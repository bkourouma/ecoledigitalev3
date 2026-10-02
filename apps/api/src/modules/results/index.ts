/**
 * API PUBLIQUE du module `results` — seul point d'import autorisé pour les autres modules.
 *
 *   import { getFinalResult, listFinalLines, listResitCandidates, createResultsDeps } from "../results";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les moyennes,
 * crédits, rangs, mentions et décisions sont CALCULÉS par `rules` (contrats `credit-semester@1`, `coef-semester@1`) à partir
 * des notes PUBLIÉES d'`assess` : ce module orchestre et ne contient aucune formule ni aucun seuil. Les résultats FINAL
 * sont immuables ; une correction passe par une réouverture motivée (version n+1).
 *
 * Consommateurs : `reportcards` (`getFinalResult`, `listFinalLines`, événements `results.period.*`), `higher`
 * (`listResitCandidates`, `reopenPeriod` en `RESIT_SESSION`, capitalisation), 004 (`results.decision.confirmed`), 025.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as resultsManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { resultsPlugin, createPortRegistry as createResultsPortRegistry, registerResultsPorts, setup as resultsSetup, type ResultsPluginOptions, type ResultsPortRegistry } from "./http/plugin";
export { createPermissionKit as createResultsPermissionKit, PERMISSIONS as RESULTS_PERMISSIONS, type PermissionKit as ResultsPermissionKit } from "./http/guards";

// Dépendances et ports
export { createResultsDeps, DEFAULT_RESULTS_CONFIG, inTx as resultsInTx, type ResultsCaps, type ResultsConfig, type ResultsDeps, type ResultsDepsInput } from "./application/deps";
export type {
  ActorNamePort as ResultsActorNamePort,
  AssessPort,
  AuditEntry as ResultsAuditEntry,
  AuditPort as ResultsAuditPort,
  CurriculumPort,
  GuardianshipPort as ResultsGuardianshipPort,
  LockOutcome,
  PendingAssessmentInfo,
  ResolveRequest,
  ResultsPorts,
  RosterEntry as ResultsRosterEntry,
  RosterPort as ResultsRosterPort,
  RulePin,
  RuleSourceKind,
  RulesPort,
  RuleSession,
  CompetencyCountersPort,
  YearFactsPort,
} from "./application/ports";
export { noopAudit as resultsNoopAudit, RecordingAudit as ResultsRecordingAudit } from "./application/ports";
export { assessPortFrom } from "./infrastructure/assess-adapter";
export { rulesPortFrom } from "./infrastructure/rules-adapter";
export {
  InMemoryAssess,
  InMemoryCurriculum as InMemoryResultsCurriculum,
  InMemoryGuardianship as InMemoryResultsGuardianship,
  InMemoryNames as InMemoryResultsNames,
  InMemoryRoster as InMemoryResultsRoster,
  unavailableResultsPorts,
} from "./infrastructure/in-memory-ports";

// Conseils : port d'ÉCRITURE (décisions de passage / redoublement, appréciation générale, distinctions, séance) et quorum (règle)
export {
  COUNCIL_WRITE_SOURCES,
  markDeliberationHeld,
  openCouncilDeliberation,
  publishYearDecision,
  recordDistinction,
  withdrawCouncilDecision,
  writeCouncilAppreciation,
  type CouncilActor,
  type CouncilWriteSource,
  type MarkDeliberationHeldInput,
  type OpenCouncilDeliberationInput,
  type PublishYearDecisionInput,
  type RecordDistinctionInput,
  type WithdrawCouncilDecisionInput,
  type WriteCouncilAppreciationInput,
} from "./application/council-write";
export { evaluateCouncilQuorum, type CouncilQuorumResult, type EvaluateCouncilQuorumInput } from "./application/quorum";

// Calcul, cycle de période
export { computePeriod, type ComputeReport } from "./application/compute";
export { closePeriod, deliberatePeriod, lockPeriod, reopenPeriod, repinPeriod, type CloseInput, type CloseOutcome, type DeliberateInput, type LockInput, type PeriodRef, type RepinSimulation, type ReopenInput } from "./application/lifecycle";
export { processAllTenants as processAllResultsRecomputes, processDueRecomputes, purgeAllTenants as purgeAllResults, purgeOld as purgeOldResults, recomputeNow, requestRecompute, requestRecomputeForClassroom, listRecomputeRequests, type ProcessReport } from "./application/recompute";

// Gouvernance : surcharges, décisions, délibérations, appréciations, réglages
export {
  approveOverride,
  confirmDecisionUseCase as confirmDecision,
  createDeliberation,
  getResultsSettings,
  listAppreciationsView as listAppreciations,
  listDecisionsView as listDecisions,
  listDeliberationsView as listDeliberations,
  listOverridesView as listOverrides,
  rejectOverride,
  requestOverride,
  revokeOverrideUseCase as revokeOverride,
  updateDeliberationUseCase as updateDeliberation,
  updateResultsSettings,
  writeAppreciation,
  type ConfirmDecisionInput,
  type DeliberationInput,
  type RequestOverrideInput,
} from "./application/governance";

// Lectures (dont l'API publique pour reportcards / higher)
export {
  explainResult,
  getClassMatrix,
  getEnrollmentResult,
  getFinalResult,
  getPeriodView,
  getStateView,
  listChildResults,
  listFinalLines,
  listMyResults,
  listResitCandidates,
  type ClassMatrix,
  type EnrollmentResult,
  type Explanation,
  type FamilyResult,
  type PeriodView,
  type RuleLag,
  type ResitCandidate,
} from "./application/reads";

// Worker : ports d'autres modules (curriculum, roster…) et sources de rejeu / simulation branchées dans `rules`
export { createWorkerResultsDeps, setResultsWorkerPorts } from "./application/worker-ports";
export { bindResultsRulesSources, createResultsReplaySource, createResultsSimulationSource } from "./application/replay";

// Décisions de passage de fin d'année (lues par la reconduction annuelle d'academic ; jamais calculées par academic)
export { listPromotionOutcomes, type PromotionOutcome } from "./application/promotion";

// Usage d'un nœud de curriculum (garde d'amendement structurel d'academic)
export { isCurriculumNodeInResults } from "./application/usage";

// Résultat d'année (dérivé des FINAL de période)
export { getYearResult, type YearPeriodSummary, type YearResult } from "./application/year";

// Pipelines purs (testables sans base) et domaine
export { computeCreditSemester } from "./domain/pipeline/credit";
export { computeCoefSemester } from "./domain/pipeline/coef";
export { computeCoefPeriod, COEF_PERIOD_CONTRACT, type CoefPeriodInput } from "./domain/pipeline/coef-period";
export { computeCompetencyPeriod, COMPETENCY_PERIOD_CONTRACT, type CompetencyPeriodInput } from "./domain/pipeline/competency-period";
export { StageRunner, StructureError, type BatchEvaluator, type CallResult, type RuleCall } from "./domain/pipeline/runner";
export { ALL_RESULTS_EVENT_TYPES, ResultsEvents, ConsumedEvents as ResultsConsumedEvents, type ResultsEventType } from "./domain/events";
export { ResultsCode, type ResultsCodeValue } from "./domain/errors";
export { OVERRIDABLE, DECISION_RULES, EXAM_AGGREGATION_GROUP, YEAR_END_FINAL_CODES, NON_FINAL_DECISION_CODES, isFinalDecisionCode, outcomeOf } from "./domain/catalog";
export { isLegalStateTransition, planClose, planDeliberate, planLock, planReopen } from "./domain/period-state";
export { closureHashOf, hashOf, canonicalJson } from "./domain/hash";
export type { ClassStructure, ComputedHeader, ComputedLine, EnrollmentComputation, ClassComputation, GradeFact, PeriodFacts, StructureNode, ApprovedOverride, EnrollmentYearFacts, CompetencyCounters } from "./domain/types";
export type { PeriodState, ResultHeader, LineRecord, OverrideRecord, DecisionRecord, DeliberationRecord, AppreciationRecord, ClosureRecord, RecomputeRequest, ResultsSettings } from "./domain/records";
