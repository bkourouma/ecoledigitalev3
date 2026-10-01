/**
 * Version compilée : règles du moteur prêtes à évaluer, compilées PARESSEUSEMENT (une règle cassée n'interdit pas
 * les autres) et mises en cache par `(identifiant, hash de définition)`. Une version non-brouillon est immuable : la
 * clé de cache contient son hash, donc une entrée ne devient jamais fausse et n'a pas besoin d'être invalidée
 * (les événements `rules.version.*` servent à libérer la mémoire des versions retirées).
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import {
  RuleBudgetError,
  RuleError,
  compileRule,
  effectiveRuleSchema,
  type CompiledRule,
  type RuleDefinition,
  type RuleSchemaSpec,
} from "../engine";
import { contractRule as findContractRule, getContract, type ContractRule, type RuleContract } from "../contracts";
import { ENGINE_VERSION, toEngineDefinition } from "../domain/definition";
import { RulesCode, notFound, validation } from "../domain/errors";
import type { RuleDefinitionRecord, RuleVersionRecord } from "../domain/types";

export interface CompiledRuleEntry {
  readonly record: RuleDefinitionRecord;
  readonly definition: RuleDefinition;
  readonly compiled: CompiledRule;
  /** Schéma d'entrée EFFECTIF (celui du contrat à défaut de schéma propre), sans la variable `params`. */
  readonly inputSchema: RuleSchemaSpec;
  readonly contractRule: ContractRule | undefined;
}

export interface CompiledVersion {
  readonly version: RuleVersionRecord;
  readonly rules: readonly RuleDefinitionRecord[];
  readonly contract: RuleContract | undefined;
  readonly definitionHash: string;
  readonly engineVersion: string;
  /** Règle compilée (mémoïsée) ou erreur typée. */
  rule(key: string): Result<CompiledRuleEntry, AppError>;
}

/** Traduit une erreur du moteur en erreur typée du module (message français conservé, jamais de pile). */
export function engineFailure(e: unknown, ruleKey: string): AppError {
  if (e instanceof RuleError) {
    const budget = e instanceof RuleBudgetError;
    return validation(budget ? RulesCode.BUDGET_EXCEEDED : RulesCode.EVALUATION_FAILED, e.message, undefined, {
      ruleKey,
      engineCode: e.code,
      phase: e.phase,
      ...(e.position ? { position: e.position } : {}),
      ...(e.hint ? { hint: e.hint } : {}),
    });
  }
  throw e;
}

export function createCompiledVersion(version: RuleVersionRecord, rules: readonly RuleDefinitionRecord[], definitionHash: string): CompiledVersion {
  const contract = getContract(version.contractId);
  const byKey = new Map(rules.map((r) => [r.key, r]));
  const memo = new Map<string, Result<CompiledRuleEntry, AppError>>();

  return {
    version,
    rules,
    contract,
    definitionHash,
    engineVersion: ENGINE_VERSION,
    rule(key) {
      const cached = memo.get(key);
      if (cached) return cached;
      const record = byKey.get(key);
      let result: Result<CompiledRuleEntry, AppError>;
      if (!record) {
        result = err(notFound(RulesCode.RULE_NOT_FOUND, "Règle", key));
      } else {
        const cr = contract ? findContractRule(contract, key) : undefined;
        try {
          const definition = toEngineDefinition(record, cr);
          const compiled = compileRule(definition, cr?.inputs);
          result = ok({ record, definition, compiled, inputSchema: record.inputSchema ?? cr?.inputs ?? { variables: {} }, contractRule: cr });
        } catch (e) {
          result = err(engineFailure(e, key));
        }
      }
      memo.set(key, result);
      return result;
    },
  };
}

/** Schéma effectif d'une règle (avec `params`), pour les contrôles qui en ont besoin. */
export function effectiveSchemaOf(entry: CompiledRuleEntry): RuleSchemaSpec {
  return effectiveRuleSchema(entry.definition, entry.contractRule?.inputs);
}

/**
 * Cache LRU de versions compilées. Une version brouillon n'y entre jamais (son contenu change).
 */
export class CompiledVersionCache {
  private readonly entries = new Map<string, CompiledVersion>();

  constructor(private readonly capacity = 200) {}

  static keyOf(version: Pick<RuleVersionRecord, "kind" | "tenantId" | "id">, definitionHash: string): string {
    return `${version.kind}:${version.tenantId ?? "-"}:${version.id}:${definitionHash}`;
  }

  get(key: string): CompiledVersion | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: CompiledVersion): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Libère les entrées d'une version (retrait) — jamais nécessaire à la justesse. */
  evictVersion(versionId: string): void {
    for (const key of [...this.entries.keys()]) if (key.split(":")[2] === versionId) this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
