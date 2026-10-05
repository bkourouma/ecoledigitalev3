/**
 * TRANSMISSION AUX ADMISSIONS (décision métier Q-E18) : « admis / non admis » ET la MOYENNE d'un candidat-élève, pour les types
 * d'examen désignés par l'établissement (`transmits_to_admission`, désactivé par défaut) — CEPE vers l'admission en 6e.
 *
 * Minimisation et restriction d'accès :
 *  - la moyenne ne voyage que dans l'événement dédié `examinations.result.transmitted` (abonné : `admissions` seul, vérifié par test) ;
 *    `examinations.result.published` reste SANS note ni moyenne ;
 *  - jamais de nom, de date de naissance ni de contact ; seulement identifiants, codes, issue, moyenne et version du résultat ;
 *  - seulement un candidat-élève d'une session OFFICIELLE (jamais un examen blanc, jamais un candidat libre sans dossier élève) ;
 *  - une correction approuvée après transmission (Q-E17) retransmet le résultat corrigé (`revision` plus grande) ;
 *  - l'audit trace la transmission SANS la valeur de la moyenne.
 */
import { ExaminationsEvents } from "../domain/events";
import { normalizeDecimal } from "../domain/decimal";
import type { CandidateRow, ExamTypeRow, ResultRow, SessionRow } from "../domain/types";
import type { EventBuffer } from "./deps";

export interface TransmittedPayload extends Record<string, unknown> {
  v: 1;
  sessionId: string;
  candidateId: string;
  resultId: string;
  studentId: string;
  institutionId: string;
  examTypeCode: string;
  sessionYear: number;
  outcome: ResultRow["resultCode"];
  admitted: boolean;
  average: string | null;
  revision: number;
}

/** `null` quand rien ne doit partir vers les admissions. */
export function transmittedPayload(session: SessionRow, type: Pick<ExamTypeRow, "code" | "transmitsToAdmission"> | null, candidate: CandidateRow, result: ResultRow): TransmittedPayload | null {
  if (session.sessionKind !== "OFFICIAL" || !type || !type.transmitsToAdmission) return null;
  if (candidate.candidateKind !== "STUDENT" || !candidate.studentId) return null;
  return {
    v: 1,
    sessionId: session.id,
    candidateId: candidate.id,
    resultId: result.id,
    studentId: candidate.studentId,
    institutionId: session.institutionId,
    examTypeCode: type.code,
    sessionYear: session.sessionYear,
    outcome: result.resultCode,
    admitted: result.resultCode === "ADMITTED",
    average: result.average === null ? null : normalizeDecimal(result.average),
    revision: result.rowVersion,
  };
}

/** Ajoute l'événement de transmission (et sa trace d'audit sans la moyenne) au tampon de la transaction en cours. */
export function addTransmission(events: EventBuffer, payload: TransmittedPayload, kind: "PUBLISH" | "REVISION"): void {
  events.add(ExaminationsEvents.RESULT_TRANSMITTED, payload, { type: "examinations.result", id: payload.resultId });
  events.audit({
    action: "examinations.result.transmit",
    resourceType: "result",
    resourceId: payload.resultId,
    metadata: { sessionId: payload.sessionId, candidateId: payload.candidateId, outcome: payload.outcome, revision: payload.revision, kind, withAverage: payload.average !== null },
  });
}
