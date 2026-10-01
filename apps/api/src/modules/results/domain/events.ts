/**
 * Événements publiés par `results` (outbox, ADR-004). `results.<entité>.<verbe-passé>`, payload `{ v: 1, … }`. Aucune
 * note ni moyenne dans les payloads : des identifiants, des versions et des empreintes.
 */
export const ResultsEvents = {
  PERIOD_RESULT_COMPUTED: "results.period_result.computed",
  PERIOD_LOCKED: "results.period.locked",
  PERIOD_DELIBERATED: "results.period.deliberated",
  PERIOD_CLOSED: "results.period.closed",
  PERIOD_REOPENED: "results.period.reopened",
  DECISION_CONFIRMED: "results.decision.confirmed",
  OVERRIDE_REQUESTED: "results.override.requested",
  OVERRIDE_APPROVED: "results.override.approved",
  OVERRIDE_REVOKED: "results.override.revoked",
  RECOMPUTE_BLOCKED: "results.recompute.blocked",
} as const;

export type ResultsEventType = (typeof ResultsEvents)[keyof typeof ResultsEvents];
export const ALL_RESULTS_EVENT_TYPES: readonly ResultsEventType[] = Object.values(ResultsEvents);

/** Événements d'autres modules écoutés par `results`. */
export const ConsumedEvents = {
  GRADE_PUBLISHED: "assess.grade.published",
  GRADE_REVISED: "assess.grade.revised",
  ASSESSMENT_CANCELLED: "assess.assessment.cancelled",
  OVERRIDE_APPROVED: ResultsEvents.OVERRIDE_APPROVED,
  OVERRIDE_REVOKED: ResultsEvents.OVERRIDE_REVOKED,
  ENROLLMENT_CREATED: "academic.enrollment.created",
  ENROLLMENT_TRANSFERRED: "academic.enrollment.transferred",
  ENROLLMENT_WITHDRAWN: "academic.enrollment.withdrawn",
  RULES_BINDING_CHANGED: "rules.binding.changed",
} as const;
