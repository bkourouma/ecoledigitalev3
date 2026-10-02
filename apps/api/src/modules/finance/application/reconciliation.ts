/**
 * Rapprochement planifié (job `finance.reconcile-pending-payments` de `apps/worker`, spec 015 §US6).
 *
 * Pourquoi : un webhook perdu, une session abandonnée ou une réponse d'initiation égarée laissent des paiements
 * `PENDING` ; un remboursement envoyé au fournisseur dont la réponse est perdue reste `REFUND_PENDING`. Le job interroge
 * le fournisseur, tenant par tenant, par lots, après un délai configurable, et :
 *
 *   - CONFIRME / ÉCHOUE selon la réponse, avec EXACTEMENT les mêmes contrôles que `handleProviderWebhook`
 *     (`applyProviderOutcome` : montant, devise, référence, paiement simulé) — jamais un chemin plus permissif ;
 *   - ATTEND (backoff exponentiel plafonné) tant que le fournisseur répond « en attente » ou est injoignable ;
 *   - PLAFONNE les tentatives (`reconciliation.maxAttempts`) puis SIGNALE `finance.payment.reconciliation_needed`
 *     (événement outbox + audit sensible + alerte) : le job ne présume jamais d'un succès NI d'un échec ;
 *   - SIGNALE aussitôt ce qui ne peut pas être vérifié (Orange Money sans `pay_token`) ou ce qui est incohérent
 *     (montant divergent, succès tardif d'un paiement échoué) : action humaine requise (écran « paiements à rapprocher »).
 *
 * Garanties : IDEMPOTENT (le traitement d'un paiement se fait sous verrou de ligne et ne retouche pas un paiement déjà
 * réglé), plusieurs instances sans doublon (bail `FOR UPDATE SKIP LOCKED` dans `reconciliation_state`), reprise après
 * plantage (le bail expire), AUDITÉ (les effets passent par les cas d'usage audités), isolé par tenant (RLS ; un tenant
 * en échec n'arrête pas les autres).
 *
 * Remboursements en vol : lecture d'état du fournisseur si elle existe ; sinon renvoi de la MÊME demande si — et seulement
 * si — le fournisseur garantit l'idempotence ; sinon signalement (jamais de second envoi aveugle).
 */
import { createSystemContext, err, ok, type AppError, type RequestContext } from "@ecoledigitale/kernel";
import type { SystemDb, Tx } from "@ecoledigitale/database";
import { FinanceCode, notFound } from "../domain/errors";
import { FinanceEvents } from "../domain/events";
import type { PaymentRecord, ReconciliationRecord, RefundRecord } from "../domain/records";
import type { Uuid } from "../domain/types";
import { getPayment, getRefund } from "../infrastructure/payments-repository";
import {
  claimDuePayments,
  claimDueRefunds,
  ensureInFlightRefundStates,
  ensurePendingPaymentStates,
  recordAttempt,
  resolveState,
} from "../infrastructure/reconciliation-repository";
import { EventBuffer, inTx, moneyPayload, type FinanceDeps, type ReconciliationConfig } from "./deps";
import { applyProviderOutcome } from "./online-payments";
import { FinanceMetricNames, type FinanceAlert } from "./ports/operations";
import type { PaymentProvider } from "./ports/payment-provider";
import { applyRefundProviderOutcome, callProviderRefund } from "./refunds";

// ---------------------------------------------------------------------------------------------------------------------
// Compte rendu
// ---------------------------------------------------------------------------------------------------------------------

export interface SubjectCounts {
  /** Sujets pris à bail dans ce passage. */
  examined: number;
  /** Conclus par le fournisseur : paiement confirmé / remboursement terminé. */
  confirmed: number;
  /** Conclus par le fournisseur : paiement échoué / remboursement refusé. */
  failed: number;
  /** Fournisseur toujours « en attente » ou injoignable : nouvelle tentative plus tard. */
  deferred: number;
  /** Signalés `reconciliation_needed` dans ce passage. */
  flagged: number;
  /** Déjà réglés entre-temps (webhook, action manuelle). */
  settled: number;
}

export interface ReconcileTenantReport {
  tenantId: string;
  payments: SubjectCounts;
  refunds: SubjectCounts;
}

const emptyCounts = (): SubjectCounts => ({ examined: 0, confirmed: 0, failed: 0, deferred: 0, flagged: 0, settled: 0 });

/** Attente avant la tentative suivante : base × 2^(tentatives − 1), plafonnée (`attempts` = tentatives déjà faites, ≥ 1). */
export function backoffDelayMs(config: Pick<ReconciliationConfig, "backoffBaseMs" | "backoffMaxMs">, attempts: number): number {
  const exp = Math.min(Math.max(attempts - 1, 0), 30);
  return Math.min(config.backoffMaxMs, config.backoffBaseMs * 2 ** exp);
}

/** Code court et sûr tiré d'une erreur (jamais un message amont). */
function errorCodeOf(error: AppError): string {
  const reason = error.details && typeof (error.details as Record<string, unknown>).reason === "string" ? String((error.details as Record<string, unknown>).reason) : null;
  return (reason ?? error.code).slice(0, 80);
}

async function raiseAlerts(deps: FinanceDeps, alerts: FinanceAlert[]): Promise<void> {
  for (const a of alerts) {
    try {
      await deps.alerts.raise(a);
    } catch (e) {
      // Une alerte qui échoue ne doit jamais empêcher le rapprochement ; l'événement et l'audit existent déjà.
      deps.logger.error({ code: a.code, err: e instanceof Error ? e.message : "unknown" }, "finance : échec d'envoi d'une alerte");
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Un tenant
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Rapproche UN tenant : crée le suivi manquant, prend à bail les sujets échus (lots), les traite un à un. Une erreur sur un
 * sujet est consignée (tentative comptée) et n'empêche pas les suivants.
 */
export async function reconcileTenant(deps: FinanceDeps, tenantId: string): Promise<ReconcileTenantReport> {
  const cfg = deps.config.reconciliation;
  const ctx = createSystemContext(tenantId);
  const report: ReconcileTenantReport = { tenantId, payments: emptyCounts(), refunds: emptyCounts() };

  const claimed = await inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    await ensurePendingPaymentStates(tx, tenantId, deps.newId, cfg.minAgeMs, cfg.batchSize * 4);
    await ensureInFlightRefundStates(tx, tenantId, deps.newId, cfg.minAgeMs, cfg.batchSize * 4);
    return ok({
      payments: await claimDuePayments(tx, now, cfg.leaseMs, cfg.batchSize),
      refunds: await claimDueRefunds(tx, now, cfg.leaseMs, cfg.batchSize),
    });
  });
  if (!claimed.ok) throw claimed.error;

  for (const c of claimed.value.payments) {
    report.payments.examined++;
    const outcome = await reconcileOnePayment(deps, ctx, c.paymentId, c.state).catch((e: unknown) => failUnexpected(deps, "payment", c.paymentId, e));
    bump(report.payments, outcome);
    deps.metrics.count(FinanceMetricNames.RECONCILIATION, 1, { subject: "payment", outcome });
  }
  for (const c of claimed.value.refunds) {
    report.refunds.examined++;
    const outcome = await reconcileOneRefund(deps, ctx, c.refundId, c.state).catch((e: unknown) => failUnexpected(deps, "refund", c.refundId, e));
    bump(report.refunds, outcome);
    deps.metrics.count(FinanceMetricNames.RECONCILIATION, 1, { subject: "refund", outcome });
  }
  return report;
}

type Outcome = "confirmed" | "failed" | "deferred" | "flagged" | "settled";

function bump(counts: SubjectCounts, outcome: Outcome): void {
  counts[outcome]++;
}

/** Exception inattendue sur un sujet (base indisponible…) : consignée, le bail expirera et le sujet sera repris. */
function failUnexpected(deps: FinanceDeps, subject: "payment" | "refund", id: string, e: unknown): Outcome {
  deps.logger.error({ subject, id, err: e instanceof Error ? e.message : "unknown" }, "finance : rapprochement en erreur (sera repris à l'expiration du bail)");
  return "deferred";
}

export interface ReconcileAllReport {
  tenants: number;
  payments: SubjectCounts;
  refunds: SubjectCounts;
  failed: Array<{ tenantId: string; error: unknown }>;
}

/** Rapproche TOUS les tenants actifs, l'un après l'autre. Un tenant en échec est rapporté sans arrêter les autres. */
export async function reconcileAllTenants(deps: FinanceDeps, systemDb: SystemDb): Promise<ReconcileAllReport> {
  const tenants = await systemDb.run(
    "finance-reconcile :: list-tenants",
    (tx: Tx) => tx.many<{ id: string }>("SELECT id FROM kernel.tenants WHERE status = 'active' ORDER BY created_at, id"),
    { readOnly: true },
  );
  const total: ReconcileAllReport = { tenants: tenants.length, payments: emptyCounts(), refunds: emptyCounts(), failed: [] };
  for (const t of tenants) {
    try {
      const r = await reconcileTenant(deps, t.id);
      for (const k of Object.keys(total.payments) as Array<keyof SubjectCounts>) {
        total.payments[k] += r.payments[k];
        total.refunds[k] += r.refunds[k];
      }
    } catch (error) {
      total.failed.push({ tenantId: t.id, error });
    }
  }
  deps.metrics.count(FinanceMetricNames.RECONCILIATION_RUNS, 1, { tenants: String(tenants.length) });
  return total;
}

// ---------------------------------------------------------------------------------------------------------------------
// Un paiement
// ---------------------------------------------------------------------------------------------------------------------

async function reconcileOnePayment(deps: FinanceDeps, ctx: RequestContext, paymentId: Uuid, state: ReconciliationRecord): Promise<Outcome> {
  const cfg = deps.config.reconciliation;
  const payment = await deps.db.run(ctx, (tx) => getPayment(tx, paymentId), { readOnly: true });
  if (!payment) return "settled";
  if (payment.status !== "PENDING" || !payment.provider) {
    await inTx(deps, ctx, async (tx) => {
      await resolveState(tx, { paymentId }, deps.clock.now(), "already_settled");
      return ok(true as const);
    });
    return "settled";
  }
  const attemptNo = state.attempts + 1;
  const exhausted = attemptNo >= cfg.maxAttempts;

  const resolved = await deps.providers.resolve(ctx.tenantId, payment.provider);
  if (!resolved.ok) return deferOrFlagPayment(deps, ctx, payment, state, { outcome: "provider_unavailable", errorCode: errorCodeOf(resolved.error), exhausted, reason: "provider_unavailable" });
  const provider: PaymentProvider = resolved.value;

  // Orange Money (et TresorPay) : sans référence reçue à l'initiation, AUCUNE vérification n'existe — inutile de réessayer.
  if (provider.cannotVerifyWithoutProviderRef && !payment.providerRef) {
    return flagPayment(deps, ctx, payment, state, { reason: "unverifiable_no_provider_ref", outcome: "unverifiable", errorCode: null });
  }

  let verification: Awaited<ReturnType<PaymentProvider["verify"]>>;
  try {
    verification = await provider.verify({ paymentId: payment.id, providerRef: payment.providerRef, amount: payment.amount });
  } catch (e) {
    deps.logger.error({ paymentId, err: e instanceof Error ? e.message : "unknown" }, "finance : exception de l'adaptateur pendant la vérification");
    return deferOrFlagPayment(deps, ctx, payment, state, { outcome: "provider_error", errorCode: "adapter_exception", exhausted, reason: "attempts_exhausted" });
  }
  if (!verification.ok) {
    return deferOrFlagPayment(deps, ctx, payment, state, { outcome: "provider_error", errorCode: errorCodeOf(verification.error), exhausted, reason: "attempts_exhausted" });
  }
  const v = verification.value;

  // Application : MÊMES contrôles que le webhook (applyProviderOutcome). Une incohérence annule tout et se signale.
  const alerts: FinanceAlert[] = [];
  const applied = await inTx<{ outcome: Outcome }>(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const locked = await getPayment(tx, paymentId, { forUpdate: true });
    if (!locked) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", paymentId));
    const result = await applyProviderOutcome(deps, ctx, tx, events, locked, {
      status: v.status,
      amount: v.amount,
      providerRef: v.providerRef,
      ...(v.failureReason ? { failureReason: v.failureReason } : {}),
      source: "reconcile",
    });
    if (!result.ok) return result;
    const now = deps.clock.now();
    let outcome: Outcome;
    if (result.value.applied) {
      outcome = result.value.status === "CONFIRMED" ? "confirmed" : "failed";
    } else if (result.value.status === "PENDING") {
      // Le fournisseur répond toujours « en attente ».
      if (exhausted) {
        alerts.push(await raiseFlag(deps, ctx, tx, events, locked, state, attemptNo, "attempts_exhausted", null, now));
        outcome = "flagged";
      } else {
        await recordAttempt(tx, state.id, { at: now, outcome: "pending", errorCode: null, nextAttemptAt: new Date(now.getTime() + backoffDelayMs(cfg, attemptNo)) });
        outcome = "deferred";
      }
    } else {
      await resolveState(tx, { paymentId }, now, "already_settled");
      outcome = "settled";
    }
    await events.flush(tx);
    return ok({ outcome });
  });
  if (applied.ok) {
    await raiseAlerts(deps, alerts);
    return applied.value.outcome;
  }
  // Montant / devise / référence divergents, succès tardif d'un paiement échoué… : rien n'a été écrit, une personne doit trancher.
  return flagPayment(deps, ctx, payment, state, { reason: errorCodeOf(applied.error).replace(/^finance\./, ""), outcome: "mismatch", errorCode: applied.error.code });
}

interface DeferOrFlag {
  outcome: string;
  errorCode: string | null;
  exhausted: boolean;
  reason: string;
}

/** Échec technique : on réessaie plus tard (backoff) ; à la dernière tentative, on signale. */
async function deferOrFlagPayment(deps: FinanceDeps, ctx: RequestContext, payment: PaymentRecord, state: ReconciliationRecord, o: DeferOrFlag): Promise<Outcome> {
  if (o.exhausted) return flagPayment(deps, ctx, payment, state, { reason: o.reason, outcome: o.outcome, errorCode: o.errorCode });
  const cfg = deps.config.reconciliation;
  const now = deps.clock.now();
  const attemptNo = state.attempts + 1;
  await inTx(deps, ctx, async (tx) => {
    await recordAttempt(tx, state.id, { at: now, outcome: o.outcome, errorCode: o.errorCode, nextAttemptAt: new Date(now.getTime() + backoffDelayMs(cfg, attemptNo)) });
    return ok(true as const);
  });
  return "deferred";
}

/** Signale un paiement : suivi marqué, événement + audit sensible dans UNE transaction, alerte après le commit. */
async function flagPayment(
  deps: FinanceDeps,
  ctx: RequestContext,
  payment: PaymentRecord,
  state: ReconciliationRecord,
  o: { reason: string; outcome: string; errorCode: string | null },
): Promise<Outcome> {
  const alerts: FinanceAlert[] = [];
  const done = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const locked = await getPayment(tx, payment.id, { forUpdate: true });
    // Réglé entre-temps (webhook concurrent) : plus rien à signaler.
    if (!locked || locked.status !== "PENDING") {
      await resolveState(tx, { paymentId: payment.id }, deps.clock.now(), "already_settled");
      return ok("settled" as const);
    }
    alerts.push(await raiseFlag(deps, ctx, tx, events, locked, state, state.attempts + 1, o.reason, o.errorCode, deps.clock.now(), o.outcome));
    await events.flush(tx);
    return ok("flagged" as const);
  });
  if (!done.ok) throw done.error;
  await raiseAlerts(deps, alerts);
  return done.value;
}

async function raiseFlag(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  payment: PaymentRecord,
  state: ReconciliationRecord,
  attempts: number,
  reason: string,
  lastErrorCode: string | null,
  now: Date,
  outcome = "flagged",
): Promise<FinanceAlert> {
  const safeReason = reason.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80) || "unknown";
  await recordAttempt(tx, state.id, { at: now, outcome, errorCode: lastErrorCode, flag: { reason: safeReason } });
  events.add(
    FinanceEvents.PAYMENT_RECONCILIATION_NEEDED,
    {
      v: 1,
      subject: "PAYMENT",
      paymentId: payment.id,
      learnerId: payment.learnerId,
      amount: moneyPayload(payment.amount),
      provider: payment.provider,
      reason: safeReason,
      attempts,
      lastErrorCode,
    },
    { type: "payment", id: payment.id },
  );
  events.audit({
    action: "finance.payment.reconciliation_needed",
    resourceType: "payment",
    resourceId: payment.id,
    after: { reason: safeReason, provider: payment.provider, attempts, lastErrorCode },
    sensitive: true,
  });
  return {
    code: FinanceEvents.PAYMENT_RECONCILIATION_NEEDED,
    severity: "critical",
    tenantId: ctx.tenantId,
    subject: { type: "payment", id: payment.id },
    reason: safeReason,
    provider: payment.provider,
    attempts,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Un remboursement en vol
// ---------------------------------------------------------------------------------------------------------------------

async function reconcileOneRefund(deps: FinanceDeps, ctx: RequestContext, refundId: Uuid, state: ReconciliationRecord): Promise<Outcome> {
  const cfg = deps.config.reconciliation;
  const loaded = await deps.db.run(
    ctx,
    async (tx) => {
      const refund = await getRefund(tx, refundId);
      const payment = refund ? await getPayment(tx, refund.paymentId) : null;
      return { refund, payment };
    },
    { readOnly: true },
  );
  const { refund, payment } = loaded;
  if (!refund || !payment) return "settled";
  if (refund.status !== "REFUND_PENDING" || !refund.provider) {
    await inTx(deps, ctx, async (tx) => {
      await resolveState(tx, { refundId }, deps.clock.now(), "already_settled");
      return ok(true as const);
    });
    return "settled";
  }
  const attemptNo = state.attempts + 1;
  const exhausted = attemptNo >= cfg.maxAttempts;

  const resolved = await deps.providers.resolve(ctx.tenantId, refund.provider);
  if (!resolved.ok) return deferOrFlagRefund(deps, ctx, refund, payment, state, { outcome: "provider_unavailable", errorCode: errorCodeOf(resolved.error), exhausted, reason: "provider_unavailable" });
  const provider = resolved.value;
  const caps = provider.refundCapabilities ?? { partial: false, idempotent: false, statusQuery: false };

  const request = { paymentId: payment.id, providerRef: payment.providerRef, amount: refund.amount, refundId: refund.id, reason: refund.reason };

  // 1. Lecture d'état quand le fournisseur l'offre.
  if (provider.refundStatus) {
    let status: Awaited<ReturnType<NonNullable<PaymentProvider["refundStatus"]>>>;
    try {
      status = await provider.refundStatus({ paymentId: payment.id, providerRef: payment.providerRef, refundId: refund.id, providerRefundRef: refund.providerRefundRef, amount: refund.amount });
    } catch (e) {
      deps.logger.error({ refundId, err: e instanceof Error ? e.message : "unknown" }, "finance : exception de l'adaptateur pendant la lecture d'un remboursement");
      return deferOrFlagRefund(deps, ctx, refund, payment, state, { outcome: "provider_error", errorCode: "adapter_exception", exhausted, reason: "attempts_exhausted" });
    }
    if (!status.ok) return deferOrFlagRefund(deps, ctx, refund, payment, state, { outcome: "provider_error", errorCode: errorCodeOf(status.error), exhausted, reason: "attempts_exhausted" });
    const s = status.value;
    if (s.status === "SUCCEEDED" || s.status === "FAILED") {
      return concludeRefund(deps, ctx, refund, payment, state, {
        status: s.status,
        providerRefundRef: s.providerRefundRef,
        ...(s.failureReason ? { failureReason: s.failureReason } : {}),
      });
    }
    if (s.status === "PENDING") return stillPendingRefund(deps, ctx, refund, payment, state, exhausted, s.providerRefundRef);
    // NOT_FOUND : le fournisseur n'a jamais reçu la demande. Renvoi seulement s'il est idempotent.
  }

  // 2. Renvoi de la MÊME demande (référence stable) — uniquement si le fournisseur garantit l'idempotence.
  if (caps.idempotent && provider.refund) {
    const outcome = await callProviderRefund(deps, provider, request);
    if (outcome.ambiguous) {
      return deferOrFlagRefund(deps, ctx, refund, payment, state, { outcome: "provider_error", errorCode: outcome.ambiguous.code, exhausted, reason: "attempts_exhausted" });
    }
    if (outcome.status === "PENDING") return stillPendingRefund(deps, ctx, refund, payment, state, exhausted, outcome.providerRefundRef);
    return concludeRefund(deps, ctx, refund, payment, state, outcome);
  }

  // 3. Ni lecture d'état ni idempotence : on ne peut ni vérifier ni renvoyer sans risque de double remboursement.
  return flagRefund(deps, ctx, refund, payment, state, { reason: "unverifiable_refund", outcome: "unverifiable", errorCode: null });
}

async function concludeRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  refund: RefundRecord,
  payment: PaymentRecord,
  state: ReconciliationRecord,
  outcome: { status: "SUCCEEDED" | "FAILED" | "PENDING"; providerRefundRef: string | null; failureReason?: string },
): Promise<Outcome> {
  const applied = await applyRefundProviderOutcome(deps, ctx, { refundId: refund.id, outcome, source: "reconcile", provider: refund.provider! });
  if (!applied.ok) {
    // Écritures comptables impossibles alors que le fournisseur a remboursé : incohérence grave, une personne doit trancher.
    return flagRefund(deps, ctx, refund, payment, state, { reason: errorCodeOf(applied.error).replace(/^finance\./, ""), outcome: "ledger_conflict", errorCode: applied.error.code });
  }
  if (!applied.value.applied) return "settled";
  return outcome.status === "SUCCEEDED" ? "confirmed" : "failed";
}

async function stillPendingRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  refund: RefundRecord,
  payment: PaymentRecord,
  state: ReconciliationRecord,
  exhausted: boolean,
  providerRefundRef: string | null,
): Promise<Outcome> {
  if (providerRefundRef && !refund.providerRefundRef) {
    await applyRefundProviderOutcome(deps, ctx, { refundId: refund.id, outcome: { status: "PENDING", providerRefundRef }, source: "reconcile", provider: refund.provider! });
  }
  return deferOrFlagRefund(deps, ctx, refund, payment, state, { outcome: "pending", errorCode: null, exhausted, reason: "attempts_exhausted" });
}

async function deferOrFlagRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  refund: RefundRecord,
  payment: PaymentRecord,
  state: ReconciliationRecord,
  o: DeferOrFlag,
): Promise<Outcome> {
  if (o.exhausted) return flagRefund(deps, ctx, refund, payment, state, { reason: o.reason, outcome: o.outcome, errorCode: o.errorCode });
  const cfg = deps.config.reconciliation;
  const now = deps.clock.now();
  const attemptNo = state.attempts + 1;
  await inTx(deps, ctx, async (tx) => {
    await recordAttempt(tx, state.id, { at: now, outcome: o.outcome, errorCode: o.errorCode, nextAttemptAt: new Date(now.getTime() + backoffDelayMs(cfg, attemptNo)) });
    return ok(true as const);
  });
  return "deferred";
}

async function flagRefund(
  deps: FinanceDeps,
  ctx: RequestContext,
  refund: RefundRecord,
  payment: PaymentRecord,
  state: ReconciliationRecord,
  o: { reason: string; outcome: string; errorCode: string | null },
): Promise<Outcome> {
  const safeReason = o.reason.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80) || "unknown";
  const alerts: FinanceAlert[] = [];
  const done = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const locked = await getRefund(tx, refund.id, { forUpdate: true });
    if (!locked || locked.status !== "REFUND_PENDING") {
      await resolveState(tx, { refundId: refund.id }, deps.clock.now(), "already_settled");
      return ok("settled" as const);
    }
    const attempts = state.attempts + 1;
    await recordAttempt(tx, state.id, { at: deps.clock.now(), outcome: o.outcome, errorCode: o.errorCode, flag: { reason: safeReason } });
    events.add(
      FinanceEvents.REFUND_RECONCILIATION_NEEDED,
      {
        v: 1,
        subject: "REFUND",
        paymentId: payment.id,
        refundId: refund.id,
        learnerId: payment.learnerId,
        amount: moneyPayload(refund.amount),
        provider: refund.provider,
        reason: safeReason,
        attempts,
        lastErrorCode: o.errorCode,
      },
      { type: "refund", id: refund.id },
    );
    events.audit({
      action: "finance.refund.reconciliation_needed",
      resourceType: "refund",
      resourceId: refund.id,
      after: { reason: safeReason, provider: refund.provider, attempts, lastErrorCode: o.errorCode },
      sensitive: true,
    });
    await events.flush(tx);
    alerts.push({
      code: FinanceEvents.REFUND_RECONCILIATION_NEEDED,
      severity: "critical",
      tenantId: ctx.tenantId,
      subject: { type: "refund", id: refund.id },
      reason: safeReason,
      provider: refund.provider,
      attempts,
    });
    return ok("flagged" as const);
  });
  if (!done.ok) throw done.error;
  await raiseAlerts(deps, alerts);
  return done.value;
}
