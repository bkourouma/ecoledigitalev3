/**
 * Événements du module "schoollife" : noms <module>.<entité>.<verbe-passé>, payload JSON versionné { v: 1, ... }.
 * Les schémas des charges sont dans packages/contracts/src/v2/schoollife.ts (`schoollifeEventPayloadSchemas`) ; un test
 * vérifie que cette liste et le contrat sont identiques.
 *
 * Jamais de description d'incident, de motif, de déclaration d'élève ni de texte libre dans une charge : des identifiants,
 * des codes et des familles (la minimisation vaut aussi pour les consommateurs : notifications, analytics, councils).
 * Domaine pur : aucun import d'infrastructure.
 */
export const SchoolLifeEvents = {
  INCIDENT_DECLARED: "schoollife.incident.declared",
  INCIDENT_STATUS_CHANGED: "schoollife.incident.status_changed",
  MEASURE_PROPOSED: "schoollife.measure.proposed",
  MEASURE_VALIDATED: "schoollife.measure.validated",
  MEASURE_NOTIFIED: "schoollife.measure.notified",
  MEASURE_EXECUTED: "schoollife.measure.executed",
  MEASURE_REVOKED: "schoollife.measure.revoked",
  MEASURE_REJECTED: "schoollife.measure.rejected",
  MEASURE_CANCELLED: "schoollife.measure.cancelled",
  APPEAL_FILED: "schoollife.appeal.filed",
  APPEAL_DECIDED: "schoollife.appeal.decided",
  NOTE_CREATED: "schoollife.note.created",
  NOTE_WITHDRAWN: "schoollife.note.withdrawn",
  CONVOCATION_SENT: "schoollife.convocation.sent",
  CONVOCATION_ACKNOWLEDGED: "schoollife.convocation.acknowledged",
  CONVOCATION_HELD: "schoollife.convocation.held",
  CONVOCATION_MISSED: "schoollife.convocation.missed",
  CONVOCATION_CANCELLED: "schoollife.convocation.cancelled",
  CONDUCT_MOVEMENT_RECORDED: "schoollife.conduct.movement_recorded",
  EXCLUSION_EFFECT_REQUESTED: "schoollife.exclusion_effect.requested",
  EXCLUSION_EFFECT_APPLIED: "schoollife.exclusion_effect.applied",
  EXCLUSION_EFFECT_SKIPPED: "schoollife.exclusion_effect.skipped",
  EXCLUSION_EFFECT_REVERTED: "schoollife.exclusion_effect.reverted",
  CONFIDENTIAL_ACCESSED: "schoollife.confidential.accessed",
} as const;

export type SchoolLifeEventName = (typeof SchoolLifeEvents)[keyof typeof SchoolLifeEvents];

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_EVENT_TYPES: readonly string[] = Object.values(SchoolLifeEvents);
