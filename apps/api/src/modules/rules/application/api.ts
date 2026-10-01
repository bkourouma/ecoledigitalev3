/**
 * API publique inter-modules, liée à des dépendances (`createRulesApi(deps)`) : c'est ce que `results`, `higher` et
 * `reportcards` utilisent (`app.rules`, posé par `setup`). Ils ne connaissent NI le moteur NI les tables : seulement des
 * clés de règle, des contrats et des contextes typés. Aucune exception brute : `Result<T, AppError>` aux codes stables
 * `rules.no_active_ruleset`, `rules.contract_violation`, `rules.evaluation_failed`, `rules.budget_exceeded`,
 * `rules.hash_mismatch`, `rules.transition_forbidden`, `rules.overlap`.
 */
import type { AppError, RequestContext, Result } from "@ecoledigitale/kernel";
import type { SimulationReport } from "../engine";
import { getContract, listContracts, type RuleContract } from "../contracts";
import type { CompiledVersion } from "./compiled";
import type { RulesDeps } from "./deps";
import {
  benchEvaluate,
  evaluate,
  evaluateMany,
  evaluateRuleSet,
  type EvaluateOptions,
  type EvaluationCall,
  type EvaluationOutput,
  type RuleSetEvaluation,
  type RuleSetRequest,
} from "./evaluate";
import type { SimulationCaseGroup } from "./ports";
import { replayEvaluations, replaySampleForTenant, type ReplayReport } from "./replay";
import { loadVersion, resolve, type Resolution, type ResolveInput } from "./resolve";
import { recordSimulationCases, recordSimulationReport, requestSimulation, type RequestSimulationInput } from "./simulations";
import type { ReplayRecord } from "./ports";
import type { SimulationRecord } from "../domain/types";

export interface RulesApi {
  readonly deps: RulesDeps;
  /** Résout le jeu applicable à `(contrat, périmètre, date de DÉBUT de période)` ; `resolved: null` ⇒ calcul refusé. */
  resolve(ctx: RequestContext, input: ResolveInput): Promise<Result<Resolution, AppError>>;
  /** Charge, compile (cache) et vérifie le hash d'une version, même retirée. */
  loadVersion(ctx: RequestContext, ruleVersionId: string): Promise<Result<CompiledVersion, AppError>>;
  evaluate(compiled: CompiledVersion, call: EvaluationCall, options?: EvaluateOptions): Result<EvaluationOutput, AppError>;
  evaluateMany(compiled: CompiledVersion, calls: readonly EvaluationCall[], options?: EvaluateOptions): Array<Result<EvaluationOutput, AppError>>;
  /** Résolution (ou version épinglée) + chargement + évaluation d'un lot, avec journal des échecs. */
  evaluateRuleSet(ctx: RequestContext, request: RuleSetRequest, calls: readonly EvaluationCall[], options?: EvaluateOptions): Promise<Result<RuleSetEvaluation, AppError>>;
  getContract(id: string): RuleContract | undefined;
  listContracts(): readonly RuleContract[];
  requestSimulation(ctx: RequestContext, input: RequestSimulationInput): Promise<Result<SimulationRecord, AppError>>;
  recordSimulationCases(ctx: RequestContext, simulationId: string, groups: readonly SimulationCaseGroup[]): Promise<Result<SimulationRecord, AppError>>;
  recordSimulationReport(ctx: RequestContext, simulationId: string, report: SimulationReport, casesCount: number): Promise<Result<SimulationRecord, AppError>>;
  replayEvaluations(ctx: RequestContext, records: readonly ReplayRecord[]): Promise<Result<ReplayReport, AppError>>;
  replaySample(ctx: RequestContext, percent: number): Promise<Result<ReplayReport, AppError>>;
  benchEvaluate(ctx: RequestContext, versionId: string, call: EvaluationCall): Promise<Result<EvaluationOutput, AppError>>;
}

export function createRulesApi(deps: RulesDeps): RulesApi {
  return {
    deps,
    resolve: (ctx, input) => resolve(deps, ctx, input),
    loadVersion: (ctx, id) => loadVersion(deps, ctx, id),
    evaluate: (compiled, call, options) => evaluate(compiled, call, options ?? (deps.config.evaluationBudget ? { budget: deps.config.evaluationBudget } : {})),
    evaluateMany: (compiled, calls, options) => evaluateMany(compiled, calls, options ?? (deps.config.evaluationBudget ? { budget: deps.config.evaluationBudget } : {})),
    evaluateRuleSet: (ctx, request, calls, options) => evaluateRuleSet(deps, ctx, request, calls, options),
    getContract,
    listContracts,
    requestSimulation: (ctx, input) => requestSimulation(deps, ctx, input),
    recordSimulationCases: (ctx, id, groups) => recordSimulationCases(deps, ctx, id, groups),
    recordSimulationReport: (ctx, id, report, casesCount) => recordSimulationReport(deps, ctx, id, report, casesCount),
    replayEvaluations: (ctx, records) => replayEvaluations(deps, ctx, records),
    replaySample: (ctx, percent) => replaySampleForTenant(deps, ctx, percent),
    benchEvaluate: (ctx, versionId, call) => benchEvaluate(deps, ctx, { versionId, call }),
  };
}
