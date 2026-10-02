/**
 * Événements du module "councils" : noms <module>.<entité>.<verbe-passé>, payload JSON versionné { v: 1, ... }.
 * Les schémas des charges sont dans packages/contracts/src/v2/councils.ts (`councilsEventPayloadSchemas`) ; un test vérifie que
 * cette liste et le contrat sont identiques.
 *
 * Jamais de note, de justification, d'appréciation ni de texte libre dans une charge : des identifiants, des codes et des familles.
 * Domaine pur : aucun import d'infrastructure.
 */
export const CouncilsEvents = {
  COUNCIL_CREATED: "councils.council.created",
  COUNCIL_CONVOKED: "councils.council.convoked",
  COUNCIL_OPENED: "councils.council.opened",
  COUNCIL_CLOSED: "councils.council.closed",
  COUNCIL_SIGNED: "councils.council.signed",
  COUNCIL_REOPENED: "councils.council.reopened",
  COUNCIL_CANCELLED: "councils.council.cancelled",
  COUNCIL_REVIEW_NEEDED: "councils.council.review_needed",
  QUORUM_WAIVED: "councils.quorum.waived",
  DECISION_RECORDED: "councils.decision.recorded",
  DECISION_WITHDRAWN: "councils.decision.withdrawn",
  MINUTES_GENERATED: "councils.minutes.generated",
  MINUTES_RENDERED: "councils.minutes.rendered",
  MINUTES_SIGNED: "councils.minutes.signed",
  MINUTES_SUPERSEDED: "councils.minutes.superseded",
  MINUTES_REVOKED: "councils.minutes.revoked",
  UNLOCK_REQUESTED: "councils.unlock.requested",
  UNLOCK_APPROVED: "councils.unlock.approved",
  UNLOCK_REJECTED: "councils.unlock.rejected",
  EFFECT_APPLIED: "councils.effect.applied",
  EFFECT_FAILED: "councils.effect.failed",
  EFFECT_REVERTED: "councils.effect.reverted",
  EFFECT_AWAITING_HUMAN: "councils.effect.awaiting_human",
  ORIENTATION_FILE_DECIDED: "councils.orientation.file_decided",
  SERIES_TRANSFER_PLANNED: "councils.series_transfer.planned",
  SERIES_TRANSFER_APPLIED: "councils.series_transfer.applied",
  SERIES_TRANSFER_CANCELLED: "councils.series_transfer.cancelled",
} as const;

export type CouncilsEventName = (typeof CouncilsEvents)[keyof typeof CouncilsEvents];

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_EVENT_TYPES: readonly string[] = Object.values(CouncilsEvents);

/** Événements d'autres modules que les abonnés du module consomment (documentation du manifeste). */
export const ConsumedEvents = {
  INSTITUTION_CREATED: "tenancy.institution.created",
  RESULTS_PERIOD_REOPENED: "results.period.reopened",
  DOCUMENT_RENDERED: "reportcards.official_document.rendered",
} as const;
