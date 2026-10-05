import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { getAttendanceDays } from "../../application/days";
import { instantiateAttendancePack, listCallPolicyDefinitions, upsertCallPolicy } from "../../application/reference";
import { cancelAttendanceSession, getAttendanceSession, listAttendanceSessions, markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../application/sessions";
import { getAttendanceSummary } from "../../application/summaries";
import { syncOfflineAttendance, type SyncBatchInput } from "../../application/sync";
import { getAttendancePackTemplate } from "../../templates";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

/**
 * Appel du primaire le MATIN et l'APRÈS-MIDI (décision Q-P17, 2026-10-05), Postgres réel : politique du cycle, deux appels par jour,
 * exclusion de la journée entière, idempotence hors-ligne par demi-journée, journées en demi-valeurs, isolation A/B, secondaire inchangé.
 */
describeIntegration("appel par demi-journée : politique, deux appels par jour, journées, hors-ligne, isolation (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let a: School;
  let b: School;
  let primary: string;
  const kids: Array<{ studentId: string; enrollmentId: string }> = [];

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-10-08T12:00:00.000Z");
    a = await seedSchool(db, world, { students: 2 });
    b = await seedSchool(db, world, { students: 2 });
    primary = newId();
    world.ports.roster.addClassroom({ classroomId: primary, institutionId: a.institutionId, academicYearId: a.yearId, educationLevelCode: "PRIMARY", active: true });
    world.ports.people.assign(a.teacher.staffId, primary);
    for (let i = 0; i < 3; i += 1) {
      const studentId = newId();
      const enrollmentId = newId();
      world.ports.roster.addEnrollment({ enrollmentId, studentId, classroomId: primary, institutionId: a.institutionId, academicYearId: a.yearId, active: true, academicYearStart: "2025-09-01", academicYearEnd: "2026-06-30", names: `Enfant ${i}` });
      world.ports.people.addStudent(studentId, `Enfant ${i}`);
      kids.push({ studentId, enrollmentId });
    }
    // Le modèle de pack PRIMARY propose l'appel du matin ET de l'après-midi ; B (autre établissement) n'applique aucun modèle.
    unwrap(await instantiateAttendancePack(world.deps, a.admin.ctx, { pack: getAttendancePackTemplate("CI", "PRIMARY"), institutionIds: [a.institutionId] }));
  });
  afterAll(async () => {
    await db.drop();
  });

  const open = (dayPart: "FULL" | "MORNING" | "AFTERNOON" | undefined, date: string) =>
    openAttendanceSession(world.deps, a.teacher.ctx, { kind: "daily", classroomId: primary, date, ...(dayPart ? { dayPart } : {}), caps: {} });
  const call = async (dayPart: "MORNING" | "AFTERNOON", date: string, marks: Record<number, string>, submit = true) => {
    const { session } = unwrap(await open(dayPart, date));
    const entries = kids.map((k, i) => ({ studentId: k.studentId, statusCode: marks[i] ?? "PRESENT", ...(marks[i] === "LATE" ? { minutesLate: 10 } : {}) }));
    unwrap(await markStudentRecords(world.deps, a.teacher.ctx, { sessionId: session.id, entries }));
    if (submit) unwrap(await submitAttendanceSession(world.deps, a.teacher.ctx, { sessionId: session.id, caps: {} }));
    return session;
  };
  const code = (r: { ok: boolean; error?: unknown }): string | undefined => (r.ok ? undefined : (r.error as { code?: string }).code);

  it("le modèle de pack pose HALF_DAYS pour le primaire et garde l'appel journalier unique pour la maternelle", async () => {
    const policies = unwrap(await listCallPolicyDefinitions(world.deps, a.admin.ctx));
    expect(policies.find((p) => p.educationLevelCode === "PRIMARY")).toMatchObject({ callScope: "DAILY", dailyCallMode: "HALF_DAYS", dailyMinutes: null });
    expect(policies.find((p) => p.educationLevelCode === "PRESCHOOL")).toMatchObject({ callScope: "DAILY", dailyCallMode: "SINGLE" });
  });

  it("deux appels par jour : la demi-journée est obligatoire ; la journée entière est refusée ; le même appel renvoie la même séance", async () => {
    expect(code(await open(undefined, "2025-10-01"))).toBe("attendance.day_part_required");
    expect(code(await open("FULL", "2025-10-01"))).toBe("attendance.day_part_not_allowed");
    const morning = unwrap(await open("MORNING", "2025-10-01"));
    expect(morning.created).toBe(true);
    expect(morning.session).toMatchObject({ scope: "DAILY", dayPart: "MORNING", status: "OPEN" });
    const again = unwrap(await open("MORNING", "2025-10-01"));
    expect(again.created).toBe(false);
    expect(again.session.id).toBe(morning.session.id);
    const afternoon = unwrap(await open("AFTERNOON", "2025-10-01"));
    expect(afternoon.created).toBe(true);
    expect(afternoon.session.id).not.toBe(morning.session.id);
    expect(afternoon.session.dayPart).toBe("AFTERNOON");
    const listed = unwrap(await listAttendanceSessions(world.deps, a.teacher.ctx, { classroomId: primary, date: "2025-10-01" }));
    expect(listed.items.map((s) => s.dayPart).sort()).toEqual(["AFTERNOON", "MORNING"]);
    // L'événement d'ouverture porte la demi-journée (charge utile additive, même type).
    const events = await adminRows<{ payload: { dayPart?: string } }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'attendance.session.opened' AND aggregate_id = ANY($1::text[])", [[morning.session.id, afternoon.session.id]]);
    expect(events.map((e) => e.payload.dayPart).sort()).toEqual(["AFTERNOON", "MORNING"]);
  });

  it("journées en demi-valeurs : absent le matin et présent l'après-midi = 0,5 journée ; jours ouverts = demi-journées appelées / 2", async () => {
    await call("MORNING", "2025-10-02", { 0: "ABSENT", 1: "LATE" });
    await call("AFTERNOON", "2025-10-02", { 1: "ABSENT" });
    await call("MORNING", "2025-10-03", {}); // le matin seulement : 0,5 jour ouvert de plus
    await call("AFTERNOON", "2025-10-03", { 0: "ABSENT" }, false); // non soumis : ne compte pas
    const window = { from: "2025-10-02", to: "2025-10-03" };
    const d0 = unwrap(await getAttendanceDays(world.deps, a.admin.ctx, { enrollmentId: kids[0]!.enrollmentId, ...window }));
    expect(d0).toMatchObject({ openDays: 1.5, absentDays: 0.5, presentDays: 1, excusedAbsentDays: 0, unexcusedAbsentDays: 0.5, ruleInputs: { absences_journees: 0.5, jours_ouverts: 1.5 } });
    const d1 = unwrap(await getAttendanceDays(world.deps, a.admin.ctx, { enrollmentId: kids[1]!.enrollmentId, ...window }));
    expect(d1).toMatchObject({ openDays: 1.5, absentDays: 0.5, lateDays: 0.5, presentDays: 1 }); // en retard le matin = présent
    // Le récapitulatif compte les APPELS (un pointage par demi-journée) : 3 appels soumis, 1 absence pour l'enfant 0.
    const summary = unwrap(await getAttendanceSummary(world.deps, a.admin.ctx, { enrollmentId: kids[0]!.enrollmentId, periodId: a.semesterId }));
    expect(summary.derived).toMatchObject({ absentCount: 1, absentMinutes: 0 });
  });

  it("une journée entière ET une demi-journée du même jour ne se chevauchent jamais (action de l'établissement, base en dernier recours)", async () => {
    // Un appel de la journée entière hérité (politique unique) puis passage en deux appels : la demi-journée est refusée.
    unwrap(await upsertCallPolicy(world.deps, a.admin.ctx, { institutionId: a.institutionId, educationLevelCode: "PRIMARY", callScope: "DAILY", dailyCallMode: "SINGLE" }));
    const full = unwrap(await open("FULL", "2025-10-06"));
    expect(full.session.dayPart).toBe("FULL");
    expect(code(await open("MORNING", "2025-10-06"))).toBe("attendance.day_part_not_allowed"); // politique unique
    unwrap(await upsertCallPolicy(world.deps, a.admin.ctx, { institutionId: a.institutionId, educationLevelCode: "PRIMARY", callScope: "DAILY", dailyCallMode: "HALF_DAYS" }));
    expect(code(await open("MORNING", "2025-10-06"))).toBe("attendance.day_part_taken");
    // Après annulation de l'appel entier, la demi-journée s'ouvre.
    unwrap(await cancelAttendanceSession(world.deps, a.teacher.ctx, { sessionId: full.session.id, reason: "Appel ouvert par erreur", caps: CAPS.teacher }));
    expect(unwrap(await open("MORNING", "2025-10-06")).created).toBe(true);
    // La base refuse aussi les chevauchements directs et les doublons.
    const insert = (part: string, date: string) =>
      adminOne(db, `INSERT INTO attendance.sessions (id, tenant_id, institution_id, academic_year_id, classroom_id, scope, day_part, session_date)
                    VALUES ($1,$2,$3,$4,$5,'DAILY',$6,$7)`, [newId(), a.tenantId, a.institutionId, a.yearId, primary, part, date]);
    await expect(insert("FULL", "2025-10-06")).rejects.toThrow(/sessions_daily_parts_exclusive/);
    await expect(insert("MORNING", "2025-10-06")).rejects.toThrow(/sessions_one_daily|sessions_daily_parts_exclusive/);
    await expect(insert("NOON", "2025-10-09")).rejects.toThrow(/day_part/);
    // Un appel par séance planifiée est toujours FULL.
    await expect(
      adminOne(db, `INSERT INTO attendance.sessions (id, tenant_id, institution_id, academic_year_id, classroom_id, scope, day_part, session_date, occurrence_id)
                    VALUES ($1,$2,$3,$4,$5,'SESSION','MORNING','2025-10-09',$6)`, [newId(), a.tenantId, a.institutionId, a.yearId, primary, newId()]),
    ).rejects.toThrow(/sessions_day_part_scope_ck/);
  });

  it("la demi-journée d'un appel est figée comme sa classe, sa date et sa portée", async () => {
    const s = unwrap(await open("AFTERNOON", "2025-10-07")).session;
    await expect(adminOne(db, "UPDATE attendance.sessions SET day_part = 'MORNING' WHERE id = $1", [s.id])).rejects.toThrow(/session_identity_immutable/);
  });

  it("l'établissement choisit le mode : deux appels par jour exigent l'appel journalier ; la politique est auditée", async () => {
    const refused = await upsertCallPolicy(world.deps, a.admin.ctx, { institutionId: a.institutionId, educationLevelCode: "CM2", callScope: "SESSION", dailyCallMode: "HALF_DAYS" });
    expect(code(refused)).toBe("attendance.invalid_input");
    const both = unwrap(await upsertCallPolicy(world.deps, a.admin.ctx, { institutionId: a.institutionId, educationLevelCode: "CM2", callScope: "BOTH", dailyCallMode: "HALF_DAYS" }));
    expect(both.dailyCallMode).toBe("HALF_DAYS");
    expect(world.audit.entries.some((e) => e.entry.action === "attendance.call_policy.upserted")).toBe(true);
    await expect(
      adminOne(db, `INSERT INTO attendance.call_policies (tenant_id, institution_id, education_level_code, call_scope, daily_call_mode) VALUES ($1,$2,'X1','SESSION','HALF_DAYS')`, [a.tenantId, a.institutionId]),
    ).rejects.toThrow(/call_policies_half_days_scope_ck/);
  });

  it("minutes : avec une durée de journée fixée, une absence d'une demi-journée en compte la moitié", async () => {
    unwrap(await upsertCallPolicy(world.deps, a.admin.ctx, { institutionId: a.institutionId, educationLevelCode: "PRIMARY", callScope: "DAILY", dailyCallMode: "HALF_DAYS", dailyMinutes: 300 }));
    const s = await call("MORNING", "2025-10-08", { 2: "ABSENT" });
    const detail = unwrap(await getAttendanceSession(world.deps, a.teacher.ctx, { sessionId: s.id }));
    expect(detail.students.find((x) => x.studentId === kids[2]!.studentId)?.record?.countedMinutes).toBe(150);
    unwrap(await upsertCallPolicy(world.deps, a.admin.ctx, { institutionId: a.institutionId, educationLevelCode: "PRIMARY", callScope: "DAILY", dailyCallMode: "HALF_DAYS", dailyMinutes: null }));
  });

  describe("hors-ligne : clés d'idempotence par demi-journée", () => {
    const at = (hhmm: string) => new Date(`2025-10-09T${hhmm}:00.000Z`);
    const target = (dayPart?: "MORNING" | "AFTERNOON") => ({ scope: "DAILY" as const, classroomId: primary, date: "2025-10-09", ...(dayPart ? { dayPart } : {}) });
    const batch = (sessions: SyncBatchInput["sessions"]): SyncBatchInput => ({ batchId: newId(), deviceId: "tablette-cm1", clientSentAt: at("12:00"), sessions, caps: CAPS.teacher });
    const sessionInput = (clientId: string, dayPart?: "MORNING" | "AFTERNOON") => ({
      clientId, target: target(dayPart), clientOpenedAt: at("08:00"),
      records: [{ clientId: newId(), studentId: kids[0]!.studentId, statusCode: "ABSENT", clientMarkedAt: at("08:05") }],
    });

    it("le matin et l'après-midi sont deux séances distinctes ; le rejeu d'une demi-journée renvoie son résultat d'origine", async () => {
      const m = newId();
      const p = newId();
      const first = unwrap(await syncOfflineAttendance(world.deps, a.teacher.ctx, batch([sessionInput(m, "MORNING"), sessionInput(p, "AFTERNOON")])));
      expect(first.sessions.map((s) => s.outcome)).toEqual(["OPENED", "OPENED"]);
      expect(first.sessions[0]!.sessionId).not.toBe(first.sessions[1]!.sessionId);
      const stored = await adminRows<{ id: string; day_part: string }>(db, "SELECT id, day_part FROM attendance.sessions WHERE id = ANY($1::uuid[]) ORDER BY day_part", [first.sessions.map((s) => s.sessionId)]);
      expect(stored.map((s) => s.day_part)).toEqual(["AFTERNOON", "MORNING"]);
      const replay = unwrap(await syncOfflineAttendance(world.deps, a.teacher.ctx, batch([sessionInput(m, "MORNING"), sessionInput(p, "AFTERNOON")])));
      expect(replay.sessions.map((s) => s.outcome)).toEqual(["REPLAYED", "REPLAYED"]);
      expect(replay.sessions.map((s) => s.sessionId)).toEqual(first.sessions.map((s) => s.sessionId));
      const sessions = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM attendance.sessions WHERE classroom_id = $1 AND session_date = '2025-10-09'", [primary]);
      expect(sessions[0]!.n).toBe("2");
    });

    it("la même clé pour l'autre demi-journée est refusée (clé d'idempotence réutilisée) ; sans demi-journée, refus explicite", async () => {
      const reused = newId();
      unwrap(await syncOfflineAttendance(world.deps, a.teacher.ctx, batch([{ ...sessionInput(reused, "MORNING"), target: { ...target("MORNING"), date: "2025-10-10" } }])));
      const clash = unwrap(await syncOfflineAttendance(world.deps, a.teacher.ctx, batch([{ ...sessionInput(reused, "AFTERNOON"), target: { ...target("AFTERNOON"), date: "2025-10-10" } }])));
      expect(clash.sessions[0]).toMatchObject({ outcome: "REJECTED", errorCode: "attendance.idempotency_key_reused" });
      const missing = unwrap(await syncOfflineAttendance(world.deps, a.teacher.ctx, batch([{ ...sessionInput(newId()), target: { ...target(), date: "2025-10-13" } }])));
      expect(missing.sessions[0]).toMatchObject({ outcome: "REJECTED", errorCode: "attendance.day_part_required" });
    });
  });

  it("secondaire inchangé : l'appel par séance planifiée est FULL, sans demi-journée, et l'appel journalier y reste refusé", async () => {
    // Le secondaire garde la politique par séance du modèle de base (`*`), inchangée par ce changement.
    unwrap(await upsertCallPolicy(world.deps, a.admin.ctx, { institutionId: a.institutionId, educationLevelCode: "*", callScope: "SESSION", editWindowMinutes: 120 }));
    const occ = addOccurrence(world, a);
    const opened = unwrap(await openAttendanceSession(world.deps, a.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    expect(opened.session).toMatchObject({ scope: "SESSION", dayPart: "FULL" });
    const secondary = await openAttendanceSession(world.deps, a.teacher.ctx, { kind: "daily", classroomId: a.classroomId, date: "2025-10-01", dayPart: "MORNING", caps: {} });
    expect(code(secondary)).toBe("attendance.call_scope_not_allowed");
  });

  it("isolation A/B : B ne voit ni les appels du matin ou de l'après-midi de A, ni sa politique ; sa propre politique est indépendante", async () => {
    const aSessions = unwrap(await listAttendanceSessions(world.deps, a.teacher.ctx, { classroomId: primary }));
    expect(aSessions.items.length).toBeGreaterThan(4);
    const fromB = unwrap(await listAttendanceSessions(world.deps, b.admin.ctx, { classroomId: primary }));
    expect(fromB.items).toEqual([]);
    const lookup = await getAttendanceSession(world.deps, b.admin.ctx, { sessionId: aSessions.items[0]!.id, caps: CAPS.admin });
    expect(lookup.ok).toBe(false);
    // B n'a aucune politique HALF_DAYS : la politique de A ne fuit pas.
    expect(unwrap(await listCallPolicyDefinitions(world.deps, b.admin.ctx)).filter((p) => p.dailyCallMode === "HALF_DAYS")).toEqual([]);
    // Sous le contexte de B, les lignes de A (séances, politiques) sont invisibles même en connaissant le tenant.
    const rows = await db.tenantDb.run(b.admin.ctx, async (tx) => ({
      sessions: await tx.many("SELECT id FROM attendance.sessions WHERE tenant_id = $1", [a.tenantId]),
      policies: await tx.many("SELECT education_level_code FROM attendance.call_policies WHERE tenant_id = $1", [a.tenantId]),
    }));
    expect(rows).toEqual({ sessions: [], policies: [] });
    // B ne peut pas poser de séance ni de politique au nom de A (WITH CHECK).
    await expect(
      db.tenantDb.run(b.admin.ctx, (tx) =>
        tx.query(`INSERT INTO attendance.call_policies (tenant_id, institution_id, education_level_code, call_scope, daily_call_mode) VALUES ($1,$2,'CP1','DAILY','HALF_DAYS')`, [a.tenantId, a.institutionId]),
      ),
    ).rejects.toThrow();
    // B ouvre ses propres appels : sa classe secondaire reste en appel par séance.
    const bOcc = addOccurrence(world, b);
    expect(unwrap(await openAttendanceSession(world.deps, b.teacher.ctx, { kind: "occurrence", occurrenceId: bOcc.occurrenceId, caps: {} })).session.dayPart).toBe("FULL");
  });
});
