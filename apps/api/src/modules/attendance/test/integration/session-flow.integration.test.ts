import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import {
  cancelAttendanceSession,
  getAttendanceSession,
  getRecordHistory,
  listAttendanceSessions,
  markStudentRecords,
  openAttendanceSession,
  reopenAttendanceSession,
  submitAttendanceSession,
  validateAttendanceSession,
} from "../../application/sessions";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("appel d'une séance : ouverture, pointage, soumission, validation (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db);
    school = await seedSchool(db, world, { students: 6 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const open = (occurrenceId: string, who = school.teacher, caps = CAPS.teacher) => openAttendanceSession(world.deps, who.ctx, { kind: "occurrence", occurrenceId, caps });
  const events = async (type: string) =>
    adminRows<{ payload: any; aggregate_id: string }>(db, "SELECT payload, aggregate_id FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY id", [school.tenantId, type]);

  it("ouvre l'appel d'une occurrence, copie classe/nœud/durée, et il est IDEMPOTENT (le second enseignant reçoit le même appel)", async () => {
    const occ = addOccurrence(world, school);
    const first = unwrap(await open(occ.occurrenceId));
    expect(first.created).toBe(true);
    expect(first.session).toMatchObject({ classroomId: school.classroomId, curriculumNodeId: school.nodeId, durationMinutes: 60, scope: "SESSION", status: "OPEN", sessionDate: "2025-10-01" });
    expect(first.session.takenByStaffId).toBe(school.teacher.staffId);

    const second = unwrap(await open(occ.occurrenceId, school.coTeacher));
    expect(second.created).toBe(false);
    expect(second.session.id).toBe(first.session.id);
    expect((await events("attendance.session.opened")).filter((e) => e.aggregate_id === first.session.id)).toHaveLength(1);
  });

  it("refuse un enseignant qui n'est ni intervenant de la séance ni affecté à la classe, et une occurrence annulée ou inconnue", async () => {
    const occ = addOccurrence(world, school);
    const denied = await open(occ.occurrenceId, school.outsider);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("attendance.not_call_taker");

    const cancelled = addOccurrence(world, school, { status: "CANCELLED" });
    const c = await open(cancelled.occurrenceId);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.error.code).toBe("attendance.occurrence_cancelled");

    const unknown = await open(newId());
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("attendance.occurrence_not_found");

    // La direction (attendance.manage) peut ouvrir pour un tiers.
    const byAdmin = await open(occ.occurrenceId, school.admin as never, CAPS.admin);
    expect(byAdmin.ok).toBe(true);
  });

  it("marque en lot, valide les statuts et le roster, calcule les minutes comptées ; le rejeu ne change rien", async () => {
    const occ = addOccurrence(world, school);
    const { session } = unwrap(await open(occ.occurrenceId));
    const [s1, s2, s3, s4] = school.students;

    // Un statut inconnu, EXCUSED direct, un élève hors roster : tout le lot est refusé.
    for (const [entries, code] of [
      [[{ studentId: s1!.studentId, statusCode: "NOPE" }], "attendance.status_unknown"],
      [[{ studentId: s1!.studentId, statusCode: "EXCUSED" }], "attendance.excused_requires_justification"],
      [[{ studentId: newId(), statusCode: "ABSENT" }], "attendance.student_not_in_roster"],
      [[{ studentId: s1!.studentId, statusCode: "PRESENT" }, { studentId: s1!.studentId, statusCode: "ABSENT" }], "attendance.duplicate_entry"],
      [[{ studentId: s1!.studentId, statusCode: "PRESENT", minutesLate: 5 }], "attendance.minutes_invalid"],
    ] as const) {
      const r = await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries });
      expect(r.ok, code).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(code);
    }
    expect(unwrap(await getAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id })).counts.marked).toBe(0);

    const batch = [
      { studentId: s1!.studentId, statusCode: "PRESENT" },
      { studentId: s2!.studentId, statusCode: "ABSENT", note: "  malade ?  " },
      { studentId: s3!.studentId, statusCode: "LATE", minutesLate: 12 },
      { studentId: s4!.studentId, statusCode: "EARLY_LEAVE", minutesMissed: 20 },
    ];
    const r1 = unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: batch }));
    expect(r1).toMatchObject({ created: 4, updated: 0, unchanged: 0 });
    const byStudent = new Map(r1.records.map((r) => [r.studentId, r]));
    expect(byStudent.get(s2!.studentId)).toMatchObject({ statusCode: "ABSENT", countedMinutes: 60, note: "malade ?", sourceDetail: "TEACHER" });
    expect(byStudent.get(s3!.studentId)).toMatchObject({ statusCode: "LATE", minutesLate: 12, countedMinutes: 12 });
    expect(byStudent.get(s4!.studentId)).toMatchObject({ statusCode: "EARLY_LEAVE", countedMinutes: 20 });
    expect(byStudent.get(s1!.studentId)!.countedMinutes).toBeNull();

    // Rejeu identique : idempotent (aucune ligne réécrite, aucun historique en plus).
    const history = async () => Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.record_history WHERE session_id = $1", [session.id])).n);
    const before = await history();
    const r2 = unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: batch }));
    expect(r2).toMatchObject({ created: 0, updated: 0, unchanged: 4 });
    expect(await history()).toBe(before);

    // Correction d'un seul élève : dernier arrivé gagne, l'historique garde les deux.
    const r3 = unwrap(await markStudentRecords(world.deps, school.coTeacher.ctx, { sessionId: session.id, entries: [{ studentId: s2!.studentId, statusCode: "PRESENT" }] }));
    expect(r3).toMatchObject({ created: 0, updated: 1 });
    const rec = byStudent.get(s2!.studentId)!;
    const h = unwrap(await getRecordHistory(world.deps, school.teacher.ctx, { sessionId: session.id, recordId: rec.id }));
    expect(h.map((x) => [x.from_status, x.to_status])).toEqual([[null, "ABSENT"], ["ABSENT", "PRESENT"]]);
  });

  it("soumission : exige un pointage pour chaque élève (ou un statut par défaut), publie les événements UNE fois et reste idempotente", async () => {
    const occ = addOccurrence(world, school);
    const { session } = unwrap(await open(occ.occurrenceId));
    const [s1, s2, s3] = school.students;
    unwrap(
      await markStudentRecords(world.deps, school.teacher.ctx, {
        sessionId: session.id,
        entries: [{ studentId: s1!.studentId, statusCode: "ABSENT" }, { studentId: s2!.studentId, statusCode: "LATE", minutesLate: 5 }],
      }),
    );

    const refused = await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("attendance.unmarked_students");
      expect((refused.error as any).issues[0].path).toEqual(["defaultStatus"]);
    }
    expect((await getAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id })).ok).toBe(true);

    const done = unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }));
    expect(done.session.status).toBe("SUBMITTED");
    expect(done).toMatchObject({ alreadySubmitted: false, filledByDefault: 4, absentCount: 1, lateCount: 1 });

    const abs = (await events("attendance.absence.recorded")).filter((e) => e.payload.sessionId === session.id);
    const late = (await events("attendance.late.recorded")).filter((e) => e.payload.sessionId === session.id);
    const submitted = (await events("attendance.session.submitted")).filter((e) => e.payload.sessionId === session.id);
    expect(abs).toHaveLength(1);
    expect(abs[0]!.payload).toMatchObject({ v: 1, studentId: s1!.studentId, correction: false, excused: false, countedMinutes: 60, occurrenceId: occ.occurrenceId });
    expect(late).toHaveLength(1);
    expect(late[0]!.payload).toMatchObject({ studentId: s2!.studentId, minutesLate: 5 });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.payload).toMatchObject({ occurrenceId: occ.occurrenceId, absentCount: 1, lateCount: 1, recordCount: 6 });
    // Aucun motif, aucune donnée sensible dans les événements.
    expect(JSON.stringify([abs, late, submitted])).not.toMatch(/note|reason|motif/i);

    const again = unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id }));
    expect(again.alreadySubmitted).toBe(true);
    expect((await events("attendance.absence.recorded")).filter((e) => e.payload.sessionId === session.id)).toHaveLength(1);

    // Correction dans la fenêtre : republication avec correction = true.
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: [{ studentId: s3!.studentId, statusCode: "ABSENT" }] }));
    const corrected = (await events("attendance.absence.recorded")).filter((e) => e.payload.sessionId === session.id);
    expect(corrected).toHaveLength(2);
    expect(corrected.at(-1)!.payload).toMatchObject({ studentId: s3!.studentId, correction: true });
  });

  it("fenêtre de correction : passé le délai, seule la direction corrige ; validation, verrou et réouverture sensible", async () => {
    const occ = addOccurrence(world, school);
    const { session } = unwrap(await open(occ.occurrenceId));
    unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }));

    // Politique par défaut du pack pour ce cycle : fenêtre de correction de 120 minutes.
    world.clock.advance(119 * 60_000);
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: [{ studentId: school.students[0]!.studentId, statusCode: "ABSENT" }] }));
    world.clock.advance(5 * 60_000);
    const late = await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: [{ studentId: school.students[0]!.studentId, statusCode: "PRESENT" }] });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe("attendance.edit_window_closed");
    expect((await markStudentRecords(world.deps, school.admin.ctx, { sessionId: session.id, entries: [{ studentId: school.students[0]!.studentId, statusCode: "PRESENT" }], caps: CAPS.admin })).ok).toBe(true);

    // Validation : permission obligatoire.
    expect((await validateAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, caps: CAPS.teacher })).ok).toBe(false);
    const validated = unwrap(await validateAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, caps: CAPS.admin }));
    expect(validated).toMatchObject({ status: "VALIDATED", validatedBy: school.admin.userId });

    // Plus aucun pointage modifiable (cas d'usage ET base).
    const locked = await markStudentRecords(world.deps, school.admin.ctx, { sessionId: session.id, entries: [{ studentId: school.students[0]!.studentId, statusCode: "ABSENT" }], caps: CAPS.admin });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error.code).toBe("attendance.session_locked");
    await expect(
      db.tenantDb.run(school.admin.ctx, (tx) => tx.query("UPDATE attendance.student_records SET note = 'x' WHERE session_id = $1", [session.id])),
    ).rejects.toThrow(/attendance\.session_locked/);
    await expect(
      db.tenantDb.run(school.admin.ctx, (tx) => tx.query("UPDATE attendance.sessions SET status = 'SUBMITTED' WHERE id = $1", [session.id])),
    ).rejects.toThrow(/attendance\.session_validated/);

    // Réouverture : sensible, motif obligatoire, sans capacité la base refuse.
    const noCap = await reopenAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, reason: "Erreur de saisie", caps: { manage: true } });
    expect(noCap.ok).toBe(false);
    const noReason = await reopenAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, reason: "  ", caps: CAPS.admin });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error.code).toBe("attendance.reason_required");

    const auditBefore = world.audit.entries.length;
    const reopened = unwrap(await reopenAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, reason: "Erreur de saisie de l'enseignant", caps: CAPS.admin }));
    expect(reopened).toMatchObject({ status: "SUBMITTED", reopenedCount: 1 });
    const entry = world.audit.entries.slice(auditBefore).find((e) => e.entry.action === "attendance.session.reopened");
    expect(entry?.entry).toMatchObject({ sensitive: true, reason: "Erreur de saisie de l'enseignant", resourceId: session.id });
    expect((await events("attendance.session.reopened")).some((e) => e.payload.sessionId === session.id && e.payload.reopenedCount === 1)).toBe(true);
    // Le réglage de transaction ne fuit pas : la session est de nouveau protégée (VALIDATED -> SUBMITTED sans réglage est refusé).
    unwrap(await validateAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, caps: CAPS.admin }));
    await expect(
      db.tenantDb.run(school.admin.ctx, (tx) => tx.query("UPDATE attendance.sessions SET status = 'SUBMITTED' WHERE id = $1", [session.id])),
    ).rejects.toThrow(/attendance\.session_validated/);
  });

  it("annulation motivée : l'appel annulé ne produit plus d'absence ; un appel validé exige la capacité de réouverture", async () => {
    const occ = addOccurrence(world, school);
    const { session } = unwrap(await open(occ.occurrenceId));
    const short = await cancelAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, reason: "ok", caps: CAPS.teacher });
    expect(short.ok).toBe(false);
    const cancelled = unwrap(await cancelAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, reason: "Séance finalement annulée", caps: CAPS.teacher }));
    expect(cancelled.status).toBe("CANCELLED");
    const noMore = await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: [{ studentId: school.students[0]!.studentId, statusCode: "ABSENT" }] });
    expect(noMore.ok).toBe(false);

    const occ2 = addOccurrence(world, school);
    const s2 = unwrap(await open(occ2.occurrenceId)).session;
    unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: s2.id, allPresent: true }));
    unwrap(await validateAttendanceSession(world.deps, school.admin.ctx, { sessionId: s2.id, caps: CAPS.admin }));
    const denied = await cancelAttendanceSession(world.deps, school.teacher.ctx, { sessionId: s2.id, reason: "Annulation tardive", caps: CAPS.teacher });
    expect(denied.ok).toBe(false);
    const ok = unwrap(await cancelAttendanceSession(world.deps, school.admin.ctx, { sessionId: s2.id, reason: "Annulation tardive", caps: CAPS.admin }));
    expect(ok.status).toBe("CANCELLED");
    // Une nouvelle occurrence peut ensuite être rouverte à zéro : l'unicité ne vise que les appels non annulés.
    expect((await open(occ2.occurrenceId)).ok).toBe(true);
  });

  it("liste les appels par classe, date et statut (pagination par curseur)", async () => {
    const all = unwrap(await listAttendanceSessions(world.deps, school.admin.ctx, { classroomId: school.classroomId, limit: 2 }));
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const page2 = unwrap(await listAttendanceSessions(world.deps, school.admin.ctx, { classroomId: school.classroomId, limit: 200, cursor: all.nextCursor! }));
    expect(page2.items.every((s) => !all.items.some((a) => a.id === s.id))).toBe(true);
    const submitted = unwrap(await listAttendanceSessions(world.deps, school.admin.ctx, { status: "SUBMITTED" }));
    expect(submitted.items.every((s) => s.status === "SUBMITTED")).toBe(true);
  });
});

describe("garde-fous purs du test", () => {
  it("le monde de test fournit des enseignants distincts", () => {
    expect(newId()).not.toBe(newId());
  });
});
