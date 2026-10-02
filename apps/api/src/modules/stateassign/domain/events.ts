/**
 * Événements publiés par stateassign (outbox, même transaction que l'écriture) — `<module>.<entité>.<verbe-passé>`,
 * charge `{ v: 1, … }`. Les schémas des charges sont dans `packages/contracts/src/v2/stateassign.ts`
 * (`stateassignEventPayloadSchemas`) ; un test vérifie que cette liste et les contrats coïncident.
 *
 * Aucun nom, aucune référence d'acte, aucun motif : des identifiants, des statuts, des montants entiers.
 * Consommateurs prévus : `academic` (financement), `analytics`, `notifications` (alerte de l'économe, de la direction).
 */
export const StateassignEvents = Object.freeze({
  ASSIGNMENT_RECEIVED: "stateassign.assignment.received",
  ASSIGNMENT_VERIFIED: "stateassign.assignment.verified",
  ASSIGNMENT_ACTIVATED: "stateassign.assignment.activated",
  ASSIGNMENT_SUSPENDED: "stateassign.assignment.suspended",
  ASSIGNMENT_RESUMED: "stateassign.assignment.resumed",
  ASSIGNMENT_ENDED: "stateassign.assignment.ended",
  ASSIGNMENT_TRANSFERRED: "stateassign.assignment.transferred",
  ASSIGNMENT_SUPERSEDED: "stateassign.assignment.superseded",
  ASSIGNMENT_REJECTED: "stateassign.assignment.rejected",
  CONTROL_DUE: "stateassign.control.due",
  CONTROL_PERFORMED: "stateassign.control.performed",
  CONTROL_ANOMALY_DETECTED: "stateassign.control.anomaly_detected",
  RECONCILIATION_DISCREPANCY: "stateassign.reconciliation.discrepancy",
  RECEIVABLE_SCHEDULED: "stateassign.receivable.scheduled",
  RECEIVABLE_OVERDUE: "stateassign.receivable.overdue",
  RECEIVABLE_RECEIVED: "stateassign.receivable.received",
  RECEIVABLE_CANCELLED: "stateassign.receivable.cancelled",
} as const);

export type StateassignEventType = (typeof StateassignEvents)[keyof typeof StateassignEvents];

export const ALL_STATEASSIGN_EVENT_TYPES: readonly StateassignEventType[] = Object.freeze(Object.values(StateassignEvents));
