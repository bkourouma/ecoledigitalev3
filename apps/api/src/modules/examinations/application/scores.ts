/**
 * NOTES D'ÉPREUVES : saisie en lot IDEMPOTENTE (rejouer le même lot ne change rien), absences, matrice de lecture.
 *
 *  - Une note ne se saisit que pour un candidat INSCRIT, session en cours ou à résultats saisis, pour une épreuve DE LA SESSION et
 *    de la série du candidat, note ≤ barème (gardes de la base). Une note déjà saisie ne se corrige, une fois les résultats
 *    saisis, que par une révision approuvée par une autre personne (`revisions.ts`) : le lot signale ces lignes, ne les contourne pas.
 *  - Chaque ligne est traitée dans son SAVEPOINT : une ligne refusée n'arrête pas le lot, le rapport dit laquelle et pourquoi.
 *  - L'audit ne contient ni note ni nom : seulement des effectifs.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamBulkScoresBody } from "@ecoledigitale/contracts/src/v2/examinations";
import { compareDecimal, normalizeDecimal } from "../domain/decimal";
import { ExamCode, notFound, validation } from "../domain/errors";
import type { ScoreStatus } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import { displayNameOf } from "./dto";
import { attempt, EventBuffer, inTx, type ExaminationsDeps } from "./deps";

export interface BulkScoresReport {
  saved: number;
  unchanged: number;
  failed: Array<{ index: number; candidateId: string; paperId: string; code: string; message: string }>;
}

export async function bulkSaveScores(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, body: ExamBulkScoresBody): Promise<Result<BulkScoresReport, AppError>> {
  if (body.items.length > deps.config.bulkMaxItems) return err(validation(ExamCode.INVALID_INPUT, `Un lot compte ${deps.config.bulkMaxItems} lignes au plus.`, "items"));
  return inTx(deps, ctx, async (tx) => {
    const session = await sess.getSession(tx, sessionId);
    if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    const papers = new Set((await sess.listSessionPapers(tx, sessionId)).map((p) => p.id));
    const ids = [...new Set(body.items.map((i) => i.candidateId))];
    const inSession = new Set((await cand.listCandidatesByIds(tx, ids)).filter((c) => c.sessionId === sessionId).map((c) => c.id));
    const report: BulkScoresReport = { saved: 0, unchanged: 0, failed: [] };
    for (const [index, item] of body.items.entries()) {
      if (!inSession.has(item.candidateId)) {
        report.failed.push({ index, candidateId: item.candidateId, paperId: item.paperId, code: ExamCode.CANDIDATE_NOT_FOUND, message: "Ce candidat n'appartient pas à la session." });
        continue;
      }
      if (!papers.has(item.paperId)) {
        report.failed.push({ index, candidateId: item.candidateId, paperId: item.paperId, code: ExamCode.PAPER_NOT_FOUND, message: "Cette épreuve n'appartient pas à la session." });
        continue;
      }
      const status = item.status as ScoreStatus;
      const score = status === "ENTERED" && item.score != null ? normalizeDecimal(item.score) : null;
      const r = await attempt(tx, async (inner) => {
        const existing = await res.getScoreOf(inner, item.candidateId, item.paperId);
        if (existing) {
          const same = existing.status === status && (existing.score === null ? score === null : score !== null && compareDecimal(existing.score, score) === 0);
          if (same) return ok("unchanged" as const);
          await res.updateScore(inner, existing.id, { status, score, source: "MANUAL", sourceRef: null, enteredBy: ctx.userId });
          return ok("saved" as const);
        }
        await res.insertScore(inner, ctx.tenantId, { id: deps.newId(), sessionId, candidateId: item.candidateId, paperId: item.paperId, status, score, source: "MANUAL", sourceRef: null, enteredBy: ctx.userId });
        return ok("saved" as const);
      });
      if (!r.ok) report.failed.push({ index, candidateId: item.candidateId, paperId: item.paperId, code: r.error.code, message: r.error.message });
      else if (r.value === "saved") report.saved += 1;
      else report.unchanged += 1;
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.scores.bulk", resourceType: "session", resourceId: sessionId, metadata: { items: body.items.length, saved: report.saved, unchanged: report.unchanged, failed: report.failed.length } });
    await events.flush(tx);
    return ok(report);
  });
}

export interface ScoreMatrix {
  sessionId: string;
  papers: Array<{ id: string; code: string; label: string; trackCode: string | null; scaleMax: string; ordinal: number }>;
  rows: Array<{ candidateId: string; candidateNumber: string | null; displayName: string | null; trackCode: string | null; scores: Record<string, { id: string; status: ScoreStatus; score: string | null; source: string }> }>;
}

export async function getScoreMatrix(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ScoreMatrix, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const session = await sess.getSession(tx, sessionId);
      if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      const papers = await sess.listSessionPapers(tx, sessionId);
      const candidates = await cand.listRegistered(tx, sessionId);
      const scores = await res.listScores(tx, sessionId);
      const byCandidate = new Map<string, ScoreMatrix["rows"][number]["scores"]>();
      for (const s of scores) {
        const m = byCandidate.get(s.candidateId) ?? {};
        m[s.paperId] = { id: s.id, status: s.status, score: s.score === null ? null : normalizeDecimal(s.score), source: s.source };
        byCandidate.set(s.candidateId, m);
      }
      return ok({
        sessionId,
        papers: papers.map((p) => ({ id: p.id, code: p.code, label: p.label, trackCode: p.trackCode, scaleMax: normalizeDecimal(p.scaleMax), ordinal: p.ordinal })),
        rows: candidates.map((c) => ({ candidateId: c.id, candidateNumber: c.candidateNumber, displayName: displayNameOf(c), trackCode: c.trackCode, scores: byCandidate.get(c.id) ?? {} })),
      });
    },
    { readOnly: true },
  );
}
