/**
 * Faits publiés pour results (011) et higher (019) — migration 0706 — sur Postgres réel : structure de calcul d'une classe ×
 * période, contrat de calcul (programme > cycle d'enseignement), attributs de nœud amendables, cycles et UE par lignée,
 * inscriptions de classe et de cycle, placements d'un apprenant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import {
  amendPublishedCurriculum,
  enrollStudent,
  getClassroomFacts,
  getCycleFacts,
  getLastEnrollmentInProgram,
  getResultsStructure,
  getUeFacts,
  hasAttendedUe,
  listClassroomEnrollments,
  listCurriculumAmendments,
  listCycleEnrollments,
  listProgramUe,
  listReference,
  listStudentPlacements,
  listUeRegistrants,
  putReference,
  transitionEnrollment,
  updateAcademicSettings,
  updateProgram,
} from "../../index";
import { adminOne, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { addStudent, codeOf, makeWorld, seedHigher, type HigherSeed, type World } from "../support/world";

describeIntegration("faits publiés pour results et higher (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  async function seeded(): Promise<{ w: World; s: HigherSeed }> {
    const w = makeWorld(db, await db.createTenant());
    const s = await seedHigher(w);
    unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "AUTO" }));
    return { w, s };
  }

  it("structure d'une classe × période : crédits, coefficients, parents, rang, contrat du cycle d'enseignement (modèle de pack)", async () => {
    const { w, s } = await seeded();
    const first = unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! }));
    expect(first).toMatchObject({
      classroomId: s.classroomId,
      academicYearId: s.yearId,
      programId: s.programId,
      educationLevelCode: "LICENCE",
      gradeLevelCode: "L1",
      calculationContract: "credit-semester@1",
      terminalExamRequired: false,
      firstPeriodId: null,
    });
    expect(first.period).toMatchObject({ id: s.periodIds[0], rankInYear: 1, countInYear: 2, isLast: false });
    expect(first.yearPeriods.map((p) => p.id)).toEqual(s.periodIds);
    expect(first.nodes.map((n) => [n.code, n.kind, n.parentId === null ? null : first.nodes.find((x) => x.id === n.parentId)?.code, n.credits, n.coefficient])).toEqual([
      ["UE1", "UE", null, "6", null],
      ["E11", "ECUE", "UE1", "3", "2"],
      ["E12", "ECUE", "UE1", "3", "1.5"],
      ["UE2", "UE", null, "6", null],
      ["E21", "ECUE", "UE2", "4", "2"],
      ["E22", "ECUE", "UE2", "2", "1"],
    ]);
    // valeurs par défaut des faits de calcul
    for (const n of first.nodes) expect(n).toMatchObject({ gradingMode: "COMPOSED", resitAllowed: false, countsInAverage: true, sectionKey: null });

    // 2e semestre : dernier de l'année, connaît le premier ; les nœuds du semestre 1 ne s'y appliquent pas
    const second = unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[1]! }));
    expect(second.period).toMatchObject({ rankInYear: 2, isLast: true });
    expect(second.firstPeriodId).toBe(s.periodIds[0]);
    expect(second.nodes).toEqual([]);

    expect(codeOf(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: w.ctx.tenantId }))).toBe("academic.period_not_found");
  });

  it("faits de nœud amendables sur un curriculum publié (journalisés) ; contrat du programme prioritaire ; drapeau d'examen terminal", async () => {
    const { w, s } = await seeded();
    const e11 = s.ue1.ecueIds[0]!;
    const amended = unwrap(
      await amendPublishedCurriculum(w.deps, w.ctx, s.versionId, {
        reason: "Matière à note directe avec rattrapage",
        operations: [{ op: "UPDATE_NODE", nodeId: e11, patch: { gradingMode: "DIRECT", resitAllowed: true, countsInAverage: false, sectionKey: "SCI" } }],
      }),
    );
    expect(amended.amendments).toBe(1);
    const journal = unwrap(await listCurriculumAmendments(w.deps, w.ctx, s.versionId));
    expect(journal[0]).toMatchObject({ kind: "OTHER", nodeId: e11 });
    expect(journal[0]?.newValue).toMatchObject({ gradingMode: "DIRECT", resitAllowed: true, countsInAverage: false, sectionKey: "SCI" });

    let st = unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! }));
    expect(st.nodes.find((n) => n.id === e11)).toMatchObject({ gradingMode: "DIRECT", resitAllowed: true, countsInAverage: false, sectionKey: "SCI" });

    // le contrat du programme l'emporte sur celui du cycle d'enseignement ; `null` rend la main au cycle d'enseignement
    unwrap(await updateProgram(w.deps, w.ctx, s.programId, { calculationContract: "coef-semester@1" }));
    st = unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! }));
    expect(st.calculationContract).toBe("coef-semester@1");
    unwrap(await updateProgram(w.deps, w.ctx, s.programId, { calculationContract: null }));
    expect(unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! })).calculationContract).toBe("credit-semester@1");

    // cycle d'enseignement sans contrat ET programme sans contrat : aucune valeur devinée
    unwrap(await putReference(w.deps, w.ctx, "education-levels", [{ code: "LICENCE", label: "Licence", ordinal: 10, calculationContract: null }]));
    expect(unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! })).calculationContract).toBeNull();
    // un PUT qui ne mentionne pas le contrat ne l'efface pas
    unwrap(await putReference(w.deps, w.ctx, "education-levels", [{ code: "LICENCE", label: "Licence", ordinal: 10, calculationContract: "credit-semester@1" }]));
    unwrap(await putReference(w.deps, w.ctx, "education-levels", [{ code: "LICENCE", label: "Licence (renommée)", ordinal: 10 }]));
    expect(unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! })).calculationContract).toBe("credit-semester@1");

    // examen terminal : donnée du niveau
    unwrap(await putReference(w.deps, w.ctx, "grade-levels", [{ code: "L1", label: "Licence 1", educationLevelCode: "LICENCE", ordinal: 1, terminalExamRequired: true }]));
    expect(unwrap(await getResultsStructure(w.deps, w.ctx, { classroomId: s.classroomId, periodId: s.periodIds[0]! })).terminalExamRequired).toBe(true);
    const grades = unwrap(await listReference(w.deps, w.ctx, "grade-levels"));
    expect(grades.find((g) => g.code === "L1")?.terminalExamRequired).toBe(true);
    // un PUT qui ne mentionne pas le drapeau ne le réinitialise pas
    unwrap(await putReference(w.deps, w.ctx, "grade-levels", [{ code: "L1", label: "Licence 1", educationLevelCode: "LICENCE", ordinal: 1 }]));
    expect(unwrap(await listReference(w.deps, w.ctx, "grade-levels")).find((g) => g.code === "L1")?.terminalExamRequired).toBe(true);
  });

  it("contraintes SQL : mode de saisie et contrat de calcul invalides refusés par la base", async () => {
    const { w, s } = await seeded();
    await expect(db.admin.query("UPDATE academic.curriculum_nodes SET grading_mode = 'AUTO' WHERE id = $1", [s.ue1.id])).rejects.toThrow(/grading_mode/);
    await expect(db.admin.query("UPDATE academic.programs SET calculation_contract = 'Credit Semester' WHERE id = $1", [s.programId])).rejects.toThrow(/calculation_contract/);
    const row = await adminOne<{ is_cycle: boolean }>(db, "SELECT is_cycle FROM academic.programs WHERE id = $1", [s.programId]);
    expect(row.is_cycle).toBe(false);
    expect(w.tenantId).toBeTruthy();
  });

  it("cycle, UE par lignée, inscriptions du cycle, dernière inscription, inscrits et suivi d'UE", async () => {
    const { w, s } = await seeded();
    expect(unwrap(await getCycleFacts(w.deps, w.ctx, s.programId))).toMatchObject({ programId: s.programId, code: "INFO", isCycle: false });
    unwrap(await updateProgram(w.deps, w.ctx, s.programId, { isCycle: true }));
    expect(unwrap(await getCycleFacts(w.deps, w.ctx, s.programId)).isCycle).toBe(true);

    const ue = unwrap(await listProgramUe(w.deps, w.ctx, s.programId));
    expect(ue.map((u) => [u.code, u.credits, u.lineageId, u.programId])).toEqual([
      ["UE1", "6", s.ue1.lineageId, s.programId],
      ["UE2", "6", s.ue2.lineageId, s.programId],
    ]);
    expect(unwrap(await getUeFacts(w.deps, w.ctx, s.ue1.lineageId))).toMatchObject({ code: "UE1", nodeId: s.ue1.id });
    expect(unwrap(await getUeFacts(w.deps, w.ctx, w.ctx.tenantId))).toBeNull();

    const st = addStudent(w);
    const other = addStudent(w);
    const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
    expect(e.status).toBe("ACTIVE");

    const inClass = unwrap(await listClassroomEnrollments(w.deps, w.ctx, s.classroomId));
    expect(inClass).toEqual([expect.objectContaining({ enrollmentId: e.id, studentId: st.studentId, classroomId: s.classroomId, status: "ACTIVE", active: true })]);

    expect(unwrap(await listCycleEnrollments(w.deps, w.ctx, s.programId)).map((x) => x.enrollmentId)).toEqual([e.id]);
    expect(unwrap(await getLastEnrollmentInProgram(w.deps, w.ctx, { studentId: st.studentId, programId: s.programId }))).toMatchObject({ enrollmentId: e.id, academicYearId: s.yearId, classroomId: s.classroomId });
    expect(unwrap(await getLastEnrollmentInProgram(w.deps, w.ctx, { studentId: other.studentId, programId: s.programId }))).toBeNull();

    // l'UE est suivie par les inscrits de la classe du niveau de l'UE (mode classe)
    expect(unwrap(await listUeRegistrants(w.deps, w.ctx, s.ue1.lineageId))).toEqual([st.studentId]);
    expect(unwrap(await hasAttendedUe(w.deps, w.ctx, { studentId: st.studentId, lineageId: s.ue1.lineageId }))).toBe(true);
    expect(unwrap(await hasAttendedUe(w.deps, w.ctx, { studentId: other.studentId, lineageId: s.ue1.lineageId }))).toBe(false);

    // un retrait sort l'inscription du suivi actuel, mais l'inscription reste attachée à la classe (non active)
    unwrap(await transitionEnrollment(w.deps, w.ctx, e.id, "withdraw", "Départ de l'établissement"));
    expect(unwrap(await listUeRegistrants(w.deps, w.ctx, s.ue1.lineageId))).toEqual([]);
    expect(unwrap(await hasAttendedUe(w.deps, w.ctx, { studentId: st.studentId, lineageId: s.ue1.lineageId }))).toBe(false);
    expect(unwrap(await listClassroomEnrollments(w.deps, w.ctx, s.classroomId))[0]).toMatchObject({ status: "WITHDRAWN", active: false });
  });

  it("faits de classe et placements de l'apprenant", async () => {
    const { w, s } = await seeded();
    const st = addStudent(w);
    unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
    const facts = unwrap(await getClassroomFacts(w.deps, w.ctx, s.classroomId));
    expect(facts).toMatchObject({ classroomId: s.classroomId, educationLevelCode: "LICENCE", gradeLevelCode: "L1", kind: "CLASS", headcount: 1, programId: s.programId });
    expect(facts.academicYearStartsOn < facts.academicYearEndsOn).toBe(true);
    expect(unwrap(await listStudentPlacements(w.deps, w.ctx, st.studentId))).toEqual({ classroomIds: [s.classroomId], offeringIds: [] });
    expect(unwrap(await listStudentPlacements(w.deps, w.ctx, addStudent(w).studentId))).toEqual({ classroomIds: [], offeringIds: [] });
  });
});
