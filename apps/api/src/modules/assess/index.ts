/**
 * API PUBLIQUE du module `assess` — seul point d'import autorisé pour les autres modules.
 *
 *   import { lockPeriodGrades, listPublishedGrades, releaseSessionLock, createAssessDeps } from "../assess";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les
 * références vers classes, inscriptions, nœuds, périodes, élèves et personnel sont des UUID résolus par les PORTS que
 * fournissent `academic`, `people` et `scheduling` (ils les enregistrent par `registerAssessPorts(app, ports)`).
 *
 * Consommateurs : `results` (`listPublishedGrades`, `lockPeriodGrades`, `unlockPeriodGrades`, `releaseSessionLock`,
 * `listPendingAssessments`, événements `assess.grade.published|revised`, `assess.period.*`), `higher` (déverrouillage de
 * la session 2), 025 (analytique), 016 (notifications).
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as assessManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { assessPlugin, createPortRegistry, registerAssessPorts, setup as assessSetup, type AssessPluginOptions, type AssessPortRegistry } from "./http/plugin";
export { createPermissionKit, PERMISSIONS as ASSESS_PERMISSIONS, type PermissionKit } from "./http/guards";

// Dépendances et ports
export { createAssessDeps, DEFAULT_ASSESS_CONFIG, inTx as assessInTx, type AssessCaps, type AssessConfig, type AssessDeps, type AssessDepsInput } from "./application/deps";
export type {
  ActorNamePort,
  AssessPorts,
  AuditEntry as AssessAuditEntry,
  AuditPort as AssessAuditPort,
  ClassroomInfo,
  CurriculumPort,
  GuardianshipPort,
  NodeInfo,
  PeriodInfo,
  PeriodPort,
  RosterEntry,
  RosterPort,
  TeachingAssignmentPort,
} from "./application/ports";
export { noopAudit as assessNoopAudit, RecordingAudit as AssessRecordingAudit } from "./application/ports";
export {
  InMemoryCurriculum,
  InMemoryGuardianship,
  InMemoryNames,
  InMemoryPeriods,
  InMemoryRoster,
  InMemoryTeaching,
  inMemoryPorts as inMemoryAssessPorts,
  unavailablePorts as unavailableAssessPorts,
  type InMemoryWorld as InMemoryAssessWorld,
} from "./infrastructure/in-memory-ports";

// Cas d'usage — types, réglages, amorçage
export {
  createAssessmentType,
  getAssessSettings,
  instantiateAssessPack,
  listAssessmentTypes,
  updateAssessmentType,
  updateAssessSettings,
} from "./application/types";

// Cas d'usage — évaluations, notes, circuit
export {
  bulkCreateAssessments,
  createAssessment,
  getAssessmentTransitions,
  getAssessmentView,
  listAssessmentsView,
  updateAssessment,
  type BulkCreateInput,
  type CreateAssessmentInput,
  type UpdateAssessmentInput,
} from "./application/assessments";
export { getGradeSheet, saveGrades, type GradeSheet, type SaveGradesInput, type SaveGradesResult } from "./application/grades";
export { cancelAssessment, transitionAssessment, type CancelInput, type CancelOutcome, type TransitionInput, type TransitionOutcome } from "./application/workflow";

// Cas d'usage — révisions de notes publiées
export {
  applyApprovedInTx as applyApprovedRevisionsInTx,
  applyRevision,
  approveRevision,
  getGradeHistory,
  getRevisionView,
  listRevisionsView,
  rejectRevision,
  requestAddition,
  requestRevision,
  type ApproveOutcome,
  type GradeHistory,
} from "./application/revisions";

// API publique pour `results` / `higher` : verrous de période et lecture des notes publiées
export {
  getPeriodLock,
  listPeriodLocks,
  listPendingAssessments,
  lockPeriodGrades,
  releaseSessionLock,
  unlockPeriodGrades,
  type LockPeriodInput,
  type LockPeriodResult,
  type PendingAssessment,
  type ReleaseLockInput,
} from "./application/locks";
export { listChildGrades, listMyGrades, listPublishedGrades, type FamilyPage, type FamilyReadInput, type ListPublishedInput } from "./application/reads";

// Consommateurs (utilisables par les tests d'assemblage)
export { onTenantProvisioned as onAssessTenantProvisioned, purgeAllTenants as purgeAssessBatchReceipts, purgeBatchReceipts } from "./application/consumers";

// Domaine : événements, codes d'erreur, types, circuit
export { ALL_ASSESS_EVENT_TYPES, AssessEvents, ConsumedEvents as AssessConsumedEvents, type AssessEventType } from "./domain/events";
export { AssessCode, type AssessCodeValue } from "./domain/errors";
export { isLegalTransition, nextStatuses, planRevisionDecision, planTransition, TRANSITION_PERMISSION, type TransitionTarget } from "./domain/workflow";
export { normalizeEntry, planSave, payloadHash } from "./domain/grades";
export { PACK_TYPE_TEMPLATES, templateKeyForPack } from "./domain/pack";
export type {
  Assessment,
  AssessmentType,
  AssessSettings,
  Grade,
  GradeRevision,
  PeriodLock,
  PublishedGrade,
  SessionNo,
  Transition,
} from "./domain/types";
