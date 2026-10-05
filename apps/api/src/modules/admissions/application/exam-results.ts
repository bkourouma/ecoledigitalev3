/**
 * RÉSULTAT D'EXAMEN REÇU de `examinations` (décision métier Q-E18 : « admis / non admis » ET la MOYENNE, CEPE -> admission en 6e).
 *
 *  - RÉCEPTION (abonné `admissions.record-exam-result`) : idempotente et ordonnée par version du résultat ; une correction approuvée
 *    après transmission remplace la ligne ; un rejeu ou un événement tardif ne change rien. Aucune donnée nominative n'est reçue.
 *  - LECTURE (`GET /applications/:id/exam-results`) : le résultat « admis / non admis » est visible de toute personne qui lit les
 *    dossiers ; la MOYENNE n'est rendue qu'au personnel d'admission HABILITÉ (permission `admission.exam_result.read`), et sa lecture
 *    est TRACÉE (audit, sans la valeur). Un dossier n'est rattaché qu'à son propre élève ou à un rapprochement CONFIRMÉ.
 *  - MINIMISATION : la moyenne ne figure dans aucun événement d'admissions, aucun audit, aucun journal.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AdmissionsExamResultsDto } from "@ecoledigitale/contracts/src/v2/admissions";
import { AdmissionsCode, notFound, validation } from "../domain/errors";
import * as results from "../infrastructure/exam-results-repository";
import { EventBuffer, inTx, type AdmissionsDeps } from "./deps";

export interface TransmittedExamResult {
  readonly sessionId: string;
  readonly candidateId: string;
  readonly resultId: string;
  readonly studentId: string;
  readonly institutionId: string;
  readonly examTypeCode: string;
  readonly sessionYear: number;
  readonly outcome: string;
  readonly admitted: boolean;
  readonly average: string | null;
  readonly revision: number;
}

const OUTCOMES: readonly string[] = ["ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"];

/** Contrôle strict de la charge reçue (le schéma partagé est tolérant) : une charge hors contrat est refusée proprement, jamais rangée. */
function checkReceived(input: TransmittedExamResult): AppError | null {
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(input.examTypeCode)) return validation(AdmissionsCode.INVALID_INPUT, "Code d'examen reçu invalide.", "examTypeCode");
  if (!OUTCOMES.includes(input.outcome)) return validation(AdmissionsCode.INVALID_INPUT, "Issue d'examen reçue inconnue.", "outcome");
  if (input.admitted !== (input.outcome === "ADMITTED")) return validation(AdmissionsCode.INVALID_INPUT, "« Admis » incohérent avec l'issue reçue.", "admitted");
  if (input.average !== null && !/^\d{1,6}(\.\d{1,3})?$/.test(input.average)) return validation(AdmissionsCode.INVALID_INPUT, "Moyenne reçue invalide.", "average");
  if (input.average !== null && input.outcome !== "ADMITTED" && input.outcome !== "FAILED") return validation(AdmissionsCode.INVALID_INPUT, "Une moyenne n'accompagne qu'une issue admis ou non admis.", "average");
  if (input.sessionYear < 2000 || input.sessionYear > 2200) return validation(AdmissionsCode.INVALID_INPUT, "Année d'examen reçue invalide.", "sessionYear");
  return null;
}

export async function recordTransmittedResult(deps: AdmissionsDeps, ctx: RequestContext, input: TransmittedExamResult, eventId: string): Promise<Result<{ stored: boolean }, AppError>> {
  const bad = checkReceived(input);
  if (bad) return err(bad);
  return inTx(deps, ctx, async (tx) => {
    const stored = await results.upsertReceivedResult(tx, ctx.tenantId, {
      id: deps.newId(), institutionId: input.institutionId, studentId: input.studentId, sourceCandidateId: input.candidateId, sourceResultId: input.resultId, examTypeCode: input.examTypeCode,
      sessionYear: input.sessionYear, outcome: input.outcome as results.ExamResultRow["outcome"], admitted: input.admitted, average: input.average, revision: input.revision, sourceEventId: eventId,
    });
    if (stored) {
      const events = new EventBuffer(deps, ctx);
      // Trace de la réception : identifiants et codes, JAMAIS la moyenne ni un nom.
      events.audit({ action: "admissions.exam_result.receive", resourceType: "exam_result", resourceId: input.resultId, metadata: { studentId: input.studentId, examTypeCode: input.examTypeCode, sessionYear: input.sessionYear, outcome: input.outcome, revision: input.revision, withAverage: input.average !== null } });
      await events.flush(tx);
    }
    return ok({ stored });
  });
}

/**
 * Résultats d'examen d'un dossier. `includeAverage` est décidé par la ROUTE (permission `admission.exam_result.read`) ; sans lui, la
 * moyenne est masquée (`average: null`, `averageHidden: true`) et aucune lecture de moyenne n'est tracée.
 */
export async function listApplicationExamResults(deps: AdmissionsDeps, ctx: RequestContext, applicationId: string, options: { includeAverage: boolean }): Promise<Result<AdmissionsExamResultsDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    if (!(await results.applicationExists(tx, applicationId))) return err(notFound(AdmissionsCode.APPLICATION_NOT_FOUND, "Candidature", applicationId));
    const rows = await results.listForApplication(tx, applicationId);
    const shown = rows.some((r) => r.average !== null);
    if (options.includeAverage && shown) {
      const events = new EventBuffer(deps, ctx);
      events.audit({ action: "admissions.exam_result.read_average", resourceType: "application", resourceId: applicationId, sensitive: true, metadata: { results: rows.length } });
      await events.flush(tx);
    }
    return ok({
      canSeeAverage: options.includeAverage,
      items: rows.map((r) => ({
        id: r.id,
        examTypeCode: r.examTypeCode,
        sessionYear: r.sessionYear,
        outcome: r.outcome,
        admitted: r.admitted,
        average: options.includeAverage ? r.average : null,
        averageHidden: !options.includeAverage && r.average !== null,
        matchedBy: r.matchedBy,
        receivedAt: r.receivedAt,
      })),
    });
  });
}
