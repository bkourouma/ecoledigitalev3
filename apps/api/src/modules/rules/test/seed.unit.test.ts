/**
 * Les trois RuleSets de départ : chaque règle compile, satisfait son contrat, et le hash est déterministe.
 */
import { describe, expect, it } from "vitest";
import { getContract } from "../contracts";
import { checkConformity } from "../domain/conformity";
import { computeDefinitionHash } from "../domain/definition";
import { SEED_RULE_SETS } from "../seed/rulesets";
import { seedVersionRecords } from "../seed/records";

describe("données de départ", () => {
  for (const set of SEED_RULE_SETS) {
    for (const version of set.versions) {
      it(`${set.code} v${version.versionNo} satisfait ${version.contractId} (compilation incluse)`, () => {
        const contract = getContract(version.contractId);
        expect(contract).toBeDefined();
        const records = seedVersionRecords(version);
        const report = checkConformity(contract!, records);
        const problems = [
          ...report.violations.map((v) => `${v.ruleKey ?? "-"} ${v.code} ${v.message}`),
          ...report.rules.filter((r) => !r.ok).map((r) => `${r.key} ${r.diagnostics.map((d) => d.message).join("; ")}`),
        ];
        expect(problems).toEqual([]);
        expect(report.ok).toBe(true);
      });

      it(`${set.code} v${version.versionNo} : hash déterministe`, () => {
        const a = computeDefinitionHash(version.contractId, seedVersionRecords(version));
        const b = computeDefinitionHash(version.contractId, [...seedVersionRecords(version)].reverse());
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(b).toBe(a); // indépendant de l'ordre de lecture : tri par position
      });
    }
  }
});
