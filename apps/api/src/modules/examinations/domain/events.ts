/**
 * Événements du module `examinations` : noms `<module>.<entité>.<verbe-passé>`, payload JSON versionné `{ v: 1, ... }`,
 * écrits dans l'outbox dans la même transaction que la donnée. Domaine pur.
 *
 * AUCUNE note, moyenne, ni identité d'élève (nom, date de naissance) dans un événement : identifiants, codes, effectifs
 * (R-EXA-12) — à UNE exception, décidée par le métier (Q-E18) : `examinations.result.transmitted`, destiné aux seules admissions, porte
 * « admis / non admis » ET la MOYENNE d'un candidat-élève, pour les seuls types d'examen qui le demandent (`transmits_to_admission`).
 * `examinations.result.published` reste, lui, SANS moyenne. Aucun nom, aucune date de naissance, dans aucun des deux.
 */
export const ExaminationsEvents = {
  SESSION_OPENED: "examinations.session.opened",
  SESSION_REGISTRATION_CLOSED: "examinations.session.registration_closed",
  SESSION_RESULTS_PUBLISHED: "examinations.session.results_published",
  SESSION_ARCHIVED: "examinations.session.archived",
  CANDIDATE_REGISTERED: "examinations.candidate.registered",
  CANDIDATE_WITHDRAWN: "examinations.candidate.withdrawn",
  ELIGIBILITY_EVALUATED: "examinations.eligibility.evaluated",
  RESULT_PUBLISHED: "examinations.result.published",
  /** Q-E18 : résultat (admis / non admis) ET moyenne, pour les admissions seules (voir l'en-tête). */
  RESULT_TRANSMITTED: "examinations.result.transmitted",
  RESULT_REVISED: "examinations.result.revised",
  REVISION_REQUESTED: "examinations.revision.requested",
  REVISION_REJECTED: "examinations.revision.rejected",
  IMPORT_APPLIED: "examinations.import.applied",
  DOCUMENT_ISSUED: "examinations.document.issued",
  DOCUMENT_REVOKED: "examinations.document.revoked",
  EXPORT_COMPLETED: "examinations.export.completed",
} as const;

export type ExaminationsEventType = (typeof ExaminationsEvents)[keyof typeof ExaminationsEvents];

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_EXAMINATIONS_EVENT_TYPES: readonly string[] = Object.values(ExaminationsEvents);

/** Événements d'autres modules consommés (voir `subscribers.ts`). */
export const ConsumedEvents = {
  ENROLLMENT_WITHDRAWN: "academic.enrollment.withdrawn",
} as const;
