/**
 * Résolution MANUELLE, motivée et à QUATRE YEUX d'un paiement ou d'un remboursement que le rapprochement n'a pas pu conclure
 * (écran « paiements à rapprocher », permission sensible `finance.payment.reconcile`, MFA).
 *
 *   1. une personne DEMANDE la résolution : ce qui s'est réellement passé chez le fournisseur (`SUCCEEDED` : l'argent est
 *      arrivé / parti ; `FAILED` : non), un motif (10 caractères minimum) et une PREUVE (référence du relevé opérateur…) ;
 *   2. une AUTRE personne l'APPROUVE (ou la refuse) : seule l'approbation écrit quelque chose ;
 *   3. l'approbation passe par les MÊMES chemins que le fournisseur (`applyProviderOutcome` pour un paiement,
 *      `applyRefundOutcomeInTx` pour un remboursement) : reçu, imputations, événements et écritures inverses identiques,
 *      journal d'audit sensible avec la preuve. Aucun raccourci comptable.
 *
 * Sujets admissibles : un paiement en ligne `PENDING` ; un remboursement `REFUND_PENDING`. Un paiement déjà `FAILED` dont
 * le fournisseur annonce un succès tardif n'est pas réactivable (machine d'états figée) : on encaisse un nouveau paiement.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, notFound, validation } from "../domain/errors";
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

const EVIDENCE_RE = /^[\p{L}\p{N} ._:/#-]{3,120}$/u;

export interface RequestResolutionInput {
  paymentId?: Uuid;
  refundId?: Uuid;
  outcome: ManualResolutionOutcome;
  reason: string;
  evidenceRef: string;
}

export async function requestManualResolution(deps: FinanceDeps, ctx: RequestContext, input: RequestResolutionInput): Promise<Result<ManualResolutionRecord, AppError>> {
  if (!ctx.userId) return err(validation(FinanceCode.INVALID_INPUT, "Une résolution manuelle exige un utilisateur identifié.", "actor"));
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
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
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
      reason,
      evidenceRef: evidence,
      requestedBy: ctx.userId!,
      requestedAt: deps.clock.now(),
    });
    if (!row) return err(conflict(FinanceCode.RESOLUTION_ALREADY_OPEN, "Une demande de résolution est déjà en attente d'approbation pour ce sujet.", {}));
    events.audit({
      action: "finance.resolution.requested",
      resourceType: "manual_resolution",
      resourceId: row.id,
      after: { ...subject, outcome: row.outcome, reason: row.reason, evidenceRef: row.evidenceRef },
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
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const res = await getResolution(tx, input.resolutionId, true);
    if (!res) return err(notFound(FinanceCode.RESOLUTION_NOT_FOUND, "Résolution", input.resolutionId));
    if (res.status !== "REQUESTED") {
      return err(conflict(FinanceCode.INVALID_TRANSITION, `La résolution est déjà ${res.status}.`, { status: res.status }));
    }
    // QUATRE YEUX : l'approbateur n'est pas le demandeur (sauf configuration explicite, déconseillée).
    if (!deps.config.manualResolutionSelfApproval && res.requestedBy === ctx.userId) {
      return err(conflict(FinanceCode.RESOLUTION_SELF_APPROVAL, "Le demandeur ne peut pas approuver sa propre résolution manuelle.", {}));
    }
    const now = deps.clock.now();
    if (res.paymentId) {
      const payment = await getPayment(tx, res.paymentId, { forUpdate: true });
      if (!payment) return err(notFound(FinanceCode.PAYMENT_NOT_FOUND, "Paiement", res.paymentId));
      if (payment.status !== "PENDING") {
        return err(conflict(FinanceCode.RESOLUTION_NOT_APPLICABLE, "Le paiement n'est plus en attente : la résolution n'a plus d'objet.", { status: payment.status }));
      }
      const applied = await applyProviderOutcome(deps, ctx, tx, events, payment, {
        status: res.outcome === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
        // L'approbateur atteste le montant ENCAISSÉ = montant attendu ; les contrôles de cohérence restent ceux du chemin fournisseur.
        amount: res.outcome === "SUCCEEDED" ? payment.amount : null,
        providerRef: payment.providerRef,
        ...(res.outcome === "FAILED" ? { failureReason: "manual_not_received" } : {}),
        source: "manual",
      });
      if (!applied.ok) return applied;
    } else {
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
    }
    await decideResolution(tx, res.id, "APPROVED", ctx.userId!, now, note);
    events.audit({
      action: "finance.resolution.approved",
      resourceType: "manual_resolution",
      resourceId: res.id,
      after: {
        ...(res.paymentId ? { paymentId: res.paymentId } : { refundId: res.refundId }),
        outcome: res.outcome,
        evidenceRef: res.evidenceRef,
        requestedBy: res.requestedBy,
        approvedBy: ctx.userId,
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
      after: { ...(res.paymentId ? { paymentId: res.paymentId } : { refundId: res.refundId }), note },
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
