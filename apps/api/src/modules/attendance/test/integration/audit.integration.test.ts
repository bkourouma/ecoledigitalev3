import { afterAll, beforeAll, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { audit } from "../../../audit";
import { acceptJustification, attachJustificationDocument, getJustificationAttachmentUrl, revokeJustification, submitJustification } from "../../application/justifications";
import { createAttendanceDeps } from "../../application/deps";
import { exportAbsencesCsv } from "../../application/reports";
import { upsertAttendanceSettings, upsertStatusDefinition } from "../../application/reference";
import { markStudentRecords, openAttendanceSession, reopenAttendanceSession, submitAttendanceSession, validateAttendanceSession } from "../../application/sessions";
import { approveStaffLeave, requestStaffLeave } from "../../application/staff";
import { setSummaryOverride } from "../../application/summaries";
import { attendanceAuditAdapter } from "../../infrastructure/audit-adapter";
import { adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("audit : chaque opération sensible est tracée dans le VRAI journal chaîné, dans la même transaction", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;
  let deps: ReturnType<typeof createAttendanceDeps>;

  beforeAll(async () => {
    db = await createAttendanceTestDb(12, { withAudit: true });
    world = makeWorld(db, "2025-10-01T12:00:00.000Z");
    school = await seedSchool(db, world, { students: 3 });
    deps = createAttendanceDeps({
      db: db.tenantDb,
      clock: world.clock,
      ports: world.ports,
      audit: attendanceAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
    });
  });
  afterAll(async () => {
    await db.drop();
  });

  const log = () =>
    adminRows<any>(db, "SELECT action, entity, entity_id, severity, actor_type, actor_id, reason, before, after, metadata FROM audit.audit_log WHERE tenant_id = $1 AND action LIKE 'attendance.%' ORDER BY seq", [school.tenantId]);

  it("réouverture, décisions, surcharge, lecture de pièce, congé, export et paramétrage : acteur, sévérité, motif, avant/après", async () => {
    const occ = addOccurrence(world, school, { date: "2025-10-01" });
    const { session } = unwrap(await openAttendanceSession(deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    unwrap(await markStudentRecords(deps, school.teacher.ctx, { sessionId: session.id, entries: [{ studentId: school.students[0]!.studentId, statusCode: "ABSENT" }] }));
    unwrap(await submitAttendanceSession(deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }));
    unwrap(await validateAttendanceSession(deps, school.admin.ctx, { sessionId: session.id, caps: CAPS.admin }));
    unwrap(await reopenAttendanceSession(deps, school.admin.ctx, { sessionId: session.id, reason: "Erreur de saisie de l'enseignant", caps: CAPS.admin }));

    const j = unwrap(await submitJustification(deps, school.guardian.ctx, { studentId: school.guardian.studentId, fromDate: "2025-10-01", toDate: "2025-10-01", reasonCode: "ILLNESS", comment: "Diagnostic confidentiel", caps: CAPS.guardian }));
    const att = unwrap(await attachJustificationDocument(deps, school.guardian.ctx, { justificationId: j.justification.id, fileName: "o.pdf", content: new Uint8Array([...Buffer.from("%PDF-1.4 x")]), caps: CAPS.guardian }));
    unwrap(await acceptJustification(deps, school.admin.ctx, { justificationId: j.justification.id, note: "Certificat vu", caps: CAPS.admin }));
    unwrap(await getJustificationAttachmentUrl(deps, school.admin.ctx, { justificationId: j.justification.id, attachmentId: att.id, caps: CAPS.admin }));
    unwrap(await revokeJustification(deps, school.admin.ctx, { justificationId: j.justification.id, reason: "Certificat contesté", caps: CAPS.admin }));

    unwrap(await setSummaryOverride(deps, school.admin.ctx, { enrollmentId: school.students[0]!.enrollmentId, periodId: school.termId, absentMinutes: 120, excusedMinutes: 60, reason: "Reprise de l'historique" }));
    const leave = unwrap(await requestStaffLeave(deps, school.teacher.ctx, { leaveTypeCode: "ANNUAL", startsOn: "2025-12-22", endsOn: "2025-12-24", caps: { leaveRequest: true } }));
    unwrap(await approveStaffLeave(deps, school.admin.ctx, { leaveId: leave.id, note: "Accordé", caps: { leaveDecide: true } }));
    unwrap(await exportAbsencesCsv(deps, school.admin.ctx, { classroomId: school.classroomId }));
    unwrap(await upsertStatusDefinition(deps, school.admin.ctx, { subjectKind: "STUDENT", code: "EXAM_ABSENT", label: "Absent à l'examen", countsAsAbsence: true }));
    unwrap(await upsertAttendanceSettings(deps, school.admin.ctx, { allowFutureJustifications: true, alertRules: [{ code: "ABS", metric: "ABSENT_COUNT", threshold: 5 }] }));

    const rows = await log();
    const by = (action: string) => rows.filter((r) => r.action === action);
    for (const action of [
      "attendance.session.reopened", "attendance.justification.submitted", "attendance.justification_attachment.added", "attendance.justification.accepted",
      "attendance.justification_attachment.read", "attendance.justification.revoked", "attendance.summary_override.set", "attendance.staff_leave.requested",
      "attendance.staff_leave.approved", "attendance.report.exported", "attendance.status.created", "attendance.settings.updated",
    ]) {
      expect(by(action), action).toHaveLength(1);
    }
    // Sévérité : sensible => notice ; acteur = l'utilisateur du contexte (jamais un en-tête client).
    for (const action of ["attendance.session.reopened", "attendance.justification.accepted", "attendance.justification.revoked", "attendance.justification_attachment.read", "attendance.summary_override.set", "attendance.staff_leave.approved", "attendance.report.exported", "attendance.settings.updated"]) {
      expect(by(action)[0], action).toMatchObject({ severity: "notice", actor_type: "user", actor_id: school.admin.userId });
    }
    expect(by("attendance.justification.submitted")[0]).toMatchObject({ severity: "info", actor_id: school.guardian.userId, entity: "justification", entity_id: j.justification.id });
    expect(by("attendance.session.reopened")[0]).toMatchObject({ entity: "attendance_session", entity_id: session.id, reason: "Erreur de saisie de l'enseignant" });
    expect(by("attendance.summary_override.set")[0].reason).toBe("Reprise de l'historique");
    expect(by("attendance.justification.revoked")[0].before).toMatchObject({ status: "ACCEPTED" }); // la décision d'origine est conservée dans le journal

    // Confidentialité : ni le commentaire libre du parent, ni l'URL signée, ni la clé de stockage ne sont journalisés.
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/Diagnostic confidentiel/);
    expect(dump).not.toMatch(/memory:\/\//);
    expect(dump).not.toMatch(/attendance\/[0-9a-f-]{36}\/justifications\//);

    // Le journal est chaîné et intègre.
    const chain = await db.tenantDb.run(school.admin.ctx, (tx) => audit.verifyChain(tx, school.tenantId));
    expect(chain.ok).toBe(true);
  });

  it("un échec métier annule AUSSI son audit (même transaction) : pas de trace d'une opération qui n'a pas eu lieu", async () => {
    const before = (await log()).length;
    const refused = await reopenAttendanceSession(deps, school.admin.ctx, { sessionId: "01960000-0000-7000-8000-00000000dead", reason: "Motif suffisant", caps: CAPS.admin });
    expect(refused.ok).toBe(false);
    const j = unwrap(await submitJustification(deps, school.admin.ctx, { studentId: school.students[1]!.studentId, fromDate: "2025-09-20", toDate: "2025-09-20", reasonCode: "OTHER", caps: CAPS.admin }));
    const countAfterSubmit = (await log()).length;
    expect(countAfterSubmit).toBe(before + 1);
    expect((await acceptJustification(deps, school.guardian.ctx, { justificationId: j.justification.id, caps: CAPS.guardian })).ok).toBe(false); // sans droit
    expect((await log()).length).toBe(countAfterSubmit);
  });
});
