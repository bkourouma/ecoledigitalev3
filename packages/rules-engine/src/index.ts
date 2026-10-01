/**
 * @ecoledigitale/rules-engine : moteur de règles académiques PUR.
 *
 * Pipeline : parse -> AST -> check (noms, types, fonctions, nullité) ->
 * evaluate (budget, arithmétique décimale, trace). Voir ADR-003.
 */

// API principale
export { compile, validate, evaluate } from './compile';
export type {
  CompileOptions,
  CompiledRule,
  EvaluateOptions,
  EvaluationResult,
  ResultType,
  ValidationReport,
} from './compile';

// Limites, budget, contexte, trace
export { DEFAULT_LIMITS } from './parser';
export type { CompileLimits } from './parser';
export { DEFAULT_BUDGET } from './runtime';
export type { Budget, Clock, EvalContext, RuleValue, TraceEntry, TraceKind, TraceValue } from './runtime';

// Schéma de données des règles et types
export { RuleSchemaSpecSchema, TypeSpecSchema, LookupSpecSchema, ScalarTypeSpecSchema, resolveSchema, isDeclarableName } from './schema';
export type { RuleSchemaSpec, TypeSpec, ScalarTypeSpec, LookupSpec, ResolvedSchema } from './schema';
export type { ResultTypeSpec } from './types';

// Erreurs typées
export {
  RuleError,
  RuleSchemaError,
  RuleSyntaxError,
  RuleCheckError,
  RuleEvaluationError,
  RuleBudgetError,
} from './errors';
export type { Diagnostic, RuleErrorCode, RulePhase, SourcePosition } from './errors';

// Arithmétique décimale
export { Decimal } from './decimal';

// Bibliothèque de fonctions
export { BUILTIN_FUNCTION_NAMES } from './function-names';

// AST (lecture seule)
export type { Node as AstNode } from './ast';

// Modèle RuleSet / RuleVersion
export {
  RULE_STATUSES,
  RULE_TYPES,
  IsoDateSchema,
  RuleStatusSchema,
  RuleTypeSchema,
  RuleScopeSchema,
  RuleSourceSchema,
  ParameterSpecSchema,
  RuleDefinitionSchema,
  RuleVersionSchema,
  RuleSetSchema,
  isValidIsoDate,
  effectiveRuleSchema,
  compileRule,
  contextWithParameters,
} from './model';
export type { RuleStatus, RuleType, RuleScope, RuleSource, ParameterSpec, RuleDefinition, RuleVersion, RuleSet } from './model';

// Gouvernance, résolution, simulation
export { canTransition, assertTransition, nextStatuses } from './governance';
export type { Actor, TransitionRequest, TransitionDecision } from './governance';
export { resolveRuleSet, findEffectiveOverlaps, isEffectiveOn } from './resolve';
export type { ResolveQuery, ResolveOptions, ResolvedRuleSet, ConsideredVersion, VersionOverlap } from './resolve';
export { simulate } from './simulate';
export type {
  SimulationCase,
  SimulationOptions,
  SimulationReport,
  RuleSimulationStats,
  Difference,
  DifferenceKind,
  Outcome,
  Transition,
} from './simulate';
