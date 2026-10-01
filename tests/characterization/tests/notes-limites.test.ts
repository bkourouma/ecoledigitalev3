import scenario from "../scenarios/notes-limites.scenario";
import { runHigherScenario } from "../harness/run-higher";
import { scenarioSuite } from "../harness/scenario-test";
import { describe, expect, it } from "vitest";

scenarioSuite(scenario, "notes-limites", runHigherScenario, (result) => {
  describe("notes-limites : couverture des valeurs-limites", () => {
    it("contient au moins 40 notes aux valeurs-limites dont les 24 couples flottants à 10", () => {
      const limites = scenario.higher!.higher.grades.filter((g) => g.ecue === "LIM");
      expect(limites.length).toBeGreaterThanOrEqual(80); // au moins 40 couples (devoirs, examen)
      const exactTen = limites.filter((g) => g.student.startsWith("ten"));
      expect(exactTen.length).toBe(48); // 24 couples x 2 notes
    });

    it("le legacy se trompe sur les 24 couples à 10 et sur les 8 couples à 5", () => {
      const d = result().defects.occurrences;
      expect(d.filter((x) => x.id === "FLOAT_ECUE_VALIDATION_10" && /\.ten\d\d\/LIM\.validee$/.test(x.path)).length).toBe(24);
      expect(d.filter((x) => x.id === "FLOAT_ECUE_ELIMINATOIRE_5" && /\.five\d\d\/LIM\.eliminee$/.test(x.path)).length).toBe(8);
    });
  });
});
