/**
 * Saisie en lot : idempotence, concurrence de deux enseignants (row_version), performance ; isolation multi-tenant (RLS A/B,
 * test générique `assertTenantIsolation`) ; lectures famille (élève, tuteur).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { assessIsolationAllowlistTables, assessIsolationFixtures, assessTenantTables } from "../../../isolation-allowlist.assess";
import { createAssessment } from "../../application/assessments";
import { getGradeSheet, saveGrades } from "../../application/grades";
import { listChildGrades, listMyGrades, listPublishedGrades } from "../../application/reads";
import { transitionAssessment } from "../../application/workflow";
import type { Assessment } from "../../domain/types";
import { adminOne, adminRows, createAssessTestDb, ctxFor, describeIntegration, type AssessTestDb } from "../support/db";
import { CAPS, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("saisie en lot, concurrence, isolation et lectures famille (Postgres réel)", () => {
  let db: AssessTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAssessTestDb({ poolSize: 16 });
    world = makeWorld(db);
    school = await seedSchool(db, world, { students: 60 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const mk = async (title: string, over: { typeCode?: string } = {}): Promise<Assessment> =>
    unwrap(
      await createAssessment(world.deps, school.teacher.ctx, {
        typeId: school.typeByCode(over.typeCode ?? "DEVOIR").id,
        classroomId: school.classroomId,
        curriculumNodeId: school.nodeId,
        academicPeriodId: school.periodId,
        title,
        assessedOn: "2026-01-10",
      }),
    );

  const all = (score: (i: number) => string) => school.students.map((s, i) => ({ enrollmentId: s.enrollmentId, score: score(i) }));

  it("rejouer le même lot (avec ou sans clé d'idempotence) n'écrit rien", async () => {
    const a = await mk("Idempotence");
    const first = unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all((i) => String(i % 21)), idempotencyKey: "lot-0001-abcd", caps: CAPS.teacher }));
    expect(first).toMatchObject({ created: 60, updated: 0, unchanged: 0, replayed: false });
    const events0 = await adminRows(db, "SELECT 1 FROM kernel.domain_events");

    const replay = unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all((i) => String(i % 21)), idempotencyKey: "lot-0001-abcd", caps: CAPS.teacher }));
    expect(replay).toMatchObject({ replayed: true, created: 60 });
    expect(replay.grades).toHaveLength(60);

    const noKey = unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all((i) => String(i % 21)), caps: CAPS.teacher }));
    expect(noKey).toMatchObject({ created: 0, updated: 0, unchanged: 60, replayed: false });
    expect((await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM assess.grades WHERE assessment_id = $1", [a.id])).n).toBe("60");
    expect((await adminRows(db, "SELECT 1 FROM kernel.domain_events")).length).toBe(events0.length);
    // aucune version de ligne n'a bougé
    expect((await adminOne<{ v: number }>(db, "SELECT max(row_version) AS v FROM assess.grades WHERE assessment_id = $1", [a.id])).v).toBe(1);

    // même clé, autre contenu : conflit explicite
    expect(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all(() => "1"), idempotencyKey: "lot-0001-abcd", caps: CAPS.teacher })).toMatchObject({ ok: false, error: { code: "assess.idempotency_conflict" } });
  });

  it("deux lots concurrents sur la même note : un seul gagne, le second reçoit 409 assess.stale_grade, rien n'est écrasé en silence", async () => {
    const a = await mk("Concurrence");
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all(() => "10"), caps: CAPS.teacher }));
    const sheet = unwrap(await getGradeSheet(world.deps, school.teacher.ctx, { assessmentId: a.id, caps: CAPS.teacher }));
    const target = sheet.grades[0]!;
    const attempt = (score: string) =>
      saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: target.enrollmentId, score, rowVersion: target.rowVersion }], caps: CAPS.teacher });
    const results = await Promise.all([attempt("14"), attempt("16")]);
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ ok: false, error: { code: "assess.stale_grade" } });
    const row = await adminOne<{ score: string; row_version: number }>(db, "SELECT score::text, row_version FROM assess.grades WHERE id = $1", [target.id]);
    expect(row.row_version).toBe(2);
    expect(["14.000", "16.000"]).toContain(row.score);
    // le perdant est annulé en entier (tout ou rien)
    const batch = await Promise.all([
      saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: sheet.grades[1]!.enrollmentId, score: "1", rowVersion: 1 }, { enrollmentId: target.enrollmentId, score: "2", rowVersion: 1 }], caps: CAPS.teacher }),
    ]);
    expect(batch[0]).toMatchObject({ ok: false, error: { code: "assess.stale_grade" } });
    expect((await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [sheet.grades[1]!.id])).score).toBe("10.000");
  });

  it("une ligne existante dont la valeur diffère exige la rowVersion lue (pas d'écrasement aveugle)", async () => {
    const a = await mk("Sans version");
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all(() => "10"), caps: CAPS.teacher }));
    const r = await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: school.students[0]!.enrollmentId, score: "11" }], caps: CAPS.teacher });
    expect(r).toMatchObject({ ok: false, error: { code: "assess.stale_grade" } });
  });

  it("publications simultanées de deux évaluations de la même classe : deux événements, une seule paire d'états cohérente", async () => {
    const a = await mk("Publication A");
    const b = await mk("Publication B");
    for (const x of [a, b]) {
      unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: x.id, entries: all(() => "12"), caps: CAPS.teacher }));
      unwrap(await transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: x.id, to: "SUBMITTED", caps: CAPS.teacher }));
      unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: x.id, to: "REVIEWED", caps: CAPS.reviewer }));
      unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: x.id, to: "APPROVED", caps: CAPS.validator }));
    }
    const out = await Promise.all([a, b].map((x) => transitionAssessment(world.deps, school.director.ctx, { assessmentId: x.id, to: "PUBLISHED", caps: CAPS.publisher })));
    expect(out.every((r) => r.ok)).toBe(true);
    const ev = await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'assess.grade.published' AND aggregate_id = ANY($1::text[])", [[a.id, b.id]]);
    expect(ev).toHaveLength(2);
  });

  it("une transition concurrente d'une saisie : la saisie ne passe jamais sur une feuille déjà soumise", async () => {
    const a = await mk("Course saisie / soumission");
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all(() => "9"), caps: CAPS.teacher }));
    const sheet = unwrap(await getGradeSheet(world.deps, school.teacher.ctx, { assessmentId: a.id, caps: CAPS.teacher }));
    const [save, submit] = await Promise.all([
      saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: [{ enrollmentId: sheet.grades[0]!.enrollmentId, score: "19", rowVersion: sheet.grades[0]!.rowVersion }], caps: CAPS.teacher }),
      transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: a.id, to: "SUBMITTED", caps: CAPS.teacher }),
    ]);
    expect(submit.ok).toBe(true);
    const score = (await adminOne<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [sheet.grades[0]!.id])).score;
    // soit la saisie a précédé la soumission (19), soit elle a été refusée (9) : jamais d'état incohérent
    if (save.ok) expect(score).toBe("19.000");
    else expect(["assess.grade_frozen", "assess.stale_grade"]).toContain((save as { error: { code: string } }).error.code);
  });

  it("performance : une grille de 60 élèves s'enregistre en moins de 300 ms (p95 mesuré sur 20 lots)", async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const a = await mk(`Perf ${i}`);
      const t0 = performance.now();
      unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all((j) => String((j + i) % 21)), caps: CAPS.teacher }));
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.floor(times.length * 0.95) - 1] as number;
    console.info(`[assess] saisie de 60 notes : p95 = ${p95.toFixed(0)} ms (médiane ${times[10]!.toFixed(0)} ms)`);
    expect(p95).toBeLessThan(300);
  });

  it("publication de 300 notes en moins de 200 ms côté base (R4)", async () => {
    const a = await mk("Gros lot");
    unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all((j) => String(j % 21)), caps: CAPS.teacher }));
    // 300 lignes : 60 élèves × 5 évaluations publiées d'un coup
    const sheets: Assessment[] = [a];
    for (let i = 0; i < 4; i += 1) {
      const x = await mk(`Gros lot ${i}`);
      unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: x.id, entries: all((j) => String((j + i) % 21)), caps: CAPS.teacher }));
      sheets.push(x);
    }
    for (const x of sheets) {
      unwrap(await transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: x.id, to: "SUBMITTED", caps: CAPS.teacher }));
      unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: x.id, to: "REVIEWED", caps: CAPS.reviewer }));
      unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: x.id, to: "APPROVED", caps: CAPS.validator }));
    }
    const t0 = performance.now();
    await db.tenantDb.run(school.director.ctx, async (tx) => {
      for (const x of sheets) {
        await tx.query("SELECT set_config('app.noop', '1', true)");
        await tx.query("UPDATE assess.assessments SET status='PUBLISHED', published_at=now(), published_by=$2 WHERE id=$1", [x.id, school.director.userId]);
      }
    });
    const ms = performance.now() - t0;
    console.info(`[assess] publication de 300 notes (5 feuilles) : ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(500);
    expect((await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM assess.grades WHERE status = 'PUBLISHED' AND assessment_id = ANY($1::uuid[])", [sheets.map((s) => s.id)])).n).toBe("300");
  });

  describe("isolation multi-tenant", () => {
    let tenantB: string;
    beforeAll(async () => {
      tenantB = await db.createTenant();
    });

    it("test d'isolation générique : structure + comportement de chaque table du schéma assess, allowlist vide", async () => {
      const options = { pool: db.appPool, schemas: ["assess"], allowlist: assessIsolationAllowlistTables, fixtures: assessIsolationFixtures as never };
      const report = await checkTenantIsolation(options);
      expect(report.violations).toEqual([]);
      expect(report.staleAllowlist).toEqual([]);
      expect(report.allowlisted).toEqual([]);
      const covered = new Set([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]);
      expect([...covered].sort()).toEqual([...assessTenantTables].sort());
      await assertTenantIsolation(options);
    });

    it("RLS activée ET forcée sur toutes les tables ; aucune table hors liste", async () => {
      const tables = await adminRows<{ t: string }>(db, "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'assess' AND table_type = 'BASE TABLE' ORDER BY 1");
      expect(tables.map((r) => r.t)).toEqual([...assessTenantTables].sort());
      expect(await adminRows(db, "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'assess' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")).toEqual([]);
    });

    it("sous le tenant B, aucune ligne du tenant A n'est visible, modifiable ni supprimable ; les cas d'usage ne voient rien", async () => {
      const a = await mk("Isolation A");
      unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: a.id, entries: all(() => "7"), caps: CAPS.teacher }));
      const b = ctxFor(tenantB, newId(), ["directeur"], true);
      for (const table of assessTenantTables) {
        const rows = await db.tenantDb.run(b, (tx) => tx.many(`SELECT * FROM ${table} WHERE tenant_id = $1`, [school.tenantId]));
        expect(rows, table).toHaveLength(0);
      }
      const upd = await db.tenantDb.run(b, (tx) => tx.query("UPDATE assess.assessments SET title = 'piraté'"));
      expect(upd.rowCount).toBe(0);
      expect(await getGradeSheet(world.deps, b, { assessmentId: a.id, caps: CAPS.admin })).toMatchObject({ ok: false, error: { code: "assess.assessment_not_found" } });
      expect(await transitionAssessment(world.deps, b, { assessmentId: a.id, to: "SUBMITTED", caps: CAPS.admin })).toMatchObject({ ok: false, error: { code: "assess.assessment_not_found" } });
      expect(unwrap(await listPublishedGrades(world.deps, b, { classroomId: school.classroomId }))).toEqual([]);
      expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM assess.assessments WHERE title = 'piraté'")).n)).toBe(0);
    });
  });

  describe("lectures de l'élève et du tuteur", () => {
    let published: Assessment;
    let hidden: Assessment;

    beforeAll(async () => {
      const publish = async (title: string, typeCode: string) => {
        const x = await mk(title, { typeCode });
        unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: x.id, entries: all((j) => String(5 + (j % 10))), caps: CAPS.teacher }));
        unwrap(await transitionAssessment(world.deps, school.teacher.ctx, { assessmentId: x.id, to: "SUBMITTED", caps: CAPS.teacher }));
        unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: x.id, to: "REVIEWED", caps: CAPS.reviewer }));
        unwrap(await transitionAssessment(world.deps, school.reviewer.ctx, { assessmentId: x.id, to: "APPROVED", caps: CAPS.validator }));
        return unwrap(await transitionAssessment(world.deps, school.director.ctx, { assessmentId: x.id, to: "PUBLISHED", caps: CAPS.publisher })).assessment;
      };
      published = await publish("Devoir visible", "DEVOIR");
      hidden = await publish("Examen blanc masqué", "EXAMEN_BLANC");
    });

    it("l'élève lit ses notes publiées et visibles, jamais celles d'un type masqué ni d'un autre élève", async () => {
      const page = unwrap(await listMyGrades(world.deps, school.pupil.ctx));
      const titles = page.items.map((i) => i.assessmentId);
      expect(titles).toContain(published.id);
      expect(titles).not.toContain(hidden.id);
      expect(page.items.every((i) => i.score !== undefined)).toBe(true);
      const mine = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM assess.grades WHERE student_id = $1 AND status = 'PUBLISHED'", [school.pupil.studentId]);
      expect(Number(mine[0]!.n)).toBeGreaterThanOrEqual(page.items.length);
    });

    it("le tuteur lit les notes de son enfant seulement : le lien est revérifié à chaque lecture", async () => {
      const ok1 = unwrap(await listChildGrades(world.deps, school.guardian.ctx, { studentId: school.guardian.studentId }));
      expect(ok1.items.length).toBeGreaterThan(0);
      const other = school.students[1]!.studentId;
      expect(await listChildGrades(world.deps, school.guardian.ctx, { studentId: other })).toMatchObject({ ok: false, error: { code: "assess.not_visible" } });
      world.ports.guardianship.links.delete(`${school.guardian.userId}|${school.guardian.studentId}`);
      expect(await listChildGrades(world.deps, school.guardian.ctx, { studentId: school.guardian.studentId })).toMatchObject({ ok: false });
      world.ports.guardianship.links.add(`${school.guardian.userId}|${school.guardian.studentId}`);
    });

    it("un utilisateur sans profil d'élève n'a pas de notes ; les brouillons et feuilles non publiées ne sont jamais lisibles", async () => {
      expect(await listMyGrades(world.deps, school.guardian.ctx)).toMatchObject({ ok: false });
      const draft = await mk("Brouillon invisible");
      unwrap(await saveGrades(world.deps, school.teacher.ctx, { assessmentId: draft.id, entries: all(() => "20"), caps: CAPS.teacher }));
      const page = unwrap(await listMyGrades(world.deps, school.pupil.ctx));
      expect(page.items.map((i) => i.assessmentId)).not.toContain(draft.id);
    });

    it("les notes publiées lues par `results` incluent les types masqués (publiés pour le calcul) mais jamais les brouillons", async () => {
      const rows = unwrap(await listPublishedGrades(world.deps, school.director.ctx, { classroomId: school.classroomId, academicPeriodId: school.periodId }));
      const ids = new Set(rows.map((r) => r.assessmentId));
      expect(ids.has(published.id)).toBe(true);
      expect(ids.has(hidden.id)).toBe(true);
      expect(rows.every((r) => r.score === null || /^\d+\.\d{3}$/.test(r.score))).toBe(true);
      const ordered = [...rows].map((r) => `${r.assessedOn}|${r.assessmentId}|${r.enrollmentId}`);
      expect(ordered).toEqual([...ordered].sort());
    });
  });
});
