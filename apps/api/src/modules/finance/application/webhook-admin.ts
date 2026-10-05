/**
 * Événements webhook en échec : lecture et rejeu sûr (spec 015, écran « webhooks en échec »).
 *
 * Un événement `FAILED` est un webhook authentique (signature vérifiée à la réception) que le module n'a PAS pu appliquer
 * (montant divergent, succès sans montant, succès tardif d'un paiement échoué…). Le rejeu ne ré-exécute JAMAIS la charge
 * stockée : il INTERROGE LE FOURNISSEUR sur le paiement concerné (même source de vérité que le rapprochement planifié) et
 * applique l'issue avec EXACTEMENT les mêmes contrôles que le webhook (`applyProviderOutcome`). Il n'existe donc aucun
 * chemin plus permissif que le webhook, et un utilisateur ne peut pas imposer une issue.
 *
 * Garanties :
 *   - idempotent : seul un événement encore `FAILED` est retraité (verrou de ligne) ; sinon réponse `replayed: true`, aucun effet ;
 *   - audité : chaque rejeu (abouti ou non) écrit `finance.webhook.replayed` / `finance.webhook.replay_failed` (sensible) ;
 *   - sans fuite : ni charge brute, ni en-têtes, ni secret ne sont lus ni renvoyés ; `error` est un code court ;
 *   - un paiement déjà réglé entre-temps (webhook concurrent, résolution manuelle) rend l'événement `IGNORED` ;
 *   - un paiement `FAILED` dont le fournisseur annonce un succès tardif reste à traiter par résolution manuelle (jamais d'encaissement ici).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, notFound } from "../domain/errors";
import type { PaymentRecord, WebhookEventRecord } from "../domain/records";
import type { Uuid } from "../domain/types";
import { getPayment } from "../infrastructure/payments-repository";
import { getWebhookEventById, listWebhookEvents, recordWebhookReplayFailure } from "../infrastructure/webhook-admin-repository";
import { markWebhookProcessed } from "../infrastructure/webhook-repository";
import { EventBuffer, inTx, type FinanceDeps } from "./deps";
import { applyProviderOutcome } from "./online-payments";
import type { ProviderVerification } from "./ports/payment-provider";

export interface ReplayWebhookResult {
  /** Vrai : l'événement n'était plus `FAILED`, rien n'a été retraité. */
  replayed: boolean;
  /** Vrai : l'événement est sorti de l'état `FAILED` à ce rejeu. */
  resolved: boolean;
  event: WebhookEventRecord;
  paymentStatus: PaymentRecord["status"] | null;
}

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Le motif exposé est toujours un code court ; tout autre contenu est masqué. */
export const safeWebhookError = (e: string | null): string | null => (e === null ? null : SAFE_CODE.test(e) ? e : "unknown");

export async function listWebhookEventsPage(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: { status?: WebhookEventRecord["status"]; provider?: string; paymentId?: Uuid; limit?: number; offset?: number } = {},
): Promise<Result<{ items: WebhookEventRecord[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await listWebhookEvents(tx, {
          status: filter.status ?? "FAILED",
          limit,
          offset: filter.offset ?? 0,
          ...(filter.provider ? { provider: filter.provider } : {}),
          ...(filter.paymentId ? { paymentId: filter.paymentId } : {}),
        }),
      ),
    { readOnly: true },
  );
}

export async function getWebhookEventView(deps: FinanceDeps, ctx: RequestContext, id: Uuid): Promise<Result<WebhookEventRecord, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await getWebhookEventById(tx, id);
      return row ? ok(row) : err(notFound(FinanceCode.NOT_FOUND, "Événement webhook", id));
    },
    { readOnly: true },
  );
}

export async function replayFailedWebhookEvent(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { id: Uuid; note?: string },
): Promise<Result<ReplayWebhookResult, AppError>> {
  // Lecture préalable (hors verrou) : on n'appelle le fournisseur que pour un événement FAILED lié à un paiement EN ATTENTE.
  const pre = await deps.db.run(
    ctx,
    async (tx) => {
      const event = await getWebhookEventById(tx, input.id);
      const payment = event?.paymentId ? await getPayment(tx, event.paymentId) : null;
      return { event, payment };
    },
    { readOnly: true },
  );
  if (!pre.event) return err(notFound(FinanceCode.NOT_FOUND, "Événement webhook", input.id));
  if (pre.event.status !== "FAILED") {
    return ok({ replayed: true, resolved: false, event: pre.event, paymentStatus: pre.payment?.status ?? null });
  }
  if (!pre.event.paymentId || !pre.payment) {
    return err(conflict(FinanceCode.WEBHOOK_NOT_REPLAYABLE, "Cet événement n'est lié à aucun paiement : rien à rejouer.", { eventId: input.id }));
  }

  let verification: ProviderVerification | null = null;
  let verifyFailure: string | null = null;
  if (pre.payment.status === "PENDING") {
    if (!pre.payment.provider || pre.payment.provider !== pre.event.provider) {
      return err(conflict(FinanceCode.WEBHOOK_NOT_REPLAYABLE, "Le fournisseur de l'événement ne correspond pas à celui du paiement.", { eventId: input.id }));
    }
    const provider = await deps.providers.resolve(ctx.tenantId, pre.event.provider, { account: pre.payment.providerAccount });
    if (!provider.ok) {
      verifyFailure = provider.error.code;
    } else {
      const v = await provider.value.verify({ paymentId: pre.payment.id, providerRef: pre.payment.providerRef, amount: pre.payment.amount });
      if (v.ok) verification = v.value;
      else verifyFailure = v.error.code;
    }
  }

  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const now = deps.clock.now();
    const event = await getWebhookEventById(tx, input.id, true);
    if (!event) return err(notFound(FinanceCode.NOT_FOUND, "Événement webhook", input.id));
    if (event.status !== "FAILED") {
      // Rejeu concurrent ou webhook redélivré entre-temps : déjà réglé, rien à faire.
      const p = event.paymentId ? await getPayment(tx, event.paymentId) : null;
      return ok({ replayed: true, resolved: false, event, paymentStatus: p?.status ?? null });
    }
    const payment = await getPayment(tx, pre.event!.paymentId!, { forUpdate: true });
    if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", pre.event!.paymentId!));

    const base = { eventId: event.eventId, provider: event.provider, previousError: safeWebhookError(event.error), ...(input.note ? { note: input.note } : {}) };
    const stillFailed = async (code: string): Promise<Result<ReplayWebhookResult, AppError>> => {
      await recordWebhookReplayFailure(tx, event.id, code);
      events.audit({
        action: "finance.webhook.replay_failed",
        resourceType: "payment",
        resourceId: payment.id,
        after: { ...base, code },
        sensitive: true,
      });
      await events.flush(tx);
      const current = (await getWebhookEventById(tx, event.id))!;
      return ok({ replayed: false, resolved: false, event: current, paymentStatus: payment.status });
    };

    if (payment.status !== "PENDING") {
      // Déjà réglé par un autre chemin : l'événement n'a plus d'objet. Un paiement échoué reste à traiter à la main.
      if (payment.status === "FAILED") return stillFailed("payment_failed_manual_resolution_required");
      await markWebhookProcessed(tx, event.id, { status: "IGNORED", paymentId: payment.id, error: "payment_already_settled", at: now });
      events.audit({ action: "finance.webhook.replayed", resourceType: "payment", resourceId: payment.id, after: { ...base, outcome: "IGNORED" }, sensitive: true });
      await events.flush(tx);
      return ok({ replayed: false, resolved: true, event: (await getWebhookEventById(tx, event.id))!, paymentStatus: payment.status });
    }

    if (!verification) return stillFailed(verifyFailure ? `provider_unavailable:${verifyFailure}`.slice(0, 80) : "provider_unavailable");
    if (verification.status === "PENDING") return stillFailed("provider_still_pending");

    const applied = await applyProviderOutcome(deps, ctx, tx, events, payment, {
      status: verification.status,
      amount: verification.amount,
      providerRef: verification.providerRef,
      ...(verification.failureReason ? { failureReason: verification.failureReason } : {}),
      source: "manual",
    });
    if (!applied.ok) return stillFailed(applied.error.code);

    await markWebhookProcessed(tx, event.id, {
      status: applied.value.applied ? "PROCESSED" : "IGNORED",
      paymentId: payment.id,
      error: null,
      at: now,
    });
    events.audit({
      action: "finance.webhook.replayed",
      resourceType: "payment",
      resourceId: payment.id,
      after: { ...base, outcome: applied.value.applied ? "PROCESSED" : "IGNORED", paymentStatus: applied.value.status },
      sensitive: true,
    });
    await events.flush(tx);
    return ok({ replayed: false, resolved: true, event: (await getWebhookEventById(tx, event.id))!, paymentStatus: applied.value.status });
  });
}
