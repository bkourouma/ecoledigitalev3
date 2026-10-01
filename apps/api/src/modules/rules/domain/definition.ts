/**
 * Définition d'une version : hash canonique (R-RUL-03) et conversion vers les types du moteur.
 *
 * `definition_hash = SHA-256( JSON canonique { contract_id, rules: [ {key, type, position, expression, parameters,
 * input_schema, result_type, label_map, is_optional} … ordonnées par position ] } )`. Calculé par l'application, et
 * par elle seule (une unique implémentation : pas de dérive possible avec une copie SQL, risque R7 de la spec) ;
 * la base exige sa présence dès la proposition, l'application le revérifie à l'approbation, à la publication et
 * à chaque chargement (`rules.hash_mismatch`).
 */
import { RuleDefinitionSchema, RuleSetSchema, RuleVersionSchema, type RuleDefinition, type RuleSet, type RuleVersion } from "../engine";
import type { ContractRule } from "../contracts";
import { canonicalJson, sha256Hex, type CanonicalValue } from "./canonical";
import type { RuleDefinitionRecord, RuleSetRecord, RuleVersionRecord } from "./types";

/** Version du moteur enregistrée avec chaque résultat (R-RUL-13) ; un test vérifie qu'elle égale celle du paquet. */
export const ENGINE_VERSION = "0.1.0";

function ordered(rules: readonly RuleDefinitionRecord[]): RuleDefinitionRecord[] {
  return [...rules].sort((a, b) => a.position - b.position || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Charge utile canonique d'une version (ce qui est hashé). */
export function definitionPayload(contractId: string, rules: readonly RuleDefinitionRecord[]): CanonicalValue {
  return {
    contract_id: contractId,
    rules: ordered(rules).map((r) => ({
      key: r.key,
      type: r.type,
      position: r.position,
      expression: r.expression,
      parameters: r.parameters as unknown as CanonicalValue,
      input_schema: (r.inputSchema ?? null) as unknown as CanonicalValue,
      result_type: r.resultType ?? null,
      label_map: r.labelMap as unknown as CanonicalValue,
      is_optional: r.isOptional,
    })),
  };
}

export function computeDefinitionHash(contractId: string, rules: readonly RuleDefinitionRecord[]): string {
  return sha256Hex(canonicalJson(definitionPayload(contractId, rules)));
}

/** Règle du moteur pour la compilation/évaluation : le schéma et le type de résultat du contrat comblent les absences. */
export function toEngineDefinition(rule: RuleDefinitionRecord, contractRule?: ContractRule): RuleDefinition {
  const inputSchema = rule.inputSchema ?? contractRule?.inputs;
  const result = rule.resultType ?? contractRule?.result;
  return RuleDefinitionSchema.parse({
    key: rule.key,
    type: rule.type,
    expression: rule.expression,
    ...(rule.description ? { description: rule.description } : {}),
    ...(Object.keys(rule.parameters).length > 0 ? { parameters: rule.parameters } : {}),
    ...(inputSchema ? { inputSchema } : {}),
    ...(result ? { result } : {}),
  });
}

/** Ensemble de règles « léger » (versions sans règles) pour `resolveRuleSet`, qui ne lit que les métadonnées. */
export function toEngineRuleSet(set: RuleSetRecord, versions: readonly RuleVersionRecord[]): RuleSet {
  return RuleSetSchema.parse({
    id: set.id,
    code: set.code,
    name: set.name,
    scope: set.kind === "NATIONAL" ? { kind: "national" } : { kind: "tenant", tenantId: set.tenantId },
    countryCode: set.countryCode,
    ...(set.regulation ? { regulation: set.regulation } : {}),
    ...(set.educationSystem ? { educationSystem: set.educationSystem } : {}),
    ...(set.level ? { level: set.level } : {}),
    versions: versions.map((v) => toEngineVersionMeta(v, [])),
  });
}

export function toEngineVersionMeta(v: RuleVersionRecord, rules: readonly RuleDefinition[]): RuleVersion {
  return RuleVersionSchema.parse({
    id: v.id,
    ruleSetId: v.ruleSetId,
    version: v.versionNo,
    status: v.status,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    source: v.source,
    rules,
    ...(v.createdBy ? { createdBy: v.createdBy } : {}),
    ...(v.approvedBy ? { approvedBy: v.approvedBy } : {}),
    ...(v.notes ? { notes: v.notes } : {}),
  });
}
