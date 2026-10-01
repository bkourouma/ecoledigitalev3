import { describe, expect, it } from "vitest";
import scenario from "../scenarios/cloture-semestre.scenario";
import { runHigherScenario } from "../harness/run-higher";
import { scenarioSuite } from "../harness/scenario-test";

scenarioSuite(scenario, "cloture-semestre", runHigherScenario, (result) => {
  describe("cloture-semestre : le verrou est effectif", () => {
    it("toute écriture de note sur un semestre clôturé est refusée avec le message de clôture daté", () => {
      const steps = (result().data as any).steps as Record<string, any>;
      const refused = Object.entries(steps).filter(([label]) => /après clôture SA1|après clôture SB1|calcul de toutes/.test(label) && !/SA2/.test(label));
      expect(refused.length).toBeGreaterThanOrEqual(6);
      for (const [label, out] of refused) {
        if (label.includes("recalcul")) continue; // sortie par cohorte, vérifiée dans la snapshot
        expect(out.ok, label).toBe(false);
        expect(out.error, label).toBe("SEMESTRE_CLOTURE");
        expect(out.message, label).toContain("a été clôturé le 31/01/2026");
      }
    });
  });
});
