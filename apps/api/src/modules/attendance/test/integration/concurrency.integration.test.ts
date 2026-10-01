import { afterAll, beforeAll, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { getAttendanceSession, markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../application/sessions";
import { getAttendanceSummary } from "../../application/summaries";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("concurrence : deux enseignants sur la même séance (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAttendanceTestDb(20);
    world = makeWorld(db, "2025-10-01T09:00:00.000Z");
    school = await seedSchool(db, world, { students: 30 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const count = async (sql: string, params: unknown[] = []) => Number((await adminOne<{ n: string }>(db, sql, params)).n);
  const open = (occurrenceId: string, who: typeof school.teacher) => openAttendanceSession(world.deps, who.ctx, { kind: "occurrence", occurrenceId, caps: {} });

  it("ouvertures simultanées de la même occurrence : UNE séance, UN événement d'ouverture, tous reçoivent la même", async () => {
    const occ = addOccurrence(world, school);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => open(occ.occurrenceId, i % 2 === 0 ? school.teacher : school.coTeacher)));
    const values = results.map((r) => unwrap(r));
    expect(new Set(values.map((v) => v.session.id)).size).toBe(1);
    expect(values.filter((v) => v.created)).toHaveLength(1);
    expect(await count("SELECT count(*) AS n FROM attendance.sessions WHERE occurrence_id = $1", [occ.occurrenceId])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'attendance.session.opened' AND aggregate_id = $1", [values[0]!.session.id])).toBe(1);
  });

  it("deux enseignants marquent le même roster en même temps (recouvrement) : un pointage par élève, pas d'interblocage, dernier arrivé gagne", async () => {
    const occ = addOccurrence(world, school);
    const { session } = unwrap(await open(occ.occurrenceId, school.teacher));
    const ids = school.students.map((s) => s.studentId);
    // Enseignant 1 : élèves 0..19 ABSENT ; enseignant 2 : élèves 10..29 LATE (recouvrement 10..19), plusieurs tours chacun.
    const rounds = Array.from({ length: 5 }, (_, i) => i);
    const jobs = rounds.flatMap(() => [
      markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: ids.slice(0, 20).map((studentId) => ({ studentId, statusCode: "ABSENT" })) }),
      markStudentRecords(world.deps, school.coTeacher.ctx, { sessionId: session.id, entries: ids.slice(10).map((studentId) => ({ studentId, statusCode: "LATE", minutesLate: 5 })) }),
    ]);
    const settled = await Promise.all(jobs);
    for (const r of settled) expect(r.ok).toBe(true);

    const stored = await adminRows<any>(db, "SELECT student_id, status_code FROM attendance.student_records WHERE session_id = $1", [session.id]);
    expect(stored).toHaveLength(30);
    expect(new Set(stored.map((s) => s.student_id)).size).toBe(30);
    const byStudent = new Map(stored.map((s) => [s.student_id, s.status_code]));
    for (const id of ids.slice(0, 10)) expect(byStudent.get(id)).toBe("ABSENT");
    for (const id of ids.slice(20)) expect(byStudent.get(id)).toBe("LATE");
    for (const id of ids.slice(10, 20)) expect(["ABSENT", "LATE"]).toContain(byStudent.get(id)); // dernier arrivé gagne

    // L'historique de chaque pointage est cohérent : suite de transitions ininterrompue qui finit sur le statut courant.
    for (const s of stored) {
      const h = await adminRows<any>(db, "SELECT from_status, to_status FROM attendance.record_history WHERE session_id = $1 AND record_id = (SELECT id FROM attendance.student_records WHERE session_id = $1 AND student_id = $2) ORDER BY seq", [session.id, s.student_id]);
      expect(h[0].from_status).toBeNull();
      for (let i = 1; i < h.length; i += 1) expect(h[i].from_status).toBe(h[i - 1].to_status);
      expect(h.at(-1).to_status).toBe(s.status_code);
    }
    const detail = unwrap(await getAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id }));
    expect(detail.counts).toMatchObject({ rosterSize: 30, marked: 30, unmarked: 0 });
  });

  it("soumissions simultanées : une seule transition et un seul jeu d'événements ; une soumission en course avec des pointages reste cohérente", async () => {
    const occ = addOccurrence(world, school);
    const { session } = unwrap(await open(occ.occurrenceId, school.teacher));
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: school.students.slice(0, 5).map((s) => ({ studentId: s.studentId, statusCode: "ABSENT" })) }));

    const results = await Promise.all([
      submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }),
      submitAttendanceSession(world.deps, school.coTeacher.ctx, { sessionId: session.id, allPresent: true }),
      markStudentRecords(world.deps, school.coTeacher.ctx, { sessionId: session.id, entries: [{ studentId: school.students[5]!.studentId, statusCode: "LATE", minutesLate: 3 }] }),
      submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }),
    ]);
    for (const r of results) expect(r.ok).toBe(true);
    const submits = [results[0]!, results[1]!, results[3]!].map((r) => unwrap(r as never) as { alreadySubmitted: boolean });
    expect(submits.filter((s) => !s.alreadySubmitted)).toHaveLength(1);
    expect(await count("SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'attendance.session.submitted' AND payload->>'sessionId' = $1", [session.id])).toBe(1);
    expect(await count("SELECT count(*) AS n FROM attendance.student_records WHERE session_id = $1", [session.id])).toBe(30);
    expect((await adminOne<any>(db, "SELECT status FROM attendance.sessions WHERE id = $1", [session.id])).status).toBe("SUBMITTED");

    // Le récapitulatif de chaque élève reflète EXACTEMENT les pointages finaux (aucune mise à jour perdue).
    for (const s of school.students.slice(0, 7)) {
      const stored = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: s.enrollmentId, periodId: school.termId }));
      const rec = await adminOne<any>(db, "SELECT status_code FROM attendance.student_records WHERE session_id = $1 AND enrollment_id = $2", [session.id, s.enrollmentId]);
      expect(stored.derived.sessionsTotal).toBe(1);
      expect(stored.derived.absentCount).toBe(rec.status_code === "ABSENT" ? 1 : 0);
      expect(stored.derived.lateCount).toBe(rec.status_code === "LATE" ? 1 : 0);
    }
  });

  it("charge mixte : 12 séances ouvertes, pointées et soumises en parallèle par les deux enseignants, sans erreur", async () => {
    const occs = Array.from({ length: 12 }, () => addOccurrence(world, school, { date: "2025-10-02" }));
    const tasks = occs.map(async (o, i) => {
      const who = i % 2 === 0 ? school.teacher : school.coTeacher;
      const { session } = unwrap(await open(o.occurrenceId, who));
      unwrap(await markStudentRecords(world.deps, who.ctx, { sessionId: session.id, entries: school.students.map((s, k) => ({ studentId: s.studentId, statusCode: k % 7 === i % 7 ? "ABSENT" : "PRESENT" })) }));
      return unwrap(await submitAttendanceSession(world.deps, who.ctx, { sessionId: session.id }));
    });
    const done = await Promise.all(tasks);
    expect(done.every((d) => d.session.status === "SUBMITTED")).toBe(true);
    // Récapitulatifs de la période : 12 séances de plus pour chaque élève, comptages cohérents.
    const sums = await Promise.all(school.students.map(async (s) => unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: s.enrollmentId, periodId: school.termId }))));
    expect(sums.every((s) => s.derived.sessionsTotal >= 12)).toBe(true);
    expect(sums.every((s) => s.derived.presentCount + s.derived.absentCount === s.derived.sessionsTotal)).toBe(true);
    void CAPS;
  });
});
