/**
 * Exécution des RuleSets de départ SANS base : la version compilée est fabriquée à partir des données de départ
 * (mêmes enregistrements que ceux qui sont insérés, même hash). Sert aux tests unitaires et aux golden tests.
 */
import { createCompiledVersion, type CompiledVersion } from "../../application/compiled";
import { evaluate, type EvaluationCall, type EvaluationOutput } from "../../application/evaluate";
import { computeDefinitionHash } from "../../domain/definition";
import type { RuleDefinitionRecord, RuleVersionRecord } from "../../domain/types";
import { SEED_RULE_SETS } from "../../seed/rulesets";
import { seedVersionRecords } from "../../seed/records";
import type { SeedVersion } from "../../seed/types";
import type { AppError, Result } from "@ecoledigitale/kernel";

export function versionRecordFor(code: string, seed: SeedVersion, records: readonly RuleDefinitionRecord[], id = `seed-${code}-v${seed.versionNo}`): RuleVersionRecord {
  return {
    kind: "NATIONAL",
    id,
    tenantId: null,
    ruleSetId: `set-${code}`,
    ruleSetCode: code,
    versionNo: seed.versionNo,
    status: "published",
    contractId: seed.contractId,
    basedOnVersionId: null,
    effectiveFrom: seed.effectiveFrom,
    effectiveTo: seed.effectiveTo ?? null,
    source: seed.source,
    definitionHash: computeDefinitionHash(seed.contractId, records),
    lastSimulationId: null,
    decisionImpactConfirmedBy: null,
    notes: seed.notes ?? null,
    createdBy: null,
    approvedBy: "00000000-0000-7000-8000-000000000001",
    rowVersion: 0,
    createdAt: new Date("2024-09-01T00:00:00Z"),
    updatedAt: new Date("2024-09-01T00:00:00Z"),
  };
}

/** Version compilée d'un RuleSet de départ, éventuellement avec des règles modifiées (variante de test). */
export function compiledSeed(code: string, edit?: (rules: RuleDefinitionRecord[]) => RuleDefinitionRecord[], versionNo = 1): CompiledVersion {
  const set = SEED_RULE_SETS.find((s) => s.code === code);
  if (!set) throw new Error(`RuleSet de départ inconnu : ${code}`);
  const seed = set.versions.find((v) => v.versionNo === versionNo);
  if (!seed) throw new Error(`RuleSet de départ ${code} : version ${versionNo} inconnue`);
  const base = seedVersionRecords(seed);
  const records = edit ? edit(base) : base;
  return createCompiledVersion(versionRecordFor(code, seed, records), records, computeDefinitionHash(seed.contractId, records));
}

export type Value = string | boolean | null;

/** Évalue des règles d'une version compilée ; une erreur est LEVÉE (les golden tests n'attendent aucun échec). */
export class RuleRunner {
  constructor(readonly compiled: CompiledVersion) {}

  result(ruleKey: string, variables: Record<string, unknown>, overrides?: EvaluationCall["overrides"]): Result<EvaluationOutput, AppError> {
    return evaluate(this.compiled, { ruleKey, context: { variables }, overrides, trace: false });
  }

  value(ruleKey: string, variables: Record<string, unknown>, overrides?: EvaluationCall["overrides"]): Value {
    const r = this.result(ruleKey, variables, overrides);
    if (!r.ok) throw r.error;
    return r.value.value;
  }

  /** Valeur numérique (la chaîne décimale exacte du moteur lue comme nombre) ; `null` si absente. */
  num(ruleKey: string, variables: Record<string, unknown>, overrides?: EvaluationCall["overrides"]): number | null {
    const v = this.value(ruleKey, variables, overrides);
    return v === null ? null : Number(v);
  }

  bool(ruleKey: string, variables: Record<string, unknown>, overrides?: EvaluationCall["overrides"]): boolean {
    const v = this.value(ruleKey, variables, overrides);
    if (typeof v !== "boolean") throw new Error(`${ruleKey} : booléen attendu, reçu ${String(v)}`);
    return v;
  }

  str(ruleKey: string, variables: Record<string, unknown>, overrides?: EvaluationCall["overrides"]): string {
    const v = this.value(ruleKey, variables, overrides);
    if (typeof v !== "string") throw new Error(`${ruleKey} : texte attendu, reçu ${String(v)}`);
    return v;
  }

  /** Libellé français d'un code de sortie (`label_map`) : les golden tests comparent aux libellés du legacy. */
  label(ruleKey: string, code: string): string {
    return this.compiled.rules.find((r) => r.key === ruleKey)?.labelMap[code]?.fr ?? code;
  }

  /** Paramètre par défaut d'une règle. */
  param(ruleKey: string, name: string): number | string | boolean {
    const spec = this.compiled.rules.find((r) => r.key === ruleKey)?.parameters[name];
    if (!spec) throw new Error(`Paramètre inconnu : ${ruleKey}.${name}`);
    return spec.default;
  }
}
