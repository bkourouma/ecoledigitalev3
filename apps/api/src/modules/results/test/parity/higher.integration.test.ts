/**
 * PARITÉ avec le legacy — pile « supérieur à crédits ». Les scénarios déclaratifs de `tests/characterization/scenarios` sont rejoués
 * à travers `results` + les VRAIES règles CI-HIGHER-LMD (voir l'adaptateur `higher.ts`) ; la projection est comparée à la snapshot
 * du legacy par `compareWithTolerance`.
 *
 * Écarts tolérés, et eux seuls :
 *   1. les bogues du catalogue de statut `bug` (virgule flottante à 10 et à 5, recalcul sur entrées arrondies, validité divergente…) :
 *      la v2 doit AVOIR CORRIGÉ le défaut (`corrected`), jamais le reproduire (`stillDefective` vide) ni diverger ailleurs ;
 *   2. les divergences DOCUMENTÉES ci-dessous (décisions v2 volontaires, avec leur justification) ; chacune doit être effectivement
 *      exercée (une documentation périmée fait échouer le test).
 * Les défauts `dead` (`RULES_NOT_WIRED_*`) ne sont PAS tolérés : leur portée (un sous-arbre entier par étudiant) masquerait des écarts réels.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadScenario, loadSnapshot } from "../../../../../../../tests/characterization/compare";
import { createResultsTestDb, describeIntegration, type ResultsTestDb } from "../support/db";
import { bind, makeWorld, type World } from "../support/world";
import { describeDifferences, runParity, type DocumentedDivergence } from "./compare-helper";
import { HigherParity, pickLegacyObservation } from "./higher";

const DEBUG = process.env.PARITY_DEBUG === "1";

/** Divergences documentées par scénario. */
const DOCUMENTED: Record<string, DocumentedDivergence[]> = {
  "conduite-absences": [
    {
      pattern: "observations.final.bulletins.S3.dan.**",
      reason:
        "dan n'a AUCUNE note de conduite. Le legacy ignore alors silencieusement l'UE de conduite (4 crédits au lieu de 6) et déclare le semestre « admis ». " +
        "La v2 laisse le semestre SANS DÉCISION (en attente) tant qu'une UE n'a aucun résultat : ni validé, ni ajourné faute de note (décision à arbitrer, voir le rapport).",
    },
    { pattern: "observations.final.fullBulletins.S3.dan", reason: "idem : dan est en attente, son bulletin n'est pas disponible." },
    {
      pattern: "observations.final.bulletins.S3.fay.**",
      reason:
        "fay : conduite saisie 9,995. Le legacy l'enregistre 10,00 (colonne numeric(6,2)) et valide l'UE. La v2 conserve la note SAISIE (3 décimales, jamais d'arrondi à l'enregistrement) " +
        "et décide sur la valeur exacte : 9,995 < 10, UE non validée (ADR-003 ; précision de saisie à arbitrer).",
    },
    { pattern: "observations.final.fullBulletins.S3.fay.**", reason: "idem : conséquence de la conduite 9,995 non validée." },
  ],
};

describeIntegration("parité avec le legacy — pile supérieur à crédits (CI-HIGHER-LMD)", () => {
  let db: ResultsTestDb;
  beforeAll(async () => {
    db = await createResultsTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  async function play(name: string) {
    const w: World = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    const scenario = loadScenario(name);
    const snapshot = loadSnapshot(name);
    const parity = new HigherParity(w, scenario);
    await parity.play();
    const expected = { observations: Object.fromEntries(Object.entries((snapshot.data as any).observations).map(([k, o]) => [k, pickLegacyObservation(o as any, parity.conductUeCodes)])) };
    const documented = DOCUMENTED[name] ?? [];
    const outcome = runParity({ observations: parity.observations }, expected, snapshot, { documented });
    if (DEBUG) {
      console.log(`\n===== ${name} : ${outcome.unexplained.length} non expliqués, ${outcome.documented.length} documentés, ${outcome.result.acceptedDivergences.length} bogues connus`);
      console.log(describeDifferences(outcome.unexplained, 120));
      console.log("stillDefective", outcome.result.stillDefective.length, "corrected", outcome.result.corrected.length, "divergedElsewhere", outcome.result.divergedElsewhere.length, "unverified", outcome.result.unverified.length);
      for (const a of outcome.result.acceptedDivergences) console.log(`  ACCEPTÉ[${a.defect}/${a.via}] ${a.path} legacy=${JSON.stringify(a.expected)} v2=${JSON.stringify(a.actual)}`);
      for (const d of outcome.documented) console.log(`  DOCUMENTÉ ${d.path} legacy=${JSON.stringify(d.expected)} v2=${JSON.stringify(d.actual)}`);
    }
    return { outcome, parity, documented };
  }

  const SCENARIOS = ["licence-rattrapage", "bts-premiere-annee", "notes-limites", "conduite-absences", "cloture-semestre"];

  it.each(SCENARIOS)("%s : aucune dérive inexpliquée, aucun bogue reproduit, divergences documentées exercées", async (name) => {
    const { outcome, parity, documented } = await play(name);
    // 1. rien d'inexpliqué
    expect(describeDifferences(outcome.unexplained)).toBe("");
    // 2. les bogues connus ne sont PAS reproduits : ils sont corrigés (ou non évaluables), jamais conservés ni déplacés
    expect(outcome.result.stillDefective.map((d) => `${d.id} ${d.path}`)).toEqual([]);
    expect(outcome.result.divergedElsewhere.map((d) => `${d.id} ${d.path}`)).toEqual([]);
    // 3. la documentation est vivante : chaque divergence documentée est exercée
    for (const d of documented) expect(outcome.documented.some((x) => x.reason === d.reason), `divergence documentée non exercée : ${d.pattern}`).toBe(true);
    // 4. le scénario a réellement été comparé (garde-fou contre une projection vide)
    const leaves = (v: unknown): number => (v !== null && typeof v === "object" ? Object.values(v as object).reduce<number>((n, x) => n + leaves(x), 0) : 1);
    expect(leaves(parity.observations)).toBeGreaterThan(200);
  });

  it("les corrections de bogues sont comptées : la v2 produit la valeur correcte du catalogue (virgule flottante, entrées arrondies)", async () => {
    const limits = await play("notes-limites");
    const ids = new Set(limits.outcome.result.corrected.map((d) => d.id));
    expect([...ids].sort()).toEqual(expect.arrayContaining(["FLOAT_ECUE_ELIMINATOIRE_5", "FLOAT_ECUE_VALIDATION_10", "FLOAT_UE_VALIDATION_10"]));
    expect(limits.outcome.result.corrected.length).toBeGreaterThanOrEqual(34);
    const bts = await play("bts-premiere-annee");
    expect(new Set(bts.outcome.result.corrected.map((d) => d.id))).toEqual(new Set(["FLOAT_ECUE_VALIDATION_10", "FLOAT_ECUE_ELIMINATOIRE_5"]));
  });
});
