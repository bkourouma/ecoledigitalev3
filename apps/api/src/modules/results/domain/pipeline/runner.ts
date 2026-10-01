/**
 * Mécanique commune des pipelines : un `BatchEvaluator` (fourni par le port `RulesPort`) évalue des lots d'appels de
 * règles ; le `StageRunner` regroupe les appels de TOUTE la classe par étape (une passe par étape, pas une par élève),
 * isole les échecs par inscription (une inscription en ERREUR ne bloque pas la classe, AC8.5) et collecte la trace.
 *
 * Aucune formule ici : le runner transporte des variables vers les règles et rend leurs sorties. Les nombres restent
 * des CHAÎNES décimales exactes ; les décisions des CODES.
 */
import type { ComputedFailure, RuleValue, TraceRecord } from "../types";

export interface RuleCall {
  readonly ruleKey: string;
  readonly variables: Readonly<Record<string, unknown>>;
}

export type CallResult =
  | {
      readonly ok: true;
      readonly value: RuleValue;
      readonly inputsHash: string;
      readonly outputsHash: string;
      readonly nodesEvaluated: number;
      readonly trace?: unknown;
    }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Évalue un lot de règles de la version épinglée ; un résultat (ou une erreur) PAR appel, dans l'ordre. */
export interface BatchEvaluator {
  run(calls: readonly RuleCall[]): CallResult[];
}

export interface StageItem<T> {
  readonly owner: number;
  readonly ruleKey: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly tag: T;
  /** Nœud concerné (message d'erreur). */
  readonly nodeId?: string | undefined;
}

export interface StageOutput<T> {
  readonly tag: T;
  readonly owner: number;
  readonly ruleKey: string;
  readonly value: RuleValue;
  readonly record: TraceRecord;
}

export class StageRunner {
  /** Premier échec par inscription (index). */
  readonly failures = new Map<number, ComputedFailure>();

  constructor(
    private readonly evaluator: BatchEvaluator,
    private readonly withTrace: boolean,
  ) {}

  isFailed(owner: number): boolean {
    return this.failures.has(owner);
  }

  /** Exécute une étape. Les inscriptions déjà en échec sont ignorées ; un échec enregistre l'inscription et omet la sortie. */
  batch<T>(items: ReadonlyArray<StageItem<T>>): Array<StageOutput<T>> {
    const live = items.filter((i) => !this.failures.has(i.owner));
    if (live.length === 0) return [];
    const results = this.evaluator.run(live.map((i) => ({ ruleKey: i.ruleKey, variables: i.variables })));
    const out: Array<StageOutput<T>> = [];
    live.forEach((item, idx) => {
      const r = results[idx];
      if (!r || !r.ok) {
        if (!this.failures.has(item.owner)) {
          this.failures.set(item.owner, { ruleKey: item.ruleKey, code: r && !r.ok ? r.code : "results.rule_missing_result", message: r && !r.ok ? r.message : "Aucun résultat de règle.", nodeId: item.nodeId });
        }
        return;
      }
      out.push({
        tag: item.tag,
        owner: item.owner,
        ruleKey: item.ruleKey,
        value: r.value,
        record: {
          ruleKey: item.ruleKey,
          value: r.value,
          inputsHash: r.inputsHash,
          outputsHash: r.outputsHash,
          nodesEvaluated: r.nodesEvaluated,
          ...(this.withTrace && r.trace !== undefined ? { trace: r.trace } : {}),
        },
      });
    });
    return out;
  }
}

/** Erreur de STRUCTURE (curriculum incomplet) : concerne toute la classe, pas une inscription. */
export class StructureError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StructureError";
  }
}

export const asString = (v: RuleValue): string | null => (typeof v === "string" ? v : v === null ? null : String(v));
export const asBool = (v: RuleValue): boolean | null => (typeof v === "boolean" ? v : null);
