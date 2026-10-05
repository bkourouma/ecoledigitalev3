/**
 * RÉVISIONS À QUATRE YEUX : une note (session à résultats saisis) ou un résultat PUBLIÉ ne se corrige que par une révision
 * DEMANDÉE par une personne et APPROUVÉE par une AUTRE (R-EXA-07, Q-E17).
 *
 *  - La demande (`revision_requests`) porte la valeur proposée et le motif (≥ 10 caractères). L'approbateur est TOUJOURS
 *    l'utilisateur authentifié : aucun champ de la requête ne permet de désigner un approbateur.
 *  - L'approbation insère la révision (ajout seul : avant / après / demandeur / approbateur) ET applique la correction dans la
 *    MÊME transaction — la base refuse toute correction sans sa révision (xid). Une demande en attente par cible.
 *  - Une correction de résultat révoque les documents émis qui en dépendent (attestation, relevé) : ils se réémettent en version suivante.
 *  - Ni note ni moyenne dans l'audit ni dans les événements : seulement des codes d'issue et des identifiants.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamPage, ExamRevisionRequestDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { compareDecimal, normalizeDecimal } from "../domain/decimal";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import type { ResultCode, ScoreStatus, SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as out from "../infrastructure/outputs-repo";
import * as ref from "../infrastructure/reference-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import { addTransmission, transmittedPayload } from "./admission-transfer";
import { toRevisionRequestDto } from "./dto";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";

const NO_AVERAGE: readonly string[] = ["ABSENT", "EXCLUDED", "DEFERRED"];

export async function requestResultRevision(deps: ExaminationsDeps, ctx: RequestContext, resultId: string, body: { resultCode: ResultCode; average?: string | null | undefined; reason: string }): Promise<Result<ExamRevisionRequestDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const average = NO_AVERAGE.includes(body.resultCode) ? null : body.average != null ? normalizeDecimal(body.average) : null;
  if (NO_AVERAGE.includes(body.resultCode) && body.average != null) return err(validation(ExamCode.INVALID_INPUT, "Un absent, exclu ou ajourné n'a pas de moyenne.", "average"));
  return inTx(deps, ctx, async (tx) => {
    const current = await res.getResult(tx, resultId);
    if (!current) return err(notFound(ExamCode.RESULT_NOT_FOUND, "Résultat", resultId));
    if (current.status !== "PUBLISHED") return err(conflict(ExamCode.REVISION_NOT_NEEDED, "Un résultat non publié se saisit directement : aucune révision nécessaire."));
    const sameAverage = current.average === null ? average === null : average !== null && compareDecimal(current.average, average) === 0;
    if (current.resultCode === body.resultCode && sameAverage) return err(validation(ExamCode.REVISION_NO_CHANGE, "La valeur proposée est identique à la valeur actuelle.", "resultCode"));
    const q = await res.insertRevisionRequest(tx, ctx.tenantId, {
      id: deps.newId(), sessionId: current.sessionId, targetKind: "RESULT", scoreId: null, resultId, proposed: { toCode: body.resultCode, toAverage: average }, reason: body.reason.trim(), requestedBy: actor,
    });
    const events = new EventBuffer(deps, ctx);
    events.add(ExaminationsEvents.REVISION_REQUESTED, { v: 1, sessionId: current.sessionId, requestId: q.id, targetKind: "RESULT" }, { type: "examinations.revision", id: q.id });
    events.audit({ action: "examinations.revision.request", resourceType: "revision_request", resourceId: q.id, reason: q.reason, metadata: { sessionId: current.sessionId, target: "RESULT", resultId, toCode: body.resultCode } });
    await events.flush(tx);
    const candidate = await cand.getCandidate(tx, current.candidateId);
    return ok(toRevisionRequestDto(q, { candidateId: current.candidateId, candidateNumber: candidate?.candidateNumber ?? null, current: { code: current.resultCode, average: current.average === null ? null : normalizeDecimal(current.average) } }));
  });
}

export async function requestScoreRevision(deps: ExaminationsDeps, ctx: RequestContext, scoreId: string, body: { status: ScoreStatus; score?: string | null | undefined; reason: string }): Promise<Result<ExamRevisionRequestDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const score = body.status === "ENTERED" && body.score != null ? normalizeDecimal(body.score) : null;
  return inTx(deps, ctx, async (tx) => {
    const current = await res.getScore(tx, scoreId);
    if (!current) return err(notFound(ExamCode.SCORE_NOT_FOUND, "Note", scoreId));
    const same = current.status === body.status && (current.score === null ? score === null : score !== null && compareDecimal(current.score, score) === 0);
    if (same) return err(validation(ExamCode.REVISION_NO_CHANGE, "La valeur proposée est identique à la valeur actuelle.", "score"));
    const q = await res.insertRevisionRequest(tx, ctx.tenantId, {
      id: deps.newId(), sessionId: current.sessionId, targetKind: "SCORE", scoreId, resultId: null, proposed: { toStatus: body.status, toScore: score }, reason: body.reason.trim(), requestedBy: actor,
    });
    const events = new EventBuffer(deps, ctx);
    events.add(ExaminationsEvents.REVISION_REQUESTED, { v: 1, sessionId: current.sessionId, requestId: q.id, targetKind: "SCORE" }, { type: "examinations.revision", id: q.id });
    events.audit({ action: "examinations.revision.request", resourceType: "revision_request", resourceId: q.id, reason: q.reason, metadata: { sessionId: current.sessionId, target: "SCORE", scoreId } });
    await events.flush(tx);
    const candidate = await cand.getCandidate(tx, current.candidateId);
    return ok(toRevisionRequestDto(q, { candidateId: current.candidateId, candidateNumber: candidate?.candidateNumber ?? null, current: { status: current.status, score: current.score === null ? null : normalizeDecimal(current.score) } }));
  });
}

export async function listRevisionRequests(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, filter: { status?: string | undefined; page: number; pageSize: number }): Promise<Result<ExamPage<ExamRevisionRequestDto>, AppError>> {
  const pageSize = Math.min(filter.pageSize, deps.config.pageSizeMax);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await sess.getSession(tx, sessionId))) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      const page = await res.listRevisionRequests(tx, { sessionId, status: filter.status, page: filter.page, pageSize });
      const items: ExamRevisionRequestDto[] = [];
      for (const q of page.items) {
        let candidateId: string | null = null;
        let current: Record<string, unknown> = {};
        if (q.targetKind === "RESULT" && q.resultId) {
          const r = await res.getResult(tx, q.resultId);
          candidateId = r?.candidateId ?? null;
          current = r ? { code: r.resultCode, average: r.average === null ? null : normalizeDecimal(r.average) } : {};
        } else if (q.scoreId) {
          const s = await res.getScore(tx, q.scoreId);
          candidateId = s?.candidateId ?? null;
          current = s ? { status: s.status, score: s.score === null ? null : normalizeDecimal(s.score) } : {};
        }
        const c = candidateId ? await cand.getCandidate(tx, candidateId) : null;
        items.push(toRevisionRequestDto(q, { candidateId, candidateNumber: c?.candidateNumber ?? null, current }));
      }
      return ok({ items, total: page.total, page: filter.page, pageSize });
    },
    { readOnly: true },
  );
}

/**
 * Approuve la demande : l'approbateur est l'utilisateur authentifié, DIFFÉRENT du demandeur. Révision et correction sont insérées
 * dans la même transaction (la base refuse la correction sans sa révision).
 */
export async function approveRevision(deps: ExaminationsDeps, ctx: RequestContext, requestId: string): Promise<Result<ExamRevisionRequestDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const approver = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const q = await res.getRevisionRequest(tx, requestId, { forUpdate: true });
    if (!q) return err(notFound(ExamCode.REQUEST_NOT_FOUND, "Demande de révision", requestId));
    if (q.status !== "PENDING") return err(conflict(ExamCode.REVISION_REQUEST_CLOSED, `Cette demande est déjà ${q.status === "APPROVED" ? "approuvée" : "refusée"}.`));
    if (q.requestedBy === approver) return err(forbidden(ExamCode.REVISION_SAME_PERSON, "Une révision est approuvée par une autre personne que celle qui l'a demandée."));
    const session = (await sess.getSession(tx, q.sessionId)) as SessionRow;
    const events = new EventBuffer(deps, ctx);
    const revisionId = deps.newId();
    let candidateId: string | null = null;
    let current: Record<string, unknown> = {};

    if (q.targetKind === "RESULT" && q.resultId) {
      const r = await res.getResult(tx, q.resultId);
      if (!r) return err(notFound(ExamCode.RESULT_NOT_FOUND, "Résultat", q.resultId));
      candidateId = r.candidateId;
      current = { code: r.resultCode, average: r.average === null ? null : normalizeDecimal(r.average) };
      const toCode = q.proposed.toCode as ResultCode;
      const toAverage = (q.proposed.toAverage as string | null | undefined) ?? null;
      // La révision précède la correction ; les deux dans la même transaction (xid).
      await res.insertResultRevision(tx, ctx.tenantId, { id: revisionId, resultId: r.id, fromCode: r.resultCode, toCode, fromAverage: r.average, toAverage, reason: q.reason, requestedBy: q.requestedBy, approvedBy: approver });
      const corrected = await res.applyResultCorrection(tx, r.id, { resultCode: toCode, average: toAverage });
      // Q-E18 : une correction approuvée retransmet « admis / non admis » ET la moyenne corrigés aux admissions (version plus grande).
      if (corrected) {
        const owner = await cand.getCandidate(tx, r.candidateId);
        const transfer = owner ? transmittedPayload(session, await ref.getType(tx, session.examTypeId), owner, corrected) : null;
        if (transfer) addTransmission(events, transfer, "REVISION");
      }
      if (session.sessionKind === "OFFICIAL") {
        events.add(ExaminationsEvents.RESULT_REVISED, { v: 1, sessionId: q.sessionId, candidateId: r.candidateId, resultId: r.id, fromOutcome: r.resultCode, toOutcome: toCode }, { type: "examinations.result", id: r.id });
      }
      // Les documents qui reposent sur l'ancien résultat sont révoqués : ils se réémettent en version suivante.
      for (const kind of ["ATTESTATION_REUSSITE", "RELEVE_NOTES"] as const) {
        const live = await out.getLiveDocument(tx, r.candidateId, kind);
        if (!live) continue;
        await out.revokeDocument(tx, live.id, `Résultat corrigé par révision approuvée (demande ${q.id.slice(0, 8)}).`);
        events.add(ExaminationsEvents.DOCUMENT_REVOKED, { v: 1, sessionId: q.sessionId, candidateId: r.candidateId, documentId: live.id, kind, version: live.version }, { type: "examinations.document", id: live.id });
      }
    } else if (q.scoreId) {
      const s = await res.getScore(tx, q.scoreId);
      if (!s) return err(notFound(ExamCode.SCORE_NOT_FOUND, "Note", q.scoreId));
      candidateId = s.candidateId;
      current = { status: s.status, score: s.score === null ? null : normalizeDecimal(s.score) };
      const toStatus = q.proposed.toStatus as ScoreStatus;
      const toScore = (q.proposed.toScore as string | null | undefined) ?? null;
      await res.insertScoreRevision(tx, ctx.tenantId, { id: revisionId, scoreId: s.id, fromStatus: s.status, fromScore: s.score, toStatus, toScore, reason: q.reason, requestedBy: q.requestedBy, approvedBy: approver });
      await res.updateScore(tx, s.id, { status: toStatus, score: toScore, source: s.source, sourceRef: s.sourceRef, enteredBy: s.enteredBy });
    } else {
      return err(validation(ExamCode.INVALID_INPUT, "Demande de révision sans cible."));
    }

    const decided = await res.decideRevisionRequest(tx, requestId, { status: "APPROVED", decidedBy: approver, decisionNote: null, revisionId });
    if (!decided) return err(conflict(ExamCode.REVISION_REQUEST_CLOSED, "Cette demande n'est plus en attente."));
    events.audit({
      action: "examinations.revision.approve",
      resourceType: "revision_request",
      resourceId: requestId,
      sensitive: true,
      reason: q.reason,
      metadata: { sessionId: q.sessionId, target: q.targetKind, requestedBy: q.requestedBy, ...(q.targetKind === "RESULT" ? { toCode: q.proposed.toCode } : {}) },
    });
    await events.flush(tx);
    const candidate = candidateId ? await cand.getCandidate(tx, candidateId) : null;
    return ok(toRevisionRequestDto(decided, { candidateId, candidateNumber: candidate?.candidateNumber ?? null, current }));
  });
}

export async function rejectRevision(deps: ExaminationsDeps, ctx: RequestContext, requestId: string, note: string): Promise<Result<ExamRevisionRequestDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const decider = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const q = await res.getRevisionRequest(tx, requestId, { forUpdate: true });
    if (!q) return err(notFound(ExamCode.REQUEST_NOT_FOUND, "Demande de révision", requestId));
    if (q.status !== "PENDING") return err(conflict(ExamCode.REVISION_REQUEST_CLOSED, `Cette demande est déjà ${q.status === "APPROVED" ? "approuvée" : "refusée"}.`));
    if (q.requestedBy === decider) return err(forbidden(ExamCode.REVISION_SAME_PERSON, "Une demande est décidée par une autre personne que celle qui l'a faite."));
    const decided = await res.decideRevisionRequest(tx, requestId, { status: "REJECTED", decidedBy: decider, decisionNote: note.trim(), revisionId: null });
    if (!decided) return err(conflict(ExamCode.REVISION_REQUEST_CLOSED, "Cette demande n'est plus en attente."));
    const events = new EventBuffer(deps, ctx);
    events.add(ExaminationsEvents.REVISION_REJECTED, { v: 1, sessionId: q.sessionId, requestId, targetKind: q.targetKind }, { type: "examinations.revision", id: requestId });
    events.audit({ action: "examinations.revision.reject", resourceType: "revision_request", resourceId: requestId, sensitive: true, reason: note.trim(), metadata: { sessionId: q.sessionId, target: q.targetKind } });
    await events.flush(tx);
    return ok(toRevisionRequestDto(decided, { candidateId: null, candidateNumber: null, current: {} }));
  });
}
