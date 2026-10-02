/**
 * Assemblage des modules « opérations » avec les VRAIS adaptateurs (aucun port en mémoire entre modules) :
 *
 *   finance -> academic   confirmation AUTOMATIQUE de l'inscription après paiement des frais d'inscription (décision métier)
 *   academic/people -> scheduling   une séance se crée sur une vraie classe et de vrais intervenants
 *   scheduling -> attendance        l'appel s'ouvre sur la séance ; l'effectif vient d'academic ; l'appel soumis est connu de scheduling
 *   attendance -> reportcards       absences / retards copiés dans le bulletin
 *   scheduling + attendance + people -> payroll   heures payables, gel atomique, présences du personnel, annuaire du personnel
 *   finance -> reportcards          impayé exigible (sans montant)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, newId, unwrap } from "@ecoledigitale/kernel";
import { financeInvoicePaidEventPayloadSchema } from "@ecoledigitale/contracts/src/v2/finance";
import { academicConsumedInvoicePaidSchema } from "@ecoledigitale/contracts/src/v2/academic";
import { enrollStudent, getEnrollment, handleInvoicePaid } from "../../src/modules/academic";
import { createFinanceDeps, createFee, createFeeSchedule, createInvoice, markOverdueInvoices, recordManualPayment, type FinanceDeps } from "../../src/modules/finance";
import { createStudent } from "../../src/modules/people";
import {
  holdOccurrence,
  createOccurrence,
  listPayableHours,
  seedReference,
  validateOccurrence,
} from "../../src/modules/scheduling";
import { getAttendanceSession, markStaffAttendance, markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../src/modules/attendance";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, ctxOf, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");
const dayOffset = (w: AssemblyWorld, days: number): string => new Date(w.clock.now().getTime() + days * 86_400_000).toISOString().slice(0, 10);

// NB : la séance porte le nœud NIVEAU (le tronc obligatoire de la classe) ; une UE/ECUE facultative n'est suivie que par
// les élèves qui l'ont sélectionnée (effectif par nœud d'academic).
describeIntegration("opérations assemblées : finance -> academic, scheduling <-> attendance, paie, bulletins (adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let fin: FinanceDeps;
  let yearCode: string;

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 3 });
    fin = createFinanceDeps({ db: w.tenantDb, clock: w.clock, logger: w.kit.logger, portsProvider: () => w.ports.finance });
    yearCode = (await adminRows<{ code: string }>(w, "SELECT code FROM academic.academic_years WHERE id = $1", [school.seed.yearId]))[0]!.code;
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  describe("finance -> academic : inscription confirmée par le paiement des frais d'inscription", () => {
    let studentId: string;
    let enrollmentId: string;
    let invoiceId: string;

    it("avec un barème d'inscription applicable, l'inscription reste EN ATTENTE ; sans barème elle était confirmée sur-le-champ", async () => {
      const registration = unwrap(await createFee(fin, w.director, { code: "INSC", name: "Inscription", category: "REGISTRATION" }));
      unwrap(await createFeeSchedule(fin, w.director, { feeId: registration.id, academicYear: yearCode, amount: xof(25_000), effectiveFrom: dayOffset(w, -200), scope: { levelKey: "L1", trackKey: "INFO" } }));
      const created = unwrap(await createStudent(w.kit.people, w.director, { person: { lastName: "NOUVEAU", firstName: "Eleve", sex: "F", birthDate: "2006-02-02", birthPlace: "Bouake" } }));
      if (created.kind !== "created") throw new Error("création attendue");
      studentId = created.student.id;
      const e = unwrap(await enrollStudent(w.academic.deps, w.director, { studentId, classroomId: school.seed.classroomId }));
      expect(e.status).toBe("PENDING");
      enrollmentId = e.id;
    });

    it("une facture de scolarité seule (sans frais d'inscription) soldée ne confirme PAS l'inscription", async () => {
      const created = unwrap(
        await createInvoice(fin, w.director, {
          learnerId: studentId,
          enrollmentId,
          lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(40_000) }],
          dueDate: dayOffset(w, 30),
          issue: true,
        }),
      );
      const tuition = created.invoices[0]!;
      const report = unwrap(await handleInvoicePaid(w.academic.deps, w.director, academicConsumedInvoicePaidSchema.parse({ v: 1, invoiceId: tuition.invoice.id, learnerId: studentId })));
      // Charge NON enrichie : academic relit les faits de la facture par le port InvoiceFactsReader (finance réel).
      expect(report.enrollmentConfirmed).toBeNull();
      expect(unwrap(await getEnrollment(w.academic.deps, w.director, enrollmentId)).status).toBe("PENDING");
    });

    it("la facture d'inscription soldée publie une charge enrichie ; academic confirme l'inscription VISÉE, une seule fois", async () => {
      const created = unwrap(
        await createInvoice(fin, w.director, {
          learnerId: studentId,
          enrollmentId,
          lines: [{ category: "REGISTRATION", description: "Frais d'inscription", unitAmount: xof(25_000) }],
          dueDate: dayOffset(w, 30),
          issue: true,
        }),
      );
      invoiceId = created.invoices[0]!.invoice.id;
      // Paiement par le cas d'usage public de finance.
      unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId: studentId, amount: xof(25_000), method: "TRANSFER", reference: "VIR-1", allocation: { mode: "AUTO", invoiceIds: [invoiceId] } }));
      const events = await adminRows<{ payload: Record<string, unknown> }>(w, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'finance.invoice.paid' AND aggregate_id = $2", [w.tenantId, invoiceId]);
      expect(events).toHaveLength(1);
      const payload = financeInvoicePaidEventPayloadSchema.parse(events[0]!.payload);
      expect(payload).toMatchObject({ enrollmentId, containsRegistrationFee: true });

      // La charge est consommée telle que finance la publie (contrat des deux côtés).
      const report = unwrap(await handleInvoicePaid(w.academic.deps, w.director, academicConsumedInvoicePaidSchema.parse(events[0]!.payload)));
      expect(report.enrollmentConfirmed).toBe(enrollmentId);
      expect(unwrap(await getEnrollment(w.academic.deps, w.director, enrollmentId)).status).toBe("ACTIVE");

      // Rejeu (au moins une fois) : aucune seconde transition.
      const replay = unwrap(await handleInvoicePaid(w.academic.deps, w.director, academicConsumedInvoicePaidSchema.parse(events[0]!.payload)));
      expect(replay.enrollmentConfirmed).toBeNull();
      const confirmed = await adminRows<{ n: string }>(w, "SELECT count(*)::text AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'academic.enrollment.confirmed' AND aggregate_id = $2", [w.tenantId, enrollmentId]);
      expect(Number(confirmed[0]!.n)).toBe(1);
    });

    it("sans enrichissement de la charge, le port InvoiceFactsReader relit la facture et conclut de même", async () => {
      const facts = await w.ports.academic.invoiceFacts!.getInvoiceFacts(w.director, invoiceId);
      expect(facts).toMatchObject({ invoiceId, learnerId: studentId, enrollmentId });
      expect(facts!.lines.map((l) => l.category)).toEqual(["REGISTRATION"]);
      expect(await w.ports.academic.invoiceFacts!.getInvoiceFacts(w.director, newId())).toBeNull();
    });

    it("la sonde `registrationFeeDue` : due pour le périmètre barémé, inconnue (null) pour une classe inconnue", async () => {
      const probe = w.ports.academic.registrationFee!;
      const e = unwrap(await getEnrollment(w.academic.deps, w.director, enrollmentId));
      const due = await probe.registrationFeeDue(w.director, {
        classroomId: e.classroomId,
        academicYearId: e.academicYearId,
        programId: school.seed.programId,
        institutionId: e.institutionId,
        fundingType: e.fundingType,
      } as never);
      expect(due).toBe(true);
      expect(await probe.registrationFeeDue(w.director, { classroomId: newId(), academicYearId: e.academicYearId, programId: school.seed.programId, institutionId: e.institutionId, fundingType: e.fundingType } as never)).toBeNull();
    });

    it("finance -> reportcards : l'impayé exigible est un booléen sans montant ; finance refuse un apprenant inconnu (annuaire réel)", async () => {
      const standing = w.ports.reportcards.standing!;
      expect(await standing.hasOutstandingBalance(w.director, studentId)).toBe(false);
      const refused = await createInvoice(fin, w.director, { learnerId: newId(), academicYear: yearCode, lines: [{ category: "TUITION", description: "X", unitAmount: xof(1000) }], dueDate: dayOffset(w, 5), issue: true });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("finance.learner_not_found");

      const late = unwrap(await createInvoice(fin, w.director, { learnerId: studentId, academicYear: yearCode, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(10_000) }], dueDate: dayOffset(w, -10), issue: true }));
      expect(late.invoices).toHaveLength(1);
      unwrap(await markOverdueInvoices(fin, w.director));
      expect(await standing.hasOutstandingBalance(w.director, studentId)).toBe(true);
      expect(await standing.hasOutstandingBalance(w.director, school.pupils[0]!.studentId)).toBe(false);
    });
  });

  describe("scheduling <-> attendance <-> payroll <-> reportcards (séance réelle, classe réelle, enseignant réel)", () => {
    const hours = (): { from: string; to: string } => ({ from: dayOffset(w, -5), to: dayOffset(w, 0) });
    let occurrenceId: string;
    let sessionId: string;
    let lessonDate: string;

    beforeAll(async () => {
      // Les inscriptions datent d'aujourd'hui : on avance l'horloge d'un jour pour que la séance (hier) tombe dans leur placement.
      w.clock.advance(86_400_000);
      unwrap(await seedReference(w.kit.scheduling, w.director));
      lessonDate = dayOffset(w, -1);
    });

    it("academic + people -> scheduling : la séance se crée sur la classe, le nœud et l'enseignant RÉELS ; un intervenant inconnu est refusé", async () => {
      const created = unwrap(
        await createOccurrence(w.kit.scheduling, w.director, {
          kind: "LESSON",
          classroomId: school.seed.classroomId,
          curriculumNodeId: school.seed.levelNodeId,
          date: lessonDate,
          startTime: "08:00",
          endTime: "10:00",
          staff: [{ staffId: school.teacher.staffId }],
        }),
      );
      occurrenceId = created.occurrence.id;
      expect(created.occurrence.classroomId).toBe(school.seed.classroomId);

      const unknown = await createOccurrence(w.kit.scheduling, w.director, {
        kind: "LESSON",
        classroomId: school.seed.classroomId,
        curriculumNodeId: school.seed.levelNodeId,
        date: lessonDate,
        startTime: "11:00",
        endTime: "12:00",
        staff: [{ staffId: newId() }],
      });
      expect(unknown.ok).toBe(false);
    });

    it("scheduling -> attendance : la séance est connue du port (classe, durée, intervenants) et attendue dans la fenêtre", async () => {
      const info = await w.ports.attendance.occurrences!.getOccurrence(w.director, occurrenceId);
      expect(info).toMatchObject({ occurrenceId, classroomId: school.seed.classroomId, date: lessonDate, durationMinutes: 120, status: "PLANNED" });
      expect(info!.staff.map((s) => s.staffId)).toEqual([school.teacher.staffId]);
      const expected = await w.ports.attendance.occurrences!.listExpectedOccurrences(w.director, { from: lessonDate, to: lessonDate });
      expect(expected.map((o) => o.occurrenceId)).toContain(occurrenceId);
      expect(await w.ports.attendance.occurrences!.getOccurrence(w.director, newId())).toBeNull();
    });

    it("academic -> attendance : l'appel s'ouvre avec l'effectif RÉEL de la classe ; les élèves marqués sont ceux de l'inscription", async () => {
      const opened = unwrap(await openAttendanceSession(w.kit.attendance, school.teacher.ctx, { kind: "occurrence", occurrenceId, caps: {} }));
      sessionId = opened.session.id;
      expect(opened.session).toMatchObject({ classroomId: school.seed.classroomId, durationMinutes: 120, takenByStaffId: school.teacher.staffId });
      const [p1, p2, p3] = school.pupils;
      unwrap(
        await markStudentRecords(w.kit.attendance, school.teacher.ctx, {
          sessionId,
          entries: [
            { studentId: p1!.studentId, statusCode: "PRESENT" },
            { studentId: p2!.studentId, statusCode: "ABSENT" },
            { studentId: p3!.studentId, statusCode: "LATE", minutesLate: 10 },
          ],
          caps: {},
        }),
      );
      // Un élève hors effectif de la classe est refusé (roster d'academic).
      const outsider = unwrap(await createStudent(w.kit.people, w.director, { person: { lastName: "HORS", firstName: "Classe", sex: "M", birthDate: "2006-03-03" } }));
      if (outsider.kind !== "created") throw new Error("création attendue");
      const refused = await markStudentRecords(w.kit.attendance, school.teacher.ctx, { sessionId, entries: [{ studentId: outsider.student.id, statusCode: "PRESENT" }], caps: {} });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("attendance.student_not_in_roster");
    });

    it("l'appel soumis : scheduling le sait (AttendanceQuery) ; l'enseignant d'un autre compte ne peut pas prendre l'appel", async () => {
      expect(await w.ports.scheduling.attendance!.hasSubmittedAttendance(w.director, occurrenceId)).toBe(false);
      const stranger = ctxOf(w, newId(), ["enseignant"], false);
      const denied = await openAttendanceSession(w.kit.attendance, stranger, { kind: "occurrence", occurrenceId, caps: {} });
      expect(denied.ok).toBe(false);
      // La 4e inscription (confirmée par le paiement, plus haut) fait partie de l'effectif : « tous présents sauf » la couvre.
      const submitted = unwrap(await submitAttendanceSession(w.kit.attendance, school.teacher.ctx, { sessionId, defaultStatus: "PRESENT", caps: {} }));
      expect(submitted.filledByDefault).toBe(1);
      expect(await w.ports.scheduling.attendance!.hasSubmittedAttendance(w.director, occurrenceId)).toBe(true);
      expect(unwrap(await getAttendanceSession(w.kit.attendance, school.teacher.ctx, { sessionId, caps: {} })).session.status).toBe("SUBMITTED");
    });

    it("attendance -> reportcards : minutes d'absence et retards de l'inscription sur la période, par le récapitulatif effectif", async () => {
      const port = w.ports.reportcards.attendance!;
      const absent = await port.getSummary(w.director, { enrollmentId: school.pupils[1]!.enrollmentId, academicPeriodId: school.ref.academicPeriodId });
      expect(absent).toEqual({ justifiedMinutes: 0, unjustifiedMinutes: 120, lateCount: 0 });
      const late = await port.getSummary(w.director, { enrollmentId: school.pupils[2]!.enrollmentId, academicPeriodId: school.ref.academicPeriodId });
      expect(late).toMatchObject({ lateCount: 1, unjustifiedMinutes: 0 });
      const present = await port.getSummary(w.director, { enrollmentId: school.pupils[0]!.enrollmentId, academicPeriodId: school.ref.academicPeriodId });
      expect(present).toEqual({ justifiedMinutes: 0, unjustifiedMinutes: 0, lateCount: 0 });
    });

    it("scheduling -> payroll : séance réalisée ET validée = heure payable ; gel ATOMIQUE par bulletin, libération idempotente", async () => {
      const port = w.ports.payroll.sessionHours!;
      expect(await port.collect(w.director, hours())).toEqual([]); // planifiée seulement
      unwrap(await holdOccurrence(w.kit.scheduling, w.director, { occurrenceId, source: "ATTENDANCE" }));
      expect(await port.collect(w.director, hours())).toEqual([]); // réalisée, pas encore validée
      unwrap(await validateOccurrence(w.kit.scheduling, ctxOf(w, newId(), ["econome"], true), { occurrenceId }));

      const facts = await port.collect(w.director, { ...hours(), staffIds: [school.teacher.staffId] });
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ kind: "SESSION", refId: occurrenceId, staffId: school.teacher.staffId, date: lessonDate, durationMinutes: 120, realized: true, validated: true, nodeId: school.seed.levelNodeId, classroomId: school.seed.classroomId });

      const lockRef = newId();
      await port.lock!(w.director, { lockRef, lines: [{ refId: occurrenceId, staffId: school.teacher.staffId }] } as never);
      // Une heure ne se paie qu'une fois : un autre bulletin ne peut pas la réclamer (le refus LÈVE).
      await expect(port.lock!(w.director, { lockRef: newId(), lines: [{ refId: occurrenceId, staffId: school.teacher.staffId }] } as never)).rejects.toMatchObject({ code: "scheduling.hours_already_locked" });
      expect(unwrap(await listPayableHours(w.kit.scheduling, w.director, hours()))[0]).toMatchObject({ locked: true, lockRef });
      await port.release!(w.director, { lockRef } as never);
      await port.release!(w.director, { lockRef } as never);
      expect(unwrap(await listPayableHours(w.kit.scheduling, w.director, hours()))[0]).toMatchObject({ locked: false });
    });

    it("attendance -> payroll : la présence terminée du personnel est un fait d'origine ATTENDANCE (durée du pointage), annuaire du personnel réel", async () => {
      const day = dayOffset(w, -2);
      unwrap(
        await markStaffAttendance(w.kit.attendance, w.director, {
          staffId: school.teacher.staffId,
          workDate: day,
          statusCode: "PRESENT",
          checkInAt: new Date(`${day}T08:00:00.000Z`),
          checkOutAt: new Date(`${day}T12:30:00.000Z`),
          caps: { staffRecord: true, staffRead: true },
        }),
      );
      const facts = await w.ports.payroll.attendanceHours!.collect(w.director, { from: day, to: day, staffIds: [school.teacher.staffId] });
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ kind: "ATTENDANCE", staffId: school.teacher.staffId, date: day, durationMinutes: 270, realized: true, validated: true });

      const staff = await w.ports.payroll.staff!.getStaff(w.director, school.teacher.staffId);
      expect(staff).toMatchObject({ staffId: school.teacher.staffId, active: true });
      expect(staff!.displayName).toContain("ENSEIGNANT");
      expect(staff!.userId).not.toBeNull();
      expect(await w.ports.payroll.staff!.getStaffIdForUser(w.director, staff!.userId!)).toBe(school.teacher.staffId);
      expect(await w.ports.payroll.staff!.getStaffIdForUser(w.director, newId())).toBeNull();
      expect((await w.ports.payroll.staff!.getStaffMany(w.director, [school.teacher.staffId, newId()])).map((s) => s.staffId)).toEqual([school.teacher.staffId]);
    });

    it("academic -> payroll : libellé et code du nœud pour les lignes du bulletin de paie ; un nœud inconnu n'a pas de libellé", async () => {
      const nodeId = school.seed.ue1.ecueIds[0]!;
      const labels = await w.ports.payroll.curriculum!.getLabels(w.director, [nodeId, newId()]);
      expect(labels.get(nodeId)).toEqual({ label: "ECUE E11", code: "E11" });
      expect(labels.size).toBe(1);
    });
  });
});
