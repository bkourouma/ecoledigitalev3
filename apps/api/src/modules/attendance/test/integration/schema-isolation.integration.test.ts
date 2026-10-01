import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { attendanceIsolationAllowlistTables, attendanceIsolationFixtures, attendanceTenantTables } from "../../../isolation-allowlist.attendance";
import { instantiateAttendancePack } from "../../application/reference";
import { getAttendanceSession, markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../application/sessions";
import { getJustification, submitJustification } from "../../application/justifications";
import { adminOne, adminRows, createAttendanceTestDb, ctxFor, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("isolation multi-tenant et invariants de la base (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let a: School;
  let tenantB: string;
  let sessionA: string;
  let justificationA: string;

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-10-01T12:00:00.000Z");
    a = await seedSchool(db, world, { students: 3 });
    tenantB = await db.createTenant();
    const occ = addOccurrence(world, a);
    sessionA = unwrap(await openAttendanceSession(world.deps, a.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} })).session.id;
    unwrap(await markStudentRecords(world.deps, a.teacher.ctx, { sessionId: sessionA, entries: [{ studentId: a.students[0]!.studentId, statusCode: "ABSENT" }] }));
    unwrap(await submitAttendanceSession(world.deps, a.teacher.ctx, { sessionId: sessionA, allPresent: true }));
    justificationA = unwrap(await submitJustification(world.deps, a.guardian.ctx, { studentId: a.guardian.studentId, fromDate: "2025-10-01", toDate: "2025-10-01", reasonCode: "ILLNESS", caps: CAPS.guardian })).justification.id;
    unwrap(await instantiateAttendancePack(world.deps, ctxFor(tenantB)));
  });
  afterAll(async () => {
    await db.drop();
  });

  it("test d'isolation générique : structure + comportement de chaque table du schéma attendance, allowlist vide", async () => {
    const options = { pool: db.appPool, schemas: ["attendance"], allowlist: attendanceIsolationAllowlistTables, fixtures: attendanceIsolationFixtures as never };
    const report = await checkTenantIsolation(options);
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(report.allowlisted).toEqual([]);
    const covered = new Set([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]);
    expect([...covered].sort()).toEqual([...attendanceTenantTables].sort());
    console.info(`[attendance] isolation : ${report.behavioural.length} tables testées en comportement, ${report.structuralOnly.length} en structure (FK composites)`);
    await assertTenantIsolation(options);
  });

  it("aucune table du schéma n'échappe à la liste attendue ; RLS activée ET forcée partout", async () => {
    const tables = await adminRows<{ t: string }>(db, "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'attendance' AND table_type = 'BASE TABLE' ORDER BY 1");
    expect(tables.map((r) => r.t)).toEqual([...attendanceTenantTables].sort());
    const noRls = await adminRows(db, "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'attendance' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)");
    expect(noRls).toEqual([]);
  });

  it("sous le tenant B, AUCUNE ligne du tenant A n'est visible ni modifiable dans aucune table", async () => {
    const b = ctxFor(tenantB);
    for (const table of attendanceTenantTables) {
      const rows = await db.tenantDb.run(b, (tx) => tx.many(`SELECT * FROM ${table} WHERE tenant_id = $1`, [a.tenantId]));
      expect(rows, table).toHaveLength(0);
    }
    const own = await db.tenantDb.run(a.admin.ctx, (tx) => tx.many("SELECT id FROM attendance.student_records"));
    expect(own.length).toBeGreaterThan(0);
    const upd = await db.tenantDb.run(b, (tx) => tx.query("UPDATE attendance.student_records SET note = 'piraté'"));
    expect(upd.rowCount).toBe(0);
    const del = await db.tenantDb.run(b, (tx) => tx.query("DELETE FROM attendance.student_records"));
    expect(del.rowCount).toBe(0);
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.student_records WHERE note = 'piraté'")).n)).toBe(0);
    // Sans contexte de tenant : rien n'est visible ni insérable (échec fermé).
    const client = await db.appPool.connect();
    try {
      expect((await client.query("SELECT count(*)::int AS n FROM attendance.sessions")).rows[0].n).toBe(0);
      await expect(
        client.query("INSERT INTO attendance.justification_reasons (id, tenant_id, code, label) VALUES ($1,$2,'ZZZ','z')", [newId(), a.tenantId]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
  });

  it("cas d'usage : le tenant B ne lit, ne pointe, ne justifie ni ne synchronise sur les objets du tenant A", async () => {
    const b = ctxFor(tenantB, newId(), ["enseignant"]);
    const read = await getAttendanceSession(world.deps, b, { sessionId: sessionA });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error.code).toBe("attendance.session_not_found");
    const mark = await markStudentRecords(world.deps, b, { sessionId: sessionA, entries: [{ studentId: a.students[1]!.studentId, statusCode: "ABSENT" }], caps: CAPS.admin });
    expect(mark.ok).toBe(false);
    const just = await getJustification(world.deps, b, { justificationId: justificationA, caps: { justificationRead: true, justificationDecide: true } });
    expect(just.ok).toBe(false);
    if (!just.ok) expect(just.error.code).toBe("attendance.justification_not_found");

    // La clé d'idempotence est PAR TENANT : le même clientId peut exister chez A et chez B sans collision ni fuite.
    const clientId = newId();
    for (const tenant of [a.tenantId, tenantB]) {
      await db.admin.query(
        "INSERT INTO attendance.sync_ops (tenant_id, client_id, kind, payload_hash, outcome) VALUES ($1,$2,'SESSION',$3,'OPENED')",
        [tenant, clientId, "0".repeat(64)],
      );
    }
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.sync_ops WHERE client_id = $1", [clientId])).n)).toBe(2);
    const seenByB = await db.tenantDb.run(b, (tx) => tx.many("SELECT tenant_id FROM attendance.sync_ops WHERE client_id = $1", [clientId]));
    expect(seenByB).toEqual([{ tenant_id: tenantB }]);
  });

  describe("invariants imposés par la base (superuser : seules les contraintes et déclencheurs jugent)", () => {
    const q = (sql: string, params: unknown[] = []) => db.admin.query(sql, params);
    const insertSession = (over: Record<string, unknown> = {}) => {
      const row = {
        id: newId(), tenant_id: a.tenantId, institution_id: a.institutionId, academic_year_id: a.yearId, classroom_id: a.classroomId, curriculum_node_id: a.nodeId,
        occurrence_id: newId(), scope: "SESSION", session_date: "2025-10-02", status: "OPEN", ...over,
      };
      const cols = Object.keys(row);
      return q(`INSERT INTO attendance.sessions (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(row));
    };
    const insertRecord = (sessionId: string, over: Record<string, unknown> = {}) => {
      const row = { id: newId(), tenant_id: a.tenantId, session_id: sessionId, enrollment_id: newId(), student_id: newId(), status_code: "PRESENT", marked_by: a.admin.userId, ...over };
      const cols = Object.keys(row);
      return q(`INSERT INTO attendance.student_records (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, Object.values(row));
    };

    it("statuts : EXCUSED sans justificatif, statut inconnu et statut désactivé sont refusés", async () => {
      const { rows } = await insertSession();
      const sid = rows[0].id;
      await expect(insertRecord(sid, { status_code: "EXCUSED", excused: true })).rejects.toThrow(/check constraint/i);
      await expect(insertRecord(sid, { status_code: "EXCUSED" })).rejects.toThrow(/check constraint/i);
      await expect(insertRecord(sid, { excused: true })).rejects.toThrow(/check constraint/i);
      await expect(insertRecord(sid, { status_code: "INEXISTANT" })).rejects.toThrow(/foreign key/i);
      await q("INSERT INTO attendance.status_definitions (id, tenant_id, subject_kind, code, label, active, counts_as_absence) VALUES ($1,$2,'STUDENT','MEDICAL_LEAVE','Congé médical', false, true)", [newId(), a.tenantId]);
      await expect(insertRecord(sid, { status_code: "MEDICAL_LEAVE" })).rejects.toThrow(/attendance\.status_inactive/);
      // Un statut ne peut pas être à la fois présence et absence ; « justifié » exige absence ou retard.
      await expect(q("INSERT INTO attendance.status_definitions (id, tenant_id, subject_kind, code, label, counts_as_present, counts_as_absence) VALUES ($1,$2,'STUDENT','BIZARRE','x', true, true)", [newId(), a.tenantId])).rejects.toThrow(/check constraint/i);
      await expect(q("INSERT INTO attendance.status_definitions (id, tenant_id, subject_kind, code, label, is_justified) VALUES ($1,$2,'STUDENT','BIZARRE2','x', true)", [newId(), a.tenantId])).rejects.toThrow(/check constraint/i);
    });

    it("unicités : un appel par occurrence, un appel journalier par classe et par jour, un pointage par (séance, inscription), clientId unique", async () => {
      const occ = newId();
      await insertSession({ occurrence_id: occ });
      await expect(insertSession({ occurrence_id: occ })).rejects.toThrow(/sessions_one_per_occurrence/);
      await insertSession({ occurrence_id: occ, status: "CANCELLED" }); // une séance annulée libère l'occurrence
      await insertSession({ scope: "DAILY", occurrence_id: null, curriculum_node_id: null, session_date: "2025-11-03" });
      await expect(insertSession({ scope: "DAILY", occurrence_id: null, curriculum_node_id: null, session_date: "2025-11-03" })).rejects.toThrow(/sessions_one_daily/);
      const cid = newId();
      await insertSession({ client_id: cid });
      await expect(insertSession({ client_id: cid })).rejects.toThrow(/sessions_client_id/);
      const sid = (await insertSession()).rows[0].id;
      const enrollment = newId();
      await insertRecord(sid, { enrollment_id: enrollment });
      await expect(insertRecord(sid, { enrollment_id: enrollment })).rejects.toThrow(/student_records_tenant_id_session_id_enrollment_id_key/);
      // Portée : SESSION exige occurrence ou nœud ; DAILY n'en a pas.
      await expect(insertSession({ occurrence_id: null, curriculum_node_id: null })).rejects.toThrow(/check constraint/i);
      await expect(insertSession({ scope: "DAILY", session_date: "2025-11-04" })).rejects.toThrow(/check constraint/i);
    });

    it("séance : transitions légales seulement, identité figée, validation tracée, suppression interdite", async () => {
      const sid = (await insertSession()).rows[0].id;
      await expect(q("UPDATE attendance.sessions SET status = 'VALIDATED', submitted_at = now(), validated_at = now(), validated_by = $2 WHERE id = $1", [sid, a.admin.userId])).rejects.toThrow(/attendance\.session_transition/);
      await expect(q("UPDATE attendance.sessions SET status = 'SUBMITTED' WHERE id = $1", [sid])).rejects.toThrow(/check constraint/i); // submitted_at manquant
      await q("UPDATE attendance.sessions SET status = 'SUBMITTED', submitted_at = now() WHERE id = $1", [sid]);
      await expect(q("UPDATE attendance.sessions SET status = 'VALIDATED' WHERE id = $1", [sid])).rejects.toThrow(/check constraint/i); // validé sans auteur
      await q("UPDATE attendance.sessions SET status = 'VALIDATED', validated_at = now(), validated_by = $2 WHERE id = $1", [sid, a.admin.userId]);
      await expect(q("UPDATE attendance.sessions SET status = 'SUBMITTED' WHERE id = $1", [sid])).rejects.toThrow(/attendance\.session_validated/);
      await expect(q("UPDATE attendance.sessions SET classroom_id = $2 WHERE id = $1", [sid, newId()])).rejects.toThrow(/attendance\.session_identity_immutable/);
      await expect(q("DELETE FROM attendance.sessions WHERE id = $1", [sid])).rejects.toThrow(/attendance\.immutable/);
      // Le réglage de réouverture, lui, ouvre la porte.
      await q("BEGIN");
      await q("SELECT set_config('attendance.reopen', 'on', true)");
      await q("UPDATE attendance.sessions SET status = 'SUBMITTED' WHERE id = $1", [sid]);
      await q("COMMIT");
      expect((await adminOne<any>(db, "SELECT status FROM attendance.sessions WHERE id = $1", [sid])).status).toBe("SUBMITTED");
    });

    it("pointages : verrouillés sur un appel validé ou annulé, historique automatique et immuable, suppression interdite à l'application après coup", async () => {
      const sid = (await insertSession()).rows[0].id;
      const rid = (await insertRecord(sid)).rows[0].id;
      await q("UPDATE attendance.student_records SET status_code = 'ABSENT' WHERE id = $1", [rid]);
      const hist = await adminRows<any>(db, "SELECT from_status, to_status FROM attendance.record_history WHERE record_id = $1 ORDER BY seq", [rid]);
      expect(hist.map((h) => [h.from_status, h.to_status])).toEqual([[null, "PRESENT"], ["PRESENT", "ABSENT"]]);
      await expect(q("UPDATE attendance.record_history SET to_status = 'X' WHERE record_id = $1", [rid])).rejects.toThrow(/attendance\.immutable/);
      await expect(q("DELETE FROM attendance.record_history WHERE record_id = $1", [rid])).rejects.toThrow(/attendance\.immutable/);
      await expect(q("UPDATE attendance.student_records SET student_id = $2 WHERE id = $1", [rid, newId()])).rejects.toThrow(/attendance\.record_identity_immutable/);
      await q("UPDATE attendance.sessions SET status = 'CANCELLED' WHERE id = $1", [sid]);
      await expect(q("UPDATE attendance.student_records SET note = 'x' WHERE id = $1", [rid])).rejects.toThrow(/attendance\.session_locked/);
      await expect(insertRecord(sid)).rejects.toThrow(/attendance\.session_locked/);
      await expect(q("DELETE FROM attendance.student_records WHERE id = $1", [rid])).rejects.toThrow(/attendance\.session_locked/);
    });

    it("l'exception d'excuse sur un appel validé : ABSENT <-> EXCUSED uniquement, aucun autre champ", async () => {
      const sid = (await insertSession()).rows[0].id;
      const enrollment = newId();
      const student = newId();
      const rid = (await insertRecord(sid, { enrollment_id: enrollment, student_id: student, status_code: "ABSENT", counted_minutes: 60 })).rows[0].id;
      const j = newId();
      await q(
        "INSERT INTO attendance.justifications (id, tenant_id, student_id, enrollment_id, from_date, to_date, reason_code, submitted_by_kind, submitted_by_user, status, decided_by, decided_at) VALUES ($1,$2,$3,$4,'2025-10-02','2025-10-02','ILLNESS','STAFF',$5,'ACCEPTED',$5,now())",
        [j, a.tenantId, student, enrollment, a.admin.userId],
      );
      await q("UPDATE attendance.sessions SET status = 'SUBMITTED', submitted_at = now() WHERE id = $1", [sid]);
      await q("UPDATE attendance.sessions SET status = 'VALIDATED', validated_at = now(), validated_by = $2 WHERE id = $1", [sid, a.admin.userId]);
      const excuse = "UPDATE attendance.student_records SET status_code = 'EXCUSED', original_status_code = 'ABSENT', excused = true, justification_id = $2 WHERE id = $1";
      await expect(q(excuse, [rid, j])).rejects.toThrow(/attendance\.session_locked/); // sans le réglage de transaction
      await q("BEGIN");
      await q("SELECT set_config('attendance.excuse_apply', 'on', true)");
      await q(excuse, [rid, j]);
      await expect(q("UPDATE attendance.student_records SET status_code = 'PRESENT', excused = false, justification_id = NULL, original_status_code = NULL WHERE id = $1", [rid])).rejects.toThrow(/attendance\.session_locked/);
      await q("ROLLBACK");
      expect((await adminOne<any>(db, "SELECT status_code FROM attendance.student_records WHERE id = $1", [rid])).status_code).toBe("ABSENT");
    });

    it("justificatifs : transitions légales, fenêtre figée après décision, décision tracée, pas de suppression ; congés approuvés sans chevauchement", async () => {
      const j = newId();
      const base = [j, a.tenantId, newId(), newId(), a.admin.userId];
      await q("INSERT INTO attendance.justifications (id, tenant_id, student_id, enrollment_id, from_date, to_date, reason_code, submitted_by_kind, submitted_by_user) VALUES ($1,$2,$3,$4,'2025-10-02','2025-10-03','ILLNESS','GUARDIAN',$5)", base);
      await expect(q("UPDATE attendance.justifications SET status = 'REVOKED' WHERE id = $1", [j])).rejects.toThrow(/attendance\.justification_transition/);
      await expect(q("UPDATE attendance.justifications SET status = 'ACCEPTED' WHERE id = $1", [j])).rejects.toThrow(/check constraint/i); // pas de décideur
      await q("UPDATE attendance.justifications SET status = 'ACCEPTED', decided_by = $2, decided_at = now() WHERE id = $1", [j, a.admin.userId]);
      await expect(q("UPDATE attendance.justifications SET to_date = '2025-10-09' WHERE id = $1", [j])).rejects.toThrow(/attendance\.justification_frozen/);
      await expect(q("UPDATE attendance.justifications SET status = 'REJECTED' WHERE id = $1", [j])).rejects.toThrow(/attendance\.justification_transition/);
      await expect(q("UPDATE attendance.justifications SET status = 'REVOKED' WHERE id = $1", [j])).rejects.toThrow(/check constraint/i); // révocation sans motif tracé
      await expect(q("UPDATE attendance.justifications SET student_id = $2 WHERE id = $1", [j, newId()])).rejects.toThrow(/attendance\.justification_identity_immutable/);
      await expect(q("DELETE FROM attendance.justifications WHERE id = $1", [j])).rejects.toThrow(/attendance\.immutable/);
      await expect(q("INSERT INTO attendance.justifications (id, tenant_id, student_id, enrollment_id, from_date, to_date, reason_code, submitted_by_kind, submitted_by_user) VALUES ($1,$2,$3,$4,'2025-10-05','2025-10-01','ILLNESS','STAFF',$5)", [newId(), a.tenantId, newId(), newId(), a.admin.userId])).rejects.toThrow(/check constraint/i);
      await expect(q("INSERT INTO attendance.justifications (id, tenant_id, student_id, enrollment_id, from_date, to_date, reason_code, submitted_by_kind, submitted_by_user) VALUES ($1,$2,$3,$4,'2025-10-01','2025-10-01','MOTIF_INCONNU','STAFF',$5)", [newId(), a.tenantId, newId(), newId(), a.admin.userId])).rejects.toThrow(/foreign key/i);

      const staff = newId();
      const leave = (from: string, to: string, status = "APPROVED") =>
        q("INSERT INTO attendance.staff_leaves (id, tenant_id, staff_id, leave_type_code, starts_on, ends_on, requested_by, status, decided_by, decided_at) VALUES ($1,$2,$3,'ANNUAL',$4,$5,$6,$7,$6,now())", [newId(), a.tenantId, staff, from, to, a.admin.userId, status]);
      await leave("2026-03-01", "2026-03-10");
      await expect(leave("2026-03-10", "2026-03-12")).rejects.toThrow(/conflicting key value violates exclusion|exclusion/i);
      await leave("2026-03-11", "2026-03-12");
      await leave("2026-03-05", "2026-03-06", "REJECTED"); // seuls les congés approuvés s'excluent
    });

    it("récapitulatif : justifié <= total (CHECK) ; la fonction SQL ne lit que le tenant courant", async () => {
      await expect(
        q("INSERT INTO attendance.period_summaries (tenant_id, enrollment_id, period_id, student_id, window_from, window_to, absent_count, excused_count) VALUES ($1,$2,$3,$4,'2025-09-01','2025-12-20', 1, 2)", [a.tenantId, newId(), newId(), newId()]),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        q("INSERT INTO attendance.summary_overrides (id, tenant_id, enrollment_id, period_id, absent_minutes, excused_minutes, reason, set_by) VALUES ($1,$2,$3,$4,10,20,'raison valable',$5)", [newId(), a.tenantId, newId(), newId(), a.admin.userId]),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        q("INSERT INTO attendance.summary_overrides (id, tenant_id, enrollment_id, period_id, absent_minutes, excused_minutes, reason, set_by) VALUES ($1,$2,$3,$4,10,5,'abc',$5)", [newId(), a.tenantId, newId(), newId(), a.admin.userId]),
      ).rejects.toThrow(/check constraint/i);
      const enrollment = a.students[0]!.enrollmentId;
      const asB = await db.tenantDb.run(ctxFor(tenantB), (tx) => tx.queryOne<any>("SELECT * FROM attendance.summarize_enrollment($1, '2025-09-01', '2025-12-31')", [enrollment]));
      expect(asB.sessions_total).toBe(0); // les pointages du tenant A sont invisibles même via la fonction
      const asA = await db.tenantDb.run(a.admin.ctx, (tx) => tx.queryOne<any>("SELECT * FROM attendance.summarize_enrollment($1, '2025-09-01', '2025-12-31')", [enrollment]));
      expect(asA.sessions_total).toBe(1);
      expect(asA.absent_count).toBe(1);
    });

    it("droits de l'application : pas de DELETE sur les séances, justificatifs, historique ni congés", async () => {
      for (const table of ["sessions", "justifications", "record_history", "staff_leaves", "staff_records", "sync_ops"]) {
        await expect(db.tenantDb.run(a.admin.ctx, (tx) => tx.query(`DELETE FROM attendance.${table}`)), table).rejects.toThrow(/permission denied/i);
      }
    });
  });
});

describe("garde-fou", () => {
  it("la liste des tables attendues couvre le DDL de référence (15) et 0904 (3)", () => {
    expect(attendanceTenantTables).toHaveLength(18);
  });
});
