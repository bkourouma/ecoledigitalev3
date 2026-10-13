/**
 * JURY d'un EXAMEN BLANC. Pour un examen officiel, l'admission est prononcée par l'autorité (ce module l'enregistre, il ne la
 * délibère jamais) ; pour un examen blanc, le résultat est CALCULÉ par la règle et le jury de l'école le relit et tranche
 * pédagogiquement : admis, ajourné, différé. Tout écart avec la proposition de la règle est motivé (20 caractères au moins).
 *
 *  - Le jury ne modifie JAMAIS le résultat calculé (`candidate_results`) : la décision est une table à part, qui garde la
 *    proposition de la règle au moment de la décision.
 *  - Un jury par examen blanc ; ouvert tant que les décisions sont corrigeables ; CLOS, il est figé (base).
 *  - Il ne sert jamais de document officiel (R-EXA-11).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { EXAM_JURY_JUSTIFICATION_MIN, type ExamJuryDecisionsBody, type ExamJuryDto, type ExamJurySaveReportDto, type ExamOpenJuryBody } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import * as jury from "../infrastructure/jury-repo";
import { EventBuffer, inTx, type ExaminationsDeps } from "./deps";

const iso = (d: Date): string => d.toISOString();

function toDto(row: jury.JuryRow, lines: jury.JuryLine[]): ExamJuryDto {
  const rows = lines.map((l) => ({
    candidateId: l.candidateId,
    candidateNumber: l.candidateNumber,
    lastName: l.lastName,
    firstName: l.firstName,
    proposedCode: l.proposedCode,
    average: l.average,
    rank: l.rank,
    decision: l.decision ? { finalCode: l.decision.finalCode, justification: l.decision.justification, decidedAt: iso(l.decision.decidedAt), changedFromProposal: l.decision.finalCode !== l.decision.proposedCode } : null,
  }));
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    heldOn: row.heldOn,
    note: row.note,
    openedAt: iso(row.openedAt),
    closedAt: row.closedAt ? iso(row.closedAt) : null,
    counts: { total: rows.length, decided: rows.filter((r) => r.decision).length, changed: rows.filter((r) => r.decision?.changedFromProposal).length },
    rows,
  };
}

/** Jury de la session blanche, ou `null` s'il n'est pas encore ouvert. */
export async function getJury(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ExamJuryDto | null, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const session = await sess.getSession(tx, sessionId);
      if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      if (session.sessionKind !== "MOCK") return err(conflict(ExamCode.JURY_MOCK_ONLY, "Le jury ne concerne que les examens blancs : pour un examen officiel, l'admission est prononcée par l'autorité."));
      const row = await jury.getJuryOfSession(tx, sessionId);
      return ok(row ? toDto(row, await jury.listJuryLines(tx, sessionId, row.id)) : null);
    },
    { readOnly: true },
  );
}

/** Ouvre le jury (idempotent) : il faut des résultats calculés par la règle. */
export async function openJury(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, body: ExamOpenJuryBody): Promise<Result<ExamJuryDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const session = await sess.getSession(tx, sessionId);
    if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    if (session.sessionKind !== "MOCK") return err(conflict(ExamCode.JURY_MOCK_ONLY, "Le jury ne concerne que les examens blancs : pour un examen officiel, l'admission est prononcée par l'autorité."));
    const existing = await jury.getJuryOfSession(tx, sessionId);
    if (existing) return ok(toDto(existing, await jury.listJuryLines(tx, sessionId, existing.id)));
    const computed = (await res.listResultsOfSession(tx, sessionId)).filter((r) => r.source === "COMPUTED");
    if (computed.length === 0) return err(conflict(ExamCode.JURY_NO_RESULTS, "Aucun résultat calculé : importez les notes puis calculez l'examen blanc avant d'ouvrir le jury."));
    const row = await jury.insertJury(tx, ctx.tenantId, { id: deps.newId(), sessionId, heldOn: body.heldOn ?? null, note: body.note?.trim() ? body.note.trim() : null, openedBy: actor });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.mock.jury.open", resourceType: "session", resourceId: sessionId, metadata: { juryId: row.id, candidates: computed.length } });
    await events.flush(tx);
    return ok(toDto(row, await jury.listJuryLines(tx, sessionId, row.id)));
  });
}

/** Enregistre (ou corrige, tant que le jury est ouvert) les décisions par candidat ; une ligne refusée n'arrête pas le lot. */
export async function saveJuryDecisions(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, body: ExamJuryDecisionsBody): Promise<Result<ExamJurySaveReportDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const session = await sess.getSession(tx, sessionId);
    if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    if (session.sessionKind !== "MOCK") return err(conflict(ExamCode.JURY_MOCK_ONLY, "Le jury ne concerne que les examens blancs."));
    const row = await jury.getJuryOfSession(tx, sessionId, { forUpdate: true });
    if (!row) return err(notFound(ExamCode.JURY_NOT_FOUND, "Jury de l'examen blanc", sessionId));
    if (row.status === "CLOSED") return err(conflict(ExamCode.JURY_CLOSED, "Le jury est clos : ses décisions ne changent plus."));
    const results = new Map((await res.listResultsOfSession(tx, sessionId)).filter((r) => r.source === "COMPUTED").map((r) => [r.candidateId, r]));
    const report: ExamJurySaveReportDto = { saved: 0, failed: [] };
    for (const [index, item] of body.items.entries()) {
      const result = results.get(item.candidateId);
      const fail = (code: string, message: string): void => {
        report.failed.push({ index, candidateId: item.candidateId, code, message });
      };
      if (!result) {
        fail(ExamCode.RESULT_NOT_FOUND, "Ce candidat n'a pas de résultat calculé dans cet examen blanc.");
        continue;
      }
      const justification = item.justification?.trim() ?? "";
      if (item.finalCode !== result.resultCode && justification.length < EXAM_JURY_JUSTIFICATION_MIN) {
        fail(ExamCode.JURY_JUSTIFICATION_REQUIRED, `Une décision différente de la proposition de la règle exige une justification (${EXAM_JURY_JUSTIFICATION_MIN} caractères au moins).`);
        continue;
      }
      await jury.upsertDecision(tx, ctx.tenantId, {
        id: deps.newId(),
        sessionId,
        juryId: row.id,
        candidateId: item.candidateId,
        proposedCode: result.resultCode,
        proposedAverage: result.average,
        finalCode: item.finalCode,
        justification: item.finalCode !== result.resultCode || justification ? justification : null,
        decidedBy: actor,
      });
      report.saved += 1;
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.mock.jury.decide", resourceType: "session", resourceId: sessionId, metadata: { juryId: row.id, saved: report.saved, refused: report.failed.length } });
    await events.flush(tx);
    return ok(report);
  });
}

/** Clôt le jury : tous les candidats ayant un résultat calculé doivent avoir une décision. Irréversible. */
export async function closeMockJury(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ExamJuryDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const session = await sess.getSession(tx, sessionId);
    if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    if (session.sessionKind !== "MOCK") return err(conflict(ExamCode.JURY_MOCK_ONLY, "Le jury ne concerne que les examens blancs."));
    const row = await jury.getJuryOfSession(tx, sessionId, { forUpdate: true });
    if (!row) return err(notFound(ExamCode.JURY_NOT_FOUND, "Jury de l'examen blanc", sessionId));
    if (row.status === "CLOSED") return ok(toDto(row, await jury.listJuryLines(tx, sessionId, row.id)));
    const before = await jury.listJuryLines(tx, sessionId, row.id);
    const missing = before.filter((l) => !l.decision).length;
    if (missing > 0) return err(conflict(ExamCode.JURY_INCOMPLETE, `${missing} candidat${missing > 1 ? "s" : ""} sans décision : le jury ne peut être clos qu'une fois tous les candidats tranchés.`, { missing }));
    const closed = await jury.closeJury(tx, row.id, actor);
    if (!closed) return err(conflict(ExamCode.JURY_CLOSED, "Le jury a été clos entre-temps."));
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.mock.jury.close", resourceType: "session", resourceId: sessionId, metadata: { juryId: row.id, candidates: before.length, changed: before.filter((l) => l.decision && l.decision.finalCode !== l.decision.proposedCode).length } });
    await events.flush(tx);
    return ok(toDto(closed, before));
  });
}
