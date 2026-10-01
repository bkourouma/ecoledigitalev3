/**
 * Erreurs métier du module attendance : types du kernel + codes stables `attendance.*`
 * (ils font partie du contrat d'API ; ne jamais en renommer un).
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const AttendanceCode = {
  INVALID_INPUT: "attendance.invalid_input",
  INVALID_TRANSITION: "attendance.invalid_transition",
  IDEMPOTENCY_KEY_REUSED: "attendance.idempotency_key_reused",
  PORT_UNAVAILABLE: "attendance.port_unavailable",
  FORBIDDEN: "attendance.forbidden",
  // Séances et pointages
  SESSION_NOT_FOUND: "attendance.session_not_found",
  SESSION_LOCKED: "attendance.session_locked",
  EDIT_WINDOW_CLOSED: "attendance.edit_window_closed",
  NOT_CALL_TAKER: "attendance.not_call_taker",
  CALL_SCOPE_NOT_ALLOWED: "attendance.call_scope_not_allowed",
  CLASSROOM_NOT_FOUND: "attendance.classroom_not_found",
  OCCURRENCE_NOT_FOUND: "attendance.occurrence_not_found",
  OCCURRENCE_CANCELLED: "attendance.occurrence_cancelled",
  EXTERNAL_SESSION_FORBIDDEN: "attendance.external_session_forbidden",
  STUDENT_NOT_IN_ROSTER: "attendance.student_not_in_roster",
  STATUS_UNKNOWN: "attendance.status_unknown",
  STATUS_INACTIVE: "attendance.status_inactive",
  EXCUSED_REQUIRES_JUSTIFICATION: "attendance.excused_requires_justification",
  MINUTES_LATE_REQUIRED: "attendance.minutes_late_required",
  MINUTES_INVALID: "attendance.minutes_invalid",
  DUPLICATE_ENTRY: "attendance.duplicate_entry",
  UNMARKED_STUDENTS: "attendance.unmarked_students",
  REASON_REQUIRED: "attendance.reason_required",
  RECORD_NOT_FOUND: "attendance.record_not_found",
  // Synchronisation
  SYNC_CONFLICT_NOT_FOUND: "attendance.sync_conflict_not_found",
  SYNC_CONFLICT_RESOLVED: "attendance.sync_conflict_already_resolved",
  // Justificatifs
  JUSTIFICATION_NOT_FOUND: "attendance.justification_not_found",
  JUSTIFICATION_NOT_PENDING: "attendance.justification_not_pending",
  JUSTIFICATION_NOT_ACCEPTED: "attendance.justification_not_accepted",
  JUSTIFICATION_WINDOW_INVALID: "attendance.justification_window_invalid",
  JUSTIFICATION_FUTURE_NOT_ALLOWED: "attendance.justification_future_not_allowed",
  REASON_UNKNOWN: "attendance.justification_reason_unknown",
  ATTACHMENT_REQUIRED: "attendance.attachment_required",
  ATTACHMENTS_DISABLED: "attendance.attachments_disabled",
  ATTACHMENT_TOO_LARGE: "attendance.attachment_too_large",
  ATTACHMENT_TYPE_REJECTED: "attendance.attachment_type_rejected",
  ATTACHMENT_NOT_FOUND: "attendance.attachment_not_found",
  NOT_GUARDIAN: "attendance.not_guardian",
  ENROLLMENT_NOT_FOUND: "attendance.enrollment_not_found",
  // Récapitulatifs
  OVERRIDE_INVALID: "attendance.override_invalid",
  OVERRIDE_NOT_FOUND: "attendance.override_not_found",
  PERIOD_NOT_FOUND: "attendance.period_not_found",
  // Personnel
  STAFF_NOT_FOUND: "attendance.staff_not_found",
  STAFF_ON_APPROVED_LEAVE: "attendance.staff_on_approved_leave",
  ON_LEAVE_REQUIRES_LEAVE: "attendance.on_leave_requires_leave",
  LEAVE_NOT_FOUND: "attendance.leave_not_found",
  LEAVE_TYPE_UNKNOWN: "attendance.leave_type_unknown",
  LEAVE_OVERLAP: "attendance.leave_overlap",
  CHECKOUT_WITHOUT_CHECKIN: "attendance.checkout_without_checkin",
  // Paramétrage
  SYSTEM_STATUS_IMMUTABLE: "attendance.system_status_immutable",
  ALERT_RULE_INVALID: "attendance.alert_rule_invalid",
} as const;

export type AttendanceCodeValue = (typeof AttendanceCode)[keyof typeof AttendanceCode];

export const validation = (
  code: AttendanceCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: AttendanceCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: AttendanceCodeValue, resource: string, id?: string): NotFoundError =>
  NotFoundError.of(resource, id, { code });

export const forbidden = (code: AttendanceCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Port non branché : le module échoue FERMÉ (aucune écriture sans la source de vérité du roster, etc.). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: AttendanceCode.PORT_UNAVAILABLE,
    details: { port },
  });
