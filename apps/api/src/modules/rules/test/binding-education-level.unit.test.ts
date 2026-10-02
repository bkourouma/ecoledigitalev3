/**
 * Liaison par niveau : une liaison peut viser le NIVEAU FIN d'une classe (`CP1`) ou son CYCLE d'enseignement (`PRIMARY`) ; à périmètre
 * égal, la liaison du niveau fin l'emporte. Résolution PURE.
 */
import { describe, expect, it } from "vitest";
import { bindingApplies, bindingSpecificity, selectBinding } from "../domain/binding";
import type { BindingRecord } from "../domain/types";

const binding = (id: string, over: Partial<BindingRecord>): BindingRecord => ({
  id,
  contractId: "coef-period@1",
  ruleSetCode: "CI-PRIMARY-PLACEHOLDER",
  institutionId: null,
  curriculumNodeId: null,
  levelCode: null,
  effectiveFrom: "2026-09-01",
  effectiveTo: null,
  createdBy: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

const query = { contractId: "coef-period@1", levelCode: "CP1", educationLevelCode: "PRIMARY", date: "2026-10-01" } as const;

describe("liaison par niveau fin ou par cycle d'enseignement", () => {
  it("une liaison du cycle s'applique aux classes de ce cycle, jamais à un autre cycle", () => {
    const cycle = binding("a", { levelCode: "PRIMARY" });
    expect(bindingApplies(cycle, query)).toBe(true);
    expect(bindingApplies(cycle, { ...query, educationLevelCode: "PRESCHOOL", levelCode: "GS" })).toBe(false);
    expect(bindingApplies(cycle, { ...query, educationLevelCode: undefined })).toBe(false); // sans cycle connu : comportement historique
  });

  it("une liaison du niveau fin l'emporte sur celle du cycle, qui l'emporte sur celle de l'établissement entier", () => {
    const fine = binding("fine", { levelCode: "CP1", ruleSetCode: "SET-FINE" });
    const cycle = binding("cycle", { levelCode: "PRIMARY", ruleSetCode: "SET-CYCLE" });
    const whole = binding("whole", { ruleSetCode: "SET-WHOLE" });
    expect(selectBinding([whole, cycle, fine], query)?.id).toBe("fine");
    expect(selectBinding([whole, cycle], query)?.id).toBe("cycle");
    expect(selectBinding([whole], query)?.id).toBe("whole");
    expect(bindingSpecificity(fine, query)).toBeGreaterThan(bindingSpecificity(cycle, query));
    expect(bindingSpecificity(cycle, query)).toBeGreaterThan(bindingSpecificity(whole, query));
  });

  it("le comportement historique est inchangé sans cycle d'enseignement dans la requête", () => {
    const fine = binding("fine", { levelCode: "BTS" });
    expect(selectBinding([fine], { contractId: "coef-period@1", levelCode: "BTS", date: "2026-10-01" })?.id).toBe("fine");
    expect(bindingSpecificity(fine)).toBe(50);
  });
});
