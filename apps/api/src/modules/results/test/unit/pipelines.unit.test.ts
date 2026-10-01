/**
 * Pipelines de `results` testés SANS base ni moteur : un évaluateur SCRIPTÉ enregistre les appels de règles. On vérifie ce que
 * `results` ORCHESTRE — contexte typé envoyé à chaque règle, ordre déterministe, absence d'identité d'élève, isolement des échecs,
 * injection des surcharges, erreurs de structure — jamais une formule (le faux évaluateur n'en contient aucune qui compte).
 */
import { describe, expect, it } from "vitest";
import { computeCoefSemester } from "../../domain/pipeline/coef";
import { computeCreditSemester, validateCreditStructure } from "../../domain/pipeline/credit";
import { StructureError, type BatchEvaluator, type CallResult, type RuleCall } from "../../domain/pipeline/runner";
import type { ApprovedOverride, ClassStructure, EnrollmentRef, GradeFact, PeriodFacts, RuleValue, StructureNode } from "../../domain/types";

// ---------------------------------------------------------------------------------------------------------------------
// Faux évaluateur : réponses scriptées par clé de règle, appels enregistrés
// ---------------------------------------------------------------------------------------------------------------------

type Respond = (vars: any, call: RuleCall) => RuleValue | { fail: string };

function scripted(overrides: Record<string, Respond> = {}) {
  const calls: RuleCall[] = [];
  const base: Record<string, Respond> = {
    note_sur_20: (v) => v.note,
    moyenne_devoirs: (v) => (v.devoirs.length === 0 ? null : v.devoirs[0].note),
    note_examen_retenue: (v) => v.note_s2 ?? v.note_s1,
    session_examen_retenue: (v) => (v.note_s2 === null ? "1" : "2"),
    note_ecue: (v) => (v.note_examen === null ? null : "12"),
    note_ecue_directe: (v) => v.note_examen,
    ecue_eliminee: () => false,
    ecue_validee: (v) => v.note !== null || v.validation_manuelle === true,
    moyenne_ue: (v) => (v.ecues.every((e: any) => e.note === null) ? null : "12"),
    ue_validee: (v) => v.moyenne !== null,
    credits_ue: () => "8",
    etat_ue: (v) => (v.validee ? "VALIDATED" : v.session2_tentee ? "DEBT" : "RESIT"),
    session_validation_ue: (v) => (v.validee ? "1" : null),
    statut_ecue: () => "VALIDATED",
    eligible_rattrapage: () => false,
    moyenne_session: (v) => (v.ues.every((u: any) => u.moyenne === null) ? null : "12"),
    credits_valides: () => "8",
    credits_total: () => "8",
    semestre_valide: () => true,
    decision_semestre: () => "ADMITTED",
    mention_releve: () => "GOOD",
    appreciation_generale: () => "WORK_GOOD",
    distinction_semestre: () => "NONE",
    arrondi_affichage: (v) => v.valeur,
    rang: (v) => String(1 + v.cohorte.filter((x: string) => Number(x) > Number(v.moyenne)).length),
    moyenne_matiere: (v) => v.notes[0].note,
    moyenne_ponderee: (v) => (v.matieres.every((m: any) => m.score === null) ? null : "12"),
    moyenne_section: (v) => (v.matieres.every((m: any) => m.score === null) ? null : "12"),
    mention: () => "GOOD",
    decision_conseil: () => "PERIOD_VALIDATED",
    moyenne_annuelle: (v) => v.s2,
    decision_fin_annee: () => "PROMOTED",
    distinction: () => "NONE",
    appreciation_conseil: () => "WORK_GOOD",
    ...overrides,
  };
  const evaluator: BatchEvaluator = {
    run(batch) {
      return batch.map((c): CallResult => {
        calls.push(c);
        const fn = base[c.ruleKey];
        if (!fn) return { ok: false, code: "rules.unknown", message: `règle non scriptée ${c.ruleKey}` };
        const out = fn(c.variables, c);
        if (out !== null && typeof out === "object") return { ok: false, code: "rules.evaluation_failed", message: (out as { fail: string }).fail };
        return { ok: true, value: out as RuleValue, inputsHash: `i:${c.ruleKey}`, outputsHash: `o:${c.ruleKey}:${String(out)}`, nodesEvaluated: 1 };
      });
    },
  };
  return { evaluator, calls, of: (key: string) => calls.filter((c) => c.ruleKey === key) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Monde
// ---------------------------------------------------------------------------------------------------------------------

const period = (over: Partial<PeriodFacts> = {}): PeriodFacts => ({ id: "p1", rankInYear: 1, countInYear: 2, isSecondSemester: false, startsOn: "2025-09-15", endsOn: "2026-02-15", ...over });

const node = (over: Partial<StructureNode> & Pick<StructureNode, "id" | "kind" | "code">): StructureNode => ({
  parentId: null,
  label: over.code,
  ordinal: 0,
  credits: null,
  coefficient: null,
  gradingMode: "COMPOSED",
  resitAllowed: true,
  countsInAverage: true,
  sectionKey: null,
  category: null,
  ...over,
});

function creditStructure(over: Partial<ClassStructure> = {}): ClassStructure {
  return {
    classroomId: "c1",
    academicYearId: "y1",
    contractId: "credit-semester@1",
    period: period(),
    firstPeriodId: null,
    terminalExamRequired: false,
    yearPeriods: [period()],
    nodes: [
      node({ id: "ue1", kind: "UE", code: "UE1", ordinal: 0, category: "fondamentale" }),
      node({ id: "e1a", kind: "ECUE", code: "E1A", parentId: "ue1", ordinal: 1, credits: "5.00" }),
      node({ id: "e1b", kind: "ECUE", code: "E1B", parentId: "ue1", ordinal: 2, credits: "3.00" }),
      node({ id: "ue2", kind: "UE", code: "UE2", ordinal: 3 }),
      node({ id: "cond", kind: "ECUE", code: "COND", parentId: "ue2", ordinal: 4, credits: "2.00", gradingMode: "DIRECT", resitAllowed: false }),
    ],
    ...over,
  };
}

const A: EnrollmentRef = { enrollmentId: "enr-a", studentId: "stu-a" };
const B: EnrollmentRef = { enrollmentId: "enr-b", studentId: "stu-b" };

let seq = 0;
const g = (enrollment: EnrollmentRef, nodeId: string, score: string | null, over: Partial<GradeFact> = {}): GradeFact => ({
  gradeId: `g${++seq}`,
  assessmentId: `a${String(seq).padStart(4, "0")}`,
  enrollmentId: enrollment.enrollmentId,
  curriculumNodeId: nodeId,
  sessionNo: 1,
  assessedOn: "2025-11-10",
  aggregationGroup: "CONTINUOUS",
  scaleMax: "20.000",
  weight: "1.000",
  score,
  entryStatus: score === null ? "ABSENT_UNEXCUSED" : "ENTERED",
  ...over,
});

const input = (structure: ClassStructure, grades: GradeFact[], extra: { overrides?: ApprovedOverride[]; enrollments?: EnrollmentRef[]; withTrace?: boolean } = {}) => ({
  structure,
  enrollments: extra.enrollments ?? [A],
  grades,
  overrides: extra.overrides ?? [],
  withTrace: extra.withTrace ?? false,
});

// ---------------------------------------------------------------------------------------------------------------------

describe("pipeline à crédits — contexte typé envoyé aux règles", () => {
  it("les devoirs sont les notes de session 1 hors groupe d'examen, triées par date puis identifiant ; l'examen est la dernière note du groupe EXAM de chaque session", () => {
    const s = scripted();
    computeCreditSemester(
      input(creditStructure(), [
        g(A, "e1a", "9", { assessedOn: "2025-12-01", assessmentId: "a-late" }),
        g(A, "e1a", "14", { assessedOn: "2025-10-01", assessmentId: "a-early", scaleMax: "10.000" }),
        g(A, "e1a", "11", { assessedOn: "2025-10-01", assessmentId: "a-early-2" }),
        g(A, "e1a", "15", { aggregationGroup: "EXAM", assessedOn: "2026-01-10", assessmentId: "x1" }),
        g(A, "e1a", "16", { aggregationGroup: "EXAM", assessedOn: "2026-01-20", assessmentId: "x2" }),
        g(A, "e1a", "8", { aggregationGroup: "EXAM", sessionNo: 2, assessedOn: "2026-02-10", assessmentId: "r1" }),
      ]),
      s.evaluator,
    );
    const dev = s.of("moyenne_devoirs").find((c) => (c.variables.devoirs as unknown[]).length === 3);
    expect(dev?.variables.devoirs).toEqual([
      { note: "14", bareme: "10.000", poids: "1.000" },
      { note: "11", bareme: "20.000", poids: "1.000" },
      { note: "9", bareme: "20.000", poids: "1.000" },
    ]);
    // examen de session 1 = la DERNIÈRE note (16), session 2 distincte ; chacune ramenée sur 20 par la RÈGLE
    expect(s.of("note_sur_20").map((c) => c.variables)).toEqual(expect.arrayContaining([{ note: "16", bareme: "20.000" }, { note: "8", bareme: "20.000" }]));
    expect(s.of("note_examen_retenue").find((c) => c.variables.note_s1 === "16")?.variables).toEqual({ note_s1: "16", note_s2: "8" });
  });

  it("une absence (score nul) n'est JAMAIS un zéro : aucune note n'est envoyée aux règles", () => {
    const s = scripted();
    computeCreditSemester(input(creditStructure(), [g(A, "e1a", null), g(A, "e1a", null, { aggregationGroup: "EXAM" }), g(A, "e1b", "12"), g(A, "e1b", "13", { entryStatus: "EXEMPT", score: null })]), s.evaluator);
    expect(s.of("note_sur_20")).toHaveLength(0);
    for (const c of s.of("moyenne_devoirs")) expect((c.variables.devoirs as Array<{ note: string }>).map((d) => d.note)).not.toContain("0");
    const e1a = s.of("note_ecue").find((c) => c.variables.moyenne_devoirs === null);
    expect(e1a?.variables.note_examen).toBeNull();
  });

  it("aucune identité d'élève ni d'inscription dans AUCUN contexte de règle", () => {
    const s = scripted();
    computeCreditSemester(input(creditStructure(), [g(A, "e1a", "12"), g(A, "e1a", "14", { aggregationGroup: "EXAM" }), g(B, "e1a", "10")], { enrollments: [A, B] }), s.evaluator);
    const text = JSON.stringify(s.calls);
    for (const forbidden of ["enr-a", "enr-b", "stu-a", "stu-b", "enrollmentId", "studentId"]) expect(text).not.toContain(forbidden);
  });

  it("une ECUE à saisie directe (conduite) passe par `note_ecue_directe`, sans devoirs ; elle n'est pas rattrapable", () => {
    const s = scripted({ ue_validee: () => false });
    const out = computeCreditSemester(input(creditStructure(), [g(A, "cond", "17", { aggregationGroup: "EXAM" })]), s.evaluator);
    expect(s.of("note_ecue_directe")).toHaveLength(1);
    expect(s.of("note_ecue_directe")[0]?.variables).toEqual({ note_examen: "17" });
    expect(s.of("moyenne_devoirs")).toHaveLength(2); // les deux ECUE composées seulement, pas la conduite
    // UE sans rattrapage possible : non validée ⇒ « dette » (session 2 réputée tentée), jamais « à repasser »
    expect(s.of("etat_ue").map((c) => c.variables)).toEqual([{ validee: false, session2_tentee: true }]);
    expect(out.enrollments[0]?.lines.find((l) => l.curriculumNodeId === "cond")?.value).toBe("17");
  });

  it("les étapes respectent l'ordre du contrat ; le rang est évalué APRÈS le calcul de toute la cohorte, sur les seules valeurs non nulles", () => {
    const s = scripted();
    computeCreditSemester(
      input(creditStructure(), [g(A, "e1a", "12"), g(A, "e1a", "14", { aggregationGroup: "EXAM" }), g(A, "cond", "15", { aggregationGroup: "EXAM" }), g(B, "e1a", "5"), g(B, "cond", "9", { aggregationGroup: "EXAM" })], { enrollments: [A, B] }),
      s.evaluator,
    );
    const order = [...new Set(s.calls.map((c) => c.ruleKey))];
    const idx = (k: string) => order.indexOf(k);
    for (const [before, after] of [["note_sur_20", "note_examen_retenue"], ["note_examen_retenue", "note_ecue"], ["note_ecue", "moyenne_ue"], ["moyenne_ue", "ue_validee"], ["ue_validee", "etat_ue"], ["etat_ue", "moyenne_session"], ["moyenne_session", "decision_semestre"], ["decision_semestre", "rang"]] as const) {
      expect(idx(before), `${before} avant ${after}`).toBeLessThan(idx(after));
    }
    const rangs = s.of("rang");
    expect(rangs.length).toBeGreaterThan(0);
    for (const r of rangs) expect((r.variables.cohorte as unknown[]).every((v) => v !== null)).toBe(true);
  });

  it("les appels d'une étape portent sur TOUTE la classe en un seul lot par étape (pas une passe par élève)", () => {
    let batches = 0;
    const s = scripted();
    const counting: BatchEvaluator = { run: (c) => (batches++, s.evaluator.run(c)) };
    computeCreditSemester(input(creditStructure(), [g(A, "e1a", "12"), g(B, "e1a", "12")], { enrollments: [A, B] }), counting);
    const oneStudent = (() => {
      let n = 0;
      const sc = scripted();
      computeCreditSemester(input(creditStructure(), [g(A, "e1a", "12")]), { run: (c) => (n++, sc.evaluator.run(c)) });
      return n;
    })();
    expect(batches).toBe(oneStudent);
  });

  it("mêmes entrées ⇒ même `inputsHash` (ordre des notes et identité sans effet) ; une note de plus ⇒ empreinte différente", () => {
    const notes = [g(A, "e1a", "12", { assessmentId: "a1" }), g(A, "e1a", "14", { aggregationGroup: "EXAM", assessmentId: "a2" })];
    const h = (ns: GradeFact[], who: EnrollmentRef = A) => computeCreditSemester(input(creditStructure(), ns.map((n) => ({ ...n, enrollmentId: who.enrollmentId })), { enrollments: [who] }), scripted().evaluator).enrollments[0]!.inputsHash;
    expect(h(notes)).toBe(h([...notes].reverse()));
    expect(h(notes)).toBe(h(notes, { enrollmentId: "autre", studentId: "autre" }));
    expect(h(notes)).not.toBe(h([...notes, g(A, "e1b", "9", { assessmentId: "a3" })]));
  });
});

describe("pipeline à crédits — isolement des échecs et structure", () => {
  it("une inscription dont une règle échoue est en ERREUR (règle, code, nœud) ; les autres sont calculées et le rang les ignore", () => {
    const s = scripted({ note_ecue: (v) => (v.moyenne_devoirs === "BAD" ? { fail: "division par zéro" } : v.note_examen === null ? null : "12") });
    const out = computeCreditSemester(
      input(creditStructure(), [g(A, "e1a", "BAD"), g(A, "e1a", "14", { aggregationGroup: "EXAM" }), g(B, "e1a", "12"), g(B, "e1a", "13", { aggregationGroup: "EXAM" })], { enrollments: [A, B] }),
      s.evaluator,
    );
    const [a, b] = out.enrollments;
    expect(a?.error).toMatchObject({ ruleKey: "note_ecue", code: "rules.evaluation_failed", nodeId: "e1a" });
    expect(a?.header).toBeNull();
    expect(a?.outputsHash).toBeNull();
    expect(a?.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b?.error).toBeNull();
    expect(b?.header?.cohortSize).toBe(1);
    for (const r of s.of("rang")) expect(r.variables.cohorte).toHaveLength(1);
  });

  it("structure incomplète : ECUE sans crédits, UE sans ECUE, aucune UE ⇒ StructureError listant les codes (jamais `credits || 0`)", () => {
    const noCredits = creditStructure({ nodes: [node({ id: "u", kind: "UE", code: "U" }), node({ id: "e", kind: "ECUE", code: "E", parentId: "u", credits: null })] });
    expect(() => validateCreditStructure(noCredits)).toThrow(StructureError);
    try {
      validateCreditStructure(noCredits);
    } catch (e) {
      expect((e as StructureError).details).toMatchObject({ ecuesWithoutCredits: ["E"], uesWithoutEcue: [], noUe: false });
    }
    expect(() => validateCreditStructure(creditStructure({ nodes: [node({ id: "u", kind: "UE", code: "U" })] }))).toThrow(/Curriculum incomplet/);
    expect(() => validateCreditStructure(creditStructure({ nodes: [] }))).toThrow(StructureError);
    expect(() => computeCreditSemester(input(noCredits, []), scripted().evaluator)).toThrow(StructureError);
  });

  it("le résultat en ERREUR n'émet aucune ligne ; la décision n'est évaluée que si la moyenne existe", () => {
    const s = scripted();
    const out = computeCreditSemester(input(creditStructure(), []), s.evaluator);
    expect(out.enrollments[0]?.header).toMatchObject({ average: null, decisionCode: null, decisionOutcome: "PENDING", validated: null });
    expect(s.of("decision_semestre")).toHaveLength(0);
    expect(s.of("rang")).toHaveLength(0);
  });

  it("une UE sans AUCUN résultat est « en attente » : ni état LMD, ni décision de semestre (jamais « ajourné » faute de note)", () => {
    const s = scripted();
    const out = computeCreditSemester(input(creditStructure(), [g(A, "e1a", "12"), g(A, "e1a", "13", { aggregationGroup: "EXAM" })]), s.evaluator);
    const h = out.enrollments[0]!.header!;
    expect(h.decisionCode).toBeNull();
    expect(h.validated).toBeNull();
    expect(h.summary).toMatchObject({ pending: true, uesWithoutResult: 1 });
    expect(out.enrollments[0]!.lines.find((l) => l.curriculumNodeId === "ue2")?.statusCode).toBeNull();
    expect(s.of("decision_semestre")).toHaveLength(0);
  });
});

describe("pipeline à crédits — surcharges", () => {
  const ovr = (over: Partial<ApprovedOverride> & Pick<ApprovedOverride, "ruleKey" | "kind" | "level">): ApprovedOverride => ({
    id: "o1",
    enrollmentId: A.enrollmentId,
    curriculumNodeId: null,
    value: null,
    flag: null,
    originalValue: null,
    ...over,
  });

  it("surcharge de VALEUR sur `moyenne_ue` : la valeur imposée alimente les étapes en aval, la trace garde la valeur d'origine", () => {
    const s = scripted();
    const out = computeCreditSemester(
      input(creditStructure(), [g(A, "e1a", "12"), g(A, "e1a", "14", { aggregationGroup: "EXAM" })], { withTrace: true, overrides: [ovr({ ruleKey: "moyenne_ue", kind: "VALUE", level: "UE", curriculumNodeId: "ue1", value: "15.5" })] }),
      s.evaluator,
    );
    expect(s.of("ue_validee").find((c) => (c.variables.ecues as unknown[]).length === 2)?.variables.moyenne).toBe("15.5");
    const line = out.enrollments[0]!.lines.find((l) => l.curriculumNodeId === "ue1")!;
    expect(line).toMatchObject({ value: "15.5", overridden: true, overrideId: "o1" });
    expect(line.trace?.find((t) => t.overridden)).toMatchObject({ ruleKey: "moyenne_ue", overridden: { overrideId: "o1", original: "12" } });
  });

  it("validation manuelle (jury) sur `ecue_validee` ⇒ entrée `validation_manuelle: true` des règles d'élimination et de validation", () => {
    const s = scripted();
    const out = computeCreditSemester(
      input(creditStructure(), [g(A, "e1a", "3"), g(A, "e1a", "3", { aggregationGroup: "EXAM" })], { overrides: [ovr({ ruleKey: "ecue_validee", kind: "VALIDATION", level: "ECUE", curriculumNodeId: "e1a", flag: true })] }),
      s.evaluator,
    );
    for (const key of ["ecue_eliminee", "ecue_validee"]) expect(s.of(key).some((c) => c.variables.validation_manuelle === true), key).toBe(true);
    expect(s.of("moyenne_ue").find((c) => (c.variables.ecues as unknown[]).length === 2)?.variables.ecues).toEqual(expect.arrayContaining([expect.objectContaining({ validation_manuelle: true })]));
    const line = out.enrollments[0]!.lines.find((l) => l.curriculumNodeId === "e1a")!;
    expect(line).toMatchObject({ overridden: true, sessionObtained: 2 });
    expect((line.outputs as Record<string, unknown>).validation_manuelle).toBe(true);
  });

  it("une surcharge d'une AUTRE inscription n'a aucun effet", () => {
    const s = scripted();
    computeCreditSemester(input(creditStructure(), [g(A, "e1a", "12")], { overrides: [ovr({ ruleKey: "moyenne_ue", kind: "VALUE", level: "UE", curriculumNodeId: "ue1", value: "20", enrollmentId: "enr-z" })] }), s.evaluator);
    expect(s.of("ue_validee").every((c) => c.variables.moyenne !== "20")).toBe(true);
  });

  it("une surcharge change `inputsHash` (reproductibilité : les entrées incluent les surcharges approuvées)", () => {
    const notes = [g(A, "e1a", "12"), g(A, "e1a", "14", { aggregationGroup: "EXAM" })];
    const without = computeCreditSemester(input(creditStructure(), notes), scripted().evaluator).enrollments[0]!.inputsHash;
    const withOverride = computeCreditSemester(input(creditStructure(), notes, { overrides: [ovr({ ruleKey: "moyenne_ue", kind: "VALUE", level: "UE", curriculumNodeId: "ue1", value: "15" })] }), scripted().evaluator).enrollments[0]!.inputsHash;
    expect(withOverride).not.toBe(without);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

function coefStructure(over: Partial<ClassStructure> = {}): ClassStructure {
  return {
    classroomId: "c1",
    academicYearId: "y1",
    contractId: "coef-semester@1",
    period: period({ isSecondSemester: false }),
    firstPeriodId: null,
    terminalExamRequired: false,
    yearPeriods: [period()],
    nodes: [
      node({ id: "math", kind: "SUBJECT", code: "MAT", ordinal: 0, coefficient: "3", sectionKey: "SCI" }),
      node({ id: "fra", kind: "SUBJECT", code: "FRA", ordinal: 1, coefficient: "2", sectionKey: "LET" }),
      node({ id: "eps", kind: "SUBJECT", code: "EPS", ordinal: 2, coefficient: null, sectionKey: "LET", countsInAverage: false }),
    ],
    ...over,
  };
}

describe("pipeline à coefficients", () => {
  const run = (structure: ClassStructure, grades: GradeFact[], extra: { first?: Map<string, string | null>; enrollments?: EnrollmentRef[] } = {}, s = scripted()) => ({
    s,
    out: computeCoefSemester({ structure, enrollments: extra.enrollments ?? [A], grades, overrides: [], firstSemesterAverages: extra.first ?? new Map(), withTrace: false }, s.evaluator),
  });

  it("la moyenne de matière ne reçoit que des notes de session 1 ; une matière sans note n'est PAS évaluée (jamais 0) ; coefficients en chaînes", () => {
    const { s } = run(coefStructure(), [g(A, "math", "10"), g(A, "math", "16"), g(A, "math", "7", { sessionNo: 2 }), g(A, "fra", null)]);
    expect(s.of("moyenne_matiere")).toHaveLength(1);
    expect(s.of("moyenne_matiere")[0]?.variables.notes).toEqual([
      { note: "10", bareme: "20.000", poids: "1.000", type: "CONTINUOUS" },
      { note: "16", bareme: "20.000", poids: "1.000", type: "CONTINUOUS" },
    ]);
    const ponderee = s.of("moyenne_ponderee")[0]?.variables.matieres as Array<{ score: string | null; coef: string }>;
    expect(ponderee).toEqual([{ score: "10", coef: "3" }, { score: null, coef: "2" }]);
  });

  it("une matière hors moyenne (`countsInAverage: false`) n'exige pas de coefficient et n'entre pas dans la moyenne", () => {
    const { s, out } = run(coefStructure(), [g(A, "math", "10")]);
    expect(out.enrollments[0]?.error).toBeNull();
    expect((s.of("moyenne_ponderee")[0]?.variables.matieres as unknown[]).length).toBe(2);
  });

  it("coefficient absent sur une matière comptée ⇒ StructureError (jamais `coef || 1`)", () => {
    const bad = coefStructure({ nodes: [node({ id: "m", kind: "SUBJECT", code: "M", coefficient: null })] });
    expect(() => run(bad, [])).toThrow(StructureError);
    expect(() => run(coefStructure({ nodes: [] }), [])).toThrow(/Curriculum incomplet/);
  });

  it("1ᵉʳ semestre : ni moyenne annuelle, ni décision de fin d'année ; 2ᵉ semestre : `moyenne_annuelle` reçoit (S1, S2, drapeau), l'examen terminal vient de la donnée", () => {
    const first = run(coefStructure(), [g(A, "math", "12")]);
    expect(first.s.of("moyenne_annuelle")).toHaveLength(0);
    expect(first.s.of("decision_fin_annee")).toHaveLength(0);
    expect(first.out.enrollments[0]?.lines.some((l) => l.level === "YEAR")).toBe(false);

    const second = run(coefStructure({ period: period({ id: "p2", rankInYear: 2, isSecondSemester: true }), terminalExamRequired: true }), [g(A, "math", "14")], { first: new Map([[A.enrollmentId, "10"]]) });
    expect(second.s.of("moyenne_annuelle")[0]?.variables).toEqual({ s1: "10", s2: "12", second_semestre: true });
    expect(second.s.of("decision_fin_annee")[0]?.variables).toEqual({ moyenne: "12", second_semestre: true, examen_terminal_requis: true });
    expect(second.out.enrollments[0]?.lines.find((l) => l.level === "YEAR")).toMatchObject({ value: "12", statusCode: "PROMOTED" });
  });

  it("rangs de matière, de section et global sur les valeurs non nulles de la classe ; ex æquo laissés à la règle", () => {
    const { s, out } = run(coefStructure(), [g(A, "math", "10"), g(B, "math", "10"), g(A, "fra", "12")], { enrollments: [A, B] });
    const cohortes = s.of("rang").map((c) => (c.variables.cohorte as string[]).length);
    expect(Math.max(...cohortes)).toBe(2);
    const matA = out.enrollments[0]!.lines.find((l) => l.level === "SUBJECT" && l.curriculumNodeId === "math")!;
    expect(matA).toMatchObject({ rank: 1, cohortSize: 2 });
    const fraB = out.enrollments[1]!.lines.find((l) => l.level === "SUBJECT" && l.curriculumNodeId === "fra")!;
    expect(fraB.rank).toBeNull();
  });
});
