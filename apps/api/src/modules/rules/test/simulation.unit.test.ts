/**
 * Simulation (US2) sur des jeux de données FICTIFS : rapport identique à `simulate()` du moteur, compteurs exacts au-delà du
 * plafond de différences, part des décisions modifiées, groupes de cas disjoints, performance (1 000 étudiants × ~100 évaluations).
 */
import { describe, expect, it } from "vitest";
import { simulate } from "../engine";
import { computeSimulationReport } from "../application/simulations";
import type { SimulationCaseGroup, SimulationCaseInput } from "../application/ports";
import { getContract, contractRule } from "../contracts";
import { toEngineDefinition, toEngineVersionMeta } from "../domain/definition";
import type { RuleDefinitionRecord, RuleVersionWithRules } from "../domain/types";
import { versionRecordFor } from "./support/runner";
import { SEED_RULE_SETS } from "../seed/rulesets";
import { seedVersionRecords } from "../seed/records";

const lmdSeed = SEED_RULE_SETS.find((s) => s.code === "CI-HIGHER-LMD")!.versions[0]!;
const baseRules = seedVersionRecords(lmdSeed);

function version(id: string, no: number, rules: RuleDefinitionRecord[]): RuleVersionWithRules {
  return { ...versionRecordFor("CI-HIGHER-LMD", { ...lmdSeed, versionNo: no }, rules, id), rules };
}
const withParam = (rules: RuleDefinitionRecord[], keys: string[], param: string, value: number): RuleDefinitionRecord[] =>
  rules.map((r) => (keys.includes(r.key) ? { ...r, parameters: { ...r.parameters, [param]: { ...r.parameters[param]!, default: value } } } : r));

const base = version("base", 1, baseRules);
const strict = version("target", 2, withParam(baseRules, ["ecue_validee", "ue_validee", "statut_ecue"], "seuil_validation", 11));

/** Génération déterministe (LCG) de notes réalistes : pas de hasard non reproductible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const note = (r: () => number): number => Math.round(r() * 2000) / 100;

function ecueCases(n: number, seed = 7): SimulationCaseInput[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const moyenne_devoirs = note(r);
    const note_examen = note(r);
    const n20 = Math.round((moyenne_devoirs * 0.4 + note_examen * 0.6) * 100) / 100;
    return { id: `inscription-${i}:periode-1`, context: { variables: { moyenne_devoirs, note_examen, note: n20, validation_manuelle: false } } };
  });
}

describe("rapport de simulation", () => {
  it("est IDENTIQUE à simulate() du moteur pour un seul groupe de cas", () => {
    const cases = ecueCases(200);
    const ruleKeys = ["ecue_validee", "ecue_eliminee"];
    const computed = computeSimulationReport(base, strict, [{ ruleKeys, cases }], 1000);
    expect(computed.ok).toBe(true);
    if (!computed.ok) return;

    const contract = getContract("credit-semester@1")!;
    const toEngine = (v: RuleVersionWithRules) => toEngineVersionMeta(v, v.rules.map((r) => toEngineDefinition(r, contractRule(contract, r.key))));
    const direct = simulate(toEngine(base), toEngine(strict), cases.map((c) => ({ id: c.id, context: c.context })), { ruleKeys, maxDifferences: 1000 });
    expect(computed.value.report.summary).toEqual({ ...direct.summary, cases: 200 });
    expect(computed.value.report.rules).toEqual(direct.rules);
    expect(computed.value.report.differences).toEqual(direct.differences);
    expect(computed.value.casesCount).toBe(200);
    // Le seuil relevé à 11 invalide des ECUE entre 10 et 11 : des différences existent, avec delta exact absent (booléens).
    expect(direct.summary.changed).toBeGreaterThan(0);
    expect(direct.rules.find((r) => r.key === "ecue_validee")!.transitions.length).toBeGreaterThan(0);
  });

  it("garde des compteurs EXACTS au-delà du plafond de différences détaillées (AC2.4)", () => {
    const cases = ecueCases(500);
    const uncapped = computeSimulationReport(base, strict, [{ ruleKeys: ["ecue_validee"], cases }], 10_000);
    const capped = computeSimulationReport(base, strict, [{ ruleKeys: ["ecue_validee"], cases }], 10);
    if (!uncapped.ok || !capped.ok) throw new Error("rapport attendu");
    expect(uncapped.value.report.summary.changed).toBeGreaterThan(10);
    expect(capped.value.report.differences).toHaveLength(10);
    expect(capped.value.report.truncated).toBe(true);
    expect(capped.value.report.summary).toEqual(uncapped.value.report.summary); // compteurs identiques
    expect(capped.value.report.rules).toEqual(uncapped.value.report.rules);
  });

  it("fusionne plusieurs groupes ; la part des DÉCISIONS ne compte que les règles de décision", () => {
    const groups: SimulationCaseGroup[] = [
      { ruleKeys: ["ecue_validee", "ecue_eliminee"], cases: ecueCases(100, 1) },
      { ruleKeys: ["mention_releve"], cases: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, context: { variables: { moyenne: (i % 21) } } })) },
    ];
    // La mention ne bouge pas (même version) : seul le seuil de validation, règle de DÉCISION, produit des écarts.
    const computed = computeSimulationReport(base, strict, groups, 1000);
    if (!computed.ok) throw computed.error;
    const { report, decisionPercent, casesCount } = computed.value;
    expect(casesCount).toBe(200);
    expect(report.summary.evaluations).toBe(100 * 2 + 100);
    const decision = report.rules.filter((r) => r.key.startsWith("ecue_"));
    const changed = decision.reduce((n, r) => n + r.changed, 0);
    expect(Number(decisionPercent)).toBeCloseTo((changed * 100) / (100 * 2), 2);
    expect(report.rules.find((r) => r.key === "mention_releve")!.changed).toBe(0);
  });

  it("une règle dont l'expression change de résultat est comptée avec son delta exact et sa matrice de transitions", () => {
    const widened = version("w", 2, withParam(baseRules, ["mention_releve"], "passable", 12));
    const cases = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, context: { variables: { moyenne: i } } }));
    const computed = computeSimulationReport(base, widened, [{ ruleKeys: ["mention_releve"], cases }], 1000);
    if (!computed.ok) throw computed.error;
    const stats = computed.value.report.rules[0]!;
    expect(stats.changed).toBe(2); // moyennes 10 et 11 passent de PASSABLE à INSUFFICIENT
    expect(stats.transitions).toEqual([{ from: "PASSABLE", to: "INSUFFICIENT", count: 2 }]);
    expect(computed.value.decisionPercent).toBe("0"); // une mention n'est pas une décision
  });

  it("une erreur introduite par la nouvelle version est comptée (error_introduced) sans masquer les autres cas", () => {
    const broken = version("b", 2, baseRules.map((r) => (r.key === "ecue_validee" ? { ...r, expression: "note >= params.seuil_validation" } : r)));
    const cases = [{ id: "a", context: { variables: { note: 12, validation_manuelle: false } } }, { id: "b", context: { variables: { note: null, validation_manuelle: false } } }];
    const computed = computeSimulationReport(base, broken, [{ ruleKeys: ["ecue_validee"], cases }], 1000);
    if (!computed.ok) throw computed.error;
    expect(computed.value.report.rules[0]!.compileErrors.new).toBeDefined();
    expect(computed.value.report.summary.newErrors).toBe(2);
    expect(computed.value.report.identical).toBe(false);
  });

  it("refuse deux groupes qui évaluent la même règle", () => {
    const cases = ecueCases(3);
    const computed = computeSimulationReport(base, strict, [{ ruleKeys: ["ecue_validee"], cases }, { ruleKeys: ["ecue_validee"], cases }], 1000);
    expect(computed.ok === false && computed.error.code).toBe("rules.invalid_input");
  });

  it("deux versions identiques : rapport identique, aucune différence", () => {
    const same = computeSimulationReport(base, base, [{ ruleKeys: ["ecue_validee", "ecue_eliminee"], cases: ecueCases(50) }], 1000);
    if (!same.ok) throw same.error;
    expect(same.value.report.identical).toBe(true);
    expect(same.value.report.summary.changed).toBe(0);
    expect(same.value.decisionPercent).toBe("0");
  });

  it("PERFORMANCE : 1 000 étudiants × ~100 évaluations (≈ 100 000 évaluations ×2) en moins de 60 s (AC2.3)", () => {
    const students = 1000;
    const r = rng(42);
    const mkEcues = () => Array.from({ length: 6 }, () => ({ note: note(r), credits: 2 + Math.floor(r() * 4), validation_manuelle: false }));
    const groups: SimulationCaseGroup[] = [
      // 1 000 cas × 3 règles d'ECUE
      { ruleKeys: ["ecue_validee", "ecue_eliminee", "note_ecue"], cases: ecueCases(students * 12, 3) },
      // 1 000 cas × 3 règles d'UE sur 6 ECUE
      {
        ruleKeys: ["moyenne_ue", "credits_ue"],
        cases: Array.from({ length: students * 10 }, (_, i) => ({ id: `ue${i}`, context: { variables: { ecues: mkEcues(), moyenne: note(r) } } })),
      },
      { ruleKeys: ["mention_releve", "distinction_semestre"], cases: Array.from({ length: students * 22 }, (_, i) => ({ id: `s${i}`, context: { variables: { moyenne: note(r) } } })) },
    ];
    const t0 = Date.now();
    const computed = computeSimulationReport(base, strict, groups, 1000);
    const elapsed = Date.now() - t0;
    if (!computed.ok) throw computed.error;
    console.info(`[rules] simulation : ${computed.value.report.summary.evaluations} évaluations comparées (ancienne + nouvelle) en ${elapsed} ms`);
    expect(computed.value.report.summary.evaluations).toBeGreaterThanOrEqual(students * 100);
    expect(elapsed).toBeLessThan(60_000);
  });
});
