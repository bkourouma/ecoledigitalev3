import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import {
  approveStaffLeave,
  cancelStaffLeave,
  checkInStaff,
  checkOutStaff,
  getStaffAttendanceSummary,
  listStaffLeaves,
  listStaffRecords,
  markStaffAttendance,
  rejectStaffLeave,
  requestStaffLeave,
} from "../../application/staff";
import { upsertLeaveTypeDefinition } from "../../application/reference";
import { adminOne, adminRows, createAttendanceTestDb, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("présence et congés du personnel (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAttendanceTestDb();
    world = makeWorld(db, "2025-10-01T07:30:00.000Z");
    school = await seedSchool(db, world, { students: 1 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const events = async (type: string) => adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY id", [school.tenantId, type]);
  const staffCaps = { staffRecord: true, staffRead: true, leaveDecide: true, leaveRequest: true } as const;

  it("une ligne par (membre, jour) : marquer deux fois met à jour ; statut inconnu, retard sans statut de retard et membre inconnu sont refusés", async () => {
    const base = { staffId: school.teacher.staffId, workDate: "2025-10-01", caps: school.teacher.userId ? staffCaps : {} };
    const first = unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...base, statusCode: "PRESENT", checkInAt: new Date("2025-10-01T07:25:00.000Z") }));
    expect(first.record).toMatchObject({ statusCode: "PRESENT", source: "MANUAL", markedBy: school.admin.userId });
    const second = unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...base, statusCode: "LATE", minutesLate: 20 }));
    expect(second.record.id).toBe(first.record.id);
    expect(second.record).toMatchObject({ statusCode: "LATE", minutesLate: 20 });
    expect(second.record.checkInAt?.toISOString()).toBe("2025-10-01T07:25:00.000Z"); // l'arrivée n'est pas effacée
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM attendance.staff_records")).n)).toBe(1);

    for (const [patch, code] of [
      [{ statusCode: "WHATEVER" }, "attendance.status_unknown"],
      [{ statusCode: "PRESENT", minutesLate: 5 }, "attendance.minutes_invalid"],
      [{ statusCode: "ABSENT", staffId: newId() }, "attendance.staff_not_found"],
      [{ statusCode: "PRESENT", checkInAt: new Date("2025-10-01T09:00:00Z"), checkOutAt: new Date("2025-10-01T08:00:00Z") }, "attendance.invalid_input"],
    ] as const) {
      const r = await markStaffAttendance(world.deps, school.admin.ctx, { ...base, ...patch });
      expect(r.ok, code).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(code);
    }

    // Idempotence par clientId (rejeu hors-ligne futur).
    const clientId = newId();
    const c1 = unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...base, staffId: school.coTeacher.staffId, statusCode: "PRESENT", clientId }));
    const c2 = unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...base, staffId: school.coTeacher.staffId, statusCode: "PRESENT", clientId }));
    expect(c2).toMatchObject({ replayed: true });
    expect(c2.record.id).toBe(c1.record.id);
  });

  it("un membre pointe SA présence (own.record) mais pas celle d'un collègue ; check-in / check-out idempotents", async () => {
    const own = { ownRecord: true } as const;
    const checkIn = unwrap(await checkInStaff(world.deps, school.outsider.ctx, { caps: own, at: new Date("2025-10-01T07:20:00.000Z") }));
    expect(checkIn.record).toMatchObject({ staffId: school.outsider.staffId, statusCode: "PRESENT", source: "SELF" });
    expect(unwrap(await checkInStaff(world.deps, school.outsider.ctx, { caps: own })).replayed).toBe(true);
    expect(unwrap(await checkInStaff(world.deps, school.outsider.ctx, { caps: own })).record.checkInAt?.toISOString()).toBe("2025-10-01T07:20:00.000Z");

    const colleague = await markStaffAttendance(world.deps, school.outsider.ctx, { staffId: school.teacher.staffId, workDate: "2025-10-01", statusCode: "ABSENT", caps: own });
    expect(colleague.ok).toBe(false);
    if (!colleague.ok) expect(colleague.error.code).toBe("attendance.forbidden");

    world.clock.advance(9 * 3_600_000);
    const out = unwrap(await checkOutStaff(world.deps, school.outsider.ctx, { caps: own }));
    expect(out.record.checkOutAt?.toISOString()).toBe("2025-10-01T16:30:00.000Z");
    expect(unwrap(await checkOutStaff(world.deps, school.outsider.ctx, { caps: own })).replayed).toBe(true);
    const noIn = await checkOutStaff(world.deps, school.outsider.ctx, { caps: own, workDate: "2025-09-30" });
    expect(noIn.ok).toBe(false);
    if (!noIn.ok) expect(noIn.error.code).toBe("attendance.checkout_without_checkin");
    // Sans profil de personnel, aucune présence propre.
    expect((await checkInStaff(world.deps, school.guardian.ctx, { caps: own })).ok).toBe(false);
  });

  it("congés : demande, approbation sensible auditée, événement pour scheduling/paie, statut du personnel jamais modifié", async () => {
    const req = unwrap(await requestStaffLeave(world.deps, school.teacher.ctx, { leaveTypeCode: "ANNUAL", startsOn: "2025-10-13", endsOn: "2025-10-17", reason: "Congé annuel", caps: { leaveRequest: true } }));
    expect(req).toMatchObject({ status: "REQUESTED", staffId: school.teacher.staffId, requestedBy: school.teacher.userId });
    expect((await events("attendance.staff_leave.requested")).length).toBe(1);

    // Approbation : permission de décision obligatoire (sensible), motif/auteur tracés.
    expect((await approveStaffLeave(world.deps, school.teacher.ctx, { leaveId: req.id, caps: { leaveRequest: true } })).ok).toBe(false);
    const auditBefore = world.audit.entries.length;
    const approved = unwrap(await approveStaffLeave(world.deps, school.admin.ctx, { leaveId: req.id, note: "Accordé", caps: staffCaps }));
    expect(approved).toMatchObject({ status: "APPROVED", decidedBy: school.admin.userId, decisionNote: "Accordé" });
    expect(world.audit.entries.slice(auditBefore).find((e) => e.entry.action === "attendance.staff_leave.approved")?.entry).toMatchObject({ sensitive: true });
    const ev = await events("attendance.staff_leave.approved");
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ v: 1, leaveId: req.id, staffId: school.teacher.staffId, leaveTypeCode: "ANNUAL", startsOn: "2025-10-13", endsOn: "2025-10-17" });
    expect((await approveStaffLeave(world.deps, school.admin.ctx, { leaveId: req.id, caps: staffCaps })).ok).toBe(false); // déjà décidé

    // Deux congés APPROUVÉS d'un même membre ne se chevauchent pas (base) : le second se demande mais ne s'approuve pas.
    const overlap = unwrap(await requestStaffLeave(world.deps, school.teacher.ctx, { leaveTypeCode: "UNPAID", startsOn: "2025-10-16", endsOn: "2025-10-20", caps: { leaveRequest: true } }));
    const refused = await approveStaffLeave(world.deps, school.admin.ctx, { leaveId: overlap.id, caps: staffCaps });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("attendance.leave_overlap");
    // Un autre membre, mêmes dates : aucun conflit.
    const other = unwrap(await requestStaffLeave(world.deps, school.coTeacher.ctx, { leaveTypeCode: "ANNUAL", startsOn: "2025-10-13", endsOn: "2025-10-17", caps: { leaveRequest: true } }));
    expect(unwrap(await approveStaffLeave(world.deps, school.admin.ctx, { leaveId: other.id, caps: staffCaps })).status).toBe("APPROVED");

    // Refus avec note obligatoire ; annulation de la demande par son auteur.
    expect((await rejectStaffLeave(world.deps, school.admin.ctx, { leaveId: overlap.id, note: "", caps: staffCaps })).ok).toBe(false);
    expect(unwrap(await rejectStaffLeave(world.deps, school.admin.ctx, { leaveId: overlap.id, note: "Chevauchement avec un congé annuel", caps: staffCaps })).status).toBe("REJECTED");
    const mine = unwrap(await requestStaffLeave(world.deps, school.teacher.ctx, { leaveTypeCode: "ANNUAL", startsOn: "2025-12-22", endsOn: "2025-12-26", caps: { leaveRequest: true } }));
    expect(unwrap(await cancelStaffLeave(world.deps, school.teacher.ctx, { leaveId: mine.id, caps: { leaveRequest: true } })).status).toBe("CANCELLED");
    expect((await cancelStaffLeave(world.deps, school.teacher.ctx, { leaveId: req.id, caps: { leaveRequest: true } })).ok).toBe(false); // annuler un congé approuvé = décision RH
    expect(unwrap(await cancelStaffLeave(world.deps, school.admin.ctx, { leaveId: other.id, note: "Reporté", caps: staffCaps })).status).toBe("CANCELLED");
    expect((await events("attendance.staff_leave.cancelled")).some((e) => e.payload.wasApproved === true)).toBe(true);

    // Le statut du personnel n'est jamais touché par un congé (aucune table de personnel ici) : seul l'événement part.
    expect((await adminRows(db, "SELECT 1 FROM information_schema.tables WHERE table_schema = 'attendance' AND table_name = 'staff'")).length).toBe(0);
  });

  it("jour de congé approuvé : ON_LEAVE imposé (correction explicite possible) ; ON_LEAVE exige un congé approuvé", async () => {
    const day = { staffId: school.teacher.staffId, workDate: "2025-10-14", caps: staffCaps };
    const present = await markStaffAttendance(world.deps, school.admin.ctx, { ...day, statusCode: "PRESENT" });
    expect(present.ok).toBe(false);
    if (!present.ok) expect(present.error.code).toBe("attendance.staff_on_approved_leave");

    const onLeave = unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...day, statusCode: "ON_LEAVE" }));
    expect(onLeave.record).toMatchObject({ statusCode: "ON_LEAVE" });
    expect(onLeave.record.leaveId).not.toBeNull();

    const fixed = unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...day, statusCode: "PRESENT", overrideLeave: true, note: "Rappelé pour le conseil" }));
    expect(fixed.record).toMatchObject({ statusCode: "PRESENT", leaveId: null });

    const none = await markStaffAttendance(world.deps, school.admin.ctx, { staffId: school.teacher.staffId, workDate: "2025-11-14", statusCode: "ON_LEAVE", caps: staffCaps });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe("attendance.on_leave_requires_leave");
    // La base elle-même refuse ON_LEAVE sans congé.
    await expect(
      db.admin.query(
        "INSERT INTO attendance.staff_records (id, tenant_id, staff_id, work_date, status_code, marked_by) VALUES ($1,$2,$3,'2025-11-20','ON_LEAVE',$4)",
        [newId(), school.tenantId, school.teacher.staffId, school.admin.userId],
      ),
    ).rejects.toThrow(/staff_records_check|check constraint/i);
  });

  it("absence du personnel : événement unique ; exigence de justificatif d'un type de congé vérifiée à l'approbation", async () => {
    const before = (await events("attendance.staff_absence.recorded")).length;
    const day = { staffId: school.coTeacher.staffId, workDate: "2025-10-02", caps: staffCaps };
    unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...day, statusCode: "ABSENT" }));
    unwrap(await markStaffAttendance(world.deps, school.admin.ctx, { ...day, statusCode: "ABSENT", note: "Sans nouvelles" })); // même statut : pas de nouvel événement
    const evs = await events("attendance.staff_absence.recorded");
    expect(evs.length).toBe(before + 1);
    expect(evs.at(-1).payload).toMatchObject({ v: 1, staffId: school.coTeacher.staffId, workDate: "2025-10-02", statusCode: "ABSENT" });

    const sick = unwrap(await requestStaffLeave(world.deps, school.outsider.ctx, { leaveTypeCode: "SICK", startsOn: "2025-11-03", endsOn: "2025-11-05", caps: { leaveRequest: true } }));
    const noDoc = await approveStaffLeave(world.deps, school.admin.ctx, { leaveId: sick.id, caps: staffCaps });
    expect(noDoc.ok).toBe(false);
    if (!noDoc.ok) expect(noDoc.error.code).toBe("attendance.attachment_required");
    unwrap(await upsertLeaveTypeDefinition(world.deps, school.admin.ctx, { code: "SICK", label: "Congé maladie", requiresAttachment: false }));
    expect(unwrap(await approveStaffLeave(world.deps, school.admin.ctx, { leaveId: sick.id, caps: staffCaps })).status).toBe("APPROVED");
    const unknown = await requestStaffLeave(world.deps, school.outsider.ctx, { leaveTypeCode: "NOPE", startsOn: "2025-11-10", endsOn: "2025-11-10", caps: { leaveRequest: true } });
    expect(unknown.ok).toBe(false);
  });

  it("lectures : le personnel ne voit que sa propre présence et ses congés ; la direction voit tout ; synthèse brute", async () => {
    const mine = unwrap(await listStaffRecords(world.deps, school.outsider.ctx, { from: "2025-09-01", to: "2025-12-31", caps: {} }));
    expect(mine.items.every((r) => r.staffId === school.outsider.staffId)).toBe(true);
    const all = unwrap(await listStaffRecords(world.deps, school.admin.ctx, { from: "2025-09-01", to: "2025-12-31", caps: { staffRead: true } }));
    expect(new Set(all.items.map((r) => r.staffId)).size).toBeGreaterThan(1);
    expect(unwrap(await listStaffLeaves(world.deps, school.outsider.ctx, { caps: {} })).items.every((l) => l.staffId === school.outsider.staffId)).toBe(true);
    expect(unwrap(await listStaffLeaves(world.deps, school.admin.ctx, { caps: staffCaps, status: "APPROVED" })).items.length).toBeGreaterThanOrEqual(2);
    // Sans profil de personnel : liste vide, pas d'erreur ni de fuite.
    expect(unwrap(await listStaffRecords(world.deps, school.guardian.ctx, { from: "2025-09-01", to: "2025-12-31", caps: {} })).items).toEqual([]);

    const summary = unwrap(await getStaffAttendanceSummary(world.deps, school.admin.ctx, { from: "2025-10-01", to: "2025-10-31", caps: { staffRead: true } }));
    const t = summary.rows.find((r) => r.staffId === school.teacher.staffId)!;
    expect(t.byStatus).toMatchObject({ LATE: 1, PRESENT: 1 });
    expect(t.lateMinutes).toBe(20);
    expect(t.approvedLeaveDays).toBe(5); // 13 -> 17 octobre
    expect(t.days).toBe(2);
    expect((await getStaffAttendanceSummary(world.deps, school.guardian.ctx, { from: "2025-10-01", to: "2025-10-31", caps: {} })).ok).toBe(false);
    void CAPS;
  });
});
