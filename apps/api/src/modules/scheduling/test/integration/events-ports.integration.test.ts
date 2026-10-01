/**
 * Réactions aux événements des autres modules, abonnés/jobs du worker, port pour academic
 * (`ScheduleConflictChecker`), amorçage des référentiels.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, noopLogger, newId, type DomainEvent } from "@ecoledigitale/kernel";
import { createScheduleConflictChecker } from "../../application/conflict-checker";
import {
  onAttendanceSessionSubmitted,
  onClassroomCancelled,
  onOfferingCancelled,
  onStaffLeaveApproved,
  onStaffStatusChanged,
  onTeachingAssignmentEnded,
  onTenantProvisioned,
  onYearClosed,
} from "../../application/consumers";
import { createOccurrence, holdOccurrence } from "../../application/occurrences";
import { listEventKinds, listRoomTypes, upsertRoomType } from "../../application/reference";
import { archiveTimetable, createTimetable, getTimetable, publishTimetable, upsertTimetableEntry } from "../../application/timetables";
import { getOccurrence, listPendingReplacements } from "../../application/views";
import { validateOccurrence } from "../../application/validation";
import { resetSchedulingPorts, registerSchedulingPorts } from "../../ports-registry";
import { addDays, isoWeekday } from "../../domain/time";
import jobs from "../../jobs";
import subscribers from "../../subscribers";
import { adminOne, createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { D, addClass, addStaff, createWorld, outboxTypes, unwrap, type World } from "../support/world";

describeIntegration("événements consommés, abonnés, jobs et ports", () => {
  let db: SchedulingTestDb;
  let w: World;
  beforeAll(async () => {
    db = await createSchedulingTestDb();
    w = await createWorld({ db });
  });
  afterAll(async () => {
    resetSchedulingPorts();
    await db.drop();
  });

  const lesson = async (teacher: string, date: string, start = "08:00", end = "09:00", cls = addClass(w, `E ${date} ${start}`), extra: Record<string, unknown> = {}) =>
    unwrap(await createOccurrence(w.deps, w.ctx, { kind: "LESSON", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, date, startTime: start, endTime: end, staff: [{ staffId: teacher }], ...extra } as never)).occurrence;

  it("attendance.session.submitted ⇒ séance constatée (source ATTENDANCE), idempotent ; charge sans occurrenceId ou séance inconnue : ignorée", async () => {
    const t = addStaff(w, "Prof Appel");
    const occ = await lesson(t, D(5));
    const r1 = unwrap(await onAttendanceSessionSubmitted(w.deps, w.tenantId, { v: 1, occurrenceId: occ.id }));
    expect(r1).toEqual({ affected: 1 });
    expect(unwrap(await onAttendanceSessionSubmitted(w.deps, w.tenantId, { occurrenceId: occ.id }))).toEqual({ affected: 0 });
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: occ.id }))).toMatchObject({ status: "HELD", heldSource: "ATTENDANCE", heldBy: null });
    expect(unwrap(await onAttendanceSessionSubmitted(w.deps, w.tenantId, {})).ignored).toContain("occurrenceId");
    expect(unwrap(await onAttendanceSessionSubmitted(w.deps, w.tenantId, { occurrenceId: newId() })).ignored).toBe("séance inconnue");
    // Séance annulée entre-temps : l'appel tardif ne la ressuscite pas.
    const cancelled = await lesson(t, D(5), "10:00", "11:00");
    const { cancelOccurrence } = await import("../../application/occurrences");
    unwrap(await cancelOccurrence(w.deps, w.ctx, { occurrenceId: cancelled.id, reason: "Annulée" }));
    expect(unwrap(await onAttendanceSessionSubmitted(w.deps, w.tenantId, { occurrenceId: cancelled.id }))).toEqual({ affected: 0 });
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: cancelled.id })).status).toBe("CANCELLED");
  });

  it("congé approuvé / départ / suspension / fin d'affectation ⇒ séances futures PLANNED signalées « à remplacer » (aucune modification), rejeu sans effet", async () => {
    const t = addStaff(w, "Prof Congé");
    const cls = addClass(w, "Congé A");
    const d1 = await lesson(t, D(12), "08:00", "09:00", cls);
    const d2 = await lesson(t, D(19), "08:00", "09:00", cls);
    const held = await lesson(t, D(14), "08:00", "09:00");
    unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: held.id, source: "ATTENDANCE" }));
    const r = unwrap(await onStaffLeaveApproved(w.deps, w.tenantId, { staffId: t, startsOn: D(12), endsOn: D(16) }));
    expect(r.affected).toBe(1); // d1 seulement : d2 est après le congé, la séance constatée est intouchable
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: d1.id }))).toMatchObject({ status: "PLANNED", needsReplacement: true, replacementReason: "STAFF_LEAVE" });
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: d2.id })).needsReplacement).toBe(false);
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: held.id })).needsReplacement).toBe(false);
    expect(unwrap(await onStaffLeaveApproved(w.deps, w.tenantId, { staffId: t, startsOn: D(12), endsOn: D(16) })).affected).toBe(0);
    expect((await outboxTypes(w, d1.id)).filter((x) => x === "scheduling.occurrence.replacement_needed")).toHaveLength(1);
    expect(unwrap(await onStaffLeaveApproved(w.deps, w.tenantId, { staffId: "pas-un-uuid" })).ignored).toContain("charge invalide");

    // Départ : toutes les séances futures non signalées ; suspension / activité ordinaire.
    expect(unwrap(await onStaffStatusChanged(w.deps, w.tenantId, { staffId: t, status: "ACTIVE" })).ignored).toContain("sans effet");
    expect(unwrap(await onStaffStatusChanged(w.deps, w.tenantId, { staffId: t, status: "LEFT" })).affected).toBe(1); // d2 (d1 déjà signalée)
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: d2.id })).replacementReason).toBe("STAFF_LEFT");
    const pending = unwrap(await listPendingReplacements(w.deps, w.ctx, { classroomId: cls.classroomId }));
    expect(pending.items.map((o) => o.id).sort()).toEqual([d1.id, d2.id].sort());

    const t2 = addStaff(w, "Prof Affectation");
    const cls2 = addClass(w, "Affect A");
    const other = addClass(w, "Affect B");
    const a = await lesson(t2, D(12), "10:00", "11:00", cls2);
    const b = await lesson(t2, D(12), "11:00", "12:00", other);
    expect(unwrap(await onTeachingAssignmentEnded(w.deps, w.tenantId, { staffId: t2, classroomId: cls2.classroomId })).affected).toBe(1);
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: a.id })).replacementReason).toBe("ASSIGNMENT_ENDED");
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: b.id })).needsReplacement).toBe(false);
    expect(unwrap(await onStaffStatusChanged(w.deps, w.tenantId, { staffId: t2, status: "SUSPENDED" })).affected).toBe(1); // b
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: b.id })).replacementReason).toBe("STAFF_SUSPENDED");
  });

  it("offre ou classe annulée ⇒ séances futures non validées annulées ; une séance validée reste (gel)", async () => {
    const t = addStaff(w, "Prof Offre");
    const cls = addClass(w, "Offre A");
    const a = await lesson(t, D(26), "08:00", "09:00", cls, { offeringId: cls.offeringId });
    const b = await lesson(t, D(27), "08:00", "09:00", cls, { offeringId: cls.offeringId });
    unwrap(await holdOccurrence(w.deps, w.ctx, { occurrenceId: b.id, source: "ATTENDANCE" }));
    unwrap(await validateOccurrence(w.deps, w.ctxOf(newId()), { occurrenceId: b.id }));
    expect(unwrap(await onOfferingCancelled(w.deps, w.tenantId, { offeringId: cls.offeringId })).affected).toBe(1);
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: a.id }))).toMatchObject({ status: "CANCELLED", cancelReason: "Offre annulée" });
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: b.id })).status).toBe("HELD");
    expect(unwrap(await onOfferingCancelled(w.deps, w.tenantId, { offeringId: cls.offeringId })).affected).toBe(0);

    const cls2 = addClass(w, "Classe annulée");
    const c = await lesson(t, D(28), "08:00", "09:00", cls2);
    expect(unwrap(await onClassroomCancelled(w.deps, w.tenantId, { classroomId: cls2.classroomId })).affected).toBe(1);
    expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: c.id })).status).toBe("CANCELLED");
    expect(unwrap(await onOfferingCancelled(w.deps, w.tenantId, {})).ignored).toBe("offeringId absent");
  });

  it("année close ⇒ emplois du temps archivés (idempotent) ; amorçage des référentiels sans écraser les libellés de l'établissement", async () => {
    const yearW = await createWorld({ db });
    const tt = unwrap(await createTimetable(yearW.deps, yearW.ctx, { institutionId: yearW.institutionId, academicYearId: yearW.yearId, name: "Année", validFrom: "2026-09-07", validTo: "2027-06-25" }));
    const draft = unwrap(await createTimetable(yearW.deps, yearW.ctx, { institutionId: yearW.institutionId, academicYearId: yearW.yearId, name: "Brouillon", validFrom: "2026-09-07", validTo: "2027-06-25" }));
    unwrap(await upsertTimetableEntry(yearW.deps, yearW.ctx, { timetableId: tt.id, kind: "MEETING", weekday: 1, startTime: "08:00", endTime: "09:00" }));
    unwrap(await publishTimetable(yearW.deps, yearW.ctx, { timetableId: tt.id }));
    expect(unwrap(await onYearClosed(yearW.deps, yearW.tenantId, { academicYearId: yearW.yearId })).affected).toBe(2);
    expect(unwrap(await getTimetable(yearW.deps, yearW.ctx, { timetableId: tt.id })).timetable.status).toBe("ARCHIVED");
    expect(unwrap(await getTimetable(yearW.deps, yearW.ctx, { timetableId: draft.id })).timetable.status).toBe("ARCHIVED");
    expect(unwrap(await onYearClosed(yearW.deps, yearW.tenantId, { academicYearId: yearW.yearId })).affected).toBe(0);
    unwrap(await archiveTimetable(yearW.deps, yearW.ctx, { timetableId: tt.id }));

    unwrap(await upsertRoomType(yearW.deps, yearW.ctx, { code: "CLASSROOM", label: "Salle banalisée" }));
    const seeded = unwrap(await onTenantProvisioned(yearW.deps, yearW.tenantId));
    expect(seeded.affected).toBe(0); // déjà amorcé à la création du monde : rejeu sans effet
    expect(unwrap(await listRoomTypes(yearW.deps, yearW.ctx)).find((r) => r.code === "CLASSROOM")?.label).toBe("Salle banalisée");
    const kinds = unwrap(await listEventKinds(yearW.deps, yearW.ctx));
    expect(kinds.find((k) => k.code === "HOLIDAY")).toMatchObject({ blocksTeachingDefault: true });
    expect(kinds.find((k) => k.code === "MEETING")).toMatchObject({ blocksTeachingDefault: false });
    // Aucun jour férié ni calendrier national n'est codé : le tenant n'a AUCUN événement de calendrier.
    const n = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.calendar_events WHERE tenant_id = $1", [yearW.tenantId]);
    expect(n.n).toBe("0");
  });

  describe("abonnés et jobs du worker (contexte simulé)", () => {
    const eventOf = (type: string, tenantId: string, payload: unknown): DomainEvent => ({ id: newId(), type, version: 1, tenantId, occurredAt: new Date().toISOString(), payload });
    const handlerCtx = (tenantId: string) => ({ tenantId, tenantDb: db.tenantDb, db: undefined as never, systemDb: db.systemDb, logger: noopLogger, subscriber: "t", attempt: 1, jobId: "j" });

    it("chaque abonné est branché sur l'événement de la spec ; le constat par l'appel passe par l'abonné", async () => {
      expect(subscribers.map((s) => s.pattern).sort()).toEqual(
        ["academic.classroom.cancelled", "academic.offering.cancelled", "academic.year.closed", "attendance.session.submitted", "attendance.staff_leave.approved", "people.staff.status_changed", "people.teaching_assignment.ended", "tenancy.tenant.provisioned"].sort(),
      );
      const t = addStaff(w, "Prof Abonné");
      const occ = await lesson(t, D(29));
      const sub = subscribers.find((s) => s.pattern === "attendance.session.submitted")!;
      await sub.handler(eventOf("attendance.session.submitted", w.tenantId, { v: 1, occurrenceId: occ.id }), handlerCtx(w.tenantId) as never);
      expect(unwrap(await getOccurrence(w.deps, w.ctx, { occurrenceId: occ.id })).status).toBe("HELD");
      // Rejeu de la livraison : sans effet, sans erreur.
      await sub.handler(eventOf("attendance.session.submitted", w.tenantId, { v: 1, occurrenceId: occ.id }), handlerCtx(w.tenantId) as never);
      const seed = subscribers.find((s) => s.pattern === "tenancy.tenant.provisioned")!;
      await expect(seed.handler(eventOf("tenancy.tenant.provisioned", w.tenantId, {}), handlerCtx(w.tenantId) as never)).resolves.toBeUndefined();
    });

    it("job quotidien : génération glissante par tenant", async () => {
      const job = jobs.find((j) => j.name === "scheduling.generate-occurrences")!;
      expect(job.perTenant).toBe(true);
      const gw = await createWorld({ db });
      const cls = addClass(gw, "Job A");
      const teacher = addStaff(gw, "Prof Job");
      registerSchedulingPorts({ academic: gw.academic, people: gw.people });
      try {
        // Le job tourne avec l'horloge SYSTÈME (jobs.ts) : le test se cale sur la date réelle.
        const today = new Date().toISOString().slice(0, 10);
        const tt = unwrap(await createTimetable(gw.deps, gw.ctx, { institutionId: gw.institutionId, academicYearId: gw.yearId, name: "Job", validFrom: addDays(today, -30), validTo: addDays(today, 400) }));
        unwrap(await upsertTimetableEntry(gw.deps, gw.ctx, { timetableId: tt.id, kind: "LESSON", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, weekday: isoWeekday(addDays(today, 3)), startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacher, role: "LEAD" }] }));
        unwrap(await publishTimetable(gw.deps, gw.ctx, { timetableId: tt.id }));
        const run = () => (job as { handler: (c: unknown) => Promise<void> }).handler({ tenant: { id: gw.tenantId, slug: "t" }, tenantDb: db.tenantDb, logger: noopLogger, systemDb: db.systemDb, name: job.name, db: undefined });
        await run();
        const count = async () => Number((await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM scheduling.session_occurrences WHERE tenant_id = $1", [gw.tenantId])).n);
        const first = await count();
        expect(first).toBeGreaterThanOrEqual(5); // horizon par défaut : 6 semaines
        expect(first).toBeLessThanOrEqual(7);
        await run();
        expect(await count()).toBe(first); // idempotent
      } finally {
        resetSchedulingPorts();
      }
    });
  });

  describe("ScheduleConflictChecker (port pour academic)", () => {
    it("signale, à l'inscription à une offre à la carte, les chevauchements avec les autres cours de l'apprenant (avertissement)", async () => {
      const cw = await createWorld({ db });
      const checker = createScheduleConflictChecker(cw.deps);
      const studentId = newId();
      const own = addClass(cw, "Classe de l'élève");
      const carteA = addClass(cw, "Carte A", { aLaCarte: true });
      const carteB = addClass(cw, "Carte B", { aLaCarte: true });
      const carteC = addClass(cw, "Carte C", { aLaCarte: true });
      const mk = (c: typeof own, teacher: string, start: string, end: string, carte: boolean) =>
        createOccurrence(cw.deps, cw.ctx, {
          kind: "LESSON",
          classroomId: c.classroomId,
          curriculumNodeId: c.nodeId,
          ...(carte ? { offeringId: c.offeringId, claimsClassroom: false } : {}),
          date: D(19),
          startTime: start,
          endTime: end,
          staff: [{ staffId: teacher }],
        });
      const t1 = addStaff(cw, "T1");
      const t2 = addStaff(cw, "T2");
      const t3 = addStaff(cw, "T3");
      const t4 = addStaff(cw, "T4");
      unwrap(await mk(own, t1, "08:00", "10:00", false));
      unwrap(await mk(carteA, t2, "09:00", "11:00", true));
      unwrap(await mk(carteB, t3, "10:30", "12:00", true));
      unwrap(await mk(carteC, t4, "14:00", "15:00", true));
      cw.academic.place(studentId, { classroomIds: [own.classroomId], offeringIds: [carteB.offeringId] });
      // L'élève s'inscrit à la carte A : chevauche sa classe (09-10) et la carte B (10:30-11).
      const r = unwrap(await checker.checkStudentOffering(cw.ctx, { studentId, offeringId: carteA.offeringId }));
      expect(r.conflicts).toHaveLength(2);
      expect(r.conflicts.map((c) => c.with.kind).sort()).toEqual(["CLASSROOM", "OFFERING"]);
      const overlap = r.conflicts.find((c) => c.with.kind === "CLASSROOM")!;
      expect(overlap.startsAt.toISOString()).toBe("2026-10-19T09:00:00.000Z");
      expect(overlap.endsAt.toISOString()).toBe("2026-10-19T10:00:00.000Z");
      // Carte C (14-15) : aucun chevauchement. Un apprenant sans autre cours : aucun.
      expect(unwrap(await checker.checkStudentOffering(cw.ctx, { studentId, offeringId: carteC.offeringId })).conflicts).toEqual([]);
      expect(unwrap(await checker.checkStudentOffering(cw.ctx, { studentId: newId(), offeringId: carteA.offeringId })).conflicts).toEqual([]);
      void createRequestContext;
    });
  });
});
