import { Decimal, toDecimal } from './decimal';
import { RuleBudgetError, RuleEvaluationError, locate, type RuleErrorCode } from './errors';
import type { Ty } from './types';

/** Valeur scalaire produite par une règle. */
export type RuleValue = Decimal | string | boolean | null;

/** Objet brut du contexte (jamais exposé tel quel au résultat). */
export type PlainObject = { readonly [key: string]: unknown };

/** Valeur interne de l'évaluateur. */
export type Value = RuleValue | readonly Value[] | PlainObject;

/**
 * Contexte d'évaluation : données IMMUABLES. Le moteur ne les modifie jamais ;
 * il ne lit que des propriétés propres de type donnée (jamais d'accesseur, jamais
 * de prototype).
 */
export interface EvalContext {
  /** Variables nommées déclarées dans le schéma. */
  variables?: Readonly<Record<string, unknown>> | undefined;
  /** Données des recherches, p. ex. { period: { S1: { average: 12.5 } } }. */
  lookups?: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined;
}

export interface Budget {
  /** Nombre maximal de nœuds évalués (les opérations sur listes comptent un nœud par élément). */
  maxNodes: number;
  /** Délai maximal en millisecondes (filet de sécurité ; le budget de nœuds est le garde-fou déterministe). */
  maxMillis?: number | undefined;
  /** Nombre maximal d'entrées de trace conservées. */
  maxTraceEntries: number;
}

export const DEFAULT_BUDGET: Readonly<Budget> = Object.freeze({
  maxNodes: 100_000,
  maxMillis: 1_000,
  maxTraceEntries: 500,
});

export type TraceValue = string | boolean | null | TraceValue[];

export type TraceKind = 'name' | 'member' | 'lookup' | 'call' | 'unary' | 'binary' | 'list';

export interface TraceEntry {
  /** Ordre d'achèvement de l'évaluation (post-ordre), à partir de 1. */
  seq: number;
  kind: TraceKind;
  /** Nom de la fonction, de l'opérateur ou du champ. */
  label: string;
  /** Extrait de la source correspondant au nœud. */
  source: string;
  start: number;
  end: number;
  type: 'number' | 'string' | 'boolean' | 'null' | 'list' | 'object';
  value: TraceValue;
}

export type Clock = () => number;

interface Span {
  readonly start: number;
  readonly end: number;
}

const TRACE_LIST_LIMIT = 20;

export function typeNameOf(v: Value): TraceEntry['type'] {
  if (v === null) return 'null';
  if (v instanceof Decimal) return 'number';
  if (Array.isArray(v)) return 'list';
  switch (typeof v) {
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    default:
      return 'object';
  }
}

export function toTraceValue(v: Value): TraceValue {
  if (v === null) return null;
  if (v instanceof Decimal) return v.toString();
  if (Array.isArray(v)) {
    const arr = v as readonly Value[];
    const head = arr.slice(0, TRACE_LIST_LIMIT).map(toTraceValue);
    if (arr.length > TRACE_LIST_LIMIT) head.push(`… (+${arr.length - TRACE_LIST_LIMIT})`);
    return head;
  }
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return '[objet]';
}

/** Lit un champ propre de type donnée ; jamais d'accesseur ni de membre hérité. */
function readOwn(obj: PlainObject, key: string): { found: boolean; value: unknown; accessor: boolean } {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc) return { found: false, value: undefined, accessor: false };
  if ('value' in desc) return { found: true, value: desc.value as unknown, accessor: false };
  return { found: true, value: undefined, accessor: true };
}

export class Runtime {
  nodes = 0;
  readonly trace: TraceEntry[] = [];
  traceTruncated = false;
  private seq = 0;
  private sinceClock = 0;
  private readonly t0: number;

  constructor(
    readonly source: string,
    readonly ctx: EvalContext,
    readonly budget: Budget,
    private readonly clock: Clock | undefined,
    readonly wantTrace: boolean,
  ) {
    this.t0 = budget.maxMillis !== undefined && clock ? clock() : 0;
  }

  fail(code: RuleErrorCode, message: string, at: Span, hint?: string): never {
    throw new RuleEvaluationError({
      code,
      phase: 'evaluation',
      message,
      position: locate(this.source, at.start, at.end),
      ...(hint ? { hint } : {}),
    });
  }

  /** Consomme `n` unités de budget ; lève RuleBudgetError si le budget est dépassé. */
  consume(n: number, at: Span): void {
    this.nodes += n;
    if (this.nodes > this.budget.maxNodes) {
      throw new RuleBudgetError({
        code: 'BUDGET_NOEUDS_DEPASSE',
        phase: 'evaluation',
        message: `Budget d'évaluation dépassé : plus de ${this.budget.maxNodes} opérations.`,
        position: locate(this.source, at.start, at.end),
        hint: 'Simplifiez la règle ou réduisez la taille des listes traitées.',
      });
    }
    this.sinceClock += n;
    if (this.sinceClock >= 256 && this.budget.maxMillis !== undefined && this.clock) {
      this.sinceClock = 0;
      if (this.clock() - this.t0 > this.budget.maxMillis) {
        throw new RuleBudgetError({
          code: 'BUDGET_TEMPS_DEPASSE',
          phase: 'evaluation',
          message: `Budget d'évaluation dépassé : plus de ${this.budget.maxMillis} ms.`,
          position: locate(this.source, at.start, at.end),
          hint: 'Simplifiez la règle ou réduisez la taille des listes traitées.',
        });
      }
    }
  }

  /** > 0 pendant l'évaluation d'un corps de lambda : seuls les résultats d'ensemble sont tracés. */
  suppressTrace = 0;

  record(at: Span, kind: TraceKind, label: string, value: Value): void {
    if (!this.wantTrace || this.suppressTrace > 0) return;
    if (this.trace.length >= this.budget.maxTraceEntries) {
      this.traceTruncated = true;
      return;
    }
    const raw = this.source.slice(at.start, at.end).replace(/\s+/g, ' ');
    this.trace.push({
      seq: ++this.seq,
      kind,
      label,
      source: raw.length > 80 ? `${raw.slice(0, 77)}…` : raw,
      start: at.start,
      end: at.end,
      type: typeNameOf(value),
      value: toTraceValue(value),
    });
  }

  /** Champ d'un objet du contexte (propriété propre, donnée uniquement). */
  readField(obj: PlainObject, key: string, at: Span): unknown {
    const r = readOwn(obj, key);
    if (r.accessor) {
      this.fail('CONTEXTE_INVALIDE', `La donnée « ${key} » est un accesseur : seules les propriétés de type donnée sont admises.`, at);
    }
    return r.value;
  }

  /**
   * Convertit une donnée brute du contexte vers une valeur interne conforme au
   * type déclaré dans le schéma. `what` décrit la donnée (pour les messages).
   */
  coerce(raw: unknown, ty: Ty, what: string, at: Span): Value {
    if (raw === undefined || raw === null) {
      if (ty.nullable) return null;
      return this.fail(
        raw === undefined ? 'DONNEE_MANQUANTE' : 'VALEUR_ABSENTE',
        `La donnée ${what} est absente alors qu'elle est obligatoire.`,
        at,
        'Fournissez la valeur dans le contexte, ou déclarez-la optionnelle dans le schéma (ex. "number?").',
      );
    }
    switch (ty.k) {
      case 'null':
        return null;
      case 'number': {
        const d = toDecimal(raw);
        if (!d) {
          return this.fail('CONTEXTE_INVALIDE', `La donnée ${what} devrait être un nombre fini (reçu : ${describeRaw(raw)}).`, at);
        }
        return d;
      }
      case 'string':
        if (typeof raw !== 'string') {
          return this.fail('CONTEXTE_INVALIDE', `La donnée ${what} devrait être un texte (reçu : ${describeRaw(raw)}).`, at);
        }
        return raw;
      case 'boolean':
        if (typeof raw !== 'boolean') {
          return this.fail('CONTEXTE_INVALIDE', `La donnée ${what} devrait être un booléen (reçu : ${describeRaw(raw)}).`, at);
        }
        return raw;
      case 'list': {
        if (!Array.isArray(raw)) {
          return this.fail('CONTEXTE_INVALIDE', `La donnée ${what} devrait être une liste (reçu : ${describeRaw(raw)}).`, at);
        }
        const arr = raw as readonly unknown[];
        this.consume(arr.length, at);
        const out: Value[] = new Array<Value>(arr.length);
        for (let i = 0; i < arr.length; i++) out[i] = this.coerce(arr[i], ty.item, indexLabel(what, i), at);
        return out;
      }
      case 'object': {
        if (typeof raw !== 'object' || Array.isArray(raw)) {
          return this.fail('CONTEXTE_INVALIDE', `La donnée ${what} devrait être un objet (reçu : ${describeRaw(raw)}).`, at);
        }
        const proto = Object.getPrototypeOf(raw) as unknown;
        if (proto !== Object.prototype && proto !== null) {
          return this.fail('CONTEXTE_INVALIDE', `La donnée ${what} doit être un objet simple (sans prototype personnalisé).`, at);
        }
        return raw as PlainObject;
      }
    }
  }
}

/** « notes » -> « notes[1] » (l'indice reste à l'intérieur des guillemets français). */
function indexLabel(what: string, i: number): string {
  return what.endsWith(' »') ? `${what.slice(0, -2)}[${i}] »` : `${what}[${i}]`;
}

function describeRaw(raw: unknown): string {
  if (raw === null) return 'null';
  if (Array.isArray(raw)) return 'une liste';
  switch (typeof raw) {
    case 'string':
      return `le texte "${raw.length > 20 ? `${raw.slice(0, 20)}…` : raw}"`;
    case 'number':
      return `le nombre ${String(raw)}`;
    case 'boolean':
      return `le booléen ${String(raw)}`;
    case 'object':
      return 'un objet';
    default:
      return typeof raw;
  }
}
