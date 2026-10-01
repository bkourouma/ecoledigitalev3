/**
 * API PUBLIQUE du module `attendance` — seul point d'import autorisé pour les autres modules.
 *
 *   import { getAttendanceSummary, createAttendanceDeps, inMemoryPorts } from "../attendance";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les
 * références vers élèves, classes, inscriptions, séances et périodes sont des UUID résolus par les PORTS que fournissent
 * `academic`, `people` et `scheduling` (ils les enregistrent par `registerAttendancePorts(app, ports)`).
 *
 * Consommateurs : 013 (`getAttendanceSummary`, `attendance.summary.recomputed`), 011, 016 (`attendance.absence.recorded`,
 * `attendance.late.recorded`), 017 (`attendance.session.submitted` -> HELD, `attendance.staff_leave.approved`), 025
 * (alertes, `getCallCompliance`), 029 (PWA : `syncOfflineAttendance`), 022/023 (`bulkMarkFromExternal`), 032 (congés).
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as attendanceManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export {
  attendancePlugin,
  createPortRegistry,
  registerAttendancePorts,
  setup as attendanceSetup,
  type AttendancePluginOptions,
  type AttendancePortRegistry,
} from "./http/plugin";
export { createPermissionKit, PERMISSIONS as ATTENDANCE_PERMISSIONS, type PermissionKit } from "./http/guards";

// Dépendances
export {
  createAttendanceDeps,
  DEFAULT_ATTENDANCE_CONFIG,
  inTx as attendanceInTx,
  type AttendanceConfig,
  type AttendanceDeps,
  type AttendanceDepsInput,
  type CallerCaps,
} from "./application/deps";

// Ports
export type {
  AlertPolicyPort,
  AttendancePorts,
  AuditEntry,
  AuditPort,
  ClassroomInfo,
  EnrollmentInfo,
  EnrollmentRosterPort,
  OccurrenceInfo,
  OccurrencePort,
  OccurrenceStaff,
  PeoplePort,
  PeriodInfo,
  PeriodPort,
  RosterEntry,
  RosterQuery,
  StoragePort,
} from "./application/ports";
export { noopAudit, RecordingAudit } from "./application/ports";
export { attendanceAuditAdapter } from "./infrastructure/audit-adapter";
export {
  InMemoryOccurrences,
  InMemoryPeople,
  InMemoryPeriods,
  InMemoryRoster,
  InMemoryStorage,
  inMemoryPorts,
  settingsAlertPolicy,
  unavailablePorts,
  type InMemoryWorld,
} from "./infrastructure/in-memory-ports";

// Cas d'usage — appel
export {
  cancelAttendanceSession,
  getAttendanceSession,
  getRecordHistory,
  listAttendanceSessions,
  listStudentRecords,
  markStudentRecords,
  openAttendanceSession,
  reopenAttendanceSession,
  submitAttendanceSession,
  validateAttendanceSession,
  type MarkRecordsInput,
  type MarkRecordsResult,
  type OpenSessionInput,
  type OpenSessionResult,
  type SessionDetail,
  type SubmitSessionInput,
  type SubmitSessionResult,
} from "./application/sessions";
export { bulkMarkFromExternal, type ExternalEntry, type ExternalResult } from "./application/external";
export {
  listSyncConflicts,
  resolveSyncConflict,
  syncOfflineAttendance,
  type SyncBatchInput,
  type SyncRecordInput,
  type SyncResult,
  type SyncSessionInput,
  type SyncTarget,
} from "./application/sync";

// Cas d'usage — justificatifs
export {
  acceptJustification,
  attachJustificationDocument,
  getJustification,
  getJustificationAttachmentUrl,
  listJustifications,
  markWithJustification,
  rejectJustification,
  removeJustificationAttachment,
  revokeJustification,
  submitJustification,
  withdrawJustification,
  type JustificationView,
} from "./application/justifications";

// Cas d'usage — récapitulatifs, rapports
export {
  getAttendanceSummary,
  getClassroomAttendanceSummary,
  recomputeSummaries,
  refreshStaleSummaries,
  removeSummaryOverride,
  setSummaryOverride,
  type SummaryView,
} from "./application/summaries";
export {
  csvCell,
  exportAbsencesCsv,
  getAttendanceCertificateData,
  getCallCompliance,
  getStudentPortalView,
  listAbsencesReport as listAbsences,
  CSV_EXPORT_MAX_ROWS,
  type CallCompliance,
  type CertificateData,
} from "./application/reports";

// Cas d'usage — personnel
export {
  approveStaffLeave,
  cancelStaffLeave,
  checkInStaff,
  checkOutStaff,
  getStaffAttendanceSummary,
  listStaffLeaves,
  listStaffRecords,
  markStaffAttendance,
  rejectStaffLeave,
  requestStaffLeave,
} from "./application/staff";

// Paramétrage et amorçage
export {
  ensureReferenceData,
  getAttendanceSettings,
  instantiateAttendancePack,
  listCallPolicyDefinitions,
  listJustificationReasons,
  listLeaveTypeDefinitions,
  listStatusDefinitions,
  upsertAttendanceSettings,
  upsertCallPolicy,
  upsertJustificationReason,
  upsertLeaveTypeDefinition,
  upsertStatusDefinition,
} from "./application/reference";

// Consommateurs et jobs (utilisables par les tests d'assemblage)
export { onEnrollmentChanged, onOccurrenceCancelled, onPeriodChanged, onTenantProvisioned, recomputeAllTenants } from "./application/consumers";

// Domaine : événements, codes d'erreur, types
export { AttendanceEvents, ALL_ATTENDANCE_EVENT_TYPES, ConsumedEvents, type AttendanceEventType } from "./domain/events";
export { AttendanceCode, type AttendanceCodeValue } from "./domain/errors";
export { DEFAULT_ATTENDANCE_PACK, validatePackTemplate, type AttendancePackTemplate } from "./domain/reference-pack";
export { computeSummary, effectiveSummary, absenceRateBps } from "./domain/summary";
export { evaluateAlerts, metricValue, parseAlertRules, ALERT_METRICS, type AlertMetric, type AlertRule } from "./domain/alerts";
export type {
  AttendanceSession,
  CallPolicy,
  Justification,
  StatusDefinition,
  StudentRecord,
  SummaryCounts,
  SummaryOverride,
} from "./domain/types";
