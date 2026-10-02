/**
 * Événements du module `analytics` : `analytics.<entité>.<verbe-passé>`, payload JSON versionné `{ v: 1, … }`.
 * Domaine pur : aucun import d'infrastructure.
 *
 * `analytics` PUBLIE peu : un instantané rafraîchi (pour que le web invalide ses caches et que les autres modules
 * sachent qu'un chiffre a changé) et la demande de reconstruction (traçabilité). Il CONSOMME beaucoup
 * (`CONSUMED_EVENTS`) : voir `refresh-plan.ts`.
 */
export const AnalyticsEvents = {
  SNAPSHOT_REFRESHED: "analytics.snapshot.refreshed",
  REBUILD_REQUESTED: "analytics.rebuild.requested",
  REBUILD_COMPLETED: "analytics.rebuild.completed",
  ALERT_RAISED: "analytics.alert.raised",
  ALERT_ACKNOWLEDGED: "analytics.alert.acknowledged",
  ALERT_RESOLVED: "analytics.alert.resolved",
} as const;

export type AnalyticsEventType = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

/** Tous les événements PUBLIÉS par le module (repris par manifest.ts). */
export const ALL_EVENT_TYPES: readonly string[] = Object.values(AnalyticsEvents);

export interface SnapshotRefreshedPayload {
  v: 1;
  kind: string;
  scopeKey: string;
  /** Instant de la passe (`asOf` des chiffres). */
  asOf: string;
  rows: number;
  /** `false` : la passe a retrouvé la même empreinte de contenu, rien n'a été réécrit. */
  changed: boolean;
}

export interface RebuildPayload {
  v: 1;
  requestedBy: string | null;
  reason: string | null;
  kinds: string[];
}

/**
 * Événements d'AUTRES modules consommés (liste EXACTE : ceux que `planRefreshes` traduit en demande ; les abonnés ont un
 * motif plus large mais ignorent le reste). Un contrat par événement : `apps/api/test/events-contracts/analytics.contracts.ts`.
 */
export const CONSUMED_EVENTS: readonly string[] = [
  "academic.year.opened", "academic.year.closed", "academic.year.archived",
  "academic.period.opened", "academic.period.grading_closed", "academic.period.closed", "academic.period.reopened",
  "academic.classroom.created", "academic.classroom.activated", "academic.classroom.completed", "academic.classroom.cancelled",
  "academic.classroom_period.grading_closed", "academic.classroom_period.closed", "academic.classroom_period.reopened",
  "academic.enrollment.created", "academic.enrollment.confirmed", "academic.enrollment.suspended", "academic.enrollment.resumed",
  "academic.enrollment.withdrawn", "academic.enrollment.cancelled", "academic.enrollment.transferred", "academic.enrollment.completed",
  "academic.enrollment.reopened", "academic.enrollment.funding_changed", "academic.enrollment.outcome_recorded",
  "people.student.status_changed", "people.student.updated", "people.student.anonymized",
  "people.teaching_assignment.created", "people.teaching_assignment.ended", "people.teaching_assignment.replaced",
  "results.period.closed", "results.period.reopened", "results.decision.confirmed",
  "attendance.session.submitted", "attendance.session.validated", "attendance.session.reopened", "attendance.session.cancelled",
  "attendance.absence.recorded", "attendance.late.recorded", "attendance.staff_absence.recorded",
  "attendance.staff_leave.approved", "attendance.staff_leave.cancelled",
  "finance.invoice.issued", "finance.invoice.paid", "finance.invoice.overdue", "finance.invoice.cancelled",
  "finance.credit_note.issued", "finance.payment.completed", "finance.payment.allocated", "finance.refund.completed",
  "finance.cash_session.opened", "finance.cash_session.closed",
  "payroll.period.created", "payroll.period.closed", "payroll.period.archived", "payroll.run.completed",
  "admissions.application.submitted", "admissions.application.status_changed", "admissions.application.enrolled", "admissions.application.anonymized",
  "admissions.decision.recorded", "admissions.offer.accepted", "admissions.offer.declined", "admissions.offer.expired", "admissions.offer.withdrawn",
  "admissions.waitlist.promoted", "admissions.prospect.converted",
  "schoollife.incident.declared", "schoollife.incident.status_changed",
  "schoollife.measure.proposed", "schoollife.measure.validated", "schoollife.measure.notified", "schoollife.measure.executed", "schoollife.measure.revoked", "schoollife.measure.rejected", "schoollife.measure.cancelled",
  "schoollife.appeal.decided", "schoollife.convocation.sent", "schoollife.convocation.held", "schoollife.convocation.missed", "schoollife.convocation.cancelled",
  "payroll.payslip.calculated", "payroll.payslip.approved", "payroll.payslip.paid", "payroll.payslip.disputed", "payroll.payslip.cancelled", "payroll.payslip.adjusted",
];
