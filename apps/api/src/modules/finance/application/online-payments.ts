/**
 * Paiement en ligne : initiation, confirmation (vérification ou webhook), rejeu sûr.
 *
 * Sécurité et exactitude :
 *   - le fournisseur est résolu par le `ProviderRegistry` (aucun repli silencieux en
 *     simulation hors développement) ;
 *   - un paiement n'est confirmé que si le montant et la devise rapportés par le
 *     fournisseur correspondent EXACTEMENT au montant attendu ;
 *   - webhooks : signature vérifiée sur le corps brut avant toute lecture ; événement
 *     enregistré avec clé unique (tenant, fournisseur, event_id) ⇒ un rejeu ne retraite rien ;
 *   - un paiement simulé ne peut jamais être confirmé hors développement/test.
 */
import {
  UnauthorizedError,
  createSystemContext,
  err,
  ok,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import { isForeignKeyViolation, type Tx } from "@ecoledigitale/database";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
import { FinanceEvents } from "../domain/events";
import { idempotencyConflict, paymentFingerprint, validateIdempotencyKey } from "../domain/payment";
import type { PaymentRecord, WebhookEventRecord } from "../domain/records";
import type { Money } from "@ecoledigitale/kernel";
import type { ProviderAccount, Uuid } from "../domain/types";
import { getInvoice } from "../infrastructure/billing-repository";
import {
  confirmPaymentRow,
  failPaymentRow,
  getPayment,
  getPaymentByIdempotencyKey,
  getPaymentByProviderRef,
  insertPaymentIdempotent,
  setPaymentProviderState,
} from "../infrastructure/payments-repository";
import {
  bumpWebhookAttempts,
  getWebhookEvent,
  insertWebhookEvent,
  markWebhookProcessed,
} from "../infrastructure/webhook-repository";
import { resolveState } from "../infrastructure/reconciliation-repository";
import { isDevLikeEnvironment } from "../infrastructure/providers/registry";
import type {
  PaymentProvider,
  ProviderHeaders,
  ProviderMetadata,
  ProviderPayer,
  ProviderPaymentStatus,
  ProviderWebhookEvent,
} from "./ports/payment-provider";
import { loadPaymentView, type PaymentView } from "./billing-core";
import { EventBuffer, inTx, moneyPayload, type FinanceDeps } from "./deps";
import { finalizeConfirmedPayment, type AllocationSpec } from "./payments";

export interface InitiateOnlinePaymentInput {
  idempotencyKey: string;
  learnerId: Uuid;
  enrollmentId?: Uuid | null;
  amount: Money;
  /** Nom du fournisseur (ex. `wave`, `orange_money`, `sandbox`). */
  provider: string;
  /** Facture visée (imputation à la confirmation) ; sinon imputation automatique. */
  invoiceId?: Uuid | null;
  payer?: ProviderPayer;
  returnUrl?: string;
  description?: string;
  metadata?: ProviderMetadata;
}

export interface OnlinePaymentResult extends PaymentView {
  instructions: {
    ussdCode?: string;
    instructions?: string;
    qrCode?: string;
    redirectUrl?: string;
    expiresAt?: Date;
  } | null;
}

interface Outcome {
  status: ProviderPaymentStatus;
  amount: Money | null;
  providerRef: string | null;
  failureReason?: string;
  source: "initiate" | "verify" | "webhook" | "reconcile" | "manual";
}

const allocationFor = (invoiceId: Uuid | null): AllocationSpec =>
  invoiceId ? { mode: "AUTO", invoiceIds: [invoiceId] } : { mode: "AUTO" };

/**
 * Applique l'issue rapportée par le fournisseur à un paiement (verrouillé par l'appelant).
 * Idempotent : un paiement déjà réglé n'est pas retouché (rejeu / ordre inversé).
 * Renvoie `Err` pour un cas à traiter à la main (montant divergent, succès tardif d'un
 * paiement échoué…) — l'appelant décide de l'enregistrer sans annuler la transaction.
 */
export async function applyProviderOutcome(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  payment: PaymentRecord,
  outcome: Outcome,
): Promise<Result<{ applied: boolean; status: PaymentRecord["status"] }, AppError>> {
  if (payment.status !== "PENDING") {
    if (outcome.status === "SUCCEEDED" && payment.status === "FAILED") {
      return err(
        conflict(
          FinanceCode.PROVIDER_FAILED,
          "Le fournisseur annonce un succès pour un paiement déjà échoué : rapprochement manuel requis.",
          { paymentId: payment.id, providerRef: outcome.providerRef },
        ),
      );
    }
    return ok({ applied: false, status: payment.status });
  }

  const now = deps.clock.now();
  if (outcome.status === "PENDING") {
    await setPaymentProviderState(tx, payment.id, { providerRef: outcome.providerRef, providerStatus: "PENDING" });
    return ok({ applied: false, status: "PENDING" });
  }

  if (outcome.status === "FAILED" || outcome.status === "CANCELLED") {
    const reason = outcome.failureReason ?? (outcome.status === "CANCELLED" ? "cancelled" : "declined");
    await failPaymentRow(tx, payment.id, now, reason, outcome.status);
    await resolveState(tx, { paymentId: payment.id }, now, "failed");
    events.add(
      FinanceEvents.PAYMENT_FAILED,
      {
        v: 1,
        paymentId: payment.id,
        learnerId: payment.learnerId,
        amount: moneyPayload(payment.amount),
        provider: payment.provider,
        reason,
      },
      { type: "payment", id: payment.id },
    );
    events.audit({
      action: "finance.payment.failed",
      resourceType: "payment",
      resourceId: payment.id,
      after: { reason, provider: payment.provider, source: outcome.source },
    });
    return ok({ applied: true, status: "FAILED" });
  }

  // SUCCEEDED : garde-fous avant d'encaisser.
  if (payment.simulated && !isDevLikeEnvironment(deps.config.environment)) {
    return err(
      conflict(FinanceCode.SIMULATED_IN_PRODUCTION, "Un paiement simulé ne peut pas être confirmé hors développement.", {
        paymentId: payment.id,
        environment: deps.config.environment,
      }),
    );
  }
  if (!outcome.amount) {
    return err(
      conflict(FinanceCode.PROVIDER_AMOUNT_MISMATCH, "Le fournisseur n'a pas rapporté le montant : confirmation refusée.", {
        paymentId: payment.id,
      }),
    );
  }
  if (payment.providerRef && outcome.providerRef && payment.providerRef !== outcome.providerRef) {
    // La référence rapportée n'est pas celle de la transaction initiée : jamais d'encaissement sur une autre transaction.
    return err(
      conflict(FinanceCode.PROVIDER_REFERENCE_MISMATCH, "La référence rapportée par le fournisseur diffère de celle de la transaction.", {
        paymentId: payment.id,
      }),
    );
  }
  if (!outcome.amount.equals(payment.amount)) {
    return err(
      conflict(FinanceCode.PROVIDER_AMOUNT_MISMATCH, "Le montant rapporté par le fournisseur diffère du montant attendu.", {
        paymentId: payment.id,
        expected: payment.amount.amount,
        reported: outcome.amount.amount,
        currency: outcome.amount.currency,
      }),
    );
  }

  await setPaymentProviderState(tx, payment.id, { providerRef: outcome.providerRef, providerStatus: "SUCCEEDED" });
  await confirmPaymentRow(tx, payment.id, now, "SUCCEEDED");
  await resolveState(tx, { paymentId: payment.id }, now, "confirmed");
  const confirmed = (await getPayment(tx, payment.id))!;
  const done = await finalizeConfirmedPayment(deps, ctx, tx, events, confirmed, allocationFor(payment.intendedInvoiceId));
  if (!done.ok) return done;
  return ok({ applied: true, status: "CONFIRMED" });
}

// ---------------------------------------------------------------------------
// Initiation
// ---------------------------------------------------------------------------

export async function initiateOnlinePayment(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: InitiateOnlinePaymentInput,
): Promise<Result<OnlinePaymentResult, AppError>> {
  const key = validateIdempotencyKey(input.idempotencyKey);
  if (!key.ok) return key;
  if (!input.amount.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant du paiement doit être strictement positif.", "amount"));
  }
  const learner = await deps.learners.getLearner(ctx, input.learnerId);
  if (!learner) return err(notFound(FinanceCode.LEARNER_NOT_FOUND, "Apprenant", input.learnerId));

  // Q-PAY-30 : compte de l'établissement, sinon compte de la plateforme ; le compte retenu est enregistré sur le paiement.
  const resolved = await deps.providers.resolveAccounted(ctx.tenantId, input.provider);
  if (!resolved.ok) return resolved;
  const provider = resolved.value.provider;
  const providerAccount = resolved.value.account;

  const fingerprint = paymentFingerprint({
    learnerId: input.learnerId,
    amount: input.amount,
    method: "ONLINE",
    payerKind: "LEARNER",
    provider: input.provider,
    invoiceId: input.invoiceId ?? null,
    extra: { enrollmentId: input.enrollmentId ?? null },
  });

  // Transaction 1 : réserver le paiement (PENDING), idempotent.
  const reserved = await inTx(deps, ctx, async (tx) => {
    const known = await getPaymentByIdempotencyKey(tx, key.value);
    if (known) {
      if (known.requestFingerprint !== fingerprint) return err(idempotencyConflict(key.value));
      return ok({ payment: known, replayed: true });
    }
    if (input.invoiceId) {
      const invoice = await getInvoice(tx, input.invoiceId);
      if (!invoice || invoice.learnerId !== input.learnerId) {
        return err(notFound(FinanceCode.INVOICE_NOT_FOUND, "Facture", input.invoiceId));
      }
      if (invoice.currency !== input.amount.currency) {
        return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise du paiement différente de celle de la facture.", "amount"));
      }
    }
    const inserted = await insertPaymentIdempotent(tx, ctx.tenantId, {
      id: deps.newId(),
      learnerId: input.learnerId,
      enrollmentId: input.enrollmentId ?? null,
      payerKind: "LEARNER",
      payerRef: null,
      payerName: input.payer?.name ?? null,
      method: "ONLINE",
      status: "PENDING",
      amount: input.amount,
      idempotencyKey: key.value,
      requestFingerprint: fingerprint,
      provider: input.provider,
      providerAccount,
      providerRef: null,
      simulated: provider.simulated,
      reference: null,
      intendedInvoiceId: input.invoiceId ?? null,
      cashSessionId: null,
      receivedAt: deps.clock.now(),
      confirmedAt: null,
      createdBy: ctx.userId,
    });
    if (!inserted) {
      const raced = (await getPaymentByIdempotencyKey(tx, key.value))!;
      if (raced.requestFingerprint !== fingerprint) return err(idempotencyConflict(key.value));
      return ok({ payment: raced, replayed: true });
    }
    return ok({ payment: inserted, replayed: false });
  });
  if (!reserved.ok) return reserved;
  const { payment, replayed } = reserved.value;

  // Un paiement déjà réglé (rejeu après succès) : on renvoie son état tel quel.
  if (payment.status !== "PENDING") {
    const view = await deps.db.run(ctx, (tx) => loadPaymentView(tx, payment.id, true), { readOnly: true });
    return ok({ ...view, instructions: null });
  }
  // Rejeu d'un paiement en attente DÉJÀ transmis au fournisseur : pas de seconde initiation.
  if (replayed && payment.providerRef) {
    const view = await deps.db.run(ctx, (tx) => loadPaymentView(tx, payment.id, true), { readOnly: true });
    return ok({ ...view, instructions: null });
  }

  // Appel fournisseur (hors transaction : appel réseau). L'initiation est idempotente côté
  // fournisseur grâce à la référence marchande = identifiant du paiement.
  const initiation = await provider.initiate({
    tenantId: ctx.tenantId,
    paymentId: payment.id,
    amount: input.amount,
    ...(input.payer ? { payer: input.payer } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
    ...(deps.config.webhookBaseUrl
      ? { notifyUrl: `${deps.config.webhookBaseUrl}/api/v1/finance/webhooks/${encodeURIComponent(input.provider)}/${ctx.tenantId}` }
      : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  if (!initiation.ok) {
    // Échec technique : le paiement reste PENDING (sans référence) ; l'appelant peut rejouer
    // avec la même clé d'idempotence.
    deps.logger.warn({ paymentId: payment.id, provider: input.provider, code: initiation.error.code }, "initiation de paiement en échec");
    return err(
      conflict(FinanceCode.PROVIDER_FAILED, "Le fournisseur de paiement n'a pas pu initier la transaction.", {
        provider: input.provider,
        cause: initiation.error.code,
      }),
    );
  }

  // Transaction 2 : enregistrer le résultat (et confirmer / échouer si le fournisseur est définitif).
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const locked = await getPayment(tx, payment.id, { forUpdate: true });
    if (!locked) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", payment.id));
    const i = initiation.value;
    if (locked.status === "PENDING") {
      await setPaymentProviderState(tx, locked.id, { providerRef: i.providerRef, providerStatus: i.status });
      events.add(
        FinanceEvents.PAYMENT_INITIATED,
        {
          v: 1,
          paymentId: locked.id,
          learnerId: locked.learnerId,
          amount: moneyPayload(locked.amount),
          provider: input.provider,
          providerRef: i.providerRef,
        },
        { type: "payment", id: locked.id },
      );
      if (i.status !== "PENDING") {
        const current = (await getPayment(tx, locked.id))!;
        const applied = await applyProviderOutcome(deps, ctx, tx, events, current, {
          status: i.status,
          amount: i.status === "SUCCEEDED" ? current.amount : null,
          providerRef: i.providerRef,
          ...(i.failureReason ? { failureReason: i.failureReason } : {}),
          source: "initiate",
        });
        if (!applied.ok) return applied;
      }
    }
    await events.flush(tx);
    const view = await loadPaymentView(tx, locked.id, replayed);
    return ok({
      ...view,
      instructions: {
        ...(i.ussdCode ? { ussdCode: i.ussdCode } : {}),
        ...(i.instructions ? { instructions: i.instructions } : {}),
        ...(i.qrCode ? { qrCode: i.qrCode } : {}),
        ...(i.redirectUrl ? { redirectUrl: i.redirectUrl } : {}),
        ...(i.expiresAt ? { expiresAt: i.expiresAt } : {}),
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Vérification active (interrogation du fournisseur)
// ---------------------------------------------------------------------------

/** Interroge le fournisseur sur un paiement EN ATTENTE et applique l'issue (job de rattrapage, support). */
export async function verifyPendingPayment(
  deps: FinanceDeps,
  ctx: RequestContext,
  input: { paymentId: Uuid },
): Promise<Result<PaymentView, AppError>> {
  const payment = await deps.db.run(ctx, (tx) => getPayment(tx, input.paymentId), { readOnly: true });
  if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", input.paymentId));
  if (payment.status !== "PENDING" || !payment.provider) {
    return ok(await deps.db.run(ctx, (tx) => loadPaymentView(tx, payment.id, true), { readOnly: true }));
  }
  // Le paiement est interrogé sur le compte où il a été initié (jamais sur un autre compte ni une autre école).
  const provider = await deps.providers.resolve(ctx.tenantId, payment.provider, { account: payment.providerAccount });
  if (!provider.ok) return provider;
  const verification = await provider.value.verify({ paymentId: payment.id, providerRef: payment.providerRef, amount: payment.amount });
  if (!verification.ok) return verification;

  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const locked = await getPayment(tx, payment.id, { forUpdate: true });
    if (!locked) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", payment.id));
    const applied = await applyProviderOutcome(deps, ctx, tx, events, locked, {
      status: verification.value.status,
      amount: verification.value.amount,
      providerRef: verification.value.providerRef,
      ...(verification.value.failureReason ? { failureReason: verification.value.failureReason } : {}),
      source: "verify",
    });
    if (!applied.ok) return applied;
    await events.flush(tx);
    return ok(await loadPaymentView(tx, locked.id, false));
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface HandleWebhookInput {
  tenantId: string;
  provider: string;
  /** Corps BRUT tel que reçu (la signature porte sur ces octets). */
  rawBody: string;
  headers: ProviderHeaders;
  /** Paramètres d'URL (schémas à URL signée : Orange Money, MTN MoMo). */
  query?: Readonly<Record<string, string>>;
  requestId?: string;
}

export interface WebhookResult {
  status: WebhookEventRecord["status"];
  /** Vrai si l'événement avait déjà été traité (rejeu) : rien n'a été retraité. */
  replayed: boolean;
  paymentId: Uuid | null;
  paymentStatus: PaymentRecord["status"] | null;
}

/**
 * Traite un webhook fournisseur de façon IDEMPOTENTE et sûre au rejeu.
 *  1. résolution du fournisseur (refus si non configuré / sandbox interdit) ;
 *  2. vérification de signature sur le corps brut (sinon 401, rien n'est stocké) ;
 *  3. enregistrement de l'événement, clé unique (tenant, fournisseur, event_id) :
 *     déjà traité ⇒ réponse immédiate ; deux livraisons concurrentes se sérialisent ;
 *  4. rapprochement du paiement (par notre référence ou celle du fournisseur) et
 *     application de l'issue, dans la même transaction que l'enregistrement.
 * Les cas à traiter à la main (montant divergent, paiement inconnu, succès tardif) sont
 * ENREGISTRÉS (statut FAILED / IGNORED + erreur) sans modifier de paiement.
 */
export async function handleProviderWebhook(deps: FinanceDeps, input: HandleWebhookInput): Promise<Result<WebhookResult, AppError>> {
  const ctx = createSystemContext(input.tenantId, input.requestId);
  const resolved = await deps.providers.resolveAccounted(input.tenantId, input.provider);
  if (!resolved.ok) return resolved;
  let provider: PaymentProvider = resolved.value.provider;
  let signedAccount = resolved.value.account;

  const meta = { tenantId: input.tenantId, ...(input.query ? { query: input.query } : {}) };
  if (!provider.verifySignature(input.rawBody, input.headers, meta)) {
    // Q-PAY-30 : une école qui a configuré son compte APRÈS avoir encaissé sur le compte de la plateforme reçoit encore des
    // notifications signées par ce dernier. On essaie le compte plateforme, jamais celui d'une autre école.
    let accepted = false;
    if (signedAccount === "TENANT" && (await deps.providers.platformAccountReady(input.provider))) {
      const platform = await deps.providers.resolveAccounted(input.tenantId, input.provider, { account: "PLATFORM" });
      if (platform.ok && platform.value.provider.verifySignature(input.rawBody, input.headers, meta)) {
        provider = platform.value.provider;
        signedAccount = "PLATFORM";
        accepted = true;
      }
    }
    if (!accepted) {
      deps.logger.warn({ tenantId: input.tenantId, provider: input.provider }, "webhook de paiement : signature invalide");
      return err(new UnauthorizedError("Signature de webhook invalide.", { code: FinanceCode.WEBHOOK_SIGNATURE_INVALID }));
    }
  }
  const parsed = await provider.handleWebhook(input.rawBody, input.headers, meta);
  if (!parsed.ok) return parsed;
  let event = parsed.value;

  // Indice sans signature de contenu : la PREUVE est l'API de statut du fournisseur (appel hors transaction).
  if (event.requiresActiveVerification) {
    const refined = await refineWithActiveVerification(deps, ctx, provider, input.provider, event, signedAccount);
    if (!refined.ok) return refined;
    event = refined.value;
  }

  const processed = inTx<WebhookResult>(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const now = deps.clock.now();

    let record = await insertWebhookEvent(tx, ctx.tenantId, {
      id: deps.newId(),
      provider: input.provider,
      eventId: event.eventId,
      eventType: event.type,
      payload: event.storedPayload ?? safeJson(input.rawBody),
      receivedAt: now,
    });
    if (!record) {
      // Rejeu : l'événement existe déjà (éventuellement traité par une transaction concurrente, que
      // l'INSERT a attendue). Traité ou ignoré ⇒ réponse immédiate, aucun effet.
      const existing = (await getWebhookEvent(tx, input.provider, event.eventId, true))!;
      if (existing.status === "PROCESSED" || existing.status === "IGNORED") {
        return ok({ status: existing.status, replayed: true, paymentId: existing.paymentId, paymentStatus: null });
      }
      await bumpWebhookAttempts(tx, existing.id);
      record = existing;
    }

    const payment = event.paymentId
      ? await getPayment(tx, event.paymentId, { forUpdate: true })
      : event.providerRef
        ? await getPaymentByProviderRef(tx, input.provider, event.providerRef, true)
        : null;
    if (!payment || (payment.provider && payment.provider !== input.provider)) {
      await markWebhookProcessed(tx, record.id, { status: "IGNORED", paymentId: null, error: "payment_not_found", at: now });
      deps.logger.warn({ provider: input.provider, eventId: event.eventId }, "webhook de paiement : paiement introuvable");
      return ok({ status: "IGNORED" as const, replayed: false, paymentId: null, paymentStatus: null });
    }

    // Q-PAY-30 : un événement signé par un compte n'agit jamais sur un paiement encaissé sur un autre compte.
    if (payment.providerAccount && payment.providerAccount !== signedAccount) {
      await markWebhookProcessed(tx, record.id, { status: "FAILED", paymentId: payment.id, error: FinanceCode.WEBHOOK_ACCOUNT_MISMATCH, at: now });
      events.audit({
        action: "finance.webhook.rejected",
        resourceType: "payment",
        resourceId: payment.id,
        after: { code: FinanceCode.WEBHOOK_ACCOUNT_MISMATCH, eventId: event.eventId, provider: input.provider, paymentAccount: payment.providerAccount, signedAccount },
        sensitive: true,
      });
      await events.flush(tx);
      return ok({ status: "FAILED" as const, replayed: false, paymentId: payment.id, paymentStatus: payment.status });
    }

    const applied = await applyProviderOutcome(deps, ctx, tx, events, payment, {
      status: event.status,
      amount: event.amount,
      providerRef: event.providerRef,
      source: "webhook",
    });
    if (!applied.ok) {
      // À rapprocher à la main : on garde la trace de l'événement (FAILED + motif) et on NE touche pas au paiement.
      deps.logger.error(
        { provider: input.provider, eventId: event.eventId, paymentId: payment.id, code: applied.error.code },
        "webhook de paiement non applicable : rapprochement manuel requis",
      );
      await markWebhookProcessed(tx, record.id, { status: "FAILED", paymentId: payment.id, error: applied.error.code, at: now });
      events.audit({
        action: "finance.webhook.rejected",
        resourceType: "payment",
        resourceId: payment.id,
        after: { code: applied.error.code, eventId: event.eventId, provider: input.provider },
        sensitive: true,
      });
      await events.flush(tx);
      return ok({ status: "FAILED" as const, replayed: false, paymentId: payment.id, paymentStatus: payment.status });
    }
    await markWebhookProcessed(tx, record.id, {
      status: applied.value.applied ? "PROCESSED" : "IGNORED",
      paymentId: payment.id,
      error: null,
      at: now,
    });
    await events.flush(tx);
    return ok({
      status: applied.value.applied ? ("PROCESSED" as const) : ("IGNORED" as const),
      replayed: false,
      paymentId: payment.id,
      paymentStatus: applied.value.status,
    });
  });
  try {
    return await processed;
  } catch (e) {
    // Tenant inexistant (identifiant d'URL inventé) : introuvable, pas une erreur 500.
    if (isForeignKeyViolation(e)) return err(notFound(FinanceCode.NOT_FOUND, "Établissement", input.tenantId));
    throw e;
  }
}

/**
 * Remplace le statut, le montant et la référence d'un webhook-indice par ceux de l'API de statut du fournisseur.
 *  - paiement introuvable : l'événement passe tel quel (il sera enregistré IGNORÉ, `payment_not_found`) — AUCUN appel
 *    sortant n'est fait pour un identifiant inconnu (un tiers ne peut pas nous faire interroger le fournisseur à volonté) ;
 *  - paiement déjà réglé : rien à vérifier, l'indice passe (le traitement le verra réglé) ;
 *  - fournisseur injoignable ou réponse en attente alors que l'indice annonçait un état final : `WEBHOOK_UNVERIFIED`
 *    (409) — rien n'est enregistré et le fournisseur réessaiera.
 */
async function refineWithActiveVerification(
  deps: FinanceDeps,
  ctx: RequestContext,
  provider: PaymentProvider,
  providerName: string,
  event: ProviderWebhookEvent,
  signedAccount: ProviderAccount,
): Promise<Result<ProviderWebhookEvent, AppError>> {
  const payment = await deps.db.run(
    ctx,
    async (tx) =>
      event.paymentId
        ? getPayment(tx, event.paymentId)
        : event.providerRef
          ? getPaymentByProviderRef(tx, providerName, event.providerRef)
          : null,
    { readOnly: true },
  );
  if (
    !payment ||
    (payment.provider && payment.provider !== providerName) ||
    payment.status !== "PENDING" ||
    // Compte différent : aucune interrogation ici, le traitement refusera l'événement (`webhook_account_mismatch`).
    (payment.providerAccount && payment.providerAccount !== signedAccount)
  ) {
    return ok({ ...event, requiresActiveVerification: false });
  }
  const verification = await provider.verify({ paymentId: payment.id, providerRef: payment.providerRef, amount: payment.amount });
  if (!verification.ok) {
    deps.logger.warn({ provider: providerName, paymentId: payment.id, code: verification.error.code }, "webhook de paiement : vérification active impossible");
    return err(
      conflict(FinanceCode.WEBHOOK_UNVERIFIED, "Le statut du paiement n'a pas pu être vérifié auprès du fournisseur ; réessayez.", {
        provider: providerName,
      }),
    );
  }
  const v = verification.value;
  if (v.status === "PENDING" && event.status !== "PENDING") {
    return err(
      conflict(FinanceCode.WEBHOOK_UNVERIFIED, "Le fournisseur n'a pas encore confirmé ce statut ; réessayez.", { provider: providerName }),
    );
  }
  return ok({
    ...event,
    requiresActiveVerification: false,
    paymentId: payment.id,
    status: v.status,
    amount: v.amount,
    providerRef: v.providerRef ?? event.providerRef,
  });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: raw.slice(0, 2000) };
  }
}
