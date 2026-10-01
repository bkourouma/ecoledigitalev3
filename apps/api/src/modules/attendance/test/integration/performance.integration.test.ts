import { afterAll, beforeAll, expect, it } from "vitest";
import { createSystemContext, newId, unwrap } from "@ecoledigitale/kernel";
import { instantiateAttendancePack } from "../../application/reference";
import { markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../application/sessions";
import { getAttendanceSummary, getClassroomAttendanceSummary, recomputeSummaries } from "../../application/summaries";
import { adminOne, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!;

describeIntegration("performance (critères mesurables de la spec 010)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAttendanceTestDb(12);
    world = makeWorld(db, "2025-10-01T12:00:00.000Z");
    school = await seedSchool(db, world, { students: 60 });
  });
  afterAll(async () => {
    await db.drop();
  });

  it("AC1.5 : l'appel de 60 élèves pèse < 20 Ko et se marque en < 300 ms (p95)", async () => {
    const durations: number[] = [];
    let bytes = 0;
    // 1 appel de chauffe puis 20 mesurés (une séance chacun).
    for (let i = 0; i < 21; i += 1) {
      const occ = addOccurrence(world, school, { date: "2025-10-01" });
      const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
      const entries = school.students.map((s, k) => ({ studentId: s.studentId, statusCode: k % 9 === 0 ? "ABSENT" : k % 11 === 0 ? "LATE" : "PRESENT", ...(k % 11 === 0 && k % 9 !== 0 ? { minutesLate: 5 } : {}) }));
      bytes = Buffer.byteLength(JSON.stringify({ entries }));
      const t0 = performance.now();
      unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries }));
      if (i > 0) durations.push(performance.now() - t0);
      if (i < 5) unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id }));
    }
    console.info(`[perf] marquage de 60 élèves : p95=${p95(durations).toFixed(0)} ms, médiane=${[...durations].sort((a, b) => a - b)[10]!.toFixed(0)} ms, corps=${bytes} octets`);
    expect(bytes).toBeLessThan(20 * 1024);
    expect(p95(durations)).toBeLessThan(300);
  });

  it("soumission d'un appel de 60 élèves (avec recalcul synchrone des récapitulatifs) < 1 s (p95)", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const occ = addOccurrence(world, school, { date: "2025-10-02" });
      const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
      unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: school.students.slice(0, 10).map((s) => ({ studentId: s.studentId, statusCode: "ABSENT" })) }));
      const t0 = performance.now();
      unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }));
      durations.push(performance.now() - t0);
    }
    console.info(`[perf] soumission de 60 élèves : p95=${p95(durations).toFixed(0)} ms`);
    expect(p95(durations)).toBeLessThan(1000);
  });

  it("AC5.5 : le récapitulatif de toute une classe de 60 inscrits en < 400 ms (p95)", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      const table = unwrap(await getClassroomAttendanceSummary(world.deps, school.admin.ctx, { classroomId: school.classroomId, periodId: school.termId }));
      durations.push(performance.now() - t0);
      expect(table.rows).toHaveLength(60);
    }
    const one = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: school.students[0]!.enrollmentId, periodId: school.termId }));
    expect(one.derived.sessionsTotal).toBeGreaterThan(5);
    console.info(`[perf] tableau de classe (60 inscrits) : p95=${p95(durations).toFixed(0)} ms`);
    expect(p95(durations)).toBeLessThan(400);
  });

  it("AC5.2 : recalcul complet de 1 500 inscriptions (30 000 pointages) < 30 s, puis idempotent", async () => {
    const t = await db.createTenant();
    const ctx = createSystemContext(t);
    unwrap(await instantiateAttendancePack(world.deps, ctx, {}));
    const year = newId();
    const period = newId();
    world.ports.periods.add({ periodId: period, academicYearId: year, startsOn: "2025-09-01", endsOn: "2025-12-20", parentPeriodId: null });
    const classroom = newId();
    const institution = newId();
    // 20 appels soumis, 1 500 inscrits : 30 000 pointages posés en SQL (superuser) pour mesurer le recalcul seul.
    await db.admin.query(
      `INSERT INTO attendance.sessions (id, tenant_id, institution_id, academic_year_id, classroom_id, curriculum_node_id, occurrence_id, scope, session_date, duration_minutes, status, submitted_at)
       SELECT md5('s' || n)::uuid, $1, $2, $3, $4, md5('node')::uuid, md5('o' || n)::uuid, 'SESSION', date '2025-09-01' + n, 60, 'SUBMITTED', now()
         FROM generate_series(1, 20) n`,
      [t, institution, year, classroom],
    );
    await db.admin.query(
      `INSERT INTO attendance.student_records (id, tenant_id, session_id, enrollment_id, student_id, status_code, counted_minutes, marked_by)
       SELECT gen_random_uuid(), $1, md5('s' || s)::uuid, md5('e' || e)::uuid, md5('p' || e)::uuid,
              CASE WHEN (s + e) % 7 = 0 THEN 'ABSENT' ELSE 'PRESENT' END, CASE WHEN (s + e) % 7 = 0 THEN 60 END, md5('u')::uuid
         FROM generate_series(1, 20) s CROSS JOIN generate_series(1, 1500) e`,
      [t],
    );
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.student_records WHERE tenant_id = $1", [t])).n)).toBe(30_000);

    const t0 = performance.now();
    const report = unwrap(await recomputeSummaries(world.deps, ctx, { periodId: period }));
    const elapsed = performance.now() - t0;
    console.info(`[perf] recalcul de 1 500 inscriptions / 30 000 pointages : ${elapsed.toFixed(0)} ms`);
    expect(report).toMatchObject({ enrollments: 1500, periods: 1, changed: 1500 });
    expect(elapsed).toBeLessThan(30_000);
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.period_summaries WHERE tenant_id = $1", [t])).n)).toBe(1500);
    const again = unwrap(await recomputeSummaries(world.deps, ctx, { periodId: period }));
    expect(again.changed).toBe(0);
  });
});
