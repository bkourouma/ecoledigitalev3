import type { Node } from './ast';
import { check } from './checker';
import { Decimal } from './decimal';
import {
  RuleCheckError,
  RuleError,
  RuleEvaluationError,
  RuleSchemaError,
  RuleSyntaxError,
  type Diagnostic,
} from './errors';
import { interpret } from './evaluator';
import { parse, type CompileLimits } from './parser';
import {
  DEFAULT_BUDGET,
  Runtime,
  type Budget,
  type Clock,
  type EvalContext,
  type RuleValue,
  type TraceEntry,
} from './runtime';
import { resolveSchema, type ResolvedSchema, type RuleSchemaSpec } from './schema';
import { describeType, resultMatches, resultSpecToTy, type ResultTypeSpec, type Ty } from './types';

export interface CompileOptions {
  /** Limites d'analyse (taille, profondeur, nombre de nœuds). */
  limits?: Partial<CompileLimits>;
  /** Type de résultat exigé (ex. "number", "string?"). Absent : tout scalaire est accepté. */
  expect?: ResultTypeSpec;
}

export interface ResultType {
  type: 'number' | 'string' | 'boolean';
  nullable: boolean;
}

/** Règle compilée : AST vérifié et gelé. Ne se fabrique qu'avec `compile`. */
export interface CompiledRule {
  readonly source: string;
  readonly ast: Node;
  readonly resultType: ResultType;
  /** Variables lues. */
  readonly names: readonly string[];
  /** Fonctions de la bibliothèque appelées. */
  readonly functions: readonly string[];
  /** Recherches appelées. */
  readonly lookups: readonly string[];
  readonly nodeCount: number;
  readonly height: number;
}

interface Internals {
  readonly schema: ResolvedSchema;
  readonly types: WeakMap<Node, Ty>;
}

/** Seules les règles produites par `compile` (donc vérifiées) sont évaluables. */
const INTERNALS = new WeakMap<object, Internals>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

function countNodes(n: Node): number {
  switch (n.t) {
    case 'member':
      return 1 + countNodes(n.object);
    case 'unary':
      return 1 + countNodes(n.operand);
    case 'lambda':
      return 1 + countNodes(n.body);
    case 'binary':
      return 1 + countNodes(n.left) + countNodes(n.right);
    case 'call':
      return 1 + n.args.reduce((s, a) => s + countNodes(a), 0);
    case 'list':
      return 1 + n.items.reduce((s, a) => s + countNodes(a), 0);
    default:
      return 1;
  }
}

type Analysis =
  | { ok: true; compiled: CompiledRule }
  | { ok: false; diagnostics: Diagnostic[]; error: RuleError };

function analyze(source: string, schemaSpec: RuleSchemaSpec | unknown, options: CompileOptions): Analysis {
  try {
    const schema = resolveSchema(schemaSpec);
    const ast = parse(source, options.limits ?? {});
    const res = check(ast, schema, source);
    if (res.diagnostics.length > 0) {
      const err = new RuleCheckError(res.diagnostics);
      return { ok: false, diagnostics: [...res.diagnostics], error: err };
    }
    const ty = res.type as Ty; // défini : aucun diagnostic
    if (options.expect) {
      const expected = resultSpecToTy(options.expect);
      if (!resultMatches(ty, expected)) {
        const d: Diagnostic = {
          code: 'TYPE_RESULTAT_INVALIDE',
          phase: 'check',
          message: `Le résultat devrait être de type ${describeType(expected)}, mais la règle produit : ${describeType(ty)}.`,
          ...(ty.k === 'number' && ty.nullable ? { hint: 'Utilisez coalesce(résultat, défaut) pour garantir une valeur.' } : {}),
        };
        return { ok: false, diagnostics: [d], error: new RuleCheckError([d]) };
      }
    }
    const resultType: ResultType = { type: ty.k as ResultType['type'], nullable: ty.nullable };
    const compiled: CompiledRule = deepFreeze({
      source,
      ast,
      resultType,
      names: Object.freeze(res.names),
      functions: Object.freeze(res.functions),
      lookups: Object.freeze(res.lookups),
      nodeCount: countNodes(ast),
      height: ast.height,
    });
    INTERNALS.set(compiled, { schema, types: res.types });
    return { ok: true, compiled };
  } catch (e) {
    if (e instanceof RuleSyntaxError || e instanceof RuleSchemaError) {
      return { ok: false, diagnostics: [e.toDiagnostic()], error: e };
    }
    throw e;
  }
}

/**
 * Compile et VÉRIFIE une expression (analyse, noms, types, fonctions, nullité).
 * Lève `RuleSchemaError`, `RuleSyntaxError` ou `RuleCheckError` (qui porte tous
 * les diagnostics). C'est la vérification faite « à la publication ».
 */
export function compile(source: string, schema: RuleSchemaSpec | unknown, options: CompileOptions = {}): CompiledRule {
  const a = analyze(source, schema, options);
  if (!a.ok) throw a.error;
  return a.compiled;
}

export interface ValidationReport {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Type du résultat si la règle est valide. */
  resultType?: ResultType;
  names: string[];
  functions: string[];
  lookups: string[];
  nodeCount: number;
}

/** Comme `compile`, mais ne lève pas : renvoie un rapport (pour un éditeur de règles ou un contrôle de publication). */
export function validate(source: string, schema: RuleSchemaSpec | unknown, options: CompileOptions = {}): ValidationReport {
  const a = analyze(source, schema, options);
  if (a.ok) {
    const c = a.compiled;
    return {
      ok: true,
      diagnostics: [],
      resultType: c.resultType,
      names: [...c.names],
      functions: [...c.functions],
      lookups: [...c.lookups],
      nodeCount: c.nodeCount,
    };
  }
  return { ok: false, diagnostics: a.diagnostics, names: [], functions: [], lookups: [], nodeCount: 0 };
}

export interface EvaluateOptions {
  /** Budget d'évaluation (surcharge partielle de DEFAULT_BUDGET). */
  budget?: Partial<Budget>;
  /** Conserver la trace des valeurs intermédiaires (défaut : true). */
  trace?: boolean;
  /** Horloge injectable (pour tester le budget de temps). Défaut : Date.now. */
  clock?: Clock;
}

export interface EvaluationResult {
  value: RuleValue;
  type: 'number' | 'string' | 'boolean' | 'null';
  /** Valeur sérialisable : les nombres sont des chaînes décimales exactes. */
  json: string | boolean | null;
  trace: TraceEntry[];
  traceTruncated: boolean;
  /** Unités de budget consommées (déterministe). */
  nodesEvaluated: number;
}

function validBudget(b: Budget): void {
  const bad = (what: string): never => {
    throw new RuleEvaluationError({ code: 'CONTEXTE_INVALIDE', phase: 'evaluation', message: `Budget invalide : ${what}.` });
  };
  if (!Number.isInteger(b.maxNodes) || b.maxNodes < 1) bad('maxNodes doit être un entier positif');
  if (!Number.isInteger(b.maxTraceEntries) || b.maxTraceEntries < 0) bad('maxTraceEntries doit être un entier positif ou nul');
  if (b.maxMillis !== undefined && !(b.maxMillis > 0)) bad('maxMillis doit être un nombre positif (Infinity pour désactiver)');
}

/**
 * Évalue une règle compilée sur un contexte immuable, avec budget.
 * Lève `RuleEvaluationError` (ou `RuleBudgetError`) avec la position du nœud fautif.
 * Pure : même règle + même contexte => même résultat et même trace.
 */
export function evaluate(compiled: CompiledRule, context: EvalContext = {}, options: EvaluateOptions = {}): EvaluationResult {
  const internals = INTERNALS.get(compiled);
  if (!internals) {
    throw new RuleEvaluationError({
      code: 'CONTEXTE_INVALIDE',
      phase: 'evaluation',
      message: 'Règle non reconnue : seules les règles produites par compile() peuvent être évaluées.',
    });
  }
  const budget: Budget = { ...DEFAULT_BUDGET, ...stripUndefined(options.budget ?? {}) };
  validBudget(budget);
  const clock: Clock | undefined = budget.maxMillis !== undefined ? (options.clock ?? (() => Date.now())) : undefined;
  const rt = new Runtime(compiled.source, context ?? {}, budget, clock, options.trace !== false);
  const raw = interpret(compiled.ast, rt, internals.schema, internals.types);

  // Le type statique garantit un scalaire ; on le revérifie par prudence.
  if (raw !== null && !(raw instanceof Decimal) && typeof raw !== 'string' && typeof raw !== 'boolean') {
    throw new RuleEvaluationError({ code: 'TYPE_RESULTAT_INVALIDE', phase: 'evaluation', message: 'Le résultat de la règle n\'est pas un scalaire.' });
  }
  const value = raw as RuleValue;
  const type = value === null ? 'null' : value instanceof Decimal ? 'number' : typeof value === 'string' ? 'string' : 'boolean';
  return {
    value,
    type,
    json: value instanceof Decimal ? value.toString() : value,
    trace: rt.trace,
    traceTruncated: rt.traceTruncated,
    nodesEvaluated: rt.nodes,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}
