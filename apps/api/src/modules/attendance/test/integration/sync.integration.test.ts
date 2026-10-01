import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { markStudentRecords, openAttendanceSession, reopenAttendanceSession, submitAttendanceSession, validateAttendanceSession } from "../../application/sessions";
import { bulkMarkFromExternal } from "../../application/external";
import { listSyncConflicts, resolveSyncConflict, syncOfflineAttendance, type SyncBatchInput, type SyncRecordInput, type SyncSessionInput } from "../../application/sync";
import { upsertCallPolicy } from "../../application/reference";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("synchronisation hors-ligne : idempotence, rejeu, conflits, horodatage client vs serveur (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-10-01T12:00:00.000Z");
    school = await seedSchool(db, world, { students: 6 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const stu = (i: number) => school.students[i]!;
  const at = (hhmm: string) => new Date(`2025-10-01T${hhmm}:00.000Z`);
  const rec = (i: number, statusCode: string, hhmm = "11:00", extra: Partial<SyncRecordInput> = {}): SyncRecordInput => ({
    clientId: newId(), studentId: stu(i).studentId, statusCode, clientMarkedAt: at(hhmm), ...extra,
  });
  const session = (occurrenceId: string, records: SyncRecordInput[], extra: Partial<SyncSessionInput> = {}): SyncSessionInput => ({
    clientId: newId(), target: { occurrenceId }, clientOpenedAt: at("10:55"), records, ...extra,
  });
  const batch = (sessions: SyncSessionInput[], extra: Partial<SyncBatchInput> = {}): SyncBatchInput => ({
    batchId: newId(), deviceId: "tablette-salle-12", clientSentAt: at("12:00"), sessions, caps: CAPS.teacher, ...extra,
  });
  const sync = (b: SyncBatchInput, who = school.teacher) => syncOfflineAttendance(world.deps, who.ctx, b);
  const count = async (sql: string, params: unknown[] = []) => Number((await adminOne<{ n: string }>(db, sql, params)).n);
  const records = (sessionId: string) =>
    adminRows<any>(db, "SELECT student_id, status_code, marked_by, source_detail, client_id, client_marked_at FROM attendance.student_records WHERE session_id = $1", [sessionId]);

  it("applique un lot (ouverture + pointages + soumission), horodate côté serveur, et le REJEU du lot ne crée aucun doublon", async () => {
    const occA = addOccurrence(world, school);
    const occB = addOccurrence(world, school);
    const a = session(occA.occurrenceId, [rec(0, "PRESENT"), rec(1, "ABSENT", "11:01"), rec(2, "LATE", "11:02", { minutesLate: 7 })], { submit: { defaultStatus: "PRESENT" } });
    const b = session(occB.occurrenceId, [rec(3, "ABSENT", "11:03")]);
    const input = batch([a, b]);

    const r1 = unwrap(await sync(input));
    expect(r1.totals).toEqual({ applied: 4, unchanged: 0, replayed: 0, conflicts: 0, rejected: 0 });
    expect(r1.receivedAt.toISOString()).toBe("2025-10-01T12:00:00.000Z");
    const [ra, rb] = r1.sessions;
    expect(ra).toMatchObject({ clientId: a.clientId, outcome: "OPENED", submitted: true, sessionStatus: "SUBMITTED", errorCode: null });
    expect(rb).toMatchObject({ outcome: "OPENED", submitted: false, sessionStatus: "OPEN" });
    expect(ra!.records.map((x) => x.outcome)).toEqual(["APPLIED", "APPLIED", "APPLIED"]);

    const stored = await records(ra!.sessionId!);
    expect(stored).toHaveLength(6); // 3 pointés + 3 « présent par défaut »
    const absent = stored.find((s) => s.student_id === stu(1).studentId)!;
    expect(absent).toMatchObject({ status_code: "ABSENT", source_detail: "OFFLINE_SYNC", client_id: a.records[1]!.clientId });
    expect(new Date(absent.client_marked_at).toISOString()).toBe("2025-10-01T11:01:00.000Z"); // horodatage appareil conservé
    const session1 = await adminOne<any>(db, "SELECT source, client_id FROM attendance.sessions WHERE id = $1", [ra!.sessionId]);
    expect(session1).toMatchObject({ source: "OFFLINE_SYNC", client_id: a.clientId });

    // Rejeu du MÊME lot (réponse perdue) : rien n'est dupliqué, le résultat d'origine revient.
    const sessionsBefore = await count("SELECT count(*) AS n FROM attendance.sessions");
    const recordsBefore = await count("SELECT count(*) AS n FROM attendance.student_records");
    const historyBefore = await count("SELECT count(*) AS n FROM attendance.record_history");
    const eventsBefore = await count("SELECT count(*) AS n FROM kernel.domain_events WHERE type LIKE 'attendance.%'");
    const r2 = unwrap(await sync(input));
    expect(r2.totals).toEqual({ applied: 0, unchanged: 0, replayed: 4, conflicts: 0, rejected: 0 });
    expect(r2.sessions.map((s) => s.outcome)).toEqual(["REPLAYED", "REPLAYED"]);
    expect(r2.sessions.map((s) => s.sessionId)).toEqual(r1.sessions.map((s) => s.sessionId));
    expect(await count("SELECT count(*) AS n FROM attendance.sessions")).toBe(sessionsBefore);
    expect(await count("SELECT count(*) AS n FROM attendance.student_records")).toBe(recordsBefore);
    expect(await count("SELECT count(*) AS n FROM attendance.record_history")).toBe(historyBefore);
    expect(await count("SELECT count(*) AS n FROM kernel.domain_events WHERE type LIKE 'attendance.%'")).toBe(eventsBefore);
    expect(await count("SELECT count(*) AS n FROM attendance.sync_ops")).toBe(2 + 4);

    // Nouveau lot (autre batchId) qui répète des pointages déjà reçus + un nouveau : seul le nouveau est appliqué.
    const extra = rec(4, "ABSENT", "11:10");
    const r3 = unwrap(await sync(batch([{ ...b, records: [...b.records, extra] }])));
    expect(r3.sessions[0]!.records.map((x) => x.outcome)).toEqual(["REPLAYED", "APPLIED"]);
  });

  it("le même clientId avec un AUTRE contenu est refusé (clé d'idempotence réutilisée) ; le reste du lot passe", async () => {
    const occ = addOccurrence(world, school);
    const first = rec(0, "ABSENT");
    const s = session(occ.occurrenceId, [first]);
    unwrap(await sync(batch([s])));
    const tampered = { ...first, statusCode: "PRESENT" };
    const fresh = rec(1, "ABSENT");
    const r = unwrap(await sync(batch([{ ...s, records: [tampered, fresh] }])));
    expect(r.sessions[0]!.records.map((x) => [x.outcome, x.errorCode])).toEqual([["REJECTED", "attendance.idempotency_key_reused"], ["APPLIED", null]]);
    // Une séance rejouée avec une autre cible est refusée en bloc.
    const other = addOccurrence(world, school);
    const r2 = unwrap(await sync(batch([{ ...s, target: { occurrenceId: other.occurrenceId } }])));
    expect(r2.sessions[0]).toMatchObject({ outcome: "REJECTED", errorCode: "attendance.idempotency_key_reused" });
  });

  it("pointage invalide ou élève hors roster : rejeté seul, sans bloquer les autres ; un enseignant étranger est refusé", async () => {
    const occ = addOccurrence(world, school);
    const good = rec(0, "ABSENT");
    const outRoster = { ...rec(0, "ABSENT"), studentId: newId() };
    const badStatus = rec(1, "ZZZ");
    const excused = rec(2, "EXCUSED");
    const r = unwrap(await sync(batch([session(occ.occurrenceId, [good, outRoster, badStatus, excused])])));
    expect(r.sessions[0]!.records.map((x) => x.errorCode ?? x.outcome)).toEqual([
      "APPLIED", "attendance.student_not_in_roster", "attendance.status_unknown", "attendance.excused_requires_justification",
    ]);
    // Rejouer un pointage rejeté le rejette de nouveau (il n'est pas mémorisé comme traité).
    const again = unwrap(await sync(batch([session(occ.occurrenceId, [badStatus])])));
    expect(again.sessions[0]!.records[0]).toMatchObject({ outcome: "REJECTED", errorCode: "attendance.status_unknown" });

    const denied = unwrap(await sync(batch([session(addOccurrence(world, school).occurrenceId, [rec(0, "ABSENT")])]), school.outsider));
    expect(denied.sessions[0]).toMatchObject({ outcome: "REJECTED", errorCode: "attendance.not_call_taker" });
    expect(denied.totals.rejected).toBe(1);
  });

  it("plusieurs saisies du même élève dans un lot : la plus récente gagne, les antérieures sont dépassées", async () => {
    const occ = addOccurrence(world, school);
    const early = rec(0, "ABSENT", "11:00");
    const later = rec(0, "PRESENT", "11:20");
    const r = unwrap(await sync(batch([session(occ.occurrenceId, [later, early])])));
    expect(r.sessions[0]!.records.map((x) => x.outcome)).toEqual(["APPLIED", "UNCHANGED"]);
    expect((await records(r.sessions[0]!.sessionId!))[0]).toMatchObject({ status_code: "PRESENT" });
  });

  it("horodatage client vs serveur : plus récent gagne, plus ancien d'un autre auteur -> file de conflits, dérive d'horloge corrigée", async () => {
    const occ = addOccurrence(world, school);
    const { session: s } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    // Le serveur enregistre l'enseignant à 12:00 (horloge figée du test).
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: s.id, entries: [{ studentId: stu(0).studentId, statusCode: "PRESENT" }, { studentId: stu(1).studentId, statusCode: "PRESENT" }, { studentId: stu(2).studentId, statusCode: "PRESENT" }] }));
    world.clock.advance(60_000); // 12:01

    const olderOtherAuthor = rec(0, "ABSENT", "11:30"); // saisie hors-ligne du co-enseignant, antérieure
    const newerOtherAuthor = rec(1, "ABSENT", "12:01"); // postérieure au pointage serveur de 12:00
    const olderSameAuthor = rec(2, "ABSENT", "11:30"); // même auteur que le pointage serveur
    const r1 = unwrap(await sync(batch([session(occ.occurrenceId, [olderOtherAuthor, newerOtherAuthor])]), school.coTeacher));
    expect(r1.sessions[0]!.records.map((x) => x.outcome)).toEqual(["CONFLICT", "APPLIED"]);
    const conflictId = r1.sessions[0]!.records[0]!.conflictId!;
    expect(conflictId).toBeTruthy();
    const r1b = unwrap(await sync(batch([session(occ.occurrenceId, [olderSameAuthor])]), school.teacher));
    expect(r1b.sessions[0]!.records[0]!.outcome).toBe("UNCHANGED"); // son propre pointage plus récent existe déjà

    // Rien n'a été écrit pour le pointage en conflit ; le conflit expose les deux valeurs à l'arbitre.
    expect((await records(s.id)).find((x) => x.student_id === stu(0).studentId)).toMatchObject({ status_code: "PRESENT" });
    const conflicts = unwrap(await listSyncConflicts(world.deps, school.admin.ctx, { status: "OPEN", sessionId: s.id }));
    expect(conflicts.items).toHaveLength(1);
    expect(conflicts.items[0]).toMatchObject({ id: conflictId, kind: "STALE", studentId: stu(0).studentId, submittedBy: school.coTeacher.userId, deviceId: "tablette-salle-12" });
    expect(conflicts.items[0]!.incoming).toMatchObject({ statusCode: "ABSENT" });
    expect(conflicts.items[0]!.existing).toMatchObject({ statusCode: "PRESENT", markedBy: school.teacher.userId });

    // Rejouer le lot : le conflit n'est PAS recréé, l'identifiant est le même.
    const replay = unwrap(await sync(batch([session(occ.occurrenceId, [olderOtherAuthor])]), school.coTeacher));
    expect(replay.sessions[0]!.records[0]).toMatchObject({ outcome: "REPLAYED", conflictId });
    expect(await count("SELECT count(*) AS n FROM attendance.sync_conflicts WHERE session_id = $1", [s.id])).toBe(1);

    // Arbitrage : seule la direction ; ACCEPT_INCOMING applique la saisie de l'appareil.
    expect((await resolveSyncConflict(world.deps, school.teacher.ctx, { conflictId, resolution: "ACCEPT_INCOMING", caps: CAPS.teacher })).ok).toBe(false);
    const resolved = unwrap(await resolveSyncConflict(world.deps, school.admin.ctx, { conflictId, resolution: "ACCEPT_INCOMING", note: "Le co-enseignant avait raison", caps: CAPS.admin }));
    expect(resolved).toMatchObject({ status: "RESOLVED", resolution: "ACCEPT_INCOMING", resolvedBy: school.admin.userId });
    expect((await records(s.id)).find((x) => x.student_id === stu(0).studentId)).toMatchObject({ status_code: "ABSENT" });
    expect((await resolveSyncConflict(world.deps, school.admin.ctx, { conflictId, resolution: "KEEP_EXISTING", caps: CAPS.admin })).ok).toBe(false);
    expect(world.audit.actions()).toContain("attendance.sync_conflict.resolved");

    // Dérive d'horloge : l'appareil croit être à 13:30 alors qu'il est 11:30 réel (2 h d'avance).
    const driftedStale = rec(3, "ABSENT", "13:30");
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: s.id, entries: [{ studentId: stu(3).studentId, statusCode: "PRESENT" }] })); // 12:01 serveur
    world.clock.advance(60_000); // réception à 12:02
    const noCorrection = unwrap(await sync(batch([session(occ.occurrenceId, [driftedStale])]), school.coTeacher));
    expect(noCorrection.sessions[0]!.records[0]!.outcome).toBe("APPLIED"); // sans correction : plafonné à la réception, donc « plus récent »
    const drifted2 = rec(4, "ABSENT", "13:30");
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: s.id, entries: [{ studentId: stu(4).studentId, statusCode: "PRESENT" }] })); // 12:02 serveur
    world.clock.advance(60_000); // réception à 12:03
    const corrected = unwrap(await sync(batch([session(occ.occurrenceId, [drifted2])], { clockOffsetMs: -2 * 3_600_000 }), school.coTeacher));
    expect(corrected.sessions[0]!.records[0]!.outcome).toBe("CONFLICT"); // 13:30 - 2 h = 11:30 : antérieur au pointage serveur de 12:02
  });

  it("séance validée, annulée ou hors fenêtre : AUCUN pointage n'est écrit, tout va dans la file de conflits", async () => {
    const occ = addOccurrence(world, school);
    const { session: s } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: s.id, allPresent: true }));
    unwrap(await validateAttendanceSession(world.deps, school.admin.ctx, { sessionId: s.id, caps: CAPS.admin }));

    const late = rec(0, "ABSENT");
    const r = unwrap(await sync(batch([session(occ.occurrenceId, [late])])));
    expect(r.sessions[0]!.records[0]).toMatchObject({ outcome: "CONFLICT" });
    const c = (await adminRows<any>(db, "SELECT kind, status FROM attendance.sync_conflicts WHERE session_id = $1", [s.id]))[0];
    expect(c).toMatchObject({ kind: "SESSION_LOCKED", status: "OPEN" });
    expect((await records(s.id)).every((x) => x.status_code === "PRESENT")).toBe(true);

    // ACCEPT_INCOMING est impossible tant que l'appel est validé : il faut d'abord le rouvrir (acte sensible).
    const conflictId = r.sessions[0]!.records[0]!.conflictId!;
    const refused = await resolveSyncConflict(world.deps, school.admin.ctx, { conflictId, resolution: "ACCEPT_INCOMING", caps: CAPS.admin });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("attendance.session_locked");
    unwrap(await reopenAttendanceSession(world.deps, school.admin.ctx, { sessionId: s.id, reason: "Pointage reçu en retard", caps: CAPS.admin }));
    expect(unwrap(await resolveSyncConflict(world.deps, school.admin.ctx, { conflictId, resolution: "ACCEPT_INCOMING", caps: CAPS.admin })).status).toBe("RESOLVED");
    expect((await records(s.id)).find((x) => x.student_id === stu(0).studentId)).toMatchObject({ status_code: "ABSENT" });

    // Fenêtre de correction close : un enseignant hors-ligne tardif est mis en file, la direction (manage) passe.
    world.clock.advance(3 * 3_600_000);
    const windowClosed = rec(1, "ABSENT");
    const r2 = unwrap(await sync(batch([session(occ.occurrenceId, [windowClosed])])));
    expect(r2.sessions[0]!.records[0]!.outcome).toBe("CONFLICT");
    expect((await adminOne<any>(db, "SELECT kind FROM attendance.sync_conflicts WHERE client_op_id = $1", [windowClosed.clientId])).kind).toBe("WINDOW_CLOSED");
    const byAdmin = unwrap(await sync(batch([session(occ.occurrenceId, [rec(2, "ABSENT", "23:00")])], { caps: CAPS.admin }), school.admin as never));
    expect(byAdmin.sessions[0]!.records[0]!.outcome).toBe("APPLIED");
  });

  it("soumission demandée mais incomplète : l'appel reste ouvert, les pointages sont conservés, le lot n'échoue pas", async () => {
    const occ = addOccurrence(world, school);
    const r = unwrap(await sync(batch([session(occ.occurrenceId, [rec(0, "ABSENT")], { submit: {} })])));
    expect(r.sessions[0]).toMatchObject({ submitted: false, sessionStatus: "OPEN", errorCode: "attendance.unmarked_students" });
    expect(r.sessions[0]!.records[0]!.outcome).toBe("APPLIED");
    expect(await records(r.sessions[0]!.sessionId!)).toHaveLength(1);
    // Le renvoi avec un statut par défaut finit le travail (pointage déjà reçu : REPLAYED).
    const done = unwrap(await sync(batch([{ ...session(occ.occurrenceId, []), clientId: r.sessions[0]!.clientId, submit: { defaultStatus: "PRESENT" } }])));
    expect(done.sessions[0]).toMatchObject({ submitted: true, sessionStatus: "SUBMITTED", outcome: "REPLAYED" });
  });

  it("DEUX enseignants synchronisent la MÊME séance en même temps : une seule séance, un pointage par élève, aucun interblocage", async () => {
    const occ = addOccurrence(world, school);
    const mk = (who: typeof school.teacher, status: string) =>
      sync(batch([session(occ.occurrenceId, school.students.map((_, i) => rec(i, status, "11:30")))], { deviceId: `appareil-${who.staffId.slice(-4)}` }), who);
    const [x, y] = await Promise.all([mk(school.teacher, "ABSENT"), mk(school.coTeacher, "LATE")].map(async (p) => unwrap(await p)));
    const ids = new Set([x.sessions[0]!.sessionId, y.sessions[0]!.sessionId]);
    expect(ids.size).toBe(1);
    expect([x.sessions[0]!.outcome, y.sessions[0]!.outcome].sort()).toEqual(["EXISTING", "OPENED"]);
    const sessionId = [...ids][0]!;
    expect(await count("SELECT count(*) AS n FROM attendance.sessions WHERE occurrence_id = $1", [occ.occurrenceId])).toBe(1);
    const stored = await records(sessionId);
    expect(stored).toHaveLength(school.students.length);
    expect(new Set(stored.map((s) => s.student_id)).size).toBe(school.students.length);
    // Même horodatage appareil des deux côtés : le premier arrivé est conservé, le second va en conflit ou est inchangé — jamais d'erreur.
    const outcomes = [...x.sessions[0]!.records, ...y.sessions[0]!.records].map((r) => r.outcome);
    expect(outcomes.every((o) => ["APPLIED", "CONFLICT", "UNCHANGED"].includes(o))).toBe(true);
    expect(await count("SELECT count(*) AS n FROM attendance.sync_conflicts WHERE session_id = $1", [sessionId])).toBe(outcomes.filter((o) => o === "CONFLICT").length);
  });

  it("rejeu SIMULTANÉ du même lot (double envoi réseau) : un seul effet", async () => {
    const occ = addOccurrence(world, school);
    const input = batch([session(occ.occurrenceId, [rec(0, "ABSENT"), rec(1, "LATE", "11:05", { minutesLate: 3 })])]);
    const results = await Promise.all([sync(input), sync(input), sync(input)].map(async (p) => unwrap(await p)));
    const sessionId = results[0]!.sessions[0]!.sessionId!;
    expect(results.every((r) => r.sessions[0]!.sessionId === sessionId)).toBe(true);
    expect(results.map((r) => r.totals.applied).sort()).toEqual([0, 0, 2]);
    expect(await count("SELECT count(*) AS n FROM attendance.sessions WHERE occurrence_id = $1", [occ.occurrenceId])).toBe(1);
    expect(await records(sessionId)).toHaveLength(2);
    expect(await count("SELECT count(*) AS n FROM attendance.sync_ops WHERE session_id = $1", [sessionId])).toBe(3);
  });

  it("appel journalier hors-ligne (primaire) : une seule séance par classe et par jour", async () => {
    const primary = newId();
    world.ports.roster.addClassroom({ classroomId: primary, institutionId: school.institutionId, academicYearId: school.yearId, educationLevelCode: "PRIMARY", active: true });
    world.ports.people.assign(school.teacher.staffId, primary);
    const kid = newId();
    const kidEnrollment = newId();
    world.ports.roster.addEnrollment({ enrollmentId: kidEnrollment, studentId: kid, classroomId: primary, institutionId: school.institutionId, academicYearId: school.yearId, active: true, academicYearStart: "2025-09-01", academicYearEnd: "2026-06-30" });
    unwrap(await upsertCallPolicy(world.deps, school.admin.ctx, { institutionId: school.institutionId, educationLevelCode: "PRIMARY", callScope: "DAILY", dailyMinutes: 300 }));

    const target = { scope: "DAILY" as const, classroomId: primary, date: "2025-10-01" };
    const s1 = { clientId: newId(), target, clientOpenedAt: at("07:30"), records: [{ clientId: newId(), studentId: kid, statusCode: "ABSENT", clientMarkedAt: at("07:45") }] };
    const r1 = unwrap(await sync(batch([s1])));
    expect(r1.sessions[0]).toMatchObject({ outcome: "OPENED" });
    const r2 = unwrap(await sync(batch([{ ...s1, clientId: newId(), records: [] }]))); // autre appareil, même classe et même jour
    expect(r2.sessions[0]).toMatchObject({ outcome: "EXISTING", sessionId: r1.sessions[0]!.sessionId });
    // L'absence journalière est comptée en minutes via la politique d'établissement (daily_minutes), pas via une constante.
    expect((await adminOne<any>(db, "SELECT counted_minutes FROM attendance.student_records WHERE session_id = $1", [r1.sessions[0]!.sessionId])).counted_minutes).toBe(300);
    // Un appel SESSION sur cette classe de cycle DAILY est refusé par la politique.
    const occ = addOccurrence(world, school, { classroomId: primary });
    const refused = unwrap(await sync(batch([session(occ.occurrenceId, [])])));
    expect(refused.sessions[0]).toMatchObject({ outcome: "REJECTED", errorCode: "attendance.call_scope_not_allowed" });
  });

  it("pont externe (visio) : n'écrase JAMAIS un pointage saisi par un humain", async () => {
    const occ = addOccurrence(world, school);
    const { session: s } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: s.id, entries: [{ studentId: stu(0).studentId, statusCode: "PRESENT" }] }));

    const denied = await bulkMarkFromExternal(world.deps, school.teacher.ctx, { sessionId: s.id, entries: [{ studentId: stu(0).studentId, statusCode: "ABSENT" }], caps: CAPS.teacher });
    expect(denied.ok).toBe(false);
    const entries = [
      { studentId: stu(0).studentId, statusCode: "ABSENT" }, // saisi par l'enseignant : protégé
      { studentId: stu(1).studentId, statusCode: "ABSENT", evidence: { note: "Connecté 12 min sur 60" } },
      { studentId: stu(2).studentId, statusCode: "PRESENT" },
    ];
    const r = unwrap(await bulkMarkFromExternal(world.deps, school.admin.ctx, { sessionId: s.id, entries, caps: CAPS.admin }));
    expect(r.results.map((x) => x.outcome)).toEqual(["SKIPPED_MANUAL", "APPLIED", "APPLIED"]);
    const stored = await records(s.id);
    expect(stored.find((x) => x.student_id === stu(0).studentId)).toMatchObject({ status_code: "PRESENT", source_detail: "TEACHER" });
    expect(stored.find((x) => x.student_id === stu(1).studentId)).toMatchObject({ status_code: "ABSENT", source_detail: "LIVE_CLASS" });
    // Rejeu : inchangé ; et le pont peut corriger SES propres pointages.
    const again = unwrap(await bulkMarkFromExternal(world.deps, school.admin.ctx, { sessionId: s.id, entries, caps: CAPS.admin }));
    expect(again.results.map((x) => x.outcome)).toEqual(["SKIPPED_MANUAL", "UNCHANGED", "UNCHANGED"]);
    const fix = unwrap(await bulkMarkFromExternal(world.deps, school.admin.ctx, { sessionId: s.id, entries: [{ studentId: stu(1).studentId, statusCode: "PRESENT" }], caps: CAPS.admin }));
    expect(fix.results[0]!.outcome).toBe("APPLIED");
  });
});
