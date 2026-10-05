/**
 * Colonnes SQL et mappeurs ligne -> domaine. Les dates calendaires sont lues en TEXTE (`::text`) pour qu'aucun
 * fuseau du processus ne décale un jour ; les `bigint` arrivent en chaîne et sont convertis.
 */
import type {
  AttendanceSession,
  CallPolicy,
  DailyCallMode,
  DayPart,
  IsoDate,
  Justification,
  RecordSource,
  SessionScope,
  SessionSource,
  SessionStatus,
  StatusDefinition,
  StudentRecord,
  SubmitterKind,
  JustificationStatus,
  CallScope,
  LeaveStatus,
  StaffSource,
  SubjectKind,
  SummaryCounts,
  Uuid,
} from "../domain/types";

// ---------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------

export const SESSION_COLUMNS = `s.id, s.institution_id, s.academic_year_id, s.classroom_id, s.curriculum_node_id, s.offering_id,
  s.occurrence_id, s.scope, s.day_part, s.session_date::text AS session_date, s.starts_at, s.ends_at, s.duration_minutes,
  s.taken_by_staff_id, s.taken_by_user_id, s.status, s.source, s.client_id, s.submitted_at, s.validated_at,
  s.validated_by, s.reopened_count, s.note, s.created_at, s.updated_at`;

export interface SessionRow {
  id: Uuid;
  institution_id: Uuid;
  academic_year_id: Uuid;
  classroom_id: Uuid;
  curriculum_node_id: Uuid | null;
  offering_id: Uuid | null;
  occurrence_id: Uuid | null;
  scope: SessionScope;
  day_part: DayPart;
  session_date: IsoDate;
  starts_at: Date | null;
  ends_at: Date | null;
  duration_minutes: number | null;
  taken_by_staff_id: Uuid | null;
  taken_by_user_id: Uuid | null;
  status: SessionStatus;
  source: SessionSource;
  client_id: Uuid | null;
  submitted_at: Date | null;
  validated_at: Date | null;
  validated_by: Uuid | null;
  reopened_count: number;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

export const toSession = (r: SessionRow): AttendanceSession => ({
  id: r.id,
  institutionId: r.institution_id,
  academicYearId: r.academic_year_id,
  classroomId: r.classroom_id,
  curriculumNodeId: r.curriculum_node_id,
  offeringId: r.offering_id,
  occurrenceId: r.occurrence_id,
  scope: r.scope,
  dayPart: r.day_part,
  sessionDate: r.session_date,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  durationMinutes: r.duration_minutes,
  takenByStaffId: r.taken_by_staff_id,
  takenByUserId: r.taken_by_user_id,
  status: r.status,
  source: r.source,
  clientId: r.client_id,
  submittedAt: r.submitted_at,
  validatedAt: r.validated_at,
  validatedBy: r.validated_by,
  reopenedCount: r.reopened_count,
  note: r.note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---------------------------------------------------------------------------
// Pointages
// ---------------------------------------------------------------------------

export const RECORD_COLUMNS = `r.id, r.session_id, r.enrollment_id, r.student_id, r.status_code, r.original_status_code, r.excused,
  r.minutes_late, r.counted_minutes, r.arrived_at, r.left_at, r.justification_id, r.note, r.marked_by, r.marked_at,
  r.client_marked_at, r.source_detail, r.client_id`;

export interface RecordRow {
  id: Uuid;
  session_id: Uuid;
  enrollment_id: Uuid;
  student_id: Uuid;
  status_code: string;
  original_status_code: string | null;
  excused: boolean;
  minutes_late: number | null;
  counted_minutes: number | null;
  arrived_at: Date | null;
  left_at: Date | null;
  justification_id: Uuid | null;
  note: string | null;
  marked_by: Uuid;
  marked_at: Date;
  client_marked_at: Date | null;
  source_detail: RecordSource | null;
  client_id: Uuid | null;
}

export const toRecord = (r: RecordRow): StudentRecord => ({
  id: r.id,
  sessionId: r.session_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  statusCode: r.status_code,
  originalStatusCode: r.original_status_code,
  excused: r.excused,
  minutesLate: r.minutes_late,
  countedMinutes: r.counted_minutes,
  arrivedAt: r.arrived_at,
  leftAt: r.left_at,
  justificationId: r.justification_id,
  note: r.note,
  markedBy: r.marked_by,
  markedAt: r.marked_at,
  clientMarkedAt: r.client_marked_at,
  sourceDetail: r.source_detail,
  clientId: r.client_id,
});

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

export interface StatusRow {
  subject_kind: SubjectKind;
  code: string;
  label: string;
  counts_as_present: boolean;
  counts_as_absence: boolean;
  counts_as_late: boolean;
  is_justified: boolean;
  requires_justification: boolean;
  sort_order: number;
  is_system: boolean;
  active: boolean;
}
export const STATUS_COLUMNS =
  "subject_kind, code, label, counts_as_present, counts_as_absence, counts_as_late, is_justified, requires_justification, sort_order, is_system, active";
export const toStatus = (r: StatusRow): StatusDefinition => ({
  subjectKind: r.subject_kind,
  code: r.code,
  label: r.label,
  countsAsPresent: r.counts_as_present,
  countsAsAbsence: r.counts_as_absence,
  countsAsLate: r.counts_as_late,
  isJustified: r.is_justified,
  requiresJustification: r.requires_justification,
  sortOrder: r.sort_order,
  isSystem: r.is_system,
  active: r.active,
});

export interface CallPolicyRow {
  institution_id: Uuid;
  education_level_code: string;
  call_scope: CallScope;
  edit_window_minutes: number | null;
  late_requires_minutes: boolean;
  daily_minutes: number | null;
  daily_call_mode: DailyCallMode;
}
export const CALL_POLICY_COLUMNS = "institution_id, education_level_code, call_scope, edit_window_minutes, late_requires_minutes, daily_minutes, daily_call_mode";
export const toCallPolicy = (r: CallPolicyRow): CallPolicy => ({
  institutionId: r.institution_id,
  educationLevelCode: r.education_level_code,
  callScope: r.call_scope,
  editWindowMinutes: r.edit_window_minutes,
  lateRequiresMinutes: r.late_requires_minutes,
  dailyMinutes: r.daily_minutes,
  dailyCallMode: r.daily_call_mode,
});

// ---------------------------------------------------------------------------
// Justificatifs
// ---------------------------------------------------------------------------

export const JUSTIFICATION_COLUMNS = `j.id, j.student_id, j.enrollment_id, j.from_date::text AS from_date, j.to_date::text AS to_date, j.reason_code,
  j.comment, j.submitted_by_kind, j.submitted_by_user, j.submitted_at, j.status, j.decided_by, j.decided_at, j.decision_note,
  j.revoked_by, j.revoked_at, j.revocation_reason`;

export interface JustificationRow {
  id: Uuid;
  student_id: Uuid;
  enrollment_id: Uuid;
  from_date: IsoDate;
  to_date: IsoDate;
  reason_code: string;
  comment: string | null;
  submitted_by_kind: SubmitterKind;
  submitted_by_user: Uuid;
  submitted_at: Date;
  status: JustificationStatus;
  decided_by: Uuid | null;
  decided_at: Date | null;
  decision_note: string | null;
  revoked_by: Uuid | null;
  revoked_at: Date | null;
  revocation_reason: string | null;
}
export const toJustification = (r: JustificationRow): Justification => ({
  id: r.id,
  studentId: r.student_id,
  enrollmentId: r.enrollment_id,
  fromDate: r.from_date,
  toDate: r.to_date,
  reasonCode: r.reason_code,
  comment: r.comment,
  submittedByKind: r.submitted_by_kind,
  submittedByUser: r.submitted_by_user,
  submittedAt: r.submitted_at,
  status: r.status,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  revokedBy: r.revoked_by,
  revokedAt: r.revoked_at,
  revocationReason: r.revocation_reason,
});

export interface AttachmentRow {
  id: Uuid;
  justification_id: Uuid;
  storage_key: string;
  file_name: string;
  detected_mime: string;
  size_bytes: string | number;
  sha256: string;
  uploaded_by: Uuid;
  uploaded_at: Date;
  removed_at: Date | null;
}
export const ATTACHMENT_COLUMNS = "id, justification_id, storage_key, file_name, detected_mime, size_bytes, sha256, uploaded_by, uploaded_at, removed_at";
export interface Attachment {
  readonly id: Uuid;
  readonly justificationId: Uuid;
  readonly storageKey: string;
  readonly fileName: string;
  readonly detectedMime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly uploadedBy: Uuid;
  readonly uploadedAt: Date;
  readonly removedAt: Date | null;
}
export const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  justificationId: r.justification_id,
  storageKey: r.storage_key,
  fileName: r.file_name,
  detectedMime: r.detected_mime,
  sizeBytes: Number(r.size_bytes),
  sha256: r.sha256,
  uploadedBy: r.uploaded_by,
  uploadedAt: r.uploaded_at,
  removedAt: r.removed_at,
});

// ---------------------------------------------------------------------------
// Récapitulatifs
// ---------------------------------------------------------------------------

export interface SummaryRow {
  enrollment_id: Uuid;
  period_id: Uuid;
  student_id: Uuid;
  window_from: IsoDate;
  window_to: IsoDate;
  sessions_total: number;
  present_count: number;
  absent_count: number;
  excused_count: number;
  late_count: number;
  excused_late_count: number;
  early_leave_count: number;
  unmarked_count: number;
  absent_minutes: number;
  excused_minutes: number;
  late_minutes: number;
  computed_at: Date;
}
export const SUMMARY_COLUMNS = `enrollment_id, period_id, student_id, window_from::text AS window_from, window_to::text AS window_to, sessions_total,
  present_count, absent_count, excused_count, late_count, excused_late_count, early_leave_count, unmarked_count,
  absent_minutes, excused_minutes, late_minutes, computed_at`;
export const toCounts = (r: SummaryRow): SummaryCounts => ({
  sessionsTotal: r.sessions_total,
  presentCount: r.present_count,
  absentCount: r.absent_count,
  excusedCount: r.excused_count,
  lateCount: r.late_count,
  excusedLateCount: r.excused_late_count,
  earlyLeaveCount: r.early_leave_count,
  unmarkedCount: r.unmarked_count,
  absentMinutes: r.absent_minutes,
  excusedMinutes: r.excused_minutes,
  lateMinutes: r.late_minutes,
});

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

export interface StaffRecordRow {
  id: Uuid;
  staff_id: Uuid;
  work_date: IsoDate;
  occurrence_id: Uuid | null;
  status_code: string;
  check_in_at: Date | null;
  check_out_at: Date | null;
  minutes_late: number | null;
  leave_id: Uuid | null;
  note: string | null;
  source: StaffSource;
  marked_by: Uuid;
  marked_at: Date;
  client_id: Uuid | null;
}
export const STAFF_RECORD_COLUMNS = `id, staff_id, work_date::text AS work_date, occurrence_id, status_code, check_in_at, check_out_at, minutes_late,
  leave_id, note, source, marked_by, marked_at, client_id`;
export interface StaffRecord {
  readonly id: Uuid;
  readonly staffId: Uuid;
  readonly workDate: IsoDate;
  readonly occurrenceId: Uuid | null;
  readonly statusCode: string;
  readonly checkInAt: Date | null;
  readonly checkOutAt: Date | null;
  readonly minutesLate: number | null;
  readonly leaveId: Uuid | null;
  readonly note: string | null;
  readonly source: StaffSource;
  readonly markedBy: Uuid;
  readonly markedAt: Date;
  readonly clientId: Uuid | null;
}
export const toStaffRecord = (r: StaffRecordRow): StaffRecord => ({
  id: r.id,
  staffId: r.staff_id,
  workDate: r.work_date,
  occurrenceId: r.occurrence_id,
  statusCode: r.status_code,
  checkInAt: r.check_in_at,
  checkOutAt: r.check_out_at,
  minutesLate: r.minutes_late,
  leaveId: r.leave_id,
  note: r.note,
  source: r.source,
  markedBy: r.marked_by,
  markedAt: r.marked_at,
  clientId: r.client_id,
});

export interface LeaveRow {
  id: Uuid;
  staff_id: Uuid;
  leave_type_code: string;
  starts_on: IsoDate;
  ends_on: IsoDate;
  half_day_start: boolean;
  half_day_end: boolean;
  reason: string | null;
  status: LeaveStatus;
  requested_by: Uuid;
  requested_at: Date;
  decided_by: Uuid | null;
  decided_at: Date | null;
  decision_note: string | null;
  document_ref: Uuid | null;
}
export const LEAVE_COLUMNS = `id, staff_id, leave_type_code, starts_on::text AS starts_on, ends_on::text AS ends_on, half_day_start, half_day_end,
  reason, status, requested_by, requested_at, decided_by, decided_at, decision_note, document_ref`;
export interface StaffLeave {
  readonly id: Uuid;
  readonly staffId: Uuid;
  readonly leaveTypeCode: string;
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
  readonly halfDayStart: boolean;
  readonly halfDayEnd: boolean;
  readonly reason: string | null;
  readonly status: LeaveStatus;
  readonly requestedBy: Uuid;
  readonly requestedAt: Date;
  readonly decidedBy: Uuid | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly documentRef: Uuid | null;
}
export const toLeave = (r: LeaveRow): StaffLeave => ({
  id: r.id,
  staffId: r.staff_id,
  leaveTypeCode: r.leave_type_code,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  halfDayStart: r.half_day_start,
  halfDayEnd: r.half_day_end,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
  documentRef: r.document_ref,
});

/** Curseur de pagination opaque (base64url JSON) : keyset, jamais d'OFFSET sur de gros volumes. */
export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
export function decodeCursor<T extends Record<string, string | number>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}
