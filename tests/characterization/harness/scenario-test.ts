import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScenarioDatabase, type ScenarioDatabase } from "./db";
import { expectMatchesSnapshot } from "./snapshot";
import type { DefectCollector } from "./defects";
import type { Scenario } from "../scenarios/types";

/**
 * Squelette commun des tests de scénario : une base copiée du modèle, une exécution, une comparaison à la snapshot.
 */
export function scenarioSuite<T extends { data: unknown; defects: DefectCollector }>(
  scenario: Scenario,
  snapshotName: string,
  run: (db: ScenarioDatabase, scenario: Scenario) => Promise<T>,
  extra?: (result: () => T) => void,
): void {
  const templateDb = inject("templateDb");
  if (!templateDb) {
    // Jamais de succès silencieux : sans Postgres, la caractérisation n'a pas eu lieu.
    describe(`scénario ${scenario.meta.name}`, () => {
      it("nécessite un Postgres éphémère", () => {
        throw new Error("TEST_DATABASE_URL absent : lancez `pnpm test:characterization` (Postgres éphémère dans Docker).");
      });
    });
    return;
  }
  describe(`scénario ${scenario.meta.name}`, () => {
    let db: ScenarioDatabase;
    let result: T;

    beforeAll(async () => {
      db = await createScenarioDatabase(templateDb!, scenario.meta.name);
      result = await run(db, scenario);
    });

    afterAll(async () => {
      await db?.drop();
    });

    it("la sortie legacy est identique à la snapshot figée", () => {
      expectMatchesSnapshot(snapshotName, scenario.meta.name, result.data, result.defects.sorted());
    });

    extra?.(() => result);

    it("n'expose aucun UUID brut ni horodatage dans la snapshot", () => {
      const text = JSON.stringify(result.data);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
}
