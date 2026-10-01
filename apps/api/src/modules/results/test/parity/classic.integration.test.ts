/**
 * PARITÉ avec le legacy — pile « classique » (matières à coefficients). Les scénarios déclaratifs sont rejoués à travers `results`
 * + les VRAIES règles CI-CLASSIC-SEMESTRE (et CI-HIGHER-BTS pour le niveau BTS) ; voir l'adaptateur `classic.ts`.
 *
 * Écarts tolérés : bogues catalogués (virgule flottante de la moyenne pondérée → mention, décision, distinction à tort) que la v2
 * doit avoir CORRIGÉS, et — pour le scénario de nommage — les défauts de statut `quirk` dont la v2 se sépare volontairement
 * (rôle du semestre deviné d'après un NOM, « redoublant » déduit d'un LIBELLÉ).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadScenario, loadSnapshot } from "../../../../../../../tests/characterization/compare";
import { createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { bind, makeWorld, type World } from "../support/world";
import { ClassicParity, pickLegacyStep } from "./classic";
import { describeDifferences, runParity } from "./compare-helper";

const DEBUG = process.env.PARITY_DEBUG === "1";

describeIntegration("parité avec le legacy — pile classique (CI-CLASSIC-SEMESTRE, CI-HIGHER-BTS)", () => {
  let db: ResultsTestDb;
  beforeAll(async () => {
    db = await createResultsTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  async function play(name: string, options: { levelCode?: string; statuses?: Array<"bug" | "quirk"> } = {}) {
    const w: World = await makeWorld(db);
    await bind(w, "coef-semester@1", "CI-CLASSIC-SEMESTRE");
    await bind(w, "coef-semester@1", "CI-HIGHER-BTS", { levelCode: "BTS" });
    const scenario = loadScenario(name);
    const snapshot = loadSnapshot(name);
    const parity = new ClassicParity(w, scenario, options.levelCode ? { levelCode: options.levelCode } : {});
    await parity.play();
    const roleByName = new Map(scenario.classic!.setup.periods.map((p) => [p.name, p.role === "second-semester"]));
    const expected = { steps: Object.fromEntries(Object.entries((snapshot.data as any).steps).flatMap(([k, s]) => { const p = pickLegacyStep(s as any, (n) => roleByName.get(n) === true); return p ? [[k, p]] : []; })) };
    const outcome = runParity({ steps: parity.steps }, expected, snapshot, { statuses: options.statuses ?? ["bug"] });
    if (DEBUG) {
      console.log(`\n===== ${name} : ${outcome.unexplained.length} non expliqués, ${outcome.result.acceptedDivergences.length} tolérés`);
      console.log(describeDifferences(outcome.unexplained, 80));
      console.log("stillDefective", outcome.result.stillDefective.length, "corrected", outcome.result.corrected.length, "divergedElsewhere", outcome.result.divergedElsewhere.length, "unverified", outcome.result.unverified.length);
      console.log("refus", JSON.stringify(parity.refusals));
      for (const a of outcome.result.acceptedDivergences.slice(0, 80)) console.log(`  ACCEPTÉ[${a.defect}/${a.via}] ${a.path} legacy=${JSON.stringify(a.expected)} v2=${JSON.stringify(a.actual)}`);
    }
    return { outcome, parity, expected };
  }

  const leaves = (v: unknown): number => (v !== null && typeof v === "object" ? Object.values(v as object).reduce<number>((n, x) => n + leaves(x), 0) : 1);

  it("classique-terminale : parité EXACTE (aucun bogue catalogué) — moyennes pondérées, sections, (S1+2·S2)/3, rangs avec ex æquo, mentions, distinctions, décisions", async () => {
    const { outcome, parity, expected } = await play("classique-terminale");
    expect(describeDifferences(outcome.unexplained)).toBe("");
    expect(outcome.result.acceptedDivergences).toEqual([]);
    expect(leaves(parity.steps)).toBe(leaves(expected));
    expect(leaves(parity.steps)).toBeGreaterThan(1500);
    // refus joués par le scénario : 3 requêtes de saisie rejetées en bloc
    expect(parity.refusals.map(([l]) => l)).toEqual(["refus : heures justifiées > absences", "refus : élève non inscrit dans la classe", "refus : moyenne supérieure à 20"]);
  });

  it("classique-flottants : la v2 CORRIGE le défaut du double (moyenne exacte sur un seuil) au lieu de le reproduire", async () => {
    const { outcome } = await play("classique-flottants");
    expect(describeDifferences(outcome.unexplained)).toBe("");
    expect(outcome.result.stillDefective.map((d) => d.path)).toEqual([]);
    expect(outcome.result.divergedElsewhere.map((d) => d.path)).toEqual([]);
    expect(outcome.result.corrected.length).toBeGreaterThan(0);
    expect(outcome.result.acceptedDivergences.every((a) => a.defect === "CLASSIC_FLOAT_WEIGHTED_MEAN")).toBe(true);
  });

  it("classique-nommage-periodes : le rôle du semestre vient de la DONNÉE (rang, rôle), pas du nom ; formule (S1+2·S2)/3 correcte pour toutes les orthographes", async () => {
    const { outcome } = await play("classique-nommage-periodes", { levelCode: "BTS", statuses: ["bug", "quirk"] });
    expect(describeDifferences(outcome.unexplained)).toBe("");
    expect(outcome.result.stillDefective.map((d) => d.path)).toEqual([]);
    expect(outcome.result.divergedElsewhere.map((d) => d.path)).toEqual([]);
    // la moyenne annuelle « correcte » du catalogue (15.333…) est bien celle de la v2
    expect(outcome.result.corrected.some((d) => d.id === "CLASSIC_SEMESTER_DETECTED_BY_NAME")).toBe(true);
  });
});
