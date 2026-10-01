/**
 * IMMUABILITÉ après publication, prouvée à trois niveaux :
 *   1. l'application (cas d'usage) ;
 *   2. les déclencheurs sous le rôle applicatif `app_user` (RLS + droits) ;
 *   3. les déclencheurs sous un SUPERUSER (aucun rôle puissant ne contourne un déclencheur).
 * Puis le cycle de vie d'une GradeRevision : demande, approbation, application par `assess.apply_revision`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createAssessment } from "../../application/assessments";
import { getGradeSheet, saveGrades } from "../../application/grades";
import { applyRevision, approveRevision, getGradeHistory, rejectRevision, requestAddition, requestRevision } from "../../application/revisions";
import { cancelAssessment, transitionAssessment } from "../../application/workflow";
import { lockPeriodGrades, releaseSessionLock, unlockPeriodGrades } from "../../application/locks";
import type { Assessment, Grade } from "../../domain/types";
import { adminOne, adminRows, createAssessTestDb, describeIntegration, type AssessTestDb } from "../support/db";
import { CAPS, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("immuabilité des notes publiées et révisions (Postgres réel)", () => {
  let db: AssessTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAssessTestDb({ poolSize: 8 });
    world = makeWorld(db);
    school = await seedSchool(db, world, { students: 5, pack: "higher" });
  });
  afterAll(async () => {
    await db.drop();
  });

  /** Évaluation publiée avec 5 notes (12, 15, 8, 18, 10). */
  async function publishedSheet(title: string, extra: Partial<Parameters<typeof createAssessment>[2]> = {}): Promise<{ a: Assessment; grades: Grade[] }> {
    const a = unwrap(
      await createAssessment(world.deps, school.teacher.ctx, {
        typeId: school.typeByCode("DEVOIR").id,
        classroomId: school.classroomId,
        curriculumNodeId: school.nodeId,
        academicPeriodId: school.periodId,
        title,
        assessedOn: "2026-01-10",
        ...extra,
      }),
    );
    const scores = ["12", "15", "8", "18", "10"];
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: school.students.map((s, i) => ({ enrollmentId: s.enrollmentId, score: scores[i] })), caps: CAPS.teacher }));
    unwrap(await transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: a.id, to: "SUBMITTED", caps: CAPS.teacher }));
    unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: a.id, to: "REVIEWED", caps: CAPS.reviewer }));
    unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: a.id, to: "APPROVED", caps: CAPS.validator }));
    const published = unwrap(await transitionAssessment(world.deps, school.director.ctx, { assessmentId: a.id, to: "PUBLISHED", caps: CAPS.publisher })).assessment;
    const sheet = unwrap(await getGradeSheet(world.deps, school.director.ctx, { assessmentId: a.id, caps: CAPS.admin }));
    return { a: published, grades: sheet.grades };
  }

  const asAppUser = async <T>(fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>) => Promise<T>): Promise<T> =>
    db.tenantDb.run(school.director.ctx, async (tx) => fn((sql, params = []) => tx.query(sql, params) as never));

  it("niveau 1 — application : saisie et suppression refusées sur une feuille publiée (409, aucune écriture)", async () => {
    const { a, grades } = await publishedSheet("Applicatif");
    const g = grades[0]!;
    const r = await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: g.enrollmentId, score: "20", rowVersion: g.rowVersion }], caps: CAPS.teacher });
    expect(r).toMatchObject({ ok: false, error: { code: "assess.grade_frozen" } });
    expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("12.000");
  });

  it("niveau 2 — rôle applicatif : UPDATE et DELETE d'une note PUBLIÉE refusés par le déclencheur", async () => {
    const { grades } = await publishedSheet("Triggers app_user");
    const g = grades[0]!;
    await expect(asAppUser((q) => q("UPDATE assess.grades SET score = 20 WHERE id = $1", [g.id]))).rejects.toThrow(/assess\.grade_published/);
    await expect(asAppUser((q) => q("UPDATE assess.grades SET entry_status = 'ABSENT_UNEXCUSED', score = NULL WHERE id = $1", [g.id]))).rejects.toThrow(/assess\.grade_published/);
    await expect(asAppUser((q) => q("UPDATE assess.grades SET comment = 'retouche' WHERE id = $1", [g.id]))).rejects.toThrow(/assess\.grade_published/);
    await expect(asAppUser((q) => q("DELETE FROM assess.grades WHERE id = $1", [g.id]))).rejects.toThrow(/assess\.grade_frozen/);
    await expect(asAppUser((q) => q("INSERT INTO assess.grades (id, tenant_id, assessment_id, enrollment_id, student_id, score, entry_status) VALUES ($1,$2,$3,$4,$5,5,'ENTERED')", [newId(), school.tenantId, g.assessmentId, newId(), newId()]))).rejects.toThrow(/assess\.grade_frozen/);
    expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("12.000");
  });

  it("niveau 3 — SUPERUSER : les mêmes tentatives échouent encore (un déclencheur ne se contourne pas par un rôle puissant)", async () => {
    const { a, grades } = await publishedSheet("Triggers superuser");
    const g = grades[1]!;
    const attempt = async (sql: string, params: unknown[] = []): Promise<string> => db.admin.query(sql, params).then(() => "ok", (e: Error) => e.message);
    expect(await attempt("UPDATE assess.grades SET score = 20 WHERE id = $1", [g.id])).toMatch(/assess\.grade_published/);
    expect(await attempt("DELETE FROM assess.grades WHERE id = $1", [g.id])).toMatch(/assess\.grade_frozen/);
    expect(await attempt("UPDATE assess.assessments SET scale_max = 100 WHERE id = $1", [a.id])).toMatch(/assess\.assessment_frozen/);
    expect(await attempt("UPDATE assess.assessments SET status = 'DRAFT' WHERE id = $1", [a.id])).toMatch(/assess\.invalid_transition/);
    expect(await attempt("DELETE FROM assess.assessments WHERE id = $1", [a.id])).toMatch(/assess\.immutable/);
    expect(await attempt("UPDATE assess.grades SET status = 'DRAFT' WHERE id = $1", [g.id])).toMatch(/assess\.status_mirror/);
    // une note ENTERED hors barème ne s'écrit nulle part
    expect(await attempt("UPDATE assess.grades SET score = 21 WHERE id = $1", [g.id])).toMatch(/assess\.score_out_of_scale/);
    expect((await adminOne<{ score: string; status: string }>(db, "SELECT score::text, status FROM assess.grades WHERE id = $1", [g.id]))).toEqual({ score: "15.000", status: "PUBLISHED" });
  });

  it("un réglage de transaction forgé ne suffit pas : sans révision APPROUVÉE correspondante, la note ne bouge pas", async () => {
    const { grades } = await publishedSheet("Réglage forgé");
    const g = grades[2]!;
    const sql = async (revisionId: string | null): Promise<string> => {
      const c = await db.admin.query("BEGIN");
      void c;
      try {
        if (revisionId) await db.admin.query("SELECT set_config('app.grade_revision_id', $1, true)", [revisionId]);
        await db.admin.query("UPDATE assess.grades SET score = 19 WHERE id = $1", [g.id]);
        await db.admin.query("COMMIT");
        return "ok";
      } catch (e) {
        await db.admin.query("ROLLBACK");
        return (e as Error).message;
      }
    };
    expect(await sql(null)).toMatch(/assess\.grade_published/);
    expect(await sql(newId())).toMatch(/assess\.grade_published/);
    // une révision qui existe mais n'est pas approuvée ne suffit pas non plus
    const r = unwrap(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "19", reason: "Erreur de report sur la copie.", caps: CAPS.reviser }));
    expect(await sql(r.id)).toMatch(/assess\.grade_published/);
    expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("8.000");
  });

  it("révision : ancienne et nouvelle valeur, motif, demandeur, approbateur, dates ; appliquée par apply_revision ; note mise à jour, historique complet", async () => {
    const { a, grades } = await publishedSheet("Révision nominale");
    const g = grades[0]!;
    world.clock.advance(60_000);
    const req = unwrap(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "14", reason: "Erreur de report : la copie porte 14, pas 12.", caps: CAPS.reviser }));
    expect(req).toMatchObject({ kind: "CORRECTION", status: "REQUESTED", oldScore: "12.000", oldEntryStatus: "ENTERED", newScore: "14.000", newEntryStatus: "ENTERED", requestedBy: school.teacher.userId });
    expect(req.requestedByName).toMatch(/^Agent /);
    // tant qu'elle n'est pas approuvée, la note ne change pas
    expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("12.000");
    // le demandeur n'approuve pas sa propre correction
    expect(await approveRevision(world.deps, school.teacher.ctx, { revisionId: req.id, caps: CAPS.approver })).toMatchObject({ ok: false, error: { code: "assess.four_eyes" } });

    world.clock.advance(60_000);
    world.audit.clear();
    const approved = unwrap(await approveRevision(world.deps, school.director.ctx, { revisionId: req.id, comment: "Copie vérifiée.", caps: CAPS.approver }));
    expect(approved.applied).toBe(true);
    expect(approved.revisions[0]).toMatchObject({ status: "APPLIED", decidedBy: school.director.userId, decisionComment: "Copie vérifiée.", fourEyesWaived: false });
    expect(approved.revisions[0]!.appliedAt).toBeInstanceOf(Date);
    expect((await adminOne<{ score: string; row_version: number }>(db, "SELECT score::text, row_version FROM assess.grades WHERE id = $1", [g.id]))).toMatchObject({ score: "14.000", row_version: 2 });
    expect(world.audit.actions()).toEqual(["assess.revision.approved", "assess.revision.applied"]);

    const events = await adminRows<{ type: string; payload: any }>(db, "SELECT type, payload FROM kernel.domain_events WHERE type = 'assess.grade.revised' AND aggregate_id = $1", [req.id]);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ v: 1, assessmentId: a.id, gradeId: g.id, enrollmentId: g.enrollmentId, kind: "CORRECTION", revisionId: req.id });

    const history = unwrap(await getGradeHistory(world.deps, school.director.ctx, { gradeId: g.id, caps: CAPS.admin }));
    expect(history.revisions).toHaveLength(1);
    expect(history.trail.map((t) => t.toStatus)).toEqual(["DRAFT", "SUBMITTED", "REVIEWED", "APPROVED", "PUBLISHED"]);
    expect(history.grade.correctedAt).toBeInstanceOf(Date);

    // la même note ne peut plus être corrigée sans valeur différente
    expect(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "14", reason: "Encore la même valeur.", caps: CAPS.reviser })).toMatchObject({ ok: false, error: { code: "assess.revision_noop" } });
  });

  it("une révision appliquée ou approuvée est immuable ; apply_revision refuse une révision non approuvée ; la voie directe est fermée", async () => {
    const { grades } = await publishedSheet("Révision immuable");
    const g = grades[3]!;
    const req = unwrap(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newEntryStatus: "ABSENT_EXCUSED", reason: "L'élève était absent, note saisie à tort.", caps: CAPS.reviser }));
    const attempt = async (sql: string, params: unknown[] = []): Promise<string> => db.admin.query(sql, params).then(() => "ok", (e: Error) => e.message);
    expect(await attempt("SELECT assess.apply_revision($1::uuid)", [req.id])).toMatch(/assess\.revision_not_approved/);
    expect(await attempt("UPDATE assess.grade_revisions SET new_score = 1 WHERE id = $1", [req.id])).toMatch(/assess\.revision_immutable/);
    expect(await attempt("UPDATE assess.grade_revisions SET status = 'APPLIED', applied_at = now() WHERE id = $1", [req.id])).toMatch(/assess\.revision_transition/);
    expect(await attempt("DELETE FROM assess.grade_revisions WHERE id = $1", [req.id])).toMatch(/assess\.immutable/);
    // approuvée par un tiers, mais « appliquée » à la main sans avoir changé la note : refusé
    await db.admin.query("UPDATE assess.grade_revisions SET status='APPROVED', decided_by=$2, decided_by_name='x', decided_at=now() WHERE id=$1", [req.id, school.director.userId]);
    expect(await attempt("UPDATE assess.grade_revisions SET status = 'APPLIED', applied_at = now() WHERE id = $1", [req.id])).toMatch(/assess\.revision_apply_only/);
    expect(await attempt("SELECT assess.apply_revision($1::uuid)", [req.id])).toBe("ok");
    expect((await adminOne<{ entry_status: string; score: string | null }>(db, "SELECT entry_status, score::text FROM assess.grades WHERE id = $1", [g.id]))).toEqual({ entry_status: "ABSENT_EXCUSED", score: null });
    expect(await attempt("SELECT assess.apply_revision($1::uuid)", [req.id])).toMatch(/assess\.revision_not_approved/);
  });

  it("l'ancienne valeur d'une révision est relue en base : impossible de mentir", async () => {
    const { a, grades } = await publishedSheet("Ancienne valeur");
    const g = grades[4]!;
    const id = newId();
    await db.admin.query(
      `INSERT INTO assess.grade_revisions (id, tenant_id, assessment_id, grade_id, enrollment_id, kind, old_score, old_entry_status, new_score, new_entry_status, reason, requested_by, requested_by_name)
       VALUES ($1,$2,$3,$4,$5,'CORRECTION',999,'ENTERED',11,'ENTERED','Motif suffisamment long pour passer.',$6,'Moi')`,
      [id, school.tenantId, a.id, g.id, g.enrollmentId, school.teacher.userId],
    );
    expect((await adminOne<{ old_score: string }>(db, "SELECT old_score::text FROM assess.grade_revisions WHERE id = $1", [id])).old_score).toBe("10.000");
  });

  it("rejet d'une révision : motif obligatoire, la note ne change pas, événement émis", async () => {
    const { grades } = await publishedSheet("Rejet");
    const g = grades[1]!;
    const req = unwrap(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "20", reason: "Je souhaite augmenter cette note.", caps: CAPS.reviser }));
    expect(await rejectRevision(world.deps, school.director.ctx, { revisionId: req.id, comment: "no", caps: CAPS.approver })).toMatchObject({ ok: false, error: { code: "assess.comment_required" } });
    const rejected = unwrap(await rejectRevision(world.deps, school.director.ctx, { revisionId: req.id, comment: "Aucune pièce justificative.", caps: CAPS.approver }));
    expect(rejected[0]).toMatchObject({ status: "REJECTED", decisionComment: "Aucune pièce justificative." });
    expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("15.000");
    expect(await approveRevision(world.deps, school.director.ctx, { revisionId: req.id, caps: CAPS.approver })).toMatchObject({ ok: false, error: { code: "assess.revision_transition" } });
    // une nouvelle demande est possible après le rejet
    unwrap(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "16", reason: "Nouvelle demande avec la copie jointe.", caps: CAPS.reviser }));
  });

  it("une seule demande en cours par note ; une feuille non publiée ne se corrige pas par révision", async () => {
    const { grades } = await publishedSheet("Doublon");
    const g = grades[0]!;
    unwrap(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "13", reason: "Première demande de correction.", caps: CAPS.reviser }));
    expect(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "16", reason: "Seconde demande concurrente.", caps: CAPS.reviser })).toMatchObject({ ok: false, error: { code: "assess.revision_pending" } });

    const draft = unwrap(
      await createAssessment(world.deps, school.teacher.ctx, { typeId: school.typeByCode("DEVOIR").id, classroomId: school.classroomId, curriculumNodeId: school.nodeId, academicPeriodId: school.periodId, title: "Brouillon", assessedOn: "2026-01-11" }),
    );
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: draft.id, entries: [{ enrollmentId: school.students[0]!.enrollmentId, score: "5" }], caps: CAPS.teacher }));
    const dg = unwrap(await getGradeSheet(world.deps, school.teacher.ctx, { assessmentId: draft.id, caps: CAPS.teacher })).grades[0]!;
    expect(await requestRevision(world.deps, school.teacher.ctx, { gradeId: dg.id, newScore: "6", reason: "Brouillon à corriger directement.", caps: CAPS.reviser })).toMatchObject({ ok: false, error: { code: "assess.revision_not_applicable" } });
  });

  it("ADDITION : un élève absent de la feuille à la publication est ajouté par une révision approuvée (et pas autrement)", async () => {
    const late = { enrollmentId: newId(), studentId: newId() };
    const a = unwrap(
      await createAssessment(world.deps, school.teacher.ctx, { typeId: school.typeByCode("DEVOIR").id, classroomId: school.classroomId, curriculumNodeId: school.nodeId, academicPeriodId: school.periodId, title: "Addition", assessedOn: "2026-01-12" }),
    );
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: school.students.map((s) => ({ enrollmentId: s.enrollmentId, score: "10" })), caps: CAPS.teacher }));
    unwrap(await transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: a.id, to: "SUBMITTED", caps: CAPS.teacher }));
    unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: a.id, to: "REVIEWED", caps: CAPS.reviewer }));
    unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: a.id, to: "APPROVED", caps: CAPS.validator }));
    unwrap(await transitionAssessment(world.deps, school.director.ctx, { assessmentId: a.id, to: "PUBLISHED", caps: CAPS.publisher }));
    // l'élève s'est inscrit après la publication
    world.ports.roster.enrollments.push({ enrollmentId: late.enrollmentId, studentId: late.studentId, classroomId: school.classroomId, active: true });

    const attempt = await db.admin.query("INSERT INTO assess.grades (id, tenant_id, assessment_id, enrollment_id, student_id, score, entry_status) VALUES ($1,$2,$3,$4,$5,9,'ENTERED')", [newId(), school.tenantId, a.id, late.enrollmentId, late.studentId]).then(() => "ok", (e: Error) => e.message);
    expect(attempt).toMatch(/assess\.grade_frozen/);

    const req = unwrap(await requestAddition(world.deps, school.teacher.ctx, { assessmentId: a.id, enrollmentId: late.enrollmentId, newScore: "9", reason: "Élève inscrit après la publication de la feuille.", caps: CAPS.reviser }));
    expect(req).toMatchObject({ kind: "ADDITION", gradeId: null, oldScore: null, newScore: "9.000" });
    const out = unwrap(await approveRevision(world.deps, school.director.ctx, { revisionId: req.id, caps: CAPS.approver }));
    expect(out.revisions[0]).toMatchObject({ status: "APPLIED" });
    const row = await adminOne<{ status: string; score: string }>(db, "SELECT status, score::text FROM assess.grades WHERE assessment_id = $1 AND enrollment_id = $2", [a.id, late.enrollmentId]);
    expect(row).toEqual({ status: "PUBLISHED", score: "9.000" });
    expect(out.revisions[0]!.gradeId).not.toBeNull();
    // une inscription étrangère à la classe est refusée
    expect(await requestAddition(world.deps, school.teacher.ctx, { assessmentId: a.id, enrollmentId: newId(), newScore: "9", reason: "Inscription qui n'existe pas du tout.", caps: CAPS.reviser })).toMatchObject({ ok: false, error: { code: "assess.unknown_enrollment" } });
  });

  it("annulation d'une évaluation PUBLIÉE : lot de REMOVAL approuvé en UNE décision, puis feuille annulée ; la voie directe est fermée", async () => {
    const { a, grades } = await publishedSheet("À annuler après publication");
    const direct = await db.admin.query("UPDATE assess.assessments SET status='CANCELLED', cancelled_at=now(), cancelled_by=$2, cancel_reason='x' WHERE id=$1", [a.id, school.director.userId]).then(() => "ok", (e: Error) => e.message);
    expect(direct).toMatch(/assess\.published_immutable/);

    const asked = unwrap(await cancelAssessment(world.deps, school.teacher.ctx, { assessmentId: a.id, reason: "Évaluation rattachée à la mauvaise classe.", caps: CAPS.reviser }));
    expect(asked.assessment).toBeNull();
    expect(asked.revisions).toHaveLength(grades.length);
    expect(new Set(asked.revisions.map((r) => r.batchId)).size).toBe(1);
    expect(asked.revisions.every((r) => r.kind === "REMOVAL" && r.status === "REQUESTED")).toBe(true);

    const decided = unwrap(await approveRevision(world.deps, school.director.ctx, { revisionId: asked.revisions[0]!.id, caps: CAPS.approver }));
    expect(decided.revisions).toHaveLength(grades.length);
    expect(decided.applied).toBe(true);
    expect(decided.cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Évaluation rattachée à la mauvaise classe." });
    expect(await adminRows(db, "SELECT DISTINCT status FROM assess.grades WHERE assessment_id = $1", [a.id])).toEqual([{ status: "CANCELLED" }]);
    const ev = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'assess.assessment.cancelled'", [a.id]);
    expect(ev).toHaveLength(1);
  });

  describe("verrou de période et sessions", () => {
    it("un verrou {1,2} interdit saisie, transition, création et application d'une révision ; la libération de la session 2 ne rouvre QUE la session 2", async () => {
      const mk = async (title: string, sessionNo: 1 | 2) =>
        unwrap(
          await createAssessment(world.deps, school.teacher.ctx, {
            typeId: school.typeByCode("EXAMEN").id,
            classroomId: school.classroomId,
            curriculumNodeId: school.nodeId,
            academicPeriodId: school.periodId,
            title,
            assessedOn: "2026-01-20",
            sessionNo,
          }),
        );
      const s1 = await mk("Examen S1", 1);
      const s2 = await mk("Examen S2 (brouillon)", 2);
      for (const a of [s1, s2]) {
        unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: school.students[0]!.enrollmentId, score: "9" }], caps: CAPS.teacher }));
      }
      for (const to of ["SUBMITTED"] as const) unwrap(await transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: s1.id, to, caps: CAPS.teacher }));
      unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: s1.id, to: "REVIEWED", caps: CAPS.reviewer }));
      unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: s1.id, to: "APPROVED", caps: CAPS.validator }));
      unwrap(await transitionAssessment(world.deps, school.director.ctx, { assessmentId: s1.id, to: "PUBLISHED", caps: CAPS.publisher }));

      // verrouiller sans forcer : la session 2 en brouillon bloque
      const refused = await lockPeriodGrades(world.deps, school.director.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId });
      expect(refused).toMatchObject({ ok: false, error: { code: "assess.period_locked" } });
      expect((refused as any).error.details.pending.length).toBeGreaterThan(0);

      // le brouillon S2 est annulé ; la direction verrouille tout
      unwrap(await cancelAssessment(world.deps, school.teacher.ctx, { assessmentId: s2.id, reason: "Pas de rattrapage pour cette période.", caps: CAPS.teacher }));
      const pending = await adminRows<{ id: string }>(db, "SELECT id FROM assess.assessments WHERE classroom_id = $1 AND academic_period_id = $2 AND status NOT IN ('PUBLISHED','CANCELLED')", [school.classroomId, school.periodId]);
      const force = pending.length > 0;
      const locked = unwrap(await lockPeriodGrades(world.deps, school.director.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, force, reason: "Clôture du semestre." }));
      expect(locked.lock.lockedSessions).toEqual([1, 2]);
      expect(unwrap(await lockPeriodGrades(world.deps, school.director.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, force })).alreadyLocked).toBe(true);

      const g = unwrap(await getGradeSheet(world.deps, school.director.ctx, { assessmentId: s1.id, caps: CAPS.admin })).grades[0]!;
      // 1. une révision approuvée n'est pas appliquée tant que la session est verrouillée
      const req = unwrap(await requestRevision(world.deps, school.teacher.ctx, { gradeId: g.id, newScore: "10", reason: "La copie vaut finalement 10 sur 20.", caps: CAPS.reviser }));
      const held = unwrap(await approveRevision(world.deps, school.director.ctx, { revisionId: req.id, caps: CAPS.approver }));
      expect(held.applied).toBe(false);
      expect(held.revisions[0]!.status).toBe("APPROVED");
      expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("9.000");
      expect(await applyRevision(world.deps, school.director.ctx, { revisionId: req.id, caps: CAPS.approver })).toMatchObject({ ok: false, error: { code: "assess.period_locked" } });
      // 2. SQL direct refusé aussi (superuser)
      expect(await db.admin.query("SELECT assess.apply_revision($1::uuid)", [req.id]).then(() => "ok", (e: Error) => e.message)).toMatch(/assess\.period_locked/);
      // 3. nouvelle évaluation refusée
      expect(await createAssessment(world.deps, school.teacher.ctx, { typeId: school.typeByCode("DEVOIR").id, classroomId: school.classroomId, curriculumNodeId: school.nodeId, academicPeriodId: school.periodId, title: "Trop tard", assessedOn: "2026-02-01" })).toMatchObject({ ok: false });

      // Fenêtre de rattrapage : seule la session 2 est libérée
      const resit = unwrap(await releaseSessionLock(world.deps, school.director.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, reason: "Ouverture de la fenêtre de rattrapage." }));
      expect(resit.lock?.lockedSessions).toEqual([1]);
      expect(resit.applied).toBe(0); // la session 1 reste verrouillée : la révision S1 attend toujours
      expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("9.000");
      const s2bis = await mk("Examen de rattrapage", 2);
      expect(s2bis.sessionNo).toBe(2);
      expect(await createAssessment(world.deps, school.teacher.ctx, { typeId: school.typeByCode("DEVOIR").id, classroomId: school.classroomId, curriculumNodeId: school.nodeId, academicPeriodId: school.periodId, title: "S1 refusée", assessedOn: "2026-02-01", sessionNo: 1 })).toMatchObject({ ok: false, error: { code: "assess.period_locked" } });
      unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: s2bis.id, entries: [{ enrollmentId: school.students[0]!.enrollmentId, score: "13" }], caps: CAPS.teacher }));
      // le verrou ne peut pas s'élargir directement
      expect(await db.admin.query("UPDATE assess.period_locks SET locked_sessions = '{1,2}' WHERE id = $1", [locked.lock.id]).then(() => "ok", (e: Error) => e.message)).toMatch(/assess\.lock_cannot_widen/);

      // Réouverture (correction) : tout est libéré, la révision approuvée s'applique
      const reopened = unwrap(await unlockPeriodGrades(world.deps, school.director.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId, reason: "Réouverture pour correction." }));
      expect(reopened.lock).toBeNull();
      expect(reopened.applied).toBe(1);
      expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [g.id])).score).toBe("10.000");
      const events = await adminRows<{ type: string; payload: any }>(db, "SELECT type, payload FROM kernel.domain_events WHERE type LIKE 'assess.period.%' ORDER BY occurred_at, id");
      expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["assess.period.locked", "assess.period.unlocked"]));
      // un verrou relâché est définitif
      expect(await db.admin.query("UPDATE assess.period_locks SET released_at = NULL WHERE id = $1", [locked.lock.id]).then(() => "ok", (e: Error) => e.message)).toMatch(/assess\.lock_released/);
    });
  });
});

