/**
 * GOLDEN — pile « classique » (moyennes pondérées par coefficient, `(S1 + 2·S2)/3`, mentions, décisions, distinctions, classement) :
 * le RuleSet `CI-CLASSIC-SEMESTRE` reproduit les documents de bulletin figés du legacy, sauf bogues connus.
 *
 * `CI-HIGHER-BTS` (copie de CI-CLASSIC-SEMESTRE v1) est rejoué sur les MÊMES scénarios : mêmes sorties.
 */
import { describe, expect, it } from "vitest";
import { ClassicScenarioWorld } from "./coef-pipeline";
import { compareStrict, describeDifferences, loadScenario, loadSnapshot, type ComparisonResult } from "./helpers";
import { RuleRunner, compiledSeed } from "../support/runner";

const ONLY = [
  "steps.*.documents.*.sections.*.average",
  "steps.*.documents.*.sections.*.appreciation",
  "steps.*.documents.*.sections.*.rank",
  "steps.*.documents.*.sections.*.bilanTypeName",
  "steps.*.documents.*.sections.*.lines.*.courseCode",
  "steps.*.documents.*.sections.*.lines.*.coef",
  "steps.*.documents.*.sections.*.lines.*.average",
  "steps.*.documents.*.sections.*.lines.*.appreciation",
  "steps.*.documents.*.sections.*.lines.*.rank",
  "steps.*.documents.*.summary.overallAverage",
  "steps.*.documents.*.summary.mention",
  "steps.*.documents.*.summary.decision",
  "steps.*.documents.*.summary.rank",
  "steps.*.documents.*.summary.firstSemesterAverage",
  "steps.*.documents.*.summary.secondSemesterAverage",
  "steps.*.documents.*.summary.annualAverage",
  "steps.*.documents.*.summary.annualRank",
  "steps.*.documents.*.summary.councilAppreciation",
  "steps.*.documents.*.summary.distinctionSanctions",
  "steps.*.documents.*.summary.endYearDecision",
  "steps.*.documents.*.summary.affected",
  "steps.*.documents.*.summary.repeating",
  "steps.*.documents.*.summary.totalStudents",
];

/** Un scénario peut regrouper plusieurs classes dans une même étape : les documents sont fusionnés (élèves uniques). */
function runMerged(name: string, ruleSet: string, rules: RuleRunner = new RuleRunner(compiledSeed(ruleSet))) {
  const classic = loadScenario(name).classic!;
  const world = new ClassicScenarioWorld(rules, classic.setup);
  const steps: Record<string, { documents: Record<string, unknown> }> = {};
  classic.steps.forEach((step, i) => {
    const label = `${String(i + 1).padStart(2, "0")}-${step.label}`;
    if (step.do === "report") steps[label] = { documents: { ...(steps[label]?.documents ?? {}), ...world.documents(step.class, step.period, step.student) } };
    else if (step.do === "put-matrix") world.putMatrix(step);
  });
  return { steps };
}

function compareClassic(name: string, ruleSet: string, options: Parameters<typeof compareStrict>[2] = {}, rules?: RuleRunner): { result: ComparisonResult; actual: ReturnType<typeof runMerged> } {
  const actual = runMerged(name, ruleSet, rules);
  const snapshot = loadSnapshot(name);
  // On ne compare que les étapes rejouées (bulletins) ; matrices et refus relèvent de `results`/`assess`.
  const result = compareStrict(actual, snapshot, { only: ONLY, ...options });
  return { result, actual };
}

describe.each(["CI-CLASSIC-SEMESTRE", "CI-HIGHER-BTS"])("GOLDEN pile classique avec %s", (ruleSet) => {
  it("classique-terminale : aucun écart avec le legacy (19 élèves, seuils de mention, (S1+2·S2)/3, distinctions, rangs ex æquo)", () => {
    const { result, actual } = compareClassic("classique-terminale", ruleSet);
    expect(result.differences, describeDifferences(result, 40)).toEqual([]);
    // Les étapes rejouées sont bien comparées : 4 jeux de documents (S1, S2, e18 seul, e07 après saisie).
    expect(Object.keys(actual.steps)).toHaveLength(4);
    expect(Object.keys(actual.steps["01-bulletins S1"]!.documents)).toHaveLength(19);
  });

  it("classique-flottants : les moyennes EXACTEMENT sur un seuil sont dans la catégorie supérieure (60 occurrences corrigées)", () => {
    const { result } = compareClassic("classique-flottants", ruleSet);
    expect(result.differences, describeDifferences(result, 40)).toEqual([]);
    expect(result.stillDefective).toEqual([]);
    expect(result.divergedElsewhere).toEqual([]);
    const corrected = result.corrected.filter((d) => d.id === "CLASSIC_FLOAT_WEIGHTED_MEAN");
    // Chaque occurrence du catalogue (60) est soit corrigée, soit couverte par une divergence acceptée.
    expect(corrected.length + result.acceptedDivergences.filter((d) => d.defect === "CLASSIC_FLOAT_WEIGHTED_MEAN").length).toBeGreaterThanOrEqual(60);
  });

  it("classique-nommage-periodes : le rôle de la période (et non son nom) décide du 2ᵉ semestre ; seuls les comportements liés au NOM divergent", () => {
    // Les quirks du legacy (détection par le nom, « REDOUBL » cherché dans le texte) sont volontairement NON reproduits.
    const { result } = compareClassic("classique-nommage-periodes", ruleSet, { knownDefects: "all" });
    expect(result.differences, describeDifferences(result, 40)).toEqual([]);
    expect(result.acceptedDivergences.length).toBeGreaterThan(0);
    expect(new Set(result.acceptedDivergences.map((d) => d.defect))).toEqual(
      new Set(["CLASSIC_SEMESTER_DETECTED_BY_NAME", "CLASSIC_REPEATING_FROM_DECISION_TEXT"]),
    );
  });
});

describe("GOLDEN pile classique : la comparaison est SENSIBLE (une règle modifiée est détectée)", () => {
  const variant = (key: string, param: string, value: number): RuleRunner =>
    new RuleRunner(compiledSeed("CI-CLASSIC-SEMESTRE", (rs) => rs.map((r) => (r.key === key ? { ...r, parameters: { ...r.parameters, [param]: { ...r.parameters[param]!, default: value } } } : r))));

  it("un seuil de passage relevé à 11 change les décisions de fin d'année", () => {
    const { result } = compareClassic("classique-terminale", "CI-CLASSIC-SEMESTRE", {}, variant("decision_fin_annee", "passage", 11));
    expect(result.differences.some((d) => d.path.endsWith("summary.endYearDecision"))).toBe(true);
  });

  it("des poids de moyenne annuelle 1/1 changent la moyenne annuelle ((S1+S2)/2 au lieu de (S1+2·S2)/3)", () => {
    const rules = new RuleRunner(
      compiledSeed("CI-CLASSIC-SEMESTRE", (rs) =>
        rs.map((r) => (r.key === "moyenne_annuelle" ? { ...r, parameters: { poids_s1: { ...r.parameters.poids_s1!, default: 1 }, poids_s2: { ...r.parameters.poids_s2!, default: 1 } } } : r)),
      ),
    );
    const { result } = compareClassic("classique-terminale", "CI-CLASSIC-SEMESTRE", {}, rules);
    expect(result.differences.some((d) => d.path.endsWith("summary.annualAverage"))).toBe(true);
  });
});
