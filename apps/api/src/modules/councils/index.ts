/**
 * API PUBLIQUE du module "councils" (conseil de classe du secondaire) : SEUL point d'import autorisé pour les autres modules (règle
 * dependency-cruiser, pnpm check:boundaries).
 *
 *   import { createCouncilsDeps, registerCouncilsPorts, getCouncilDecisionsForEnrollment } from "../councils";
 *
 * Consommateurs prévus : `reportcards` (bulletin : appréciation générale, distinctions, décision ; bulletins « à rééditer » après
 * `councils.council.reopened`), `examinations` (faits d'éligibilité), `analytics`, les portails. Les ports (academic, results,
 * attendance, schoollife, people, notifications, reportcards) sont branchés par `platform/adapters`.
 *
 * Le module ne CALCULE rien : il orchestre le conseil (convocation, quorum, présence, avis par élève, décisions humaines, PV scellé et
 * signé, réémission avec motif) en réutilisant les API publiques des modules voisins.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as councilsManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { councilsPlugin, registerCouncilsPorts, setup as councilsSetup, type CouncilsPluginOptions } from "./http/plugin";
export { createCouncilsPortRegistry, setCouncilsWorkerPorts, councilsWorkerPorts, resetCouncilsWorkerPorts, type CouncilsPortRegistry } from "./application/port-registry";
export { createPermissionKit as createCouncilsPermissionKit, PERMISSIONS as COUNCILS_PERMISSIONS, type PermissionKit as CouncilsPermissionKit } from "./http/guards";

// Dépendances et ports
export { createCouncilsDeps, DEFAULT_COUNCILS_CONFIG, inTx as councilsInTx, type CallerCaps as CouncilsCallerCaps, type CouncilsConfig, type CouncilsDeps, type CouncilsDepsInput } from "./application/deps";
export {
  noopAudit as councilsNoopAudit,
  RecordingAudit as CouncilsRecordingAudit,
  type AcademicPort as CouncilsAcademicPort,
  type AttendancePort as CouncilsAttendancePort,
  type AuditEntry as CouncilsAuditEntry,
  type AuditPort as CouncilsAuditPort,
  type ClassroomInfo as CouncilsClassroomInfo,
  type CouncilsPorts,
  type CouncilWriteRef,
  type DocumentsPort as CouncilsDocumentsPort,
  type EnrollmentInfo as CouncilsEnrollmentInfo,
  type FamilyPort as CouncilsFamilyPort,
  type MinutesDocumentRequest,
  type NotificationPort as CouncilsNotificationPort,
  type OutcomePort as CouncilsOutcomePort,
  type PeriodInfo as CouncilsPeriodInfo,
  type RenderedDocument,
  type ResultsReadPort as CouncilsResultsReadPort,
  type ResultsStateView,
  type ResultsWritePort as CouncilsResultsWritePort,
  type RosterEntry as CouncilsRosterEntry,
  type RuleCodesPort as CouncilsRuleCodesPort,
  type SchoolLifePort as CouncilsSchoolLifePort,
  type StaffAssignmentInfo,
  type StaffPort as CouncilsStaffPort,
  type StoragePort as CouncilsStoragePort,
  type StudentStatusPort as CouncilsStudentStatusPort,
  type TemplatePort as CouncilsTemplatePort,
} from "./application/ports";
export { councilsAuditAdapter } from "./infrastructure/audit-adapter";
export { inMemoryPorts as councilsInMemoryPorts, unavailablePorts as councilsUnavailablePorts, type InMemoryWorld as CouncilsInMemoryWorld } from "./infrastructure/in-memory-ports";
export { bundledTemplatePort as councilsBundledTemplatePort } from "./templates";

// Domaine pur (machines à états miroir de la base, quorum, effets, faits, procès-verbal)
export { CouncilsEvents, ALL_EVENT_TYPES as COUNCILS_EVENT_TYPE_LIST } from "./domain/events";
export { CouncilsCode } from "./domain/errors";
export { COUNCIL_TRANSITIONS, EFFECT_TRANSITIONS, TRANSFER_TRANSITIONS, UNLOCK_TRANSITIONS, canTransition, isLocked } from "./domain/machines";
export { evaluateQuorum, requiredSigners } from "./domain/quorum";
export { buildFacts, isMissingResults } from "./domain/facts";
export { buildMinutesSnapshot } from "./domain/minutes";
export { effectKindsOfDecision } from "./domain/effects";

// Cas d'usage
export { getReference, upsertCouncilType, upsertDecisionType, upsertRole, upsertSettings } from "./application/reference";
export { addParticipant, cancelCouncil, closeCouncil, convokeCouncil, createCouncil, getCouncilDetail as getCouncil, listCouncilsView as listCouncils, listParticipantsView, listProposedParticipants, openCouncil, patchParticipant, removeParticipant, setPresence, updateCouncil } from "./application/councils";
export { getAgenda, getAgendaItemDetail, prepareCouncil, rebuildAgendaItem, reviewAgendaItem } from "./application/agenda";
export { addProposal, listDecisionsView, listProposalsView, recordDecision, resolveProposal, withdrawDecision } from "./application/deliberation";
export { addPaperSignature, generateMinutes, getMinutesDetail, getMinutesPdf, listMinutesView, onMinutesRendered, requestMinutesRender, revokeMinutes, signMinutes } from "./application/minutes";
export { approveUnlock, expireUnlockRequests, listUnlockRequests, rejectUnlock, reopenCouncil, requestUnlock } from "./application/unlock";
export { applyEffect, listEffectsOfCouncilView, listEffectsView, onResultsReopened, planCouncilEffects, processRunnableEffects, retryEffect, revertEffect, skipEffect } from "./application/effects";
export { addWish, applyTransfer, cancelTransfer, createFile, createTransfer, getOrientationFile, listFilesView, listPathsView, listTransfersView, recordConsent, upsertPath } from "./application/orientation";
export { getChildDecisions, getClassroomSummary as getCouncilSummaryForClassroom, getCouncilDecisionsForEnrollment, getMyDecisions, listEventsView } from "./application/reads";
export { instantiateCouncilsReferenceData } from "./application/template";
