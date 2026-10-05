/**
 * API PUBLIQUE du module `academic` — seul point d'import autorisé pour les autres modules (ADR-001).
 *
 *   import { createAcademicDeps, getRuleContext, createEnrollmentDirectory } from "../academic";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les noms
 * de la section 7.2 de la spec 004 sont FIGÉS pour les modules 011, 012, 013, 019, 014 et 032. Les identifiants stables
 * (`EnrollmentId`, `NodeId`/`lineageId`, `PeriodId`, `ClassroomId`, `OfferingId`) ne changent jamais pour une même chose.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as academicManifest } from "./manifest";

// Plugin Fastify et registres de ports (adaptateurs de plateforme)
export { academicPlugin, ACADEMIC_ROUTES_PREFIX, registerAcademicPorts, type AcademicPluginOptions } from "./http/plugin";
export { academicWorkerPorts, createAcademicPortRegistry, resetAcademicWorkerPorts, setAcademicWorkerPorts, type AcademicPortRegistry } from "./application/port-registry";

// Dépendances, configuration, ports (repli sûr si non câblés)
export { createAcademicDeps, DEFAULT_ACADEMIC_CONFIG, type AcademicConfig, type AcademicDeps, type AcademicDepsInput } from "./application/deps";
export {
  DEFAULT_PORTS,
  InMemoryStudentDirectory,
  RecordingAudit,
  REGISTRATION_FEE_CATEGORY,
  noopAudit,
  type AcademicPorts,
  type AuditEntry,
  type AuditPort,
  type ClassroomActivationGuard,
  type ClassroomActivationRefusal,
  neverBlockActivation,
  type CompletionLookup,
  type CurriculumUsageGuard,
  type GuardianshipPort,
  type InstitutionDirectory,
  type InstitutionInfo,
  type InvoiceFacts,
  type InvoiceFactsReader,
  type OfferingReadinessGuard,
  type PeriodClosureGuard,
  type RegistrationFeeProbe,
  type ScheduleConflictChecker,
  type StudentDirectory,
  type StudentSummary,
  type TemplateProvider,
} from "./application/ports";
export { configureGradeLevelCache } from "./infrastructure/grade-level-cache";
export { academicAuditAdapter } from "./infrastructure/audit-adapter";
export { createTenancyInstitutionDirectory } from "./infrastructure/tenancy-directory";

// Calendrier : années, périodes typées, clôture en deux temps et par classe
export {
  applyPeriodPlan,
  archiveAcademicYear,
  closeAcademicYear,
  closeClassroomPeriod,
  closeClassroomPeriodGrading,
  closePeriod,
  closePeriodGrading,
  createAcademicYear,
  createPeriod,
  deletePeriod,
  findYearGaps,
  getAcademicPeriod,
  getAcademicYear,
  getCurrentAcademicYear,
  getEffectivePeriodState,
  listAcademicPeriods,
  listAcademicYears,
  openAcademicYear,
  openPeriod,
  reopenClassroomPeriod,
  reopenPeriod,
  resolvePeriodForDate,
  setCurrentAcademicYear,
  updateAcademicYear,
  updatePeriod,
  type EffectiveState,
} from "./application/calendar";

// Référentiels, paramètres, modèle de pack
export {
  getSettings as getAcademicSettings,
  instantiatePackReferenceData,
  listReference,
  putReference,
  updateSettings as updateAcademicSettings,
  type InstantiateOptions,
} from "./application/reference";
export { buildAcademicTemplates, defaultAcademicTemplates, getAcademicTemplate } from "./templates";
export { AcademicPackTemplateSchema, TEMPLATE_SOURCE_KINDS, type AcademicPackTemplate, type TemplateSourceKind } from "./domain/template";

// Programmes et matières
export { createProgram, createSubject, deleteSubject, getProgram, getSubject, listPrograms, listSubjects, setProgramGradeLevels, updateProgram, updateSubject } from "./application/programs";

// Curriculum
export {
  addCurriculumNode,
  amendPublishedCurriculum,
  cloneCurriculumVersion,
  createCurriculumVersion,
  getCurriculumNode,
  getCurriculumTree,
  getCurriculumVersion,
  getNodePrerequisiteStatus,
  listCurriculumAmendments,
  listCurriculumNodes,
  listCurriculumVersions,
  lockCurriculumVersion,
  moveCurriculumNode,
  publishCurriculumVersion,
  removeCurriculumNode,
  setNodePrerequisites,
  updateCurriculumNode,
  validateCurriculumVersion,
  type PrerequisiteStatus,
} from "./application/curriculum";

// Classes et offres
export {
  activateClassroom,
  classroomAction,
  createClassroom,
  createOffering,
  finalizeEndedOfferings,
  getClassroom,
  getOffering,
  listClassrooms,
  listOfferings,
  offeringAction,
  openOfferingsForPeriod,
  reopenOffering,
  updateClassroom,
  updateOffering,
} from "./application/classrooms";

// Inscriptions
export {
  cancelEnrollment,
  changeEnrollmentFunding,
  enrollStudent,
  enrollStudentsBulk,
  getEnrollment,
  getEnrollmentDetail,
  getEnrollmentHistory,
  listEnrollments,
  listEnrollmentsByStudent,
  recordEnrollmentOutcome,
  transferEnrollment,
  transitionEnrollment,
  confirmEnrollmentManually,
} from "./application/enrollments";

// Sélections de cours, éligibilité, registre d'inscriptions aux cours
export {
  addEnrollmentCourse,
  cancelEnrollmentCourse,
  checkOfferingEligibility,
  completeEnrollmentCourse,
  confirmEnrollmentCourse,
  expirePendingHolds,
  listEnrollmentCourses,
  registerCourse,
  selfEnrollToOffering,
  type EligibilityReport,
} from "./application/courses";

// Lectures pour 010, 011, 012, 013, 014, 017, 019
export {
  createEnrollmentDirectory,
  getCatalog,
  getChildLabels,
  getMyLabels,
  getRoster,
  getRuleContext,
  listChildEnrollments,
  listCourseRegistrations,
  listMyEnrollments,
  listNodesForClassroom,
  listNodesForEnrollment,
} from "./application/reads";

// Faits publiés pour les adaptateurs de la plateforme (results, higher, attendance, scheduling, payroll)
export {
  countRepeatsInCycle,
  getClassroomFacts,
  getCycleFacts,
  getEligibilityFacts,
  getLastEnrollmentInProgram,
  getResultsStructure,
  getUeFacts,
  hasAttendedUe,
  hasCompletedSelection,
  listClassroomEnrollments,
  listCycleEnrollments,
  listProgramUe,
  listStudentPlacements,
  listUeRegistrants,
} from "./application/facts";
export {
  countRepeatYears,
  effectiveContract,
  periodFactsOf,
  structureNodesOf,
  RESULT_NODE_KINDS,
  type ClassroomEnrollmentFacts,
  type ClassroomFacts,
  type CycleEnrollmentFacts,
  type CycleFacts,
  type EnrollmentEligibilityFacts,
  type LastEnrollmentFacts,
  type ResultNodeKind,
  type ResultsPeriodFacts,
  type ResultsStructure,
  type ResultsStructureNode,
  type UeFacts,
} from "./domain/facts";

// Confirmation par événements, reconduction, jobs
export { handleInvoicePaid, handleStudentStatusChanged, type InvoicePaidReport } from "./application/confirmation";
export { loadPromotionDecisions, previewRollover, rolloverAcademicYear } from "./application/rollover";
export {
  executeRolloverRun,
  getRolloverRun,
  listRolloverRuns,
  previewRolloverPlan,
  retryRolloverRun,
  startRolloverRun,
  type RolloverAssistOptions,
} from "./application/rollover-run";
export { createHoliday, deleteHoliday, holidaysOn, listHolidays, updateHoliday, type Holiday } from "./application/holidays";
export { DEFAULT_HOLIDAY_COUNTRY, listEffectiveHolidays, listNationalHolidays, setNationalHolidayEnabled, type NationalHolidayView } from "./application/national-holidays";
export { expandNationalHolidays, type EffectiveHoliday, type NationalHoliday } from "./domain/national-holidays";
export type { PromotionDecision, PromotionDecisionPort } from "./application/ports";
export { expireHoldsForAllTenants, finalizeOfferingsForAllTenants } from "./application/jobs";

// Domaine (types et fonctions pures utiles aux autres modules et au web)
export { AcademicCode } from "./domain/errors";
export { AcademicEvents, ALL_ACADEMIC_EVENT_TYPES, ConsumedEvents, type AcademicEventType } from "./domain/events";
export type * from "./domain/records";
export { effectivePeriodState, gradingIsClosed, resolvePeriodForDate as resolvePeriodFor, allocatePeriodPlan } from "./domain/calendar";
export { checkNodeGrammar, followedNodes, planClone, validateCurriculum, type NodeTypeRules, type ValidationReportRecord } from "./domain/curriculum";
export { evaluateEligibility, applyOverride, deriveOfferingStatus, holdsPlace, type EligibilityFacts, type EligibilityResult } from "./domain/offering";
export { ENROLLMENT_TRANSITIONS, SCHOOLING_COURSE_STATUSES, SCHOOLING_ENROLLMENT_STATUSES, canTransitionEnrollment, opensSchooling } from "./domain/enrollment";
export { formatRegistrationNumber, validateRegistrationPattern } from "./domain/registration-number";
export { planRollover } from "./domain/rollover";
export { buildRuleContext } from "./domain/rule-context";
