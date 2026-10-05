/**
 * Événements du module primary_school (`<module>.<entité>.<verbe-passé>`, payload `{ v: 1, … }`).
 *
 * AUCUN contenu pédagogique dans un événement : ni appréciation, ni niveau de maîtrise, ni note, ni nom d'élève. Seuls des
 * identifiants, des comptages et des codes de cycle de vie y figurent (l'outbox est relayé vers des abonnés tiers).
 */
export const PrimaryEvents = {
  TEMPLATE_APPLIED: "primary_school.template.applied",
  FRAMEWORK_PUBLISHED: "primary_school.framework.published",
  COMPETENCY_VALIDATED: "primary_school.competency.validated",
  COMPETENCY_REVISED: "primary_school.competency.revised",
  /** Q-P18 : l'enseignant a marqué la classe × période « prêtes » (visibles des familles) / a retiré ce marquage. */
  PERIOD_MARKED_READY: "primary_school.period.marked_ready",
  PERIOD_READY_WITHDRAWN: "primary_school.period.ready_withdrawn",
  COUNCIL_PREPARED: "primary_school.council.prepared",
  COUNCIL_MINUTES_REQUESTED: "primary_school.council.minutes_requested",
  ANNUAL_REVIEW_SEALED: "primary_school.annual_review.sealed",
  ANNUAL_REVIEW_SUPERSEDED: "primary_school.annual_review.superseded",
  YEAR_ARCHIVE_READY: "primary_school.year_archive.ready",
  YEAR_ARCHIVE_FROZEN: "primary_school.year_archive.frozen",
} as const;

export type PrimaryEventType = (typeof PrimaryEvents)[keyof typeof PrimaryEvents];
export const ALL_PRIMARY_EVENT_TYPES: readonly PrimaryEventType[] = Object.freeze(Object.values(PrimaryEvents));

/** Événements d'AUTRES modules consommés par les abonnés du worker (idempotents par identifiant d'événement). */
export const ConsumedEvents = {
  INSTITUTION_CREATED: "tenancy.institution.created",
  CLASSROOM_PERIOD_GRADING_CLOSED: "academic.classroom_period.grading_closed",
  CLASSROOM_PERIOD_CLOSED: "academic.classroom_period.closed",
  CLASSROOM_PERIOD_REOPENED: "academic.classroom_period.reopened",
  DECISION_CONFIRMED: "results.decision.confirmed",
  /** Document officiel rendu par reportcards (`documentKind`, `sourceId`, `documentId`) : renseigne `reportcard_id` d'un bilan scellé. */
  OFFICIAL_DOCUMENT_RENDERED: "reportcards.official_document.rendered",
} as const;
