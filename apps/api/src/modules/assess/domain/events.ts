/**
 * Événements publiés par `assess` (outbox, ADR-004). Nommage `assess.<entité>.<verbe-passé>` ; payload JSON versionné
 * `{ v: 1, … }`. AUCUNE note dans les payloads (pas de donnée personnelle dans l'outbox) : seulement des identifiants.
 * Les schémas Zod des payloads sont dans `packages/contracts/src/v2/assess.ts` (`assessEventPayloadSchemas`).
 */
export const AssessEvents = {
  ASSESSMENT_CREATED: "assess.assessment.created",
  ASSESSMENT_SUBMITTED: "assess.assessment.submitted",
  ASSESSMENT_REVIEWED: "assess.assessment.reviewed",
  ASSESSMENT_APPROVED: "assess.assessment.approved",
  ASSESSMENT_RETURNED: "assess.assessment.returned",
  ASSESSMENT_CANCELLED: "assess.assessment.cancelled",
  GRADE_PUBLISHED: "assess.grade.published",
  GRADE_REVISED: "assess.grade.revised",
  REVISION_REQUESTED: "assess.revision.requested",
  REVISION_REJECTED: "assess.revision.rejected",
  PERIOD_LOCKED: "assess.period.locked",
  PERIOD_UNLOCKED: "assess.period.unlocked",
} as const;

export type AssessEventType = (typeof AssessEvents)[keyof typeof AssessEvents];
export const ALL_ASSESS_EVENT_TYPES: readonly AssessEventType[] = Object.values(AssessEvents);

/** Événements d'autres modules écoutés par `assess`. */
export const ConsumedEvents = {
  TENANT_PROVISIONED: "tenancy.tenant.provisioned",
} as const;
