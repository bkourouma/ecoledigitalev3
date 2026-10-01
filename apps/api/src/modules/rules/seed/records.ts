import type { RuleDefinitionRecord } from "../domain/types";
import type { SeedRule, SeedVersion } from "./types";

/** Règle de départ -> enregistrement persistable (position = ordre du fichier de données). */
export function seedRuleToRecord(rule: SeedRule, position: number): RuleDefinitionRecord {
  return {
    key: rule.key,
    type: rule.type,
    position,
    expression: rule.expression,
    description: rule.description,
    parameters: { ...(rule.parameters ?? {}) },
    inputSchema: rule.inputSchema ?? null,
    resultType: rule.result ?? null,
    labelMap: { ...(rule.labelMap ?? {}) },
    isOptional: rule.isOptional ?? false,
  };
}

export function seedVersionRecords(version: SeedVersion): RuleDefinitionRecord[] {
  return version.rules.map((r, i) => seedRuleToRecord(r, i));
}
