/**
 * Domaine -> DTO de l'API (schémas `packages/contracts/src/v2/attendance.ts`). Dates calendaires en `AAAA-MM-JJ`,
 * instants en ISO 8601 UTC ; jamais d'objet interne (clé de stockage d'une pièce, chemin…).
 */
import type { z } from "zod";
import type {
  attendanceAbsenceRowDtoSchema,
  attendanceAttachmentDtoSchema,
  attendanceCallPolicyDtoSchema,
  attendanceJustificationDtoSchema,
  attendanceLeaveDtoSchema,
  attendanceLeaveTypeDtoSchema,
  attendanceReasonDtoSchema,
  attendanceRecordDtoSchema,
  attendanceSessionDetailDtoSchema,
  attendanceSessionDtoSchema,
  attendanceSettingsDtoSchema,
  attendanceStaffRecordDtoSchema,
  attendanceStatusDefinitionDtoSchema,
  attendanceSummaryDtoSchema,
  attendanceSyncConflictDtoSchema,
  attendanceSyncResultDtoSchema,
} from "@ecoledigitale/contracts/src/v2/attendance";
import type { AttendanceSession, CallPolicy, StatusDefinition, StudentRecord } from "../domain/types";
import type { AttendanceSettings, JustificationReason, LeaveType } from "../infrastructure/reference-repository";
import type { Attachment, StaffLeave, StaffRecord } from "../infrastructure/rows";
import type { AbsenceRow, HistoryRow } from "../infrastructure/sessions-repository";
import type { SyncConflict } from "../infrastructure/sync-repository";
import type { JustificationView } from "../application/justifications";
import type { SessionDetail } from "../application/sessions";
import type { SummaryView } from "../application/summaries";
import type { SyncResult } from "../application/sync";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const sessionDto = (s: AttendanceSession): z.infer<typeof attendanceSessionDtoSchema> => ({
  id: s.id,
  institutionId: s.institutionId,
  academicYearId: s.academicYearId,
  classroomId: s.classroomId,
  curriculumNodeId: s.curriculumNodeId,
  offeringId: s.offeringId,
  occurrenceId: s.occurrenceId,
  scope: s.scope,
  sessionDate: s.sessionDate,
  startsAt: iso(s.startsAt),
  endsAt: iso(s.endsAt),
  durationMinutes: s.durationMinutes,
  takenByStaffId: s.takenByStaffId,
  takenByUserId: s.takenByUserId,
  status: s.status,
  source: s.source,
  clientId: s.clientId,
  submittedAt: iso(s.submittedAt),
  validatedAt: iso(s.validatedAt),
  validatedBy: s.validatedBy,
  reopenedCount: s.reopenedCount,
  note: s.note,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export const recordDto = (r: StudentRecord): z.infer<typeof attendanceRecordDtoSchema> => ({
  id: r.id,
  sessionId: r.sessionId,
  enrollmentId: r.enrollmentId,
  studentId: r.studentId,
  statusCode: r.statusCode,
  originalStatusCode: r.originalStatusCode,
  excused: r.excused,
  minutesLate: r.minutesLate,
  countedMinutes: r.countedMinutes,
  arrivedAt: iso(r.arrivedAt),
  leftAt: iso(r.leftAt),
  justificationId: r.justificationId,
  note: r.note,
  markedBy: r.markedBy,
  markedAt: r.markedAt.toISOString(),
  clientMarkedAt: iso(r.clientMarkedAt),
  sourceDetail: r.sourceDetail,
});

export const sessionDetailDto = (d: SessionDetail): z.infer<typeof attendanceSessionDetailDtoSchema> => ({
  session: sessionDto(d.session),
  students: d.students.map((s) => ({ enrollmentId: s.enrollmentId, studentId: s.studentId, displayName: s.displayName, inRoster: s.inRoster, record: s.record ? recordDto(s.record) : null })),
  counts: d.counts,
  editable: d.editable,
});

export const historyDto = (items: HistoryRow[]) => ({
  items: items.map((h) => ({ id: h.id, recordId: h.record_id, fromStatus: h.from_status, toStatus: h.to_status, actorId: h.actor_id, reason: h.reason, changedAt: h.changed_at.toISOString() })),
});

export const absenceRowDto = (r: AbsenceRow): z.infer<typeof attendanceAbsenceRowDtoSchema> => ({ ...r });

const attachmentDto = (a: Attachment): z.infer<typeof attendanceAttachmentDtoSchema> => ({
  id: a.id,
  justificationId: a.justificationId,
  fileName: a.fileName,
  detectedMime: a.detectedMime,
  sizeBytes: a.sizeBytes,
  sha256: a.sha256,
  uploadedBy: a.uploadedBy,
  uploadedAt: a.uploadedAt.toISOString(),
});
export const attachmentDtoOf = attachmentDto;

export const justificationDto = (v: JustificationView): z.infer<typeof attendanceJustificationDtoSchema> => {
  const j = v.justification;
  return {
    id: j.id,
    studentId: j.studentId,
    enrollmentId: j.enrollmentId,
    fromDate: j.fromDate,
    toDate: j.toDate,
    reasonCode: j.reasonCode,
    comment: j.comment,
    submittedByKind: j.submittedByKind,
    submittedByUser: j.submittedByUser,
    submittedAt: j.submittedAt.toISOString(),
    status: j.status,
    decidedBy: j.decidedBy,
    decidedAt: iso(j.decidedAt),
    decisionNote: j.decisionNote,
    revokedBy: j.revokedBy,
    revokedAt: iso(j.revokedAt),
    revocationReason: j.revocationReason,
    attachments: v.attachments.map(attachmentDto),
    coveredRecordCount: v.coveredRecordCount,
  };
};

export const summaryDto = (s: SummaryView): z.infer<typeof attendanceSummaryDtoSchema> => ({
  enrollmentId: s.enrollmentId,
  periodId: s.periodId,
  studentId: s.studentId,
  windowFrom: s.windowFrom,
  windowTo: s.windowTo,
  derived: s.derived,
  override: s.override ? { absentMinutes: s.override.absentMinutes, excusedMinutes: s.override.excusedMinutes, reason: s.override.reason, setBy: s.override.setBy, setAt: s.override.setAt.toISOString() } : null,
  effective: s.effective,
  overridden: s.overridden,
  computedAt: iso(s.computedAt),
});

export const conflictDto = (c: SyncConflict): z.infer<typeof attendanceSyncConflictDtoSchema> => ({
  id: c.id,
  kind: c.kind,
  sessionId: c.sessionId,
  enrollmentId: c.enrollmentId,
  studentId: c.studentId,
  clientOpId: c.clientOpId,
  incoming: c.incoming,
  existing: c.existing,
  deviceId: c.deviceId,
  submittedBy: c.submittedBy,
  clientMarkedAt: iso(c.clientMarkedAt),
  receivedAt: c.receivedAt.toISOString(),
  status: c.status,
  resolution: c.resolution,
  resolvedBy: c.resolvedBy,
  resolvedAt: iso(c.resolvedAt),
  resolutionNote: c.resolutionNote,
});

export const syncResultDto = (r: SyncResult): z.infer<typeof attendanceSyncResultDtoSchema> => ({
  batchId: r.batchId,
  receivedAt: r.receivedAt.toISOString(),
  sessions: r.sessions,
  totals: r.totals,
});

export const staffRecordDto = (r: StaffRecord): z.infer<typeof attendanceStaffRecordDtoSchema> => ({
  id: r.id,
  staffId: r.staffId,
  workDate: r.workDate,
  occurrenceId: r.occurrenceId,
  statusCode: r.statusCode,
  checkInAt: iso(r.checkInAt),
  checkOutAt: iso(r.checkOutAt),
  minutesLate: r.minutesLate,
  leaveId: r.leaveId,
  note: r.note,
  source: r.source,
  markedBy: r.markedBy,
  markedAt: r.markedAt.toISOString(),
});

export const leaveDto = (l: StaffLeave): z.infer<typeof attendanceLeaveDtoSchema> => ({
  id: l.id,
  staffId: l.staffId,
  leaveTypeCode: l.leaveTypeCode,
  startsOn: l.startsOn,
  endsOn: l.endsOn,
  halfDayStart: l.halfDayStart,
  halfDayEnd: l.halfDayEnd,
  reason: l.reason,
  status: l.status,
  requestedBy: l.requestedBy,
  requestedAt: l.requestedAt.toISOString(),
  decidedBy: l.decidedBy,
  decidedAt: iso(l.decidedAt),
  decisionNote: l.decisionNote,
  documentRef: l.documentRef,
});

export const statusDefinitionDto = (d: StatusDefinition): z.infer<typeof attendanceStatusDefinitionDtoSchema> => ({
  subjectKind: d.subjectKind,
  code: d.code,
  label: d.label,
  countsAsPresent: d.countsAsPresent,
  countsAsAbsence: d.countsAsAbsence,
  countsAsLate: d.countsAsLate,
  isJustified: d.isJustified,
  requiresJustification: d.requiresJustification,
  sortOrder: d.sortOrder,
  isSystem: d.isSystem,
  active: d.active,
});

export const reasonDto = (r: JustificationReason): z.infer<typeof attendanceReasonDtoSchema> => ({ ...r });
export const leaveTypeDto = (t: LeaveType): z.infer<typeof attendanceLeaveTypeDtoSchema> => ({ ...t });
export const callPolicyDto = (p: CallPolicy): z.infer<typeof attendanceCallPolicyDtoSchema> => ({ ...p });
export const settingsDto = (s: AttendanceSettings): z.infer<typeof attendanceSettingsDtoSchema> => ({
  attachmentMaxBytes: s.attachmentMaxBytes,
  allowedAttachmentTypes: s.allowedAttachmentTypes ? [...s.allowedAttachmentTypes] : null,
  allowFutureJustifications: s.allowFutureJustifications,
  alertRules: s.alertRules.map((r) => ({ code: r.code, metric: r.metric, threshold: r.threshold, active: r.active })),
});
