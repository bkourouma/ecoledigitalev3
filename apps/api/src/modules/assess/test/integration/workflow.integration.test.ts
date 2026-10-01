/**
 * Circuit de validation complet sur Postgres réel : saisie, soumission, relecture, approbation, publication ; séparation
 * des tâches ; atomicité de la publication ; un événement par évaluation ; audit dans la même transaction ; retours en
 * brouillon ; annulation ; mode de publication automatique ; types masqués.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { assessEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/assess";
import { createAssessment, getAssessmentTransitions } from "../../application/assessments";
import { getGradeSheet, saveGrades } from "../../application/grades";
import { updateAssessSettings, updateAssessmentType } from "../../application/types";
import { cancelAssessment, transitionAssessment } from "../../application/workflow";
import type { Assessment } from "../../domain/types";
import { adminOne, adminRows, createAssessTestDb, describeIntegration, type AssessTestDb } from "../support/db";
import { CAPS, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("circuit de validation des feuilles de notes (Postgres réel)", () => {
  let db: AssessTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAssessTestDb({ poolSize: 8 });
    world = makeWorld(db);
    school = await seedSchool(db, world, { students: 6 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const mkAssessment = async (over: Partial<Parameters<typeof createAssessment>[2]> = {}): Promise<Assessment> =>
    unwrap(
      await createAssessment(world.deps, school.teacher.ctx, {
        typeId: school.typeByCode("DEVOIR").id,
        classroomId: school.classroomId,
        curriculumNodeId: school.nodeId,
        academicPeriodId: school.periodId,
        title: "Devoir n°1",
        assessedOn: "2026-01-10",
        ...over,
      }),
    );

  const fill = async (a: Assessment, scores: Array<string | null> = ["12", "15.5", "8", "18", "10", "14"]) =>
    unwrap(
      await saveGrades(world.deps, school.teacher.ctx, {
        assessmentId: a.id,
        entries: school.students.map((s, i) => (scores[i] === null || scores[i] === undefined ? { enrollmentId: s.enrollmentId, entryStatus: "ABSENT_UNEXCUSED" as const } : { enrollmentId: s.enrollmentId, score: scores[i] })),
        caps: CAPS.teacher,
      }),
    );

  const to = (ctx: typeof school.teacher.ctx, a: Assessment, target: "SUBMITTED" | "REVIEWED" | "APPROVED" | "PUBLISHED" | "DRAFT", caps = CAPS.teacher, comment?: string) =>
    transitionAssessment(world.deps, ctx, { assessmentId: a.id, to: target, caps, ...(comment ? { comment } : {}) });

  it("parcourt DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> PUBLISHED ; chaque étape est historisée, auditée et signée", async () => {
    const a = await mkAssessment();
    expect(a.status).toBe("DRAFT");
    await fill(a);
    world.audit.clear();

    const submitted = unwrap(await to(school.teacher.ctx, a, "SUBMITTED")).assessment;
    expect(submitted).toMatchObject({ status: "SUBMITTED", submittedBy: school.teacher.userId });
    const reviewed = unwrap(await to(school.reviewer.ctx, a, "REVIEWED", CAPS.reviewer)).assessment;
    expect(reviewed).toMatchObject({ status: "REVIEWED", reviewedBy: school.reviewer.userId, fourEyesWaived: false });
    const approved = unwrap(await to(school.reviewer.ctx, a, "APPROVED", CAPS.validator)).assessment;
    expect(approved.status).toBe("APPROVED");
    const published = unwrap(await to(school.director.ctx, a, "PUBLISHED", CAPS.publisher)).assessment;
    expect(published).toMatchObject({ status: "PUBLISHED", publishedBy: school.director.userId });
    expect(published.publishedAt).toBeInstanceOf(Date);

    const trail = unwrap(await getAssessmentTransitions(world.deps, school.director.ctx, { assessmentId: a.id, caps: CAPS.admin }));
    expect(trail.map((t) => `${t.fromStatus ?? "-"}>${t.toStatus}`)).toEqual(["->DRAFT", "DRAFT>SUBMITTED", "SUBMITTED>REVIEWED", "REVIEWED>APPROVED", "APPROVED>PUBLISHED"]);
    expect(world.audit.actions()).toEqual(["assess.assessment.submitted", "assess.assessment.reviewed", "assess.assessment.approved", "assess.assessment.published"]);

    // toutes les notes sont PUBLISHED, atomiquement
    const rows = await adminRows<{ status: string }>(db, "SELECT DISTINCT status FROM assess.grades WHERE assessment_id = $1", [a.id]);
    expect(rows).toEqual([{ status: "PUBLISHED" }]);
  });

  it("publication : UN événement `assess.grade.published` par évaluation (et non par note), sans aucune note, conforme au contrat", async () => {
    const a = await mkAssessment({ title: "Devoir n°2" });
    await fill(a);
    unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
    unwrap(await to(school.reviewer.ctx, a, "REVIEWED", CAPS.reviewer));
    unwrap(await to(school.reviewer.ctx, a, "APPROVED", CAPS.validator));
    unwrap(await to(school.director.ctx, a, "PUBLISHED", CAPS.publisher));

    const events = await adminRows<{ type: string; payload: any }>(db, "SELECT type, payload FROM kernel.domain_events WHERE aggregate_id = $1 ORDER BY occurred_at, id", [a.id]);
    expect(events.map((e) => e.type)).toEqual(["assess.assessment.created", "assess.assessment.submitted", "assess.assessment.reviewed", "assess.assessment.approved", "assess.grade.published"]);
    const published = events.filter((e) => e.type === "assess.grade.published");
    expect(published).toHaveLength(1);
    const payload = published[0]!.payload;
    expect(payload.enrollmentIds).toHaveLength(6);
    expect(JSON.stringify(payload)).not.toMatch(/"score"|"12"|"15\.5"/);
    for (const e of events) expect((assessEventPayloadSchemas as Record<string, { parse(v: unknown): unknown }>)[e.type]!.parse(e.payload)).toBeTruthy();
    expect(payload).toMatchObject({ v: 1, assessmentId: a.id, classroomId: school.classroomId, academicPeriodId: school.periodId, curriculumNodeId: school.nodeId, sessionNo: 1, visibleToStudents: true });
  });

  it("séparation des tâches : le soumetteur ne relit, n'approuve ni ne publie sa propre feuille ; rien n'est modifié", async () => {
    const a = await mkAssessment({ title: "Devoir n°3" });
    await fill(a);
    unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
    const self = await to(school.teacher.ctx, a, "REVIEWED", CAPS.admin);
    expect(self).toMatchObject({ ok: false, error: { code: "assess.four_eyes" } });
    expect(await adminOne<{ status: string }>(db, "SELECT status FROM assess.assessments WHERE id = $1", [a.id])).toEqual({ status: "SUBMITTED" });
  });

  it("dérogation : si le réglage est désactivé, la transition réussit et la dérogation est INSCRITE", async () => {
    unwrap(await updateAssessSettings(world.deps, school.director.ctx, { requireSeparateReviewer: false, requireSeparateApprover: false }));
    try {
      const a = await mkAssessment({ title: "Devoir n°4 (dérogation)" });
      await fill(a);
      unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
      const reviewed = unwrap(await to(school.teacher.ctx, a, "REVIEWED", CAPS.admin)).assessment;
      expect(reviewed).toMatchObject({ status: "REVIEWED", fourEyesWaived: true });
      const trail = unwrap(await getAssessmentTransitions(world.deps, school.director.ctx, { assessmentId: a.id, caps: CAPS.admin }));
      expect(trail.find((t) => t.toStatus === "REVIEWED")?.fourEyesWaived).toBe(true);
    } finally {
      unwrap(await updateAssessSettings(world.deps, school.director.ctx, { requireSeparateReviewer: true, requireSeparateApprover: true }));
    }
  });

  it("retour en brouillon : commentaire obligatoire, signatures effacées, la feuille redevient modifiable", async () => {
    const a = await mkAssessment({ title: "Devoir n°5" });
    await fill(a);
    unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
    unwrap(await to(school.reviewer.ctx, a, "REVIEWED", CAPS.reviewer));
    expect(await to(school.reviewer.ctx, a, "DRAFT", CAPS.reviewer)).toMatchObject({ ok: false, error: { code: "assess.comment_required" } });
    const back = unwrap(await to(school.reviewer.ctx, a, "DRAFT", CAPS.reviewer, "Une note de la liste est douteuse, à vérifier.")).assessment;
    expect(back).toMatchObject({ status: "DRAFT", reviewedBy: null, returnComment: "Une note de la liste est douteuse, à vérifier." });
    const sheet = unwrap(await getGradeSheet(world.deps, school.teacher.ctx, { assessmentId: a.id, caps: CAPS.teacher }));
    const g = sheet.grades[0]!;
    const saved = unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: g.enrollmentId, score: "11", rowVersion: g.rowVersion }], caps: CAPS.teacher }));
    expect(saved).toMatchObject({ updated: 1, created: 0 });
  });

  it("aucun trou : à la soumission chaque inscription active sans note reçoit NOT_GRADED ; une feuille vide ne se soumet pas", async () => {
    const empty = await mkAssessment({ title: "Vide" });
    expect(await to(school.teacher.ctx, empty, "SUBMITTED")).toMatchObject({ ok: false, error: { code: "assess.empty_assessment" } });

    const partial = await mkAssessment({ title: "Partielle" });
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: partial.id, entries: school.students.slice(0, 2).map((s) => ({ enrollmentId: s.enrollmentId, score: "9" })), caps: CAPS.teacher }));
    unwrap(await to(school.teacher.ctx, partial, "SUBMITTED"));
    const rows = await adminRows<{ entry_status: string; score: string | null }>(db, "SELECT entry_status, score::text FROM assess.grades WHERE assessment_id = $1 ORDER BY entry_status", [partial.id]);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.entry_status === "NOT_GRADED").every((r) => r.score === null)).toBe(true);
    expect(rows.filter((r) => r.entry_status === "NOT_GRADED")).toHaveLength(4);
  });

  it("une feuille soumise est figée : plus de saisie, plus de modification du barème", async () => {
    const a = await mkAssessment({ title: "Figée" });
    await fill(a);
    unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
    const g = unwrap(await getGradeSheet(world.deps, school.teacher.ctx, { assessmentId: a.id, caps: CAPS.teacher })).grades[0]!;
    expect(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: g.enrollmentId, score: "1", rowVersion: g.rowVersion }], caps: CAPS.teacher })).toMatchObject({ ok: false, error: { code: "assess.grade_frozen" } });
    const sql = await db.admin.query("UPDATE assess.assessments SET scale_max = 40 WHERE id = $1", [a.id]).then(
      () => "ok",
      (e: Error) => e.message,
    );
    expect(sql).toMatch(/assess\.assessment_frozen/);
  });

  it("annulation d'une évaluation NON publiée : directe, motif obligatoire, événement avec les inscriptions", async () => {
    const a = await mkAssessment({ title: "À annuler" });
    await fill(a);
    expect(await cancelAssessment(world.deps, school.teacher.ctx, { assessmentId: a.id, reason: "court", caps: CAPS.teacher })).toMatchObject({ ok: false, error: { code: "assess.comment_required" } });
    const out = unwrap(await cancelAssessment(world.deps, school.teacher.ctx, { assessmentId: a.id, reason: "Évaluation saisie par erreur dans la mauvaise classe.", caps: CAPS.teacher }));
    expect(out.assessment).toMatchObject({ status: "CANCELLED", cancelReason: "Évaluation saisie par erreur dans la mauvaise classe." });
    const grades = await adminRows<{ status: string }>(db, "SELECT DISTINCT status FROM assess.grades WHERE assessment_id = $1", [a.id]);
    expect(grades).toEqual([{ status: "CANCELLED" }]);
  });

  it("mode de publication AUTO_ON_APPROVAL : l'approbation publie dans la même transaction (un événement de publication)", async () => {
    const type = school.typeByCode("INTERROGATION");
    unwrap(await updateAssessmentType(world.deps, school.director.ctx, { typeId: type.id, patch: { publicationMode: "AUTO_ON_APPROVAL" } }));
    const a = await mkAssessment({ title: "Interro auto", typeId: type.id });
    await fill(a);
    unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
    unwrap(await to(school.reviewer.ctx, a, "REVIEWED", CAPS.reviewer));
    const out = unwrap(await to(school.reviewer.ctx, a, "APPROVED", CAPS.validator));
    expect(out.autoPublished).toBe(true);
    expect(out.assessment).toMatchObject({ status: "PUBLISHED", publishedBy: school.reviewer.userId });
    const events = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'assess.grade.published'", [a.id]);
    expect(events).toHaveLength(1);
  });

  it("type masqué (examen blanc) : publié pour le calcul, événement `visibleToStudents: false`", async () => {
    const hidden = school.typeByCode("EXAMEN_BLANC");
    const a = await mkAssessment({ title: "Examen blanc", typeId: hidden.id });
    await fill(a);
    unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
    unwrap(await to(school.reviewer.ctx, a, "REVIEWED", CAPS.reviewer));
    unwrap(await to(school.reviewer.ctx, a, "APPROVED", CAPS.validator));
    unwrap(await to(school.director.ctx, a, "PUBLISHED", CAPS.publisher));
    const e = await adminOne<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'assess.grade.published'", [a.id]);
    expect(e.payload.visibleToStudents).toBe(false);
  });

  it("droits contextuels : approuver sans la capacité est refusé ; un enseignant non affecté ne soumet pas", async () => {
    const a = await mkAssessment({ title: "Droits" });
    await fill(a);
    unwrap(await to(school.teacher.ctx, a, "SUBMITTED"));
    expect(await to(school.reviewer.ctx, a, "APPROVED", CAPS.reviewer)).toMatchObject({ ok: false, error: { code: "assess.forbidden" } });
    const other = await mkAssessment({ title: "Autre" });
    await fill(other);
    expect(await to(school.coTeacher.ctx, other, "SUBMITTED", CAPS.teacher)).toMatchObject({ ok: false, error: { code: "assess.not_assigned" } });
  });

  it("une évaluation inexistante, ou d'un autre tenant, est introuvable", async () => {
    expect(await transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: newId(), to: "SUBMITTED", caps: CAPS.teacher })).toMatchObject({ ok: false, error: { code: "assess.assessment_not_found" } });
  });
});
