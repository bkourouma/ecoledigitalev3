/**
 * API PUBLIQUE du module `rules` — seul point d'import autorisé pour les autres modules.
 *
 *   import { rulesPlugin, resolve, loadVersion, evaluate, evaluateRuleSet, getContract } from "../rules";
 *
 * Seul ce module importe `@ecoledigitale/rules-engine` : les consommateurs (`results`, `higher`, `reportcards`) ne connaissent
 * ni le DSL ni les tables, seulement des CLÉS de règle et des CONTRATS (`credit-semester@1`, `coef-semester@1`). Les cas
 * d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4), avec les codes stables
 * `rules.no_active_ruleset`, `rules.contract_violation`, `rules.evaluation_failed`, `rules.budget_exceeded`,
 * `rules.hash_mismatch`, `rules.transition_forbidden`, `rules.overlap`.
 *
 * Usage typique d'un consommateur (calcul d'une période) :
 *   1. à la 1re évaluation d'un (classe, période) : `resolve(ctx, { contractId, ..., date: début de la période })`, puis ÉPINGLER
 *      `ruleVersionId` + `definitionHash` sur l'état de la période (jamais l'heure courante) ;
 *   2. ensuite : `evaluateRuleSet(ctx, { pin }, calls)` — la version épinglée est rechargée, son hash vérifié ;
 *   3. enregistrer avec chaque résultat `(ruleVersionId, definitionHash, engineVersion, inputsHash, outputsHash)`.
 * Publier une version ne recalcule jamais rien.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as rulesManifest } from "./manifest";

// Plugin Fastify (contrat d'assemblage `(app, runtime)`) et API inter-modules `app.rules`
export { default as rulesPlugin, setup as rulesSetup, EVALUATE_RATE_LIMIT } from "./http/plugin";
export { createRulesApi, type RulesApi } from "./application/api";

// Dépendances
export {
  BackgroundTasks,
  createRulesDeps,
  DEFAULT_RULES_CONFIG,
  inTx as rulesInTx,
  type RulesConfig,
  type RulesDeps,
  type RulesDepsInput,
} from "./application/deps";

// Ports (branchés par les modules consommateurs)
export { noopAudit, type ReplayRecord, type ReplaySource, type RulesAuditEntry, type RulesAuditPort, type SimulationCaseGroup, type SimulationCaseInput, type SimulationCaseRequest, type SimulationCaseSource, type SimulationDataset } from "./application/ports";
export { registerReplaySource, registerSimulationCaseSource } from "./application/registry";

// Résolution, chargement, évaluation
export { loadVersion, loadVersionInTx, resolve, resolveInTx, NATIONAL_VISIBLE_STATUSES, type LoadOptions, type Resolution, type ResolvedVersion, type ResolveInput } from "./application/resolve";
export {
  benchEvaluate,
  evaluate,
  evaluateMany,
  evaluateRuleSet,
  type EvaluateOptions,
  type EvaluationCall,
  type EvaluationOutput,
  type PinnedVersion,
  type RuleSetEvaluation,
  type RuleSetRequest,
} from "./application/evaluate";
export { CompiledVersionCache, type CompiledRuleEntry, type CompiledVersion } from "./application/compiled";

// Contrats de règles (en code)
export {
  COEF_SEMESTER_ID,
  COEF_SEMESTER_RULES,
  CREDIT_SEMESTER_ID,
  CREDIT_SEMESTER_RULES,
  coefSemesterContract,
  creditSemesterContract,
  COEF_PERIOD_ID,
  COEF_PERIOD_RULES,
  coefPeriodContract,
  COMPETENCY_PERIOD_ID,
  COMPETENCY_PERIOD_RULES,
  competencyPeriodContract,
  EXAM_NATIONAL_ID,
  EXAM_NATIONAL_RULES,
  examNationalContract,
  SECONDARY_ANNUAL_ID,
  SECONDARY_ANNUAL_RULES,
  secondaryAnnualContract,
  PERIOD_YEAR_DECISION_CODES,
  COUNCIL_REASON_CODES,
  COMPETENCY_YEAR_DECISION_CODES,
  ELIGIBILITY_CODES,
  ELIGIBILITY_REASON_CODES,
  CANDIDATE_RESULT_CODES,
  EXAM_MENTION_CODES,
  getContract,
  listContracts,
  ECUE_STATUS_CODES,
  UE_STATE_CODES,
  SEMESTER_DECISION_CODES,
  SEMESTER_DISTINCTION_CODES,
  MENTION_CODES,
  COUNCIL_APPRECIATION_CODES,
  COUNCIL_DECISION_CODES,
  END_OF_YEAR_DECISION_CODES,
  DISTINCTION_CODES,
  SESSION2_MODES,
  SEMESTER_VALIDATION_MODES,
  YEAR_VALIDATION_MODES,
  type ContractParameter,
  type ContractRule,
  type PipelineStage,
  type RuleContract,
} from "./contracts";

// Gouvernance, variantes, liaisons, simulation, rejeu
export { closeVersionPeriod, transitionAsOperator, transitionTenantVersion, fanOutNationalEvent, operatorContext, type Operator, type TransitionInput, type TransitionOutcome } from "./application/transitions";
export { deriveVariant, editExpression, editParameters, validateExpression, validateVersion } from "./application/variants";
export { createNationalRuleSet, createNationalVersion, getPlatformSettings, replaceNationalDraftRules, updatePlatformSettings } from "./application/national";
export { listTenantBindings, putBinding, removeBinding, type BindingInput } from "./application/bindings";
export { applyPackPlaceholderBindings, PACK_PLACEHOLDER_BINDINGS, type ApplyPackBindingsInput, type PackBindingKey, type PackDefaultBinding } from "./application/pack-bindings";
export { cancelSimulation, getSimulationView, recordSimulationCases, recordSimulationReport, requestSimulation, runSimulation, startSimulation } from "./application/simulations";
export { replayEvaluations, replaySampleForTenant, verifyCatalogHashes, type HashIssue, type ReplayMismatch, type ReplayReport } from "./application/replay";
export { getPlatformVersionDetail, getVersionDetail, getVersionEvents, listApprovalQueue, listPlatformCatalog, listPlatformImpact, listTenantCatalog } from "./application/catalog";
export { ensureNationalCatalog, type SeedReport } from "./application/seed";

// Domaine (pur)
export { RulesCode } from "./domain/errors";
export { ALL_RULES_EVENT_TYPES, RulesEvents } from "./domain/events";
export { checkConformity, type ConformityReport } from "./domain/conformity";
export { computeDefinitionHash, ENGINE_VERSION } from "./domain/definition";
export { computeInputsHash, computeOutputsHash } from "./domain/evaluation";
export { canonicalJson, sha256Hex } from "./domain/canonical";
export type { RuleDefinitionRecord, RuleSetRecord, RuleVersionRecord, RuleVersionWithRules, SimulationRecord, BindingRecord } from "./domain/types";

// Environnement (liaison d'un jeu fictif en production)
export { isProductionEnvironment } from "./domain/environment";

// Données de départ (jeux fictifs : `source.kind = "placeholder"`, voir `PLACEHOLDER_RULE_SET_CODES`)
export { PLACEHOLDER_EFFECTIVE_FROM, PLACEHOLDER_RULE_SET_CODES, SEED_RULE_SETS } from "./seed/rulesets";

// Libellés d'affichage des codes de sortie (`label_map`)
export { outputLabelOf, type LabelledRule } from "./domain/labels";
