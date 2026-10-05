/**
 * FRAIS D'EXAMEN intégrés à l'inscription du candidat (décision métier Q-E13).
 *
 *  - BARÈME : l'établissement désigne, par type d'examen, les frais du catalogue de `finance` (catégorie EXAMS) qui s'appliquent
 *    (élèves, libres ou tous). VIDE PAR DÉFAUT : sans barème, l'obligation d'un candidat est `NOT_APPLICABLE`. Aucun montant n'est stocké
 *    comme tarif : les montants viennent de `finance` (catalogue et barèmes) et ne sont copiés qu'en INSTANTANÉ à la facturation.
 *  - À L'INSCRIPTION (élève ou libre, session officielle) : une obligation est créée DANS la transaction d'inscription ; la facture est
 *    ensuite demandée à `finance` par le PORT (jamais de SQL croisé). La demande est IDEMPOTENTE (clé `exam-fee-<candidat>`) et REJOUABLE :
 *    si `finance` est indisponible, l'inscription est maintenue et l'obligation reste `PENDING_INVOICE` (visible, avec le code d'erreur).
 *  - CANDIDAT LIBRE sans compte famille : `finance` ne facture que des apprenants ; l'obligation passe à `AWAITING_MANUAL_INVOICE`
 *    (facture à établir à son nom ou à celui de son tuteur par la comptabilité). Aucune donnée personnelle ne part vers `finance`.
 *  - DÉSINSCRIPTION : obligation non facturée -> `CANCELLED` ; facture non encaissée -> annulée, `CANCELLED` ; facture ENCAISSÉE ->
 *    `REFUND_DUE` (remboursement MANUEL, Q-PAY-32), puis `REFUND_DONE` quand une personne habilitée le confirme.
 *  - STATUT DE PAIEMENT : relu EN DIRECT auprès de `finance` à chaque consultation (jamais copié).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { ExamCandidateFeeDto, ExamFeeCatalogEntryDto, ExamFeeItemDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { feeAppliesTo, feeIdempotencyKey, type CandidateFeeRow, type FeeAppliesTo, type FeeLine } from "../domain/fees";
import type { CandidateRow, SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as fees from "../infrastructure/fees-repo";
import * as ref from "../infrastructure/reference-repo";
import * as sess from "../infrastructure/sessions-repo";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import type { ExamInvoiceState } from "./ports";

// ------------------------------------------------------------------ barème

/** Catalogue de `finance` en décoration : un catalogue indisponible donne une liste vide (jamais une erreur). */
async function safeCatalog(deps: ExaminationsDeps, ctx: RequestContext): Promise<ExamFeeCatalogEntryDto[]> {
  try {
    const r = await deps.ports.fees.listCatalog(ctx);
    return r.ok ? r.value : [];
  } catch {
    return [];
  }
}

async function catalogLabels(deps: ExaminationsDeps, ctx: RequestContext): Promise<Map<string, string>> {
  return new Map((await safeCatalog(deps, ctx)).map((e) => [e.feeId, e.label]));
}

export async function listFeeCatalog(deps: ExaminationsDeps, ctx: RequestContext): Promise<Result<ExamFeeCatalogEntryDto[], AppError>> {
  return deps.ports.fees.listCatalog(ctx);
}

export async function listFeeItems(deps: ExaminationsDeps, ctx: RequestContext, examTypeId: string): Promise<Result<ExamFeeItemDto[], AppError>> {
  const items = await inTx(deps, ctx, async (tx) => {
    if (!(await ref.getType(tx, examTypeId))) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", examTypeId));
    return ok(await fees.listFeeItems(tx, examTypeId));
  }, { readOnly: true });
  if (!items.ok) return items;
  // Libellés du catalogue : décoration seulement (un catalogue indisponible n'empêche pas de lire le barème).
  const catalog = await safeCatalog(deps, ctx);
  const byId = new Map(catalog.map((c) => [c.feeId, c]));
  return ok(items.value.map((i) => ({ id: i.id, feeId: i.feeId, appliesTo: i.appliesTo, active: i.active, label: byId.get(i.feeId)?.label ?? null, currency: byId.get(i.feeId)?.currency ?? null })));
}

/**
 * Définit le barème d'un type : les frais listés sont actifs (ou inactifs si `active: false`), les frais NON listés sont désactivés.
 * Chaque frais doit exister au catalogue EXAMS de `finance` (vérifié par le port : échec fermé sans lui). N'affecte pas les candidats déjà inscrits.
 */
export async function setFeeItems(deps: ExaminationsDeps, ctx: RequestContext, examTypeId: string, body: { items: ReadonlyArray<{ feeId: string; appliesTo: FeeAppliesTo; active: boolean }> }): Promise<Result<ExamFeeItemDto[], AppError>> {
  const ids = body.items.map((i) => i.feeId);
  if (new Set(ids).size !== ids.length) return err(validation(ExamCode.FEE_ITEM_INVALID, "Un frais ne figure qu'une fois au barème.", "items"));
  if (body.items.length > 0) {
    const catalog = await deps.ports.fees.listCatalog(ctx);
    if (!catalog.ok) return catalog;
    const known = new Set(catalog.value.filter((c) => c.active).map((c) => c.feeId));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) return err(validation(ExamCode.FEE_ITEM_INVALID, "Ces frais ne figurent pas (ou plus) au catalogue des frais d'examen de la comptabilité.", "items", { unknown }));
  }
  const saved = await inTx(deps, ctx, async (tx) => {
    const type = await ref.getType(tx, examTypeId);
    if (!type) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", examTypeId));
    const existing = await fees.listFeeItems(tx, examTypeId);
    for (const i of body.items) await fees.upsertFeeItem(tx, ctx.tenantId, { id: deps.newId(), examTypeId, feeId: i.feeId, appliesTo: i.appliesTo, active: i.active, createdBy: ctx.userId });
    for (const old of existing) if (old.active && !ids.includes(old.feeId)) await fees.upsertFeeItem(tx, ctx.tenantId, { id: deps.newId(), examTypeId, feeId: old.feeId, appliesTo: old.appliesTo, active: false, createdBy: ctx.userId });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.fee_items.set", resourceType: "exam_type", resourceId: examTypeId, sensitive: true, metadata: { items: body.items.length, active: body.items.filter((i) => i.active).length } });
    await events.flush(tx);
    return ok(true);
  });
  if (!saved.ok) return saved;
  return listFeeItems(deps, ctx, examTypeId);
}

// ------------------------------------------------------------------ obligation d'un candidat

/** Crée l'obligation du candidat DANS la transaction d'inscription (session officielle seulement). Idempotent. */
export async function createFeeInTx(deps: ExaminationsDeps, ctx: RequestContext, tx: Tx, c: CandidateRow, session: SessionRow): Promise<CandidateFeeRow | null> {
  if (session.sessionKind !== "OFFICIAL") return null;
  const items = (await fees.listFeeItems(tx, session.examTypeId, { activeOnly: true })).filter((i) => feeAppliesTo(i.appliesTo, c.candidateKind));
  const lines: FeeLine[] = items.map((i) => ({ feeId: i.feeId, label: null, amountMinor: null }));
  return fees.insertFee(tx, ctx.tenantId, {
    id: deps.newId(), sessionId: c.sessionId, candidateId: c.id, status: lines.length === 0 ? "NOT_APPLICABLE" : "PENDING_INVOICE", payerKind: c.candidateKind, lines, idempotencyKey: feeIdempotencyKey(c.id),
  });
}

export interface SettleResult {
  fee: CandidateFeeRow;
  /** Erreur qui a empêché d'aller au bout (obligation conservée, rejouable) ; `null` si tout est à jour. */
  failure: AppError | null;
}

const WITHDRAW_CANCEL_REASON = "Désinscription du candidat à l'examen : annulation des frais d'examen.";

async function recordFailure(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, error: AppError): Promise<CandidateFeeRow> {
  const r = await inTx(deps, ctx, async (tx) => ok(await fees.patchFee(tx, candidateId, { lastErrorCode: error.code })));
  if (!r.ok) throw r.error;
  return r.value;
}

/**
 * Met l'obligation d'un candidat à jour auprès de `finance` : facture (candidat inscrit), annulation ou remboursement à effectuer
 * (candidat retiré). Idempotent et rejouable ; appelée après l'inscription, après un retrait et par la reprise manuelle.
 */
export async function settleFee(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string): Promise<Result<SettleResult, AppError>> {
  const loaded = await inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId);
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    const fee = await fees.getFeeOfCandidate(tx, candidateId);
    if (!fee) return err(notFound(ExamCode.FEE_NOT_FOUND, "Frais d'examen du candidat", candidateId));
    return ok({ c, fee });
  }, { readOnly: true });
  if (!loaded.ok) return loaded;
  const { c, fee } = loaded.value;

  // ---- candidat retiré : annuler ou signaler un remboursement
  if (c.registrationStatus === "WITHDRAWN") {
    if (fee.status === "PENDING_INVOICE" || fee.status === "AWAITING_MANUAL_INVOICE") {
      return inTx(deps, ctx, async (tx) => {
        const patched = await fees.patchFee(tx, candidateId, { status: "CANCELLED", lastErrorCode: null, note: "Désinscription avant facturation : rien à rembourser." });
        const events = new EventBuffer(deps, ctx);
        events.audit({ action: "examinations.fee.cancel", resourceType: "candidate", resourceId: candidateId, metadata: { sessionId: c.sessionId, from: fee.status } });
        await events.flush(tx);
        return ok({ fee: patched, failure: null });
      });
    }
    if (fee.status === "INVOICED" && fee.invoiceId) {
      const cancelled = await deps.ports.fees.cancelInvoice(ctx, { invoiceId: fee.invoiceId, reason: WITHDRAW_CANCEL_REASON });
      if (!cancelled.ok) return ok({ fee: await recordFailure(deps, ctx, candidateId, cancelled.error), failure: cancelled.error });
      return inTx(deps, ctx, async (tx) => {
        const refund = cancelled.value.hasPayments;
        const patched = await fees.patchFee(tx, candidateId, {
          status: refund ? "REFUND_DUE" : "CANCELLED",
          lastErrorCode: null,
          note: refund ? "Facture encaissée : remboursement manuel à effectuer par la comptabilité." : "Facture annulée (aucun encaissement).",
        });
        const events = new EventBuffer(deps, ctx);
        events.audit({ action: refund ? "examinations.fee.refund_due" : "examinations.fee.cancel", resourceType: "candidate", resourceId: candidateId, sensitive: refund, metadata: { sessionId: c.sessionId, invoiceId: fee.invoiceId } });
        await events.flush(tx);
        return ok({ fee: patched, failure: null });
      });
    }
    return ok({ fee, failure: null });
  }

  // ---- candidat inscrit : demander la facture
  if (fee.status !== "PENDING_INVOICE" || c.registrationStatus !== "REGISTERED") return ok({ fee, failure: null });
  const feeIds = fee.lines.map((l) => l.feeId);
  const payer = c.candidateKind === "STUDENT" ? ({ kind: "STUDENT", studentId: c.studentId as string, enrollmentId: c.enrollmentId } as const) : ({ kind: "EXTERNAL" } as const);
  const issued = await deps.ports.fees.issueInvoice(ctx, { candidateId, payer, feeIds, idempotencyKey: fee.idempotencyKey });
  if (!issued.ok) return ok({ fee: await recordFailure(deps, ctx, candidateId, issued.error), failure: issued.error });
  const outcome = issued.value;
  // libellés du catalogue pour l'affichage d'une facture à établir à la main (décoration : un catalogue indisponible ne bloque rien)
  const labels = outcome.mode === "MANUAL_REQUIRED" ? await catalogLabels(deps, ctx) : new Map<string, string>();
  return inTx(deps, ctx, async (tx) => {
    const locked = await fees.getFeeOfCandidate(tx, candidateId, { forUpdate: true });
    if (!locked || locked.status !== "PENDING_INVOICE") return ok({ fee: (locked ?? fee) as CandidateFeeRow, failure: null });
    const events = new EventBuffer(deps, ctx);
    let patched: CandidateFeeRow;
    if (outcome.mode === "INVOICED") {
      const lines: FeeLine[] = outcome.lines.map((l) => ({ feeId: l.feeId ?? "", label: l.label, amountMinor: l.amountMinor })).filter((l) => l.feeId !== "");
      patched = await fees.patchFee(tx, candidateId, {
        status: "INVOICED", invoiceId: outcome.invoiceId, currency: outcome.currency, totalMinor: outcome.totalMinor, lines: lines.length > 0 ? lines : locked.lines, lastErrorCode: null, note: null,
      });
      events.audit({ action: "examinations.fee.invoice", resourceType: "candidate", resourceId: candidateId, metadata: { sessionId: c.sessionId, invoiceId: outcome.invoiceId, totalMinor: outcome.totalMinor, currency: outcome.currency } });
    } else {
      patched = await fees.patchFee(tx, candidateId, {
        status: "AWAITING_MANUAL_INVOICE", lines: locked.lines.map((l) => ({ ...l, label: labels.get(l.feeId) ?? l.label })), lastErrorCode: null,
        note: "Candidat libre sans compte famille : facture à établir par la comptabilité, au nom du candidat ou de son tuteur.",
      });
      events.audit({ action: "examinations.fee.manual_invoice_required", resourceType: "candidate", resourceId: candidateId, metadata: { sessionId: c.sessionId } });
    }
    await events.flush(tx);
    return ok({ fee: patched, failure: null });
  });
}

/** Mise à jour « au mieux » après une inscription ou un retrait : une panne de `finance` ne défait jamais l'acte principal. */
export async function settleQuietly(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string): Promise<void> {
  try {
    const r = await settleFee(deps, ctx, candidateId);
    if (!r.ok && r.error.code !== ExamCode.FEE_NOT_FOUND) deps.logger.warn({ candidate_id: candidateId, code: r.error.code }, "examinations : frais d'examen non soldés (reprise possible)");
    else if (r.ok && r.value.failure) deps.logger.warn({ candidate_id: candidateId, code: r.value.failure.code }, "examinations : facturation des frais d'examen en attente (reprise possible)");
  } catch (e) {
    deps.logger.warn({ candidate_id: candidateId, err: e instanceof Error ? e.message : String(e) }, "examinations : frais d'examen non soldés (reprise possible)");
  }
}

// ------------------------------------------------------------------ lecture

const paymentOf = (state: ExamInvoiceState | null): ExamCandidateFeeDto["payment"] => {
  if (!state) return { status: "UNKNOWN", paidMinor: null };
  if (state.status === "CANCELLED") return { status: "CANCELLED", paidMinor: state.paidMinor };
  if (state.status === "CREDITED") return { status: "CREDITED", paidMinor: state.paidMinor };
  if (state.totalMinor > 0 && state.paidMinor >= state.totalMinor) return { status: "PAID", paidMinor: state.paidMinor };
  return { status: state.paidMinor > 0 ? "PARTIAL" : "UNPAID", paidMinor: state.paidMinor };
};

export function toFeeDto(fee: CandidateFeeRow, state: ExamInvoiceState | null | undefined): ExamCandidateFeeDto {
  return {
    candidateId: fee.candidateId, status: fee.status, payerKind: fee.payerKind, currency: fee.currency, totalMinor: fee.totalMinor, lines: fee.lines,
    invoiceId: fee.invoiceId, invoiceNumber: state?.number ?? null,
    payment: fee.invoiceId === null ? { status: "NONE", paidMinor: null } : state === undefined ? { status: "UNKNOWN", paidMinor: null } : paymentOf(state),
    lastErrorCode: fee.lastErrorCode, note: fee.note, refundConfirmedAt: fee.refundConfirmedAt ? fee.refundConfirmedAt.toISOString() : null,
  };
}

/** Obligation d'un candidat avec le paiement relu EN DIRECT auprès de `finance` (`UNKNOWN` si `finance` ne répond pas : jamais « payé » par défaut). */
export async function getCandidateFee(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string): Promise<Result<ExamCandidateFeeDto, AppError>> {
  const loaded = await inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId);
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    const fee = await fees.getFeeOfCandidate(tx, candidateId);
    return fee ? ok(fee) : err(notFound(ExamCode.FEE_NOT_FOUND, "Frais d'examen du candidat", candidateId));
  }, { readOnly: true });
  if (!loaded.ok) return loaded;
  const fee = loaded.value;
  let state: ExamInvoiceState | null | undefined;
  if (fee.invoiceId) {
    const live = await deps.ports.fees.getInvoiceState(ctx, fee.invoiceId).catch(() => null);
    state = live && live.ok ? live.value : undefined;
  }
  return ok(toFeeDto(fee, state));
}

// ------------------------------------------------------------------ reprise et confirmation du remboursement

export async function syncCandidateFee(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string): Promise<Result<ExamCandidateFeeDto, AppError>> {
  const settled = await settleFee(deps, ctx, candidateId);
  if (!settled.ok) return settled;
  if (settled.value.failure) return err(settled.value.failure);
  return getCandidateFee(deps, ctx, candidateId);
}

export interface FeeSyncReport {
  settled: number;
  stillPending: number;
  failed: Array<{ candidateId: string; code: string; message: string }>;
}

/** Reprise en lot d'une session : factures en attente et candidats retirés encore facturés (plafonné, rejouable). */
export async function syncSessionFees(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<FeeSyncReport, AppError>> {
  const todo = await inTx(deps, ctx, async (tx) => {
    if (!(await sess.getSession(tx, sessionId))) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    return ok(await fees.listFeesToSettle(tx, sessionId, 500));
  }, { readOnly: true });
  if (!todo.ok) return todo;
  const report: FeeSyncReport = { settled: 0, stillPending: 0, failed: [] };
  for (const item of todo.value) {
    const r = await settleFee(deps, ctx, item.candidateId);
    const failure = r.ok ? r.value.failure : r.error;
    if (failure) {
      report.failed.push({ candidateId: item.candidateId, code: failure.code, message: failure.message });
      report.stillPending += 1;
    } else report.settled += 1;
  }
  const events = new EventBuffer(deps, ctx);
  const audited = await inTx(deps, ctx, async (tx) => {
    events.audit({ action: "examinations.fee.sync_session", resourceType: "session", resourceId: sessionId, metadata: { settled: report.settled, failed: report.failed.length } });
    await events.flush(tx);
    return ok(true);
  });
  if (!audited.ok) return audited;
  return ok(report);
}

/** Remboursement MANUEL (Q-PAY-32) : fait dans la comptabilité, confirmé ici par une personne habilitée avec une note ; sensible, audité. */
export async function confirmRefund(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, note: string): Promise<Result<ExamCandidateFeeDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  if (note.trim().length < 5) return err(validation(ExamCode.INVALID_INPUT, "La note de remboursement compte au moins 5 caractères.", "note"));
  const actor = ctx.userId;
  const done = await inTx(deps, ctx, async (tx) => {
    const fee = await fees.getFeeOfCandidate(tx, candidateId, { forUpdate: true });
    if (!fee) return err(notFound(ExamCode.FEE_NOT_FOUND, "Frais d'examen du candidat", candidateId));
    if (fee.status !== "REFUND_DUE") return err(conflict(ExamCode.FEE_STATE, "Aucun remboursement n'est en attente pour ce candidat.", { status: fee.status }));
    await fees.patchFee(tx, candidateId, { status: "REFUND_DONE", note: note.trim(), refundConfirmedBy: actor, refundConfirmedAt: deps.clock.now() });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.fee.refund_done", resourceType: "candidate", resourceId: candidateId, sensitive: true, reason: note.trim(), metadata: { sessionId: fee.sessionId, invoiceId: fee.invoiceId } });
    await events.flush(tx);
    return ok(true);
  });
  if (!done.ok) return done;
  return getCandidateFee(deps, ctx, candidateId);
}
