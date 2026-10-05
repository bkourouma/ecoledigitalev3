/**
 * Résolution MANUELLE, motivée et auditée d'un paiement ou d'un remboursement que le rapprochement n'a pas pu conclure
 * (écran « paiements à rapprocher », permission sensible `finance.payment.reconcile`).
 *
 * Q-PAY-38 (décision du 2026-10-05) : UNE SEULE personne habilitée tranche — plus de second approbateur. Le garde-fou
 * n'est plus la dualité des personnes mais :
 *   1. une MFA RÉCENTE (step-up : `iam.sessions.mfa_elevated_until` encore ouvert, `ctx.mfaElevatedUntil`) en plus de la
 *      MFA de la permission sensible : sans élévation fraîche, 403 `finance.mfa_required` et RIEN n'est écrit ;
 *   2. un MOTIF (10 à 500 caractères) et une PREUVE (référence du relevé opérateur…) obligatoires ;
 *   3. un audit RENFORCÉ, écrit dans la même transaction (échec d'audit = rien n'est appliqué) : acteur, motif, preuve,
 *      fenêtre MFA, état AVANT et APRÈS du paiement / remboursement.
 *
 * `resolveManually` demande ET applique en une transaction. L'application passe par les MÊMES chemins que le fournisseur
 * (`applyProviderOutcome` pour un paiement, `applyRefundOutcomeInTx` pour un remboursement) : reçu, imputations, événements
 * et écritures inverses identiques. Aucun raccourci comptable.
 *
 * `requestManualResolution` / `approveManualResolution` / `rejectManualResolution` restent UNIQUEMENT pour clore les demandes
 * ouvertes avant cette décision (l'ancien flux à deux personnes) : la même personne habilitée peut les approuver, avec la
 * même exigence de MFA récente.
 *
 * Sujets admissibles : un paiement en ligne `PENDING` ; un remboursement `REFUND_PENDING`. Un paiement déjà `FAILED` dont
 * le fournisseur annonce un succès tardif n'est pas réactivable (machine d'états figée) : on encaisse un nouveau paiement.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import type { ManualResolutionOutcome, ManualResolutionRecord, ManualResolutionStatus } from "../domain/records";
import type { Uuid } from "../domain/types";
import { getPayment, getRefund } from "../infrastructure/payments-repository";
import {
  decideResolution,
  getResolution,
  insertResolution,
  listPendingPayments,
  listResolutions,
  type PendingFilter,
  type PendingPaymentRow,
} from "../infrastructure/reconciliation-repository";
import { EventBuffer, inTx, type FinanceDeps } from "./deps";
import { applyProviderOutcome } from "./online-payments";
import { applyRefundOutcomeInTx } from "./refunds";
import type { Tx } from "@ecoledigitale/database";

const EVIDENCE_RE = /^[\p{L}\p{N} ._:/#-]{3,120}$/u;

export interface RequestResolutionInput {
  paymentId?: Uuid;
  refundId?: Uuid;
  outcome: ManualResolutionOutcome;
  reason: string;
  evidenceRef: string;
}

/**
 * MFA RÉCENTE : la session a prouvé un second facteur dans la fenêtre de step-up encore ouverte. Un simple `mfa = true`
 * (MFA à la connexion, il y a des heures) ne suffit pas. Renvoie la fin de la fenêtre (tracée dans l'audit).
 */
export function requireRecentMfa(deps: FinanceDeps, ctx: RequestContext): Result<Date, AppError> {
  const until = ctx.mfaElevatedUntil;
  if (!ctx.mfa || !until || until.getTime() <= deps.clock.now().getTime()) {
    return err(
      forbidden(
        FinanceCode.MFA_STEP_UP_REQUIRED,
        "Une vérification MFA récente est exigée pour résoudre un paiement à la main : confirmez votre code puis recommencez.",
        { action: "finance.resolution" },
      ),
    );
  }
  return ok(until);
}

function validateRequest(input: RequestResolutionInput): Result<{ reason: string; evidence: string }, AppError> {
  if ((input.paymentId === undefined) === (input.refundId === undefined)) {
    return err(validation(FinanceCode.INVALID_INPUT, "Désignez un paiement OU un remboursement.", "subject"));
  }
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    return err(validation(FinanceCode.INVALID_INPUT, "Le motif est obligatoire (10 à 500 caractères).", "reason"));
  }
  const evidence = input.evidenceRef.trim();
  if (!EVIDENCE_RE.test(evidence)) {
    return err(validation(FinanceCode.INVALID_INPUT, "La preuve est obligatoire : référence de transaction ou de pièce (3 à 120 caractères).", "evidenceRef"));
  }
  return ok({ reason, evidence });
}

type Subject = { kind: "payment" | "refund"; id: Uuid; status: string; providerStatus: string | null; amount: number; allocated?: number; refunded?: number };

/** Instantané du sujet (état AVANT / APRÈS de l'audit renforcé). */
async function snapshot(tx: Tx, res: { paymentId: Uuid | null; refundId: Uuid | null }): Promise<Subject | null> {
  if (res.paymentId) {
    const p = await getPayment(tx, res.paymentId);
    return p
      ? { kind: "payment", id: p.id, status: p.status, providerStatus: p.providerStatus, amount: p.amount.amount, allocated: p.allocated.amount, refunded: p.refunded.amount }
      : null;
  }
  const r = await getRefund(tx, res.refundId!);
  return r ? { kind: "refund", id: r.id, status: r.status, providerStatus: r.providerStatus, amount: r.amount.amount } : null;
}

/** Ouvre la demande après contrôle du sujet (paiement en ligne PENDING ou remboursement REFUND_PENDING). */
async function openRequest(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  input: RequestResolutionInput,
  text: { reason: string; evidence: string },
): Promise<Result<ManualResolutionRecord, AppError>> {
  if (input.paymentId) {
    const payment = await getPayment(tx, input.paymentId, { forUpdate: true });
    if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", input.paymentId));
    if (payment.status !== "PENDING" || payment.method !== "ONLINE") {
      return err(conflict(FinanceCode.RESOLUTION_NOT_APPLICABLE, "Seul un paiement en ligne encore en attente peut être résolu à la main.", { status: payment.status }));
    }
  } else {
    const refund = await getRefund(tx, input.refundId!, { forUpdate: true });
    if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", input.refundId!));
    if (refund.status !== "REFUND_PENDING") {
      return err(conflict(FinanceCode.RESOLUTION_NOT_APPLICABLE, "Seul un remboursement envoyé au fournisseur et sans conclusion peut être résolu à la main.", { status: refund.status }));
    }
  }
  const subject = input.paymentId ? { paymentId: input.paymentId } : { refundId: input.refundId! };
  const row = await insertResolution(tx, ctx.tenantId, {
    id: deps.newId(),
    subject,
    outcome: input.outcome,
    reason: text.reason,
    evidenceRef: text.evidence,
    requestedBy: ctx.userId!,
    requestedAt: deps.clock.now(),
  });
  if (!row) return err(conflict(FinanceCode.RESOLUTION_ALREADY_OPEN, "Une demande de résolution est déjà ouverte pour ce sujet : tranchez-la.", {}));
  return ok(row);
}

/** Applique l'issue déclarée (mêmes chemins que le fournisseur). Le sujet doit être encore en attente. */
async function applyOutcome(
  deps: FinanceDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  res: ManualResolutionRecord,
): Promise<Result<true, AppError>> {
  if (res.paymentId) {
    const payment = await getPayment(tx, res.paymentId, { forUpdate: true });
    if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", res.paymentId));
    if (payment.status !== "PENDING") {
      return err(conflict(FinanceCode.RESOLUTION_NOT_APPLICABLE, "Le paiement n'est plus en attente : la résolution n'a plus d'objet.", { status: payment.status }));
    }
    const applied = await applyProviderOutcome(deps, ctx, tx, events, payment, {
      status: res.outcome === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      // La personne habilitée atteste le montant ENCAISSÉ = montant attendu ; les contrôles de cohérence restent ceux du chemin fournisseur.
      amount: res.outcome === "SUCCEEDED" ? payment.amount : null,
      providerRef: payment.providerRef,
      ...(res.outcome === "FAILED" ? { failureReason: "manual_not_received" } : {}),
      source: "manual",
    });
    if (!applied.ok) return applied;
    return ok(true);
  }
  const refund = await getRefund(tx, res.refundId!, { forUpdate: true });
  if (!refund) return err(notFound(FinanceCode.REFUND_NOT_FOUND, "Remboursement", res.refundId!));
  if (refund.status !== "REFUND_PENDING") {
    return err(conflict(FinanceCode.RESOLUTION_NOT_APPLICABLE, "Le remboursement n'est plus en attente : la résolution n'a plus d'objet.", { status: refund.status }));
  }
  const applied = await applyRefundOutcomeInTx(deps, ctx, tx, events, refund, {
    outcome: res.outcome === "SUCCEEDED" ? { status: "SUCCEEDED", providerRefundRef: refund.providerRefundRef } : { status: "FAILED", providerRefundRef: null, failureReason: "manual_not_sent" },
    source: "manual",
    provider: refund.provider ?? "unknown",
    manual: { reference: res.evidenceRef, note: res.reason },
  });
  if (!applied.ok) return applied;
  return ok(true);
}

/**
 * Q-PAY-38 : résout à la main, EN UNE FOIS, par UNE seule personne (MFA récente, motif et preuve obligatoires, audit
 * renforcé avant/après). Renvoie la résolution `APPROVED` (décideur = demandeur).
 */
export async function resolveManually(deps: FinanceDeps, ctx: RequestContext, input: RequestResolutionInput): Promise<Result<ManualResolutionRecord, AppError>> {
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "Une résolution manuelle exige un utilisateur identifié.", "actor"));
  const text = validateRequest(input);
  if (!text.ok) return text;
  const mfa = requireRecentMfa(deps, ctx);
  if (!mfa.ok) return mfa;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const opened = await openRequest(deps, ctx, tx, input, text.value);
    if (!opened.ok) return opened;
    const res = opened.value;
    const before = await snapshot(tx, res);
    const applied = await applyOutcome(deps, ctx, tx, events, res);
    if (!applied.ok) return applied;
    await decideResolution(tx, res.id, "APPROVED", ctx.userId!, deps.clock.now(), null);
    const after = await snapshot(tx, res);
    events.audit({
      action: "finance.resolution.resolved",
      resourceType: "manual_resolution",
      resourceId: res.id,
      before,
      after: { ...after, outcome: res.outcome },
      metadata: {
        actorId: ctx.userId,
        reason: res.reason,
        evidenceRef: res.evidenceRef,
        mode: "SINGLE_ACTOR",
        mfa: "step_up",
        mfaElevatedUntil: mfa.value.toISOString(),
        ...(res.paymentId ? { paymentId: res.paymentId } : { refundId: res.refundId }),
      },
      sensitive: true,
    });
    await events.flush(tx);
    return ok((await getResolution(tx, res.id))!);
  });
}

/** Ancien flux : ouvre une demande SANS l'appliquer (à clore par `approve` / `reject`). Conservé pour les demandes déjà ouvertes. */
export async function requestManualResolution(deps: FinanceDeps, ctx: RequestContext, input: RequestResolutionInput): Promise<Result<ManualResolutionRecord, AppError>> {
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "Une résolution manuelle exige un utilisateur identifié.", "actor"));
  const text = validateRequest(input);
  if (!text.ok) return text;
  const mfa = requireRecentMfa(deps, ctx);
  if (!mfa.ok) return mfa;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const opened = await openRequest(deps, ctx, tx, input, text.value);
    if (!opened.ok) return opened;
    const row = opened.value;
    events.audit({
      action: "finance.resolution.requested",
      resourceType: "manual_resolution",
      resourceId: row.id,
      after: { ...(row.paymentId ? { paymentId: row.paymentId } : { refundId: row.refundId }), outcome: row.outcome, reason: row.reason, evidenceRef: row.evidenceRef },
      metadata: { actorId: ctx.userId, mfaElevatedUntil: mfa.value.toISOString() },
      sensitive: true,
    });
    await events.flush(tx);
    return ok(row);
  });
}

export async function approveManualResolution(deps: FinanceDeps, ctx: RequestContext, input: { resolutionId: Uuid; note?: string }): Promise<Result<ManualResolutionRecord, AppError>> {
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "Une approbation exige un utilisateur identifié.", "actor"));
  const note = input.note?.trim() || null;
  if (note && note.length > 500) return err(validation(FinanceCode.INVALID_INPUT, "La note est limitée à 500 caractères.", "note"));
  const mfa = requireRecentMfa(deps, ctx);
  if (!mfa.ok) return mfa;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const res = await getResolution(tx, input.resolutionId, true);
    if (!res) return err(notFound(FinanceCode.RESOLUTION_NOT_FOUND, "Résolution", input.resolutionId));
    if (res.status !== "REQUESTED") {
      return err(conflict(FinanceCode.INVALID_TRANSITION, `La résolution est déjà ${res.status}.`, { status: res.status }));
    }
    const before = await snapshot(tx, res);
    const applied = await applyOutcome(deps, ctx, tx, events, res);
    if (!applied.ok) return applied;
    await decideResolution(tx, res.id, "APPROVED", ctx.userId!, deps.clock.now(), note);
    const after = await snapshot(tx, res);
    events.audit({
      action: "finance.resolution.approved",
      resourceType: "manual_resolution",
      resourceId: res.id,
      before,
      after: { ...after, outcome: res.outcome },
      metadata: {
        actorId: ctx.userId,
        requestedBy: res.requestedBy,
        reason: res.reason,
        evidenceRef: res.evidenceRef,
        mfa: "step_up",
        mfaElevatedUntil: mfa.value.toISOString(),
        ...(res.paymentId ? { paymentId: res.paymentId } : { refundId: res.refundId }),
      },
      sensitive: true,
    });
    await events.flush(tx);
    return ok((await getResolution(tx, res.id))!);
  });
}

export async function rejectManualResolution(deps: FinanceDeps, ctx: RequestContext, input: { resolutionId: Uuid; note?: string }): Promise<Result<ManualResolutionRecord, AppError>> {
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "Un refus exige un utilisateur identifié.", "actor"));
  const note = input.note?.trim() || null;
  if (note && note.length > 500) return err(validation(FinanceCode.INVALID_INPUT, "La note est limitée à 500 caractères.", "note"));
  const mfa = requireRecentMfa(deps, ctx);
  if (!mfa.ok) return mfa;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const res = await getResolution(tx, input.resolutionId, true);
    if (!res) return err(notFound(FinanceCode.RESOLUTION_NOT_FOUND, "Résolution", input.resolutionId));
    if (res.status !== "REQUESTED") {
      return err(conflict(FinanceCode.INVALID_TRANSITION, `La résolution est déjà ${res.status}.`, { status: res.status }));
    }
    await decideResolution(tx, res.id, "REJECTED", ctx.userId!, deps.clock.now(), note);
    events.audit({
      action: "finance.resolution.rejected",
      resourceType: "manual_resolution",
      resourceId: res.id,
      before: await snapshot(tx, res),
      after: { ...(res.paymentId ? { paymentId: res.paymentId } : { refundId: res.refundId }), note },
      metadata: { actorId: ctx.userId, requestedBy: res.requestedBy, mfaElevatedUntil: mfa.value.toISOString() },
      sensitive: true,
    });
    await events.flush(tx);
    return ok((await getResolution(tx, res.id))!);
  });
}

export async function listManualResolutions(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: { status?: ManualResolutionStatus; paymentId?: Uuid; refundId?: Uuid; limit?: number; offset?: number } = {},
): Promise<Result<ManualResolutionRecord[], AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(deps, ctx, async (tx) => ok(await listResolutions(tx, { ...filter, limit, offset: filter.offset ?? 0 })), { readOnly: true });
}

/** Liste « paiements à rapprocher » : paiements en ligne en attente, signalés d'abord, avec l'état du rapprochement. */
export async function listPendingReconciliations(
  deps: FinanceDeps,
  ctx: RequestContext,
  filter: Partial<Pick<PendingFilter, "flagged" | "provider" | "olderThan">> & { limit?: number; offset?: number } = {},
): Promise<Result<{ items: PendingPaymentRow[]; total: number }, AppError>> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  return inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await listPendingPayments(tx, {
          limit,
          offset: filter.offset ?? 0,
          ...(filter.flagged !== undefined ? { flagged: filter.flagged } : {}),
          ...(filter.provider ? { provider: filter.provider } : {}),
          ...(filter.olderThan ? { olderThan: filter.olderThan } : {}),
        }),
      ),
    { readOnly: true },
  );
}
