import { describe, expect, it } from "vitest";
import { cleanCode, formatRegistrationNumber, patternUsesPrefix, validateRegistrationPattern } from "../../domain/registration-number";
import { planRollover, plannedClassroomCode, type RolloverContext, type RolloverSource } from "../../domain/rollover";
import { buildRuleContext } from "../../domain/rule-context";
import type { AcademicPeriod, CurriculumNode } from "../../domain/records";
import { followedNodes } from "../../domain/curriculum";

describe("numéro d'inscription (R23)", () => {
  const tokens = { prefix: "ECO", programCode: "L-INFO", gradeLevelCode: "L1", year: "2026", studentSeq: 42 };
  it("motif par défaut du supérieur : {PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}", () => {
    expect(formatRegistrationNumber("{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}", tokens)).toBe("ECO-LINFO-L1-0042");
    expect(formatRegistrationNumber("{PROGRAM}-{STUDENT_SEQ:4}", { ...tokens, programCode: "gl" })).toBe("GL-0042");
    expect(formatRegistrationNumber("{YEAR}/{LEVEL}/{STUDENT_SEQ:6}", tokens)).toBe("2026/L1/000042");
    expect(formatRegistrationNumber("N{STUDENT_SEQ:1}", { ...tokens, studentSeq: 12345 })).toBe("N12345");
  });
  it("un code vide devient XXX (comportement historique de cleanFiliereCode)", () => {
    expect(cleanCode("--")).toBe("XXX");
    expect(cleanCode("m-1_tl")).toBe("M1TL");
    expect(formatRegistrationNumber("{PROGRAM}-{STUDENT_SEQ:4}", { ...tokens, programCode: "###" })).toBe("XXX-0042");
  });
  it("le motif doit contenir {STUDENT_SEQ:n} : sans lui deux apprenants partageraient un numéro", () => {
    expect(validateRegistrationPattern("{PREFIX}-{PROGRAM}")).toContain("Le motif doit contenir {STUDENT_SEQ:n} : sans lui deux apprenants pourraient partager un numéro.");
    expect(validateRegistrationPattern("{PREFIX}-{STUDENT_SEQ:4}")).toEqual([]);
  });
  it("jetons inconnus, caractères interdits, largeur absente ou mal placée", () => {
    expect(validateRegistrationPattern("{FOO}-{STUDENT_SEQ:4}").join(" ")).toContain("Jeton inconnu");
    expect(validateRegistrationPattern("{STUDENT_SEQ}").join(" ")).toContain("largeur");
    expect(validateRegistrationPattern("{PREFIX:3}-{STUDENT_SEQ:4}").join(" ")).toContain("n'accepte pas de largeur");
    expect(validateRegistrationPattern("A B{STUDENT_SEQ:4}").join(" ")).toContain("caractères");
    expect(validateRegistrationPattern("{prefix}-{STUDENT_SEQ:4}").join(" ")).toContain("caractères");
    expect(validateRegistrationPattern("ab").join(" ")).toContain("entre 3 et 80");
  });
  it("erreurs de génération : préfixe absent, numéro d'ordre invalide, numéro trop long", () => {
    expect(() => formatRegistrationNumber("{PREFIX}-{STUDENT_SEQ:4}", { ...tokens, prefix: null })).toThrow(/préfixe/);
    expect(() => formatRegistrationNumber("{STUDENT_SEQ:4}", { ...tokens, studentSeq: -1 })).toThrow();
    expect(() => formatRegistrationNumber("{STUDENT_SEQ:9}{STUDENT_SEQ:9}{STUDENT_SEQ:9}{STUDENT_SEQ:9}{STUDENT_SEQ:9}{STUDENT_SEQ:9}{STUDENT_SEQ:9}{STUDENT_SEQ:9}{STUDENT_SEQ:9}", tokens)).toThrow(/80/);
    expect(patternUsesPrefix("{PREFIX}-x{STUDENT_SEQ:2}")).toBe(true);
    expect(patternUsesPrefix("{PROGRAM}{STUDENT_SEQ:2}")).toBe(false);
  });
});

describe("reconduction annuelle (US7) — matrice issue × niveau suivant", () => {
  const gradeLevels = new Map(
    [
      { id: "g1", code: "L1", label: "Licence 1", nextGradeLevelId: "g2", isFinal: false },
      { id: "g2", code: "L2", label: "Licence 2", nextGradeLevelId: "g3", isFinal: false },
      { id: "g3", code: "L3", label: "Licence 3", nextGradeLevelId: null, isFinal: true },
    ].map((g) => [g.id, g]),
  );
  const programs = new Map([["p1", { id: "p1", code: "INFO", label: "Informatique", gradeLevelIds: new Set(["g1", "g2", "g3"]) }], ["p2", { id: "p2", code: "GEST", label: "Gestion", gradeLevelIds: new Set(["g1", "g2"]) }]]);
  const ctx = (over: Partial<RolloverContext> = {}): RolloverContext => ({
    gradeLevels,
    programs,
    fundingRequiresReference: new Map([["STATE_ASSIGNED", true], ["PRIVATE", false], ["SCHOLARSHIP", false]]),
    targetClassrooms: [],
    programsWithPublishedCurriculum: new Set(["p1", "p2"]),
    alreadyRolledOver: new Set(),
    createMissingClassrooms: true,
    ...over,
  });
  const src = (id: string, kind: "ADVANCE" | "REPEAT" | "REDIRECT" | "EXIT" | null, over: Partial<RolloverSource> = {}): RolloverSource => ({
    enrollmentId: id,
    studentId: `s-${id}`,
    classroomId: "c1",
    programId: "p1",
    gradeLevelId: "g1",
    mode: "CLASS",
    status: "ACTIVE",
    fundingType: "PRIVATE",
    funderLabel: null,
    outcome: kind ? { code: kind, kind, targetProgramId: null, targetGradeLevelId: null } : null,
    ...over,
  });

  it("ADVANCE -> niveau suivant, REPEAT -> même niveau (redoublant), EXIT -> aucune inscription", () => {
    const plan = planRollover([src("a", "ADVANCE"), src("b", "REPEAT"), src("c", "EXIT")], ctx());
    expect(plan.enrollments.map((e) => [e.previousEnrollmentId, e.targetGradeLevelId, e.isRepeating])).toEqual([
      ["a", "g2", false],
      ["b", "g1", true],
    ]);
    expect(plan.byOutcome).toEqual({ ADVANCE: 1, REPEAT: 1, EXIT: 1 });
    expect(plan.classroomsToCreate).toHaveLength(2); // une classe par (programme, niveau) manquant
    expect(plan.anomalies).toEqual([]);
  });
  it("REDIRECT -> programme et niveau désignés par la décision ; sans cible : anomalie", () => {
    const redirect = src("r", "REDIRECT", { outcome: { code: "ORIENTED", kind: "REDIRECT", targetProgramId: "p2", targetGradeLevelId: "g2" } });
    const plan = planRollover([redirect, src("x", "REDIRECT")], ctx());
    expect(plan.enrollments).toHaveLength(1);
    expect(plan.enrollments[0]).toMatchObject({ targetProgramId: "p2", targetGradeLevelId: "g2" });
    expect(plan.anomalies.map((a) => a.code)).toEqual(["redirect_target_missing"]);
  });
  it("anomalies : issue manquante, pas de niveau suivant, programme qui ne couvre pas le niveau cible", () => {
    const plan = planRollover([src("a", null), src("b", "ADVANCE", { gradeLevelId: "g3" }), src("c", "ADVANCE", { programId: "p2", gradeLevelId: "g2" })], ctx());
    expect(plan.enrollments).toEqual([]);
    expect(plan.anomalies.map((a) => a.code)).toEqual(["outcome_missing", "next_level_missing", "next_level_missing"]);
  });
  it("programme sans curriculum publié : une seule anomalie par programme", () => {
    const plan = planRollover([src("a", "ADVANCE"), src("b", "ADVANCE")], ctx({ programsWithPublishedCurriculum: new Set() }));
    expect(plan.anomalies.filter((a) => a.code === "curriculum_missing")).toHaveLength(1);
    expect(plan.enrollments).toHaveLength(2);
  });
  it("financement exigeant une référence : NON reporté et listé ; les autres sont reportés", () => {
    const plan = planRollover([src("a", "ADVANCE", { fundingType: "STATE_ASSIGNED" }), src("b", "ADVANCE", { fundingType: "SCHOLARSHIP", funderLabel: "Fondation" })], ctx());
    expect(plan.enrollments[0]).toMatchObject({ fundingType: "PRIVATE", carriesFunding: false, funderLabel: null });
    expect(plan.enrollments[1]).toMatchObject({ fundingType: "SCHOLARSHIP", carriesFunding: true, funderLabel: "Fondation" });
    expect(plan.anomalies.filter((a) => a.code === "funding_to_reconfirm").map((a) => a.enrollmentId)).toEqual(["a"]);
  });
  it("idempotence : une inscription déjà reconduite n'est pas replanifiée", () => {
    const plan = planRollover([src("a", "ADVANCE"), src("b", "ADVANCE")], ctx({ alreadyRolledOver: new Set(["a"]) }));
    expect(plan.alreadyRolledOver).toBe(1);
    expect(plan.enrollments.map((e) => e.previousEnrollmentId)).toEqual(["b"]);
  });
  it("seules les inscriptions de classe ACTIVE/COMPLETED sont reconduites", () => {
    const plan = planRollover([src("a", "ADVANCE", { mode: "A_LA_CARTE" }), src("b", "ADVANCE", { status: "WITHDRAWN" }), src("c", "ADVANCE", { status: "COMPLETED" })], ctx());
    expect(plan.enrollments.map((e) => e.previousEnrollmentId)).toEqual(["c"]);
  });
  it("classes de destination : réutilise une classe existante avec de la place, sinon crée ; complète = anomalie", () => {
    const existing = [{ id: "t1", programId: "p1", gradeLevelId: "g2", name: "L2 A", capacity: 1, capacityIsHard: true, enrolledCount: 0 }, { id: "t2", programId: "p1", gradeLevelId: "g2", name: "L2 B", capacity: 1, capacityIsHard: true, enrolledCount: 0 }];
    const plan = planRollover([src("a", "ADVANCE"), src("b", "ADVANCE"), src("c", "ADVANCE")], ctx({ targetClassrooms: existing }));
    expect(plan.enrollments.map((e) => e.targetClassroomId)).toEqual(["t1", "t2"]);
    expect(plan.anomalies.map((a) => a.code)).toEqual(["target_classroom_full"]);
    const none = planRollover([src("a", "ADVANCE")], ctx({ createMissingClassrooms: false }));
    expect(none.anomalies.map((a) => a.code)).toEqual(["target_classroom_missing"]);
    expect(plannedClassroomCode("info", "l2")).toBe("INFO-L2");
    expect(plannedClassroomCode("--", "")).toMatch(/^[A-Z0-9]/);
  });
});

describe("faits pour le moteur de règles (D-29)", () => {
  const periods: AcademicPeriod[] = [1, 2].map((n) => ({
    id: `P${n}`,
    academicYearId: "Y",
    parentPeriodId: null,
    periodTypeCode: "SEMESTER",
    ordinal: n,
    code: `S${n}`,
    label: `S${n}`,
    startsOn: n === 1 ? "2026-09-01" : "2027-02-01",
    endsOn: n === 1 ? "2027-01-31" : "2027-08-31",
    status: "OPEN",
    openedAt: null,
    gradingClosedAt: null,
    closedAt: null,
    closedBy: null,
    reopenedCount: 0,
  }));
  const node = (id: string, over: Partial<CurriculumNode>): CurriculumNode => ({
    id,
    versionId: "V",
    parentId: null,
    nodeTypeCode: "LEVEL",
    lineageId: `l-${id}`,
    subjectId: null,
    gradeLevelId: null,
    periodTypeCode: null,
    periodOrdinal: null,
    code: id,
    label: id,
    ordinal: 0,
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
  it("niveau, rang, fin de parcours, rang et type de période, nœuds en chaînes décimales exactes — sans lire un seul nom", () => {
    const nodes = [node("L", { gradeLevelId: "g" }), node("E", { parentId: "L", nodeTypeCode: "SUBJECT", subjectId: "s", coefficient: "2.5", credits: "3", categoryCode: "FONDAMENTALE" })];
    const followed = followedNodes({
      nodes,
      nodeTypes: [
        { code: "LEVEL", allowedParentCodes: ["ROOT"], requiresGradeLevel: true, requiresPeriodSlot: false, requiresSubject: false, allowsCoefficient: false, allowsCredits: false, creditsMustEqualChildren: false, isEnrollable: false },
        { code: "SUBJECT", allowedParentCodes: ["LEVEL"], requiresGradeLevel: false, requiresPeriodSlot: false, requiresSubject: true, allowsCoefficient: true, allowsCredits: true, creditsMustEqualChildren: false, isEnrollable: true },
      ],
      mode: "CLASS",
      classGradeLevelId: "g",
      selections: [],
    });
    const ctx = buildRuleContext({
      enrollment: { id: "e", studentId: "s", institutionId: "i", academicYearId: "Y", classroomId: "c", fundingType: "PRIVATE", isRepeating: true },
      pack: "HIGHER",
      educationLevel: { code: "LICENCE", ordinal: 10 },
      gradeLevel: { code: "L2", ordinal: 2, isFinal: false, nextGradeLevelCode: "L3" },
      program: { code: "INFO", kindCode: "PROGRAM", domainCode: "SCI", parentProgramCode: null },
      period: { period: periods[1]!, allPeriodsOfYear: periods, periodTypes: [{ code: "SEMESTER", kind: "TEACHING_PERIOD" }], parentTypeCode: null, effectiveState: "OPEN" },
      nodes: followed,
    });
    expect(ctx).toMatchObject({
      pack: "HIGHER",
      educationLevel: { code: "LICENCE", ordinal: 10 },
      gradeLevel: { code: "L2", ordinal: 2, isFinal: false, nextGradeLevelCode: "L3" },
      program: { code: "INFO", domainCode: "SCI" },
      isRepeating: true,
      fundingType: "PRIVATE",
      period: { typeCode: "SEMESTER", kind: "TEACHING_PERIOD", ordinal: 2, rankInYear: 2, siblingsOfType: 2, isLastOfType: true, state: "OPEN" },
    });
    expect(ctx.nodes.find((n) => n.nodeId === "E")).toMatchObject({ coefficient: "2.5", credits: "3", categoryCode: "FONDAMENTALE" });
  });
  it("sans période : null", () => {
    const ctx = buildRuleContext({
      enrollment: { id: "e", studentId: "s", institutionId: "i", academicYearId: "Y", classroomId: "c", fundingType: "PRIVATE", isRepeating: false },
      pack: null,
      educationLevel: { code: "PRIMARY", ordinal: 2 },
      gradeLevel: { code: "CM2", ordinal: 6, isFinal: true, nextGradeLevelCode: null },
      program: { code: "PRIMAIRE", kindCode: "PROGRAM", domainCode: null, parentProgramCode: null },
      period: null,
      nodes: [],
    });
    expect(ctx.period).toBeNull();
    expect(ctx.gradeLevel.isFinal).toBe(true);
  });
});
