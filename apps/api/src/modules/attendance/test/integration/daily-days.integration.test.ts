import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { acceptJustification, submitJustification } from "../../application/justifications";
import { getAttendanceDays, getAttendanceDaysForEnrollments } from "../../application/days";
import { instantiateAttendancePack, listCallPolicyDefinitions } from "../../application/reference";
import { markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../application/sessions";
import { getAttendanceSummary } from "../../application/summaries";
import { getAttendancePackTemplate } from "../../templates";
import { createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

/** Primaire : appel journalier unique, absences en journées, jours ouverts (spec 005 §14.2 « 010 », règle `cas_absences`). */
describeIntegration("appel journalier PRIMARY : modèle de pack, absences en journées, jours ouverts (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;
  let primary: string;
  const kids: Array<{ studentId: string; enrollmentId: string }> = [];
  const dates = ["2025-10-01", "2025-10-02", "2025-10-03", "2025-10-06", "2025-10-07"];

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-10-08T12:00:00.000Z");
    school = await seedSchool(db, world, { students: 2 });
    primary = newId();
    world.ports.roster.addClassroom({ classroomId: primary, institutionId: school.institutionId, academicYearId: school.yearId, educationLevelCode: "PRIMARY", active: true });
    world.ports.people.assign(school.teacher.staffId, primary);
    for (let i = 0; i < 3; i += 1) {
      const studentId = newId();
      const enrollmentId = newId();
      world.ports.roster.addEnrollment({ enrollmentId, studentId, classroomId: primary, institutionId: school.institutionId, academicYearId: school.yearId, active: true, academicYearStart: "2025-09-01", academicYearEnd: "2026-06-30", names: `Enfant ${i}` });
      world.ports.people.addStudent(studentId, `Enfant ${i}`);
      kids.push({ studentId, enrollmentId });
    }
    // Le modèle de pack PRIMARY pose la politique journalière (aucune durée supposée).
    unwrap(await instantiateAttendancePack(world.deps, school.admin.ctx, { pack: getAttendancePackTemplate("CI", "PRIMARY"), institutionIds: [school.institutionId] }));
  });
  afterAll(async () => {
    await db.drop();
  });

  const daily = async (date: string, marks: Record<number, string>, submit = true) => {
    const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "daily", classroomId: primary, date, caps: {} }));
    const entries = kids.map((k, i) => ({ studentId: k.studentId, statusCode: marks[i] ?? "PRESENT" }));
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries }));
    if (submit) unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, caps: {} }));
    return session;
  };

  it("le modèle PRIMARY_DAILY est instancié par niveau, sans minutes ; l'appel SESSION y est refusé, le journalier accepté", async () => {
    const policies = unwrap(await listCallPolicyDefinitions(world.deps, school.admin.ctx));
    for (const level of ["PRESCHOOL", "PRIMARY"]) {
      expect(policies.find((p) => p.educationLevelCode === level)).toMatchObject({ callScope: "DAILY", dailyMinutes: null });
    }
    const occ = addOccurrence(world, school, { classroomId: primary });
    const refused = await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("attendance.call_scope_not_allowed");
  });

  it("une séance journalière par classe et par jour : le second appel renvoie la même séance", async () => {
    const first = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "daily", classroomId: primary, date: "2025-09-15", caps: {} }));
    const again = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "daily", classroomId: primary, date: "2025-09-15", caps: {} }));
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.session.id).toBe(first.session.id);
  });

  it("absences en journées et jours ouverts : comptes exacts, absences journalières sans minutes, récapitulatif en jours", async () => {
    await daily("2025-10-01", { 0: "ABSENT" });
    await daily("2025-10-02", { 0: "ABSENT", 1: "LATE" });
    await daily("2025-10-03", {});
    await daily("2025-10-06", { 0: "ABSENT", 2: "ABSENT" });
    await daily("2025-10-07", {}, false); // non soumis : ne compte pas
    const window = { from: "2025-10-01", to: "2025-10-31" };
    const [a, b, c] = kids;
    const d0 = unwrap(await getAttendanceDays(world.deps, school.admin.ctx, { enrollmentId: a!.enrollmentId, ...window }));
    expect(d0).toMatchObject({ openDays: 4, openDaysSource: "CALLED_DAYS", absentDays: 3, excusedAbsentDays: 0, unexcusedAbsentDays: 3, presentDays: 1, ruleInputs: { absences_journees: 3, jours_ouverts: 4 } });
    const d1 = unwrap(await getAttendanceDays(world.deps, school.admin.ctx, { enrollmentId: b!.enrollmentId, ...window }));
    expect(d1).toMatchObject({ openDays: 4, absentDays: 0, lateDays: 1 });
    const d2 = unwrap(await getAttendanceDays(world.deps, school.admin.ctx, { enrollmentId: c!.enrollmentId, ...window }));
    expect(d2).toMatchObject({ absentDays: 1, ruleInputs: { absences_journees: 1, jours_ouverts: 4 } });

    // Le récapitulatif existant ne compte que des jours : aucune minute.
    const period = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: a!.enrollmentId, periodId: school.semesterId }));
    expect(period.derived).toMatchObject({ sessionsTotal: 4, absentCount: 3, absentMinutes: 0 });
    // Cohérence : les jours de la fonction = les comptes du récapitulatif (même fenêtre, appels journaliers seuls).
    const wide = unwrap(await getAttendanceDays(world.deps, school.admin.ctx, { enrollmentId: a!.enrollmentId, periodId: school.semesterId }));
    expect(wide.absentDays).toBe(period.derived.absentCount);
    expect(wide.openDays).toBe(period.derived.sessionsTotal);
  });

  it("lot : un tableau pour toute la classe en une requête ; inscription sans appel = zéros ; plafond et paramètres validés", async () => {
    const stranger = newId();
    const rows = unwrap(await getAttendanceDaysForEnrollments(world.deps, school.admin.ctx, { enrollmentIds: [...kids.map((k) => k.enrollmentId), stranger, kids[0]!.enrollmentId], from: "2025-10-01", to: "2025-10-31" }));
    expect(rows.map((r) => r.enrollmentId)).toEqual([...kids.map((k) => k.enrollmentId), stranger]);
    expect(rows.at(-1)).toMatchObject({ openDays: 0, absentDays: 0, ruleInputs: { absences_journees: 0, jours_ouverts: 0 } });
    expect(unwrap(await getAttendanceDaysForEnrollments(world.deps, school.admin.ctx, { enrollmentIds: [], from: "2025-10-01", to: "2025-10-31" }))).toEqual([]);

    const bad = async (q: object) => {
      const r = await getAttendanceDaysForEnrollments(world.deps, school.admin.ctx, { enrollmentIds: [stranger], ...q } as never);
      return r.ok ? "ok" : r.error.code;
    };
    expect(await bad({})).toBe("attendance.invalid_input");
    expect(await bad({ from: "2025-10-31", to: "2025-10-01" })).toBe("attendance.invalid_input");
    expect(await bad({ from: "2025-10-01", to: "2025-10-31", openDays: -1 })).toBe("attendance.invalid_input");
    expect(await bad({ periodId: newId() })).toBe("attendance.period_not_found");
    const many = Array.from({ length: 501 }, () => newId());
    expect((await getAttendanceDaysForEnrollments(world.deps, school.admin.ctx, { enrollmentIds: many, from: "2025-10-01", to: "2025-10-31" })).ok).toBe(false);
  });

  it("les jours du calendrier fournis remplacent les jours d'appel ; un justificatif accepté sépare absences justifiées et non justifiées", async () => {
    const a = kids[0]!;
    unwrap(await submitJustification(world.deps, school.admin.ctx, { studentId: a.studentId, fromDate: "2025-10-01", toDate: "2025-10-02", reasonCode: "ILLNESS", caps: CAPS.admin }).then(async (j) => {
      const view = unwrap(j);
      return acceptJustification(world.deps, school.admin.ctx, { justificationId: view.justification.id, caps: CAPS.admin });
    }));
    const d = unwrap(await getAttendanceDays(world.deps, school.admin.ctx, { enrollmentId: a.enrollmentId, from: "2025-10-01", to: "2025-10-31", openDays: 20 }));
    expect(d).toMatchObject({ openDays: 20, openDaysSource: "CALLER", absentDays: 3, excusedAbsentDays: 2, unexcusedAbsentDays: 1, ruleInputs: { absences_journees: 3, jours_ouverts: 20 } });
    const strict = unwrap(await getAttendanceDays(world.deps, school.admin.ctx, { enrollmentId: a.enrollmentId, from: "2025-10-01", to: "2025-10-31", excludeExcused: true }));
    expect(strict.ruleInputs).toEqual({ absences_journees: 1, jours_ouverts: 4 });
  });
});
