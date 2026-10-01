/**
 * API PUBLIQUE du module `scheduling` — seul point d'import autorisé pour les autres modules.
 *
 *   import { createSchedulingDeps, listPayableHours, lockHours, holdOccurrence } from "../scheduling";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (conventions n° 4).
 * Consommateurs principaux :
 *   - 032 (paie)        : `listPayableHours`, `lockHours`, `releaseHoursLock` (réservées à la paie),
 *                         `createAccountingOccurrence`, `listExpectedWithoutOccurrence`, `holdOccurrence`/`cancelOccurrence` ;
 *   - 010 (présences)   : `getOccurrence`, `listOccurrencesForStaff`/`Classroom`, `holdOccurrence`, événements
 *                         `scheduling.occurrence.*` ;
 *   - 004 (académique)  : `createScheduleConflictChecker` (port `ScheduleConflictChecker`), `registerSchedulingPorts` ;
 *   - 009 (personnel)   : `registerSchedulingPorts({ people })`.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as schedulingManifest } from "./manifest";

// Plugin Fastify
export { schedulingPlugin, SCHEDULING_ROUTES_PREFIX, type SchedulingPluginOptions } from "./http/plugin";

// Dépendances et ports
export {
  createSchedulingDeps,
  inTx as schedulingInTx,
  type SchedulingDeps,
  type SchedulingDepsInput,
  type SchedulingPorts,
} from "./application/deps";
export { registerSchedulingPorts, resetSchedulingPorts, registryPorts as schedulingRegistryPorts } from "./ports-registry";
export { noopAudit, RecordingAudit, type AuditEntry, type AuditPort } from "./application/ports/audit";
export { schedulingAuditAdapter } from "./infrastructure/audit-adapter";
export type {
  AcademicQuery,
  ClassroomInfo,
  CurriculumNodeInfo,
  OfferingInfo,
  OfferingStatus,
  PeriodInfo,
  StudentPlacements,
} from "./application/ports/academic";
export { SCHEDULABLE_OFFERING_STATUSES } from "./application/ports/academic";
export type { PeopleQuery, StaffAvailabilityInfo, StaffCompetencyInfo, StaffInfo, StaffStatus } from "./application/ports/people";
export type { AttendanceQuery } from "./application/ports/attendance";
export { InMemoryAcademicQuery, InMemoryAttendanceQuery, InMemoryPeopleQuery } from "./application/ports/in-memory";

// Port pour academic
export { createScheduleConflictChecker, type ScheduleConflictChecker, type StudentOfferingCheck, type StudentScheduleConflict } from "./application/conflict-checker";

// Cas d'usage — séances
export {
  cancelOccurrence,
  changeOccurrenceRoom,
  createAccountingOccurrence,
  createOccurrence,
  holdOccurrence,
  overrideConflict,
  rescheduleOccurrence,
  restoreOccurrence,
  setOccurrenceStaff,
  substituteStaff,
  unholdOccurrence,
  updateOccurrenceDetails,
  type CancelResult,
  type CreateAccountingOccurrenceInput,
  type CreateOccurrenceInput,
  type HoldInput,
  type HoldResult,
  type OccurrenceResult,
  type RescheduleInput,
  type SetStaffInput,
  type StaffAssignmentInput,
  type SubstituteInput,
} from "./application/occurrences";

// Cas d'usage — validation, heures payables, verrous de paie
export {
  findValidatedOverlaps,
  listPayableHours,
  lockHours,
  releaseHoursLock,
  setPaidMinutes,
  unvalidateOccurrence,
  validateOccurrence,
  validateOccurrencesBatch,
  type LockHoursInput,
  type LockHoursResult,
  type LockLine,
  type PayableHoursInput,
  type ValidateBatchResult,
  type ValidateOutcome,
} from "./application/validation";

// Cas d'usage — emplois du temps, patrons, génération
export {
  archiveTimetable,
  cloneTimetable,
  createTimetable,
  endTimetableEntry,
  getTimetable,
  getTimetableConflicts,
  listGenerationRuns,
  listTimetables,
  publishTimetable,
  removeTimetableEntry,
  updateTimetable,
  upsertTimetableEntries,
  upsertTimetableEntry,
  type CloneInput,
  type CreateTimetableInput,
  type EntryInput,
  type EntryResult,
  type PropagationReport,
} from "./application/timetables";
export {
  generateOccurrences,
  generateRolling,
  listExpectedWithoutOccurrence,
  type GenerateInput,
  type GenerationReport,
  type MissingOccurrence,
  type RollingReport,
} from "./application/generation";

// Cas d'usage — aides au placement
export { previewConflicts, suggestSlots, suggestSubstitutes, type PreviewInput, type PreviewResult, type SuggestSlotsInput } from "./application/aids";

// Cas d'usage — vues et rapports
export {
  createIcsToken,
  exportTimetableIcs,
  getOccurrence,
  getOccurrenceHistory,
  getRoomOccupancy,
  getStaffWeeklyLoad,
  listIcsTokens,
  listMyToday,
  listMyTimetable,
  listOccurrences,
  listOccurrencesForClassroom,
  listOccurrencesForRoom,
  listOccurrencesForStaff,
  listOccurrencesForStudent,
  listPendingReplacements,
  listPendingValidation,
  listUnrealizedOccurrences,
  readIcsFeed,
  revokeIcsToken,
  type OccurrenceView,
  type Page,
  type RoomOccupancyView,
} from "./application/views";

// Cas d'usage — paramétrage
export {
  createCalendarEvent,
  createEquipmentItem,
  createRoom,
  deactivateTimeSlot,
  deleteCalendarEvent,
  getConflictPolicies,
  getRoom,
  getSchedulingSettings,
  listCalendarEvents,
  listEquipmentItems,
  listEventKinds,
  listRoomTypes,
  listRooms,
  listTimeSlots,
  seedReference,
  seedReferenceData,
  setRoomStatus,
  updateCalendarEvent,
  updateEquipmentItem,
  updateRoom,
  updateSchedulingSettings,
  upsertConflictPolicy,
  upsertEventKind,
  upsertRoomType,
  upsertTimeSlot,
  type CalendarEventInput,
  type RoomInput,
  type TimeSlotInput,
} from "./application/reference";

// Réactions aux événements (utilisables directement par le câblage ou les tests)
export {
  onAttendanceSessionSubmitted,
  onClassroomCancelled,
  onOfferingCancelled,
  onStaffLeaveApproved,
  onStaffStatusChanged,
  onTeachingAssignmentEnded,
  onTenantProvisioned,
  onYearClosed,
} from "./application/consumers";

// Domaine : types, événements, codes d'erreur
export { SchedulingEvents, ConsumedEvents, ALL_SCHEDULING_EVENT_TYPES } from "./domain/events";
export { SchedulingCodes } from "./domain/errors";
export type { ConflictView } from "./domain/conflicts";
export type {
  CalendarEvent,
  EquipmentItem,
  Occurrence,
  OccurrenceDetail,
  OccurrenceStaff,
  PayableHourLine,
  Room,
  SchedulingSettings,
  TimeSlot,
  Timetable,
  TimetableEntry,
} from "./domain/types";
