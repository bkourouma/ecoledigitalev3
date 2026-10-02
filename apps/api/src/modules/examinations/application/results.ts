/**
 * RÉSULTATS d'une session. Deux régimes, un seul modèle :
 *
 *  - session OFFICIELLE : le résultat vient de l'autorité — saisi (`ENTERED`, avec son auteur) ou importé (`IMPORTED`, avec son lot,
 *    voir `imports.ts`). L'admission est celle que l'autorité prononce : ce module l'ENREGISTRE, il ne la CALCULE JAMAIS
 *    (déclencheur `official_not_computed`).
 *  - session BLANCHE : le résultat est calculé par la règle (`mock.ts`), tracé par version de règle et empreinte d'entrées ;
 *    la saisie manuelle d'un résultat d'examen blanc est refusée.
 * Un résultat naît BROUILLON ; la publication est une étape distincte ; un résultat publié ne se dépublie pas (révision seulement).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamBulkResultsBody, ExamPage, ExamResultDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { normalizeDecimal } from "../domain/decimal";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import { toResultDto } from "./dto";
import { attempt, EventBuffer, inTx, type ExaminationsDeps } from "./deps";

export async function listResults(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  sessionId: string,
  filter: { resultCode?: string | undefined; status?: string | undefined; q?: string | undefined; page: number; pageSize: number },
): Promise<Result<ExamPage<ExamResultDto>, AppError>> {
  const pageSize = Math.min(filter.pageSize, deps.config.pageSizeMax);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await sess.getSession(tx, sessionId))) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      const page = await res.listResults(tx, { sessionId, ...filter, pageSize });
      return ok({ items: page.items.map((r) => toResultDto(r, r)), total: page.total, page: filter.page, pageSize });
    },
    { readOnly: true },
  );
}

export interface BulkResultsReport {
  saved: number;
  failed: Array<{ index: number; candidateId: string; code: string; message: string }>;
}

/** Saisie des résultats OFFICIELS (ou de leur correction tant qu'ils sont en brouillon). Un résultat publié ne se touche que par révision. */
export async function saveResults(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, body: ExamBulkResultsBody): Promise<Result<BulkResultsReport, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  if (body.items.length > deps.config.bulkMaxItems) return err(validation(ExamCode.INVALID_INPUT, `Un lot compte ${deps.config.bulkMaxItems} lignes au plus.`, "items"));
  return inTx(deps, ctx, async (tx) => {
    const session = await sess.getSession(tx, sessionId);
    if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    if (session.sessionKind === "MOCK") return err(conflict(ExamCode.MOCK_RESULTS_COMPUTED, "Les résultats d'un examen blanc sont calculés par la règle, jamais saisis."));
    const found = new Map((await cand.listCandidatesByIds(tx, [...new Set(body.items.map((i) => i.candidateId))])).filter((c) => c.sessionId === sessionId).map((c) => [c.id, c]));
    const report: BulkResultsReport = { saved: 0, failed: [] };
    for (const [index, item] of body.items.entries()) {
      if (!found.has(item.candidateId)) {
        report.failed.push({ index, candidateId: item.candidateId, code: ExamCode.CANDIDATE_NOT_FOUND, message: "Ce candidat n'appartient pas à la session." });
        continue;
      }
      const write = {
        resultCode: item.resultCode,
        average: item.average != null ? normalizeDecimal(item.average) : null,
        totalPoints: item.totalPoints != null ? normalizeDecimal(item.totalPoints) : null,
        rank: item.rank ?? null,
        mentionCode: item.mentionCode ?? null,
        source: "ENTERED" as const,
        ruleVersionRef: null,
        inputsHash: null,
        importBatchId: null,
        enteredBy: actor,
      };
      const r = await attempt(tx, async (inner) => {
        const existing = await res.getResultOfCandidate(inner, item.candidateId);
        if (!existing) {
          await res.insertResult(inner, ctx.tenantId, { id: deps.newId(), sessionId, candidateId: item.candidateId, ...write });
          return ok(true);
        }
        if (existing.status === "PUBLISHED") return err(conflict(ExamCode.RESULT_REVISION_REQUIRED, "Ce résultat est publié : sa correction passe par une révision approuvée par une autre personne."));
        await res.replaceDraftResult(inner, existing.id, write);
        return ok(true);
      });
      if (r.ok) report.saved += 1;
      else report.failed.push({ index, candidateId: item.candidateId, code: r.error.code, message: r.error.message });
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.results.enter", resourceType: "session", resourceId: sessionId, metadata: { items: body.items.length, saved: report.saved, failed: report.failed.length } });
    await events.flush(tx);
    return ok(report);
  });
}

/** Publie UN résultat brouillon (étape distincte du saisi). Sensible : le passage de la session à PUBLISHED publie tous les brouillons. */
export async function publishResult(deps: ExaminationsDeps, ctx: RequestContext, resultId: string): Promise<Result<ExamResultDto, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  return inTx(deps, ctx, async (tx) => {
    const current = await res.getResult(tx, resultId);
    if (!current) return err(notFound(ExamCode.RESULT_NOT_FOUND, "Résultat", resultId));
    if (current.status === "PUBLISHED") return ok(toResultDto(current));
    const session = await sess.getSession(tx, current.sessionId);
    const published = await res.publishResult(tx, resultId, actor);
    if (!published || !session) return err(conflict(ExamCode.RESULT_PUBLISHED, "Ce résultat n'est plus publiable."));
    const candidate = await cand.getCandidate(tx, published.candidateId);
    const type = await ref.getType(tx, session.examTypeId);
    const events = new EventBuffer(deps, ctx);
    if (session.sessionKind === "OFFICIAL" && candidate) {
      events.add(
        ExaminationsEvents.RESULT_PUBLISHED,
        { v: 1, sessionId: session.id, candidateId: published.candidateId, studentId: candidate.studentId, institutionId: session.institutionId, examTypeCode: type?.code ?? "", sessionYear: session.sessionYear, outcome: published.resultCode },
        { type: "examinations.result", id: published.id },
      );
    }
    events.audit({ action: "examinations.result.publish", resourceType: "result", resourceId: resultId, sensitive: true, metadata: { sessionId: session.id, outcome: published.resultCode, source: published.source } });
    await events.flush(tx);
    return ok(toResultDto(published, candidate ?? undefined));
  });
}
