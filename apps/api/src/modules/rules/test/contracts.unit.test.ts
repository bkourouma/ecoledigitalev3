/**
 * Contrats de règles (en code) et conformité d'une version à son contrat (AC5.1) : cas positifs (RuleSets de départ) et
 * NÉGATIFS (clé manquante, type de règle erroné, schéma d'entrée élargi, résultat non conforme, paramètre de mode hors
 * énumération, libellé sur un code inconnu, expression qui ne compile pas).
 */
import { describe, expect, it } from "vitest";
import { resolveSchema, RULE_TYPES } from "../engine";
import {
  COEF_PERIOD_ID,
  COEF_SEMESTER_ID,
  COMPETENCY_PERIOD_ID,
  CREDIT_SEMESTER_ID,
  EXAM_NATIONAL_ID,
  SECONDARY_ANNUAL_ID,
  coefPeriodContract,
  competencyPeriodContract,
  examNationalContract,
  getContract,
  listContracts,
  secondaryAnnualContract,
  coefSemesterContract,
  creditSemesterContract,
} from "../contracts";
import { checkConformity, inputSchemaProblems, parameterAllowed } from "../domain/conformity";
import type { RuleDefinitionRecord } from "../domain/types";
import { PLACEHOLDER_RULE_SET_CODES, SEED_RULE_SETS } from "../seed/rulesets";
import { seedVersionRecords } from "../seed/records";

const lmd = (): RuleDefinitionRecord[] => seedVersionRecords(SEED_RULE_SETS.find((s) => s.code === "CI-HIGHER-LMD")!.versions[0]!);
const classic = (): RuleDefinitionRecord[] => seedVersionRecords(SEED_RULE_SETS.find((s) => s.code === "CI-CLASSIC-SEMESTRE")!.versions[0]!);
const credit = creditSemesterContract;
const coef = coefSemesterContract;

const edit = (rules: RuleDefinitionRecord[], key: string, patch: Partial<RuleDefinitionRecord>): RuleDefinitionRecord[] => rules.map((r) => (r.key === key ? { ...r, ...patch } : r));
const codes = (rules: RuleDefinitionRecord[], contract = credit): string[] => checkConformity(contract, rules).violations.map((v) => `${v.ruleKey}:${v.code}`);

describe("catalogue de contrats", () => {
  it("expose les contrats versionnés en code (historiques et Phase 4-5)", () => {
    expect(listContracts().map((c) => c.id).sort()).toEqual(
      [COEF_SEMESTER_ID, CREDIT_SEMESTER_ID, COEF_PERIOD_ID, COMPETENCY_PERIOD_ID, EXAM_NATIONAL_ID, SECONDARY_ANNUAL_ID].sort(),
    );
    expect(getContract("credit-semester@1")).toBe(credit);
    expect(getContract("coef-semester@2")).toBeUndefined();
  });

  it.each([
    [credit.id, credit],
    [coef.id, coef],
    [coefPeriodContract.id, coefPeriodContract],
    [competencyPeriodContract.id, competencyPeriodContract],
    [examNationalContract.id, examNationalContract],
    [secondaryAnnualContract.id, secondaryAnnualContract],
  ] as const)("%s : clés uniques, types de règle du moteur, schémas d'entrée valides, pipeline cohérent", (_id, contract) => {
    const keys = contract.rules.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of contract.rules) {
      expect(RULE_TYPES).toContain(r.type);
      expect(() => resolveSchema(r.inputs), r.key).not.toThrow();
      expect(r.description.length, r.key).toBeGreaterThan(10);
    }
    // Le pipeline ne référence que des règles du contrat, et chaque règle y figure exactement une fois.
    const staged = contract.pipeline.flatMap((p) => p.rules);
    for (const k of staged) expect(keys, `pipeline : ${k}`).toContain(k);
    expect(new Set(staged).size).toBe(staged.length);
    expect([...keys].sort()).toEqual([...staged].sort());
  });

  it("aucune règle réglementaire ivoirienne officielle n'est inventée (MGA, CEPE, BEPC, BAC…)", () => {
    const text = JSON.stringify([credit, coef, coefPeriodContract, competencyPeriodContract, examNationalContract, secondaryAnnualContract, SEED_RULE_SETS]);
    for (const forbidden of ["MGA", "CEPE", "BEPC", "BACCALAUR", "BAC "]) expect(text.includes(forbidden), forbidden).toBe(false);
    // Portages fidèles du legacy : `platform` ; jeux de démonstration de la Phase 4-5 : `placeholder`, jamais `regulation`.
    for (const set of SEED_RULE_SETS) {
      const placeholder = (PLACEHOLDER_RULE_SET_CODES as readonly string[]).includes(set.code);
      for (const v of set.versions) {
        expect(v.source.kind, `${set.code} v${v.versionNo}`).toBe(placeholder ? "placeholder" : "platform");
        if (placeholder) {
          expect(set.name, set.code).toContain("(fictif)");
          for (const rule of v.rules) expect(rule.description, `${set.code}.${rule.key}`).toMatch(/\(fictif\)/);
        }
      }
    }
  });

  it("les règles à code déclarent leurs codes de sortie ; les paramètres de mode sont énumérés", () => {
    const coded = credit.rules.filter((r) => r.outputCodes.length > 0).map((r) => r.key);
    expect(coded).toEqual(expect.arrayContaining(["statut_ecue", "etat_ue", "decision_semestre", "mention_releve", "distinction_semestre"]));
    expect(credit.rules.find((r) => r.key === "note_examen_retenue")!.parameters.mode_session2!.allowed).toEqual(["REPLACE", "BEST"]);
    expect(credit.rules.find((r) => r.key === "semestre_valide")!.parameters.mode_validation!.allowed).toEqual(["ALL_UE", "CREDITS", "ALL_UE_OR_CREDITS"]);
  });
});

describe("conformité d'une version à son contrat", () => {
  it("les RuleSets de départ satisfont leur contrat", () => {
    expect(checkConformity(credit, lmd())).toMatchObject({ ok: true, violations: [] });
    expect(checkConformity(coef, classic())).toMatchObject({ ok: true, violations: [] });
  });

  it("refuse une clé OBLIGATOIRE manquante en nommant la clé", () => {
    const report = checkConformity(credit, lmd().filter((r) => r.key !== "ue_validee"));
    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(expect.objectContaining({ ruleKey: "ue_validee", code: "missing_rule", message: expect.stringContaining("ue_validee") }));
  });

  it("refuse une règle étrangère au contrat (R-RUL-09 : la structure appartient au contrat)", () => {
    const extra: RuleDefinitionRecord = { ...lmd()[0]!, key: "regle_inventee", position: 99 };
    expect(codes([...lmd(), extra])).toContain("regle_inventee:unknown_rule");
  });

  it("refuse un type de règle différent de celui du contrat", () => {
    expect(codes(edit(lmd(), "mention_releve", { type: "rounding" }))).toContain("mention_releve:type_mismatch");
  });

  it("refuse un schéma d'entrée ÉLARGI (variable inconnue du contrat) ou plus strict sur la nullité", () => {
    const widened = edit(lmd(), "mention_releve", { inputSchema: { variables: { moyenne: "number?", secret: "number" } } });
    expect(codes(widened)).toContain("mention_releve:input_schema_incompatible");
    // `moyenne` peut être absente dans le contrat : une règle ne peut pas l'exiger non nulle.
    const stricter = edit(lmd(), "mention_releve", { inputSchema: { variables: { moyenne: "number" } } });
    expect(checkConformity(credit, stricter).violations.map((v) => v.message).join(" ")).toContain("peut être absente dans le contrat");
    // Un type différent est refusé aussi.
    expect(codes(edit(lmd(), "mention_releve", { inputSchema: { variables: { moyenne: "string?" } } }))).toContain("mention_releve:input_schema_incompatible");
    // Un sous-ensemble compatible (la règle lit moins de champs) est accepté.
    expect(codes(edit(lmd(), "moyenne_ue", { inputSchema: { variables: { ecues: { list: { object: { note: "number?", credits: "number" } } } } } }))).toEqual([]);
  });

  it("refuse un type de résultat plus permissif que celui du contrat", () => {
    expect(codes(edit(lmd(), "credits_ue", { resultType: "number?" }))).toContain("credits_ue:result_type_mismatch");
    expect(codes(edit(lmd(), "credits_ue", { resultType: "string" }))).toContain("credits_ue:result_type_mismatch");
    // Plus strict : accepté.
    expect(codes(edit(lmd(), "moyenne_ue", { resultType: "number" }))).toEqual(expect.not.arrayContaining(["moyenne_ue:result_type_mismatch"]));
  });

  it("refuse une expression dont le type de résultat ne respecte pas le contrat (AC1.4)", () => {
    const report = checkConformity(credit, edit(lmd(), "credits_ue", { expression: '"beaucoup"' }));
    expect(report.ok).toBe(false);
    expect(report.rules.find((r) => r.key === "credits_ue")!.diagnostics[0]!.message).toMatch(/nombre/);
  });

  it("refuse une expression qui ne compile pas, avec un diagnostic français et la position", () => {
    const report = checkConformity(credit, edit(lmd(), "ecue_eliminee", { expression: "note < params.seuil_inconnu" }));
    const check = report.rules.find((r) => r.key === "ecue_eliminee")!;
    expect(check.ok).toBe(false);
    expect(check.diagnostics[0]!.message).toMatch(/seuil_inconnu|valeur peut|absent/i);
    const syntax = checkConformity(credit, edit(lmd(), "ecue_eliminee", { expression: "note <" }));
    expect(syntax.rules.find((r) => r.key === "ecue_eliminee")!.diagnostics[0]).toMatchObject({ phase: "syntax", position: expect.objectContaining({ line: 1 }) });
  });

  it("refuse une valeur de paramètre de MODE hors de l'énumération du contrat", () => {
    const bad = edit(lmd(), "note_examen_retenue", { parameters: { mode_session2: { type: "string", default: "MOYENNE" } } });
    expect(codes(bad)).toContain("note_examen_retenue:parameter_value");
    const wrongType = edit(lmd(), "note_examen_retenue", { parameters: { mode_session2: { type: "number", default: 1 } } });
    expect(codes(wrongType)).toContain("note_examen_retenue:parameter_type");
  });

  it("refuse un paramètre invalide (borne incohérente) ou un libellé sur un code inconnu", () => {
    const badParam = edit(lmd(), "ecue_validee", { parameters: { seuil_validation: { type: "number", default: 30, min: 0, max: 20 } } });
    expect(codes(badParam)).toContain("ecue_validee:parameter_invalid");
    const badLabel = edit(lmd(), "mention_releve", { labelMap: { SUPER_BIEN: { fr: "Super bien" } } });
    expect(codes(badLabel)).toContain("mention_releve:unknown_label_code");
  });

  it("valide aussi le contrat coef-semester@1 (clé manquante, type de règle)", () => {
    expect(codes(classic().filter((r) => r.key !== "rang"), coef)).toContain("rang:missing_rule");
    expect(codes(edit(classic(), "mention", { type: "promotion" }), coef)).toContain("mention:type_mismatch");
  });
});

describe("compatibilité des schémas d'entrée (fonction pure)", () => {
  const contract = { variables: { a: "number", b: "number?", xs: { list: { object: { n: "number", m: "number?" } } } } } as const;

  it("accepte un sous-ensemble de champs et une nullité plus permissive", () => {
    expect(inputSchemaProblems(contract, { variables: { a: "number?" } })).toEqual([]);
    expect(inputSchemaProblems(contract, { variables: { b: "number?", xs: { list: { object: { n: "number" } } } } })).toEqual([]);
  });

  it("refuse variable inconnue, type différent, nullité plus stricte, champ inconnu, liste devenue scalaire, lookups non fournis", () => {
    expect(inputSchemaProblems(contract, { variables: { z: "number" } })).toHaveLength(1);
    expect(inputSchemaProblems(contract, { variables: { a: "string" } })).toHaveLength(1);
    expect(inputSchemaProblems(contract, { variables: { b: "number" } })).toHaveLength(1);
    expect(inputSchemaProblems(contract, { variables: { xs: { list: { object: { inconnu: "number" } } } } })).toHaveLength(1);
    expect(inputSchemaProblems(contract, { variables: { xs: "number" } })).toHaveLength(1);
    expect(inputSchemaProblems(contract, { variables: {}, lookups: { periode: { value: "number" } } })).toHaveLength(1);
  });
});

describe("paramètres de mode", () => {
  it("parameterAllowed contrôle le type et l'énumération", () => {
    expect(parameterAllowed({ type: "string", allowed: ["A", "B"] }, "A")).toBe(true);
    expect(parameterAllowed({ type: "string", allowed: ["A", "B"] }, "C")).toBe(false);
    expect(parameterAllowed({ type: "string", allowed: ["A", "B"] }, 1)).toBe(false);
    expect(parameterAllowed({ type: "number" }, 12)).toBe(true);
  });
});
