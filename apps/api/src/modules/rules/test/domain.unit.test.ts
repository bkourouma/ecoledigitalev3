/**
 * Domaine pur : JSON canonique et hash (déterminisme), gouvernance (table de vérité acteur × portée × transition contre
 * `canTransition` du moteur), résolution des liaisons (spécificité, dates), fusion des rapports de simulation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RULE_STATUSES, canTransition, nextStatuses, type RuleStatus, type SimulationReport } from "../engine";
import { canonicalJson, sha256Hex } from "../domain/canonical";
import { ENGINE_VERSION, computeDefinitionHash } from "../domain/definition";
import { computeInputsHash, computeOutputsHash } from "../domain/evaluation";
import { allowedTransitions, commentRequired, isDecisionRule, planTransition, requiresDecisionConfirmation } from "../domain/governance";
import { bindingApplies, bindingSpecificity, selectBinding } from "../domain/binding";
import { decisionChangedPercent, mergeSimulationReports } from "../domain/simulation";
import type { BindingRecord, GovernanceActor } from "../domain/types";
import { SEED_RULE_SETS } from "../seed/rulesets";
import { seedVersionRecords } from "../seed/records";

describe("JSON canonique et empreintes", () => {
  it("trie les clés, normalise NFC, omet undefined, écrit -0 comme 0", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: "x" }] })).toBe('{"a":[2,{"c":"x"}],"b":1}');
    expect(canonicalJson("é")).toBe(canonicalJson("é")); // é décomposé = é précomposé
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson(0.4)).toBe("0.4");
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });

  it("sha256Hex est stable et sensible au moindre changement", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); // vecteur FIPS 180-2
    expect(sha256Hex("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });

  it("le hash de définition ignore l'ordre de lecture et la description, pas l'expression ni les paramètres", () => {
    const lmd = SEED_RULE_SETS.find((s) => s.code === "CI-HIGHER-LMD")!.versions[0]!;
    const rules = seedVersionRecords(lmd);
    const base = computeDefinitionHash(lmd.contractId, rules);
    expect(computeDefinitionHash(lmd.contractId, [...rules].reverse())).toBe(base);
    expect(computeDefinitionHash(lmd.contractId, rules.map((r) => ({ ...r, description: "autre" })))).toBe(base);
    expect(computeDefinitionHash("credit-semester@2", rules)).not.toBe(base);
    expect(computeDefinitionHash(lmd.contractId, rules.map((r) => (r.key === "note_ecue" ? { ...r, expression: `${r.expression} ` } : r)))).not.toBe(base);
    const changed = rules.map((r) => (r.key === "ecue_validee" ? { ...r, parameters: { seuil_validation: { ...r.parameters.seuil_validation!, default: 11 } } } : r));
    expect(computeDefinitionHash(lmd.contractId, changed)).not.toBe(base);
  });

  it("la version du moteur enregistrée avec chaque résultat égale celle du paquet", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../../../../../packages/rules-engine/package.json"), "utf8")) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
  });

  const schema = { variables: { note: "number?", liste: { list: { object: { x: "number", flag: "boolean" } } }, code: "string" } } as const;

  it("inputs_hash : 12, 12.0 et \"12.00\" donnent la même empreinte ; seuls les champs déclarés comptent", () => {
    const h = (note: unknown, extra: Record<string, unknown> = {}) =>
      computeInputsHash("r", schema, { variables: { note, liste: [{ x: 1, flag: true, ...extra }], code: "007" } });
    expect(h(12)).toBe(h(12.0));
    expect(h(12)).toBe(h("12.00"));
    expect(h(12)).not.toBe(h(12.5));
    expect(h(null)).toBe(h(undefined));
    expect(h(12, { inconnu: 99 })).toBe(h(12)); // champ non déclaré : ignoré
    // Un texte reste un texte : "007" n'est pas confondu avec 7.
    expect(computeInputsHash("r", schema, { variables: { note: 1, liste: [], code: "007" } })).not.toBe(computeInputsHash("r", schema, { variables: { note: 1, liste: [], code: "7" } }));
    // L'ordre des clés du contexte est sans effet ; l'ordre d'une LISTE compte.
    expect(computeInputsHash("r", schema, { variables: { code: "a", liste: [], note: 1 } })).toBe(computeInputsHash("r", schema, { variables: { note: 1, liste: [], code: "a" } }));
    const two = (a: number, b: number) => computeInputsHash("r", schema, { variables: { note: 1, code: "", liste: [{ x: a, flag: true }, { x: b, flag: true }] } });
    expect(two(1, 2)).not.toBe(two(2, 1));
  });

  it("inputs_hash dépend de la règle et des surcharges ; outputs_hash normalise les décimaux", () => {
    const ctx = { variables: { note: 1, liste: [], code: "" } };
    expect(computeInputsHash("a", schema, ctx)).not.toBe(computeInputsHash("b", schema, ctx));
    expect(computeInputsHash("a", schema, ctx, { poids: 0.5 })).not.toBe(computeInputsHash("a", schema, ctx));
    expect(computeOutputsHash("number", "10")).toBe(computeOutputsHash("number", "10.0"));
    expect(computeOutputsHash("number", "10")).not.toBe(computeOutputsHash("string", "10"));
    expect(computeOutputsHash("null", null)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("gouvernance : table de vérité acteur × portée × transition", () => {
  const tenantAdmin: GovernanceActor = { kind: "tenant_admin", id: "u1", name: "Admin" };
  const superAdmin: GovernanceActor = { kind: "super_admin", id: "s1", name: "Super" };
  const TENANT = "11111111-1111-4111-8111-111111111111";

  it("planTransition == canTransition du moteur pour TOUTES les combinaisons (R-RUL-01 : aucune transition ajoutée)", () => {
    for (const from of RULE_STATUSES) {
      for (const to of RULE_STATUSES) {
        for (const origin of ["tenant", "national"] as const) {
          for (const actor of [tenantAdmin, superAdmin]) {
            const engine = canTransition({
              from,
              to,
              scope: origin === "national" ? { kind: "national" } : { kind: "tenant", tenantId: TENANT },
              actor: actor.kind === "tenant_admin" ? "tenant_admin" : "super_admin",
            });
            const plan = planTransition({ from, to, origin, tenantId: origin === "tenant" ? TENANT : null, actor, comment: "Commentaire de test." });
            expect(plan.ok, `${from}->${to} ${origin} ${actor.kind}`).toBe(engine.ok);
            if (!plan.ok) expect(plan.error.code).toBe("rules.transition_forbidden");
          }
        }
      }
    }
  });

  it("la chaîne draft → simulated → proposed → approved → published → retired est exactement celle du moteur", () => {
    expect(nextStatuses("draft")).toEqual(["simulated"]);
    expect(nextStatuses("simulated").sort()).toEqual(["draft", "proposed"]);
    expect(nextStatuses("proposed").sort()).toEqual(["approved", "draft"]);
    expect(nextStatuses("approved").sort()).toEqual(["published", "retired"]);
    expect(nextStatuses("published")).toEqual(["retired"]);
    expect(nextStatuses("retired")).toEqual([]);
  });

  it("un administrateur d'établissement ne peut ni approuver, ni publier, ni retirer, ni toucher le national (403) ; une transition inexistante est un 409", () => {
    for (const to of ["approved", "published", "retired"] as const) {
      const from: RuleStatus = to === "approved" ? "proposed" : to === "published" ? "approved" : "published";
      const plan = planTransition({ from, to, origin: "tenant", tenantId: TENANT, actor: tenantAdmin, comment: "ok" });
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error.httpStatus).toBe(403);
    }
    const national = planTransition({ from: "draft", to: "simulated", origin: "national", tenantId: null, actor: tenantAdmin });
    expect(national.ok === false && national.error.httpStatus).toBe(403);
    const illegal = planTransition({ from: "draft", to: "published", origin: "tenant", tenantId: TENANT, actor: superAdmin, comment: "x" });
    expect(illegal.ok === false && illegal.error.httpStatus).toBe(409);
  });

  it("le commentaire est obligatoire pour approuver, rejeter (super-admin) et retirer (AC3.5), pas pour retirer sa proposition", () => {
    expect(commentRequired("proposed", "approved", superAdmin)).toBe(true);
    expect(commentRequired("approved", "retired", superAdmin)).toBe(true);
    expect(commentRequired("published", "retired", superAdmin)).toBe(true);
    expect(commentRequired("proposed", "draft", superAdmin)).toBe(true);
    expect(commentRequired("proposed", "draft", tenantAdmin)).toBe(false);
    expect(commentRequired("draft", "simulated", tenantAdmin)).toBe(false);
    const noComment = planTransition({ from: "proposed", to: "approved", origin: "tenant", tenantId: TENANT, actor: superAdmin });
    expect(noComment.ok === false && noComment.error.code).toBe("rules.comment_required");
    expect(planTransition({ from: "proposed", to: "draft", origin: "tenant", tenantId: TENANT, actor: tenantAdmin }).ok).toBe(true);
  });

  it("allowedTransitions suit l'acteur et la portée", () => {
    expect(allowedTransitions("proposed", "tenant", TENANT, tenantAdmin)).toEqual(["draft"]);
    expect(allowedTransitions("proposed", "tenant", TENANT, superAdmin).sort()).toEqual(["approved", "draft"]);
    expect(allowedTransitions("draft", "national", null, tenantAdmin)).toEqual([]);
  });

  it("seuil de confirmation d'impact : strictement supérieur au seuil (AC2.5) ; types de règle de décision", () => {
    expect(requiresDecisionConfirmation(5.01, 5)).toBe(true);
    expect(requiresDecisionConfirmation(5, 5)).toBe(false);
    expect(requiresDecisionConfirmation(0, 5)).toBe(false);
    expect(["promotion", "repetition", "orientation", "credit_validation"].every((t) => isDecisionRule(t as never))).toBe(true);
    expect(["mention", "rounding", "ranking", "period_average"].some((t) => isDecisionRule(t as never))).toBe(false);
  });
});

describe("liaisons : spécificité et dates", () => {
  const INST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const NODE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const b = (id: string, over: Partial<BindingRecord>): BindingRecord => ({
    id,
    contractId: "credit-semester@1",
    ruleSetCode: "CI-HIGHER-LMD",
    institutionId: null,
    curriculumNodeId: null,
    levelCode: null,
    effectiveFrom: "2024-09-01",
    effectiveTo: null,
    createdBy: null,
    createdAt: new Date(0),
    ...over,
  });
  const q = { contractId: "credit-semester@1", institutionId: INST, curriculumNodeId: NODE, levelCode: "LICENCE", date: "2025-09-15" };

  it("nœud > niveau > établissement > tenant", () => {
    const tenant = b("1", {});
    const inst = b("2", { institutionId: INST, ruleSetCode: "INST" });
    const level = b("3", { levelCode: "LICENCE", ruleSetCode: "LEVEL" });
    const node = b("4", { curriculumNodeId: NODE, ruleSetCode: "NODE" });
    expect(selectBinding([tenant, inst, level, node], q)?.ruleSetCode).toBe("NODE");
    expect(selectBinding([tenant, inst, level], q)?.ruleSetCode).toBe("LEVEL");
    expect(selectBinding([tenant, inst], q)?.ruleSetCode).toBe("INST");
    expect(selectBinding([tenant], q)?.id).toBe("1");
    expect(bindingSpecificity(node)).toBeGreaterThan(bindingSpecificity(level));
    expect(bindingSpecificity(level)).toBeGreaterThan(bindingSpecificity(inst));
    expect(bindingSpecificity(inst)).toBeGreaterThan(bindingSpecificity(tenant));
  });

  it("filtre sur le contrat, la période d'effet (bornes incluses) et le périmètre exact", () => {
    expect(selectBinding([b("1", { contractId: "coef-semester@1" })], q)).toBeNull();
    expect(selectBinding([b("1", { effectiveFrom: "2025-09-16" })], q)).toBeNull();
    expect(selectBinding([b("1", { effectiveFrom: "2025-09-15" })], q)?.id).toBe("1");
    expect(selectBinding([b("1", { effectiveTo: "2025-09-14" })], q)).toBeNull();
    expect(selectBinding([b("1", { effectiveTo: "2025-09-15" })], q)?.id).toBe("1");
    expect(bindingApplies(b("1", { institutionId: "autre" }), q)).toBe(false);
    expect(bindingApplies(b("1", { curriculumNodeId: "autre" }), q)).toBe(false);
    expect(bindingApplies(b("1", { levelCode: "MASTER" }), q)).toBe(false);
    expect(selectBinding([], q)).toBeNull();
  });

  it("à spécificité égale : début d'effet le plus récent, puis identifiant (déterministe)", () => {
    const older = b("z", { institutionId: INST, effectiveFrom: "2024-09-01", ruleSetCode: "OLD" });
    const newer = b("a", { institutionId: INST, effectiveFrom: "2025-09-01", ruleSetCode: "NEW" });
    expect(selectBinding([older, newer], q)?.ruleSetCode).toBe("NEW");
    expect(selectBinding([newer, older], q)?.ruleSetCode).toBe("NEW");
  });
});

describe("rapports de simulation", () => {
  const mkReport = (over: Partial<SimulationReport["summary"]> = {}, ruleKeys: string[] = ["a"]): SimulationReport => ({
    oldVersion: { id: "o", version: 1 },
    newVersion: { id: "n", version: 2 },
    summary: { cases: 3, rules: ruleKeys.length, evaluations: 6, changed: 2, unchanged: 4, newErrors: 0, resolvedErrors: 0, changedErrors: 0, changedPercent: "33.33", ...over },
    rules: ruleKeys.map((key) => ({ key, presence: "both", compileErrors: {}, evaluated: 6, changed: 2, unchanged: 4, newErrors: 0, resolvedErrors: 0, changedErrors: 0, transitions: [] })),
    differences: [],
    truncated: false,
    identical: false,
  });

  it("fusionne les compteurs, compte chaque cas une fois et plafonne les différences détaillées", () => {
    const withDiffs = (n: number): SimulationReport => ({
      ...mkReport(),
      differences: Array.from({ length: n }, (_, i) => ({ caseId: `c${i}`, ruleKey: "a", kind: "value_changed" as const, old: { status: "absent" as const }, new: { status: "absent" as const } })),
    });
    const merged = mergeSimulationReports([withDiffs(3), { ...mkReport({}, ["b"]), differences: [] }], new Set(["c0", "c1", "c2", "c3"]), 2);
    expect(merged.summary).toMatchObject({ cases: 4, rules: 2, evaluations: 12, changed: 4, unchanged: 8, changedPercent: "33.33" });
    expect(merged.differences).toHaveLength(2);
    expect(merged.truncated).toBe(true);
    expect(merged.rules.map((r) => r.key)).toEqual(["a", "b"]);
    expect(() => mergeSimulationReports([], new Set(), 10)).toThrow();
  });

  it("part des DÉCISIONS modifiées : seules les règles de décision comptent", () => {
    const report: SimulationReport = {
      ...mkReport(),
      rules: [
        { key: "semestre_valide", presence: "both", compileErrors: {}, evaluated: 10, changed: 1, unchanged: 9, newErrors: 0, resolvedErrors: 0, changedErrors: 0, transitions: [] },
        { key: "mention", presence: "both", compileErrors: {}, evaluated: 10, changed: 10, unchanged: 0, newErrors: 0, resolvedErrors: 0, changedErrors: 0, transitions: [] },
      ],
    };
    const types = new Map([["semestre_valide", "promotion"], ["mention", "mention"]] as const);
    expect(decisionChangedPercent(report, types)).toBe("10");
    expect(decisionChangedPercent(report, new Map())).toBe("0");
  });

  it("la fusion d'un seul rapport est l'identité (hors comptage des cas) ; l'égalité avec simulate() est vérifiée sur données dans simulation.unit.test.ts", () => {
    const single = mkReport();
    const merged = mergeSimulationReports([single], new Set(["x", "y", "z"]), 1000);
    expect(merged.summary).toEqual(single.summary);
    expect(merged.rules).toEqual(single.rules);
  });
});
