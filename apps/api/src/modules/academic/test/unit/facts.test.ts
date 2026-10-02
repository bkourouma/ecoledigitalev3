/** Dérivations PURES des faits publiés pour results / higher (migration 0706) : rang des périodes, nœuds de structure, contrat. */
import { describe, expect, it } from "vitest";
import { effectiveContract, periodFactsOf, structureNodesOf } from "../../domain/facts";
import type { AcademicPeriod, CurriculumNode, PeriodType } from "../../domain/records";

const types = new Map<string, PeriodType>([
  ["SEMESTER", { id: "t1", code: "SEMESTER", label: "Semestre", kind: "TEACHING_PERIOD", active: true }],
  ["TRIMESTER", { id: "t2", code: "TRIMESTER", label: "Trimestre", kind: "TEACHING_PERIOD", active: true }],
  ["MAKEUP_SESSION", { id: "t3", code: "MAKEUP_SESSION", label: "Rattrapage", kind: "EXAM_SESSION", active: true }],
]);

const period = (id: string, typeCode: string, ordinal: number, startsOn: string, endsOn: string, parentPeriodId: string | null = null): AcademicPeriod => ({
  id,
  academicYearId: "Y",
  parentPeriodId,
  periodTypeCode: typeCode,
  ordinal,
  code: `${typeCode}${ordinal}`,
  label: `${typeCode} ${ordinal}`,
  startsOn,
  endsOn,
  status: "OPEN",
  openedAt: null,
  gradingClosedAt: null,
  closedAt: null,
  closedBy: null,
  reopenedCount: 0,
});

describe("faits de période (rang sans lecture du libellé)", () => {
  const s1 = period("p1", "SEMESTER", 1, "2026-09-01", "2027-01-31");
  const s2 = period("p2", "SEMESTER", 2, "2027-02-01", "2027-07-31");
  const makeup = period("p3", "MAKEUP_SESSION", 1, "2027-08-01", "2027-08-31");

  it("deux semestres : le second est « dernier » et connaît le premier ; la session de rattrapage n'entre pas dans le rang", () => {
    const f = periodFactsOf([makeup, s2, s1], "p2", types);
    expect(f?.period).toMatchObject({ id: "p2", rankInYear: 2, countInYear: 2, isLast: true });
    expect(f?.yearPeriods.map((p) => p.id)).toEqual(["p1", "p2"]);
    const first = periodFactsOf([s1, s2], "p1", types);
    expect(first?.period).toMatchObject({ rankInYear: 1, isLast: false });
  });

  it("une année à une seule période n'a pas de « second semestre »", () => {
    expect(periodFactsOf([s1], "p1", types)?.period).toMatchObject({ rankInYear: 1, countInYear: 1, isLast: false });
  });

  it("trois trimestres : le troisième est le dernier", () => {
    const t = [period("a", "TRIMESTER", 1, "2026-09-01", "2026-12-15"), period("b", "TRIMESTER", 2, "2027-01-05", "2027-03-31"), period("c", "TRIMESTER", 3, "2027-04-05", "2027-06-30")];
    expect(periodFactsOf(t, "c", types)?.period).toMatchObject({ rankInYear: 3, countInYear: 3, isLast: true });
    expect(periodFactsOf(t, "b", types)?.period.isLast).toBe(false);
  });

  it("période d'examen : décrite sans devenir « dernière » ; période inconnue : null", () => {
    expect(periodFactsOf([s1, s2, makeup], "p3", types)?.period).toMatchObject({ id: "p3", isLast: false });
    expect(periodFactsOf([s1], "zzz", types)).toBeNull();
  });
});

describe("contrat de calcul effectif", () => {
  it("celui du programme prime ; sinon celui du cycle d'enseignement ; jamais de valeur par défaut", () => {
    expect(effectiveContract({ calculationContract: "coef-semester@1" }, { calculationContract: "credit-semester@1" })).toBe("coef-semester@1");
    expect(effectiveContract({ calculationContract: null }, { calculationContract: "credit-semester@1" })).toBe("credit-semester@1");
    expect(effectiveContract({ calculationContract: null }, { calculationContract: null })).toBeNull();
    expect(effectiveContract({ calculationContract: null }, null)).toBeNull();
  });
});

describe("nœuds de structure de calcul", () => {
  let seq = 0;
  const node = (over: Partial<CurriculumNode> & Pick<CurriculumNode, "id" | "code" | "nodeTypeCode">): CurriculumNode => ({
    versionId: "V",
    parentId: null,
    lineageId: `l-${over.id}`,
    subjectId: null,
    gradeLevelId: null,
    periodTypeCode: null,
    periodOrdinal: null,
    label: over.code,
    ordinal: (seq += 1),
    coefficient: null,
    credits: null,
    isMandatory: true,
    isTransversal: false,
    categoryCode: null,
    gradingMode: "COMPOSED",
    resitAllowed: false,
    countsInAverage: true,
    sectionKey: null,
    hoursTotal: null,
    hoursLecture: null,
    hoursTutorial: null,
    hoursPractical: null,
    attributes: {},
    status: "ACTIVE",
    prerequisiteLineageIds: [],
    ...over,
  });

  it("ne retient que UE / ECUE / SUBJECT, rattache chaque nœud à son plus proche ancêtre retenu et ordonne en profondeur", () => {
    const level = node({ id: "L", code: "L1", nodeTypeCode: "LEVEL" });
    const period = node({ id: "P", code: "S1", nodeTypeCode: "PERIOD", parentId: "L" });
    const ue2 = node({ id: "U2", code: "UE2", nodeTypeCode: "UE", parentId: "P", credits: "4", ordinal: 20 });
    const ue1 = node({ id: "U1", code: "UE1", nodeTypeCode: "UE", parentId: "P", credits: "6", ordinal: 10 });
    const e11 = node({ id: "E11", code: "E11", nodeTypeCode: "ECUE", parentId: "U1", credits: "3", coefficient: "2", resitAllowed: true, sectionKey: "SCI" });
    const e21 = node({ id: "E21", code: "E21", nodeTypeCode: "ECUE", parentId: "U2", credits: "4", gradingMode: "DIRECT", countsInAverage: false, isTransversal: true });
    const out = structureNodesOf([level, period, ue2, e21, ue1, e11]);
    expect(out.map((n) => [n.code, n.parentId, n.position])).toEqual([
      ["UE1", null, 0],
      ["E11", "U1", 1],
      ["UE2", null, 2],
      ["E21", "U2", 3],
    ]);
    expect(out[1]).toMatchObject({ kind: "ECUE", credits: "3", coefficient: "2", resitAllowed: true, sectionKey: "SCI", gradingMode: "COMPOSED", countsInAverage: true });
    expect(out[3]).toMatchObject({ gradingMode: "DIRECT", countsInAverage: false, isTransversal: true });
  });

  it("matières d'un groupe (primaire / secondaire) : sans parent retenu", () => {
    const level = node({ id: "L", code: "6E", nodeTypeCode: "LEVEL" });
    const group = node({ id: "G", code: "LIT", nodeTypeCode: "GROUP", parentId: "L" });
    const math = node({ id: "M", code: "MATH", nodeTypeCode: "SUBJECT", parentId: "G", coefficient: "4" });
    const out = structureNodesOf([level, group, math]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: "MATH", kind: "SUBJECT", parentId: null, coefficient: "4", lineageId: "l-M" });
  });
});
