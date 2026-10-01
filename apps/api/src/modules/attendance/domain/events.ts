/**
 * Événements publiés par le module attendance (outbox, ADR-004).
 *
 * Nommage `attendance.<entité>.<verbe-passé>` ; payload JSON versionné `{ v: 1, … }`. On ajoute des champs, on n'en
 * retire jamais sans nouvelle version. Les payloads ne contiennent AUCUNE donnée sensible : identifiants, statuts,
 * dates, jamais le motif d'un justificatif ni une pièce (schémas Zod : `packages/contracts/src/v2/attendance.ts`).
 */
export const AttendanceEvents = {
  SESSION_OPENED: "attendance.session.opened",
  SESSION_SUBMITTED: "attendance.session.submitted",
  SESSION_VALIDATED: "attendance.session.validated",
  SESSION_REOPENED: "attendance.session.reopened",
  SESSION_CANCELLED: "attendance.session.cancelled",
  ABSENCE_RECORDED: "attendance.absence.recorded",
  LATE_RECORDED: "attendance.late.recorded",
  JUSTIFICATION_SUBMITTED: "attendance.justification.submitted",
  JUSTIFICATION_ACCEPTED: "attendance.justification.accepted",
  JUSTIFICATION_REJECTED: "attendance.justification.rejected",
  JUSTIFICATION_REVOKED: "attendance.justification.revoked",
  LEAVE_REQUESTED: "attendance.staff_leave.requested",
  LEAVE_APPROVED: "attendance.staff_leave.approved",
  LEAVE_REJECTED: "attendance.staff_leave.rejected",
  LEAVE_CANCELLED: "attendance.staff_leave.cancelled",
  STAFF_ABSENCE_RECORDED: "attendance.staff_absence.recorded",
  SUMMARY_RECOMPUTED: "attendance.summary.recomputed",
  ALERT_TRIGGERED: "attendance.alert.triggered",
  ALERT_CLEARED: "attendance.alert.cleared",
  SYNC_CONFLICT_RECORDED: "attendance.sync.conflict_recorded",
} as const;

export type AttendanceEventType = (typeof AttendanceEvents)[keyof typeof AttendanceEvents];
export const ALL_ATTENDANCE_EVENT_TYPES: ReadonlyArray<AttendanceEventType> = Object.values(AttendanceEvents);

/** Événements d'AUTRES modules consommés (hypothèses de travail à confirmer avec leurs producteurs). */
export const ConsumedEvents = {
  OCCURRENCE_CANCELLED: "scheduling.occurrence.cancelled",
  ENROLLMENT_WITHDRAWN: "academic.enrollment.withdrawn",
  ENROLLMENT_CANCELLED: "academic.enrollment.cancelled",
  ENROLLMENT_TRANSFERRED: "academic.enrollment.transferred",
  PERIOD_CLOSED: "academic.period.closed",
  PERIOD_REOPENED: "academic.period.reopened",
  TENANT_PROVISIONED: "tenancy.tenant.provisioned",
} as const;
