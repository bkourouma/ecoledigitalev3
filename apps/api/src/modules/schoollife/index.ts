/**
 * API PUBLIQUE du module "schoollife" (vie scolaire) : SEUL point d'import autorisé pour les autres modules (règle
 * dependency-cruiser, pnpm check:boundaries).
 *
 *   import { createSchoolLifeDeps, registerSchoolLifePorts, getStudentLifeSummary } from "../schoollife";
 *
 * Consommateurs prévus : `councils` (synthèse de vie scolaire figée dans l'ordre du jour), 013 (bulletins), 018 (examens :
 * faits de discipline), 010 (exclusion en vigueur), 025 (analytics) — comptages et codes uniquement, jamais de texte libre ni
 * d'élément confidentiel. Les ports (academic, people, attendance, notifications) sont branchés par `platform/adapters`.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as schoollifeManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { schoollifePlugin, registerSchoolLifePorts, createPortRegistry as createSchoolLifePortRegistry, setup as schoollifySetup, type SchoolLifePluginOptions, type SchoolLifePortRegistry } from "./http/plugin";
export { createPermissionKit, PERMISSIONS as SCHOOLLIFE_PERMISSIONS, type PermissionKit } from "./http/guards";

// Dépendances et ports
export { createSchoolLifeDeps, clearanceOfCaps, type CallerCaps, type SchoolLifeDeps, type SchoolLifeDepsInput } from "./application/deps";
export {
  noopAudit,
  RecordingAudit,
  type AbsenceView,
  type AttendanceViewPort,
  type AuditEntry,
  type AuditPort,
  type EnrollmentInfo,
  type EnrollmentPort,
  type GuardianInfo,
  type GuardianNotification,
  type NotificationChannelName,
  type NotificationKind,
  type NotificationPort,
  type PeoplePort,
  type PeriodInfo,
  type PeriodPort,
  type RosterEntry,
  type SchoolLifePorts,
  type StudentStatusPort,
  type StudentStatusTarget,
} from "./application/ports";
export { schoollifeAuditAdapter } from "./infrastructure/audit-adapter";
export { inMemoryPorts, unavailablePorts, type InMemoryWorld } from "./infrastructure/in-memory-ports";

// Domaine pur (règle de visibilité miroir, machines à états, barème)
export { audienceMaySee, clearanceOf, confidentialityRank, staffAudience } from "./domain/confidentiality";
export { SchoolLifeEvents, ALL_EVENT_TYPES } from "./domain/events";
export { SchoolLifeCode } from "./domain/errors";
export { conductBalance, pickScale } from "./domain/conduct";

// Cas d'usage
export { getReference, upsertEventType, upsertSettings, upsertSeverity } from "./application/reference";
export { addInvolvement, closeIncident, confirmIncident, declareIncident, dismissIncident, getIncidentView, listIncidentsView, raiseIncidentConfidentiality, reviewIncident } from "./application/incidents";
export {
  cancelMeasure,
  decideAppeal,
  executeMeasure,
  fileAppeal,
  getMeasureView,
  isStudentExcludedOn,
  listMeasuresView,
  notifyMeasure,
  proposeMeasure,
  rejectMeasure,
  revokeMeasure,
  validateMeasure,
  withdrawAppeal,
} from "./application/measures";
export { applyEffect, listEffectsView, revertEffect, skipEffect } from "./application/effects";
export { createNote, listNotesView, withdrawNote } from "./application/notes";
export { acknowledgeConvocation, cancelConvocation, createConvocation, holdConvocation, listConvocationsView, markConvocationMissed, rescheduleConvocation, sendConvocation } from "./application/convocations";
export { activateScale, adjustConduct, createScale, getStudentConduct, listScalesView, retireScale, setScaleItems } from "./application/conduct";
export { listConfidentialReadsView, readConfidential, DEFAULT_READ_PURPOSE } from "./application/confidential";
export { getClassroomLifeSummary, getClassroomSummary, getConductPoints, getDashboard, getDisciplineFacts, getFamilyLife, getStudentLife, getStudentLifeSummary, listMyChildren, type StudentLifeSummary } from "./application/dossier";
