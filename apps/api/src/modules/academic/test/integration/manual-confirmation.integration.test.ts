/**
 * O-01 — une inscription est confirmée par le PAIEMENT des frais d'inscription OU par une confirmation MANUELLE
 * (dérogation de la direction : permission dédiée, motif tracé). Postgres réel, RLS A/B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import {
  RecordingAudit,
  confirmEnrollmentManually,
  enrollStudent,
  getEnrollment,
  getEnrollmentHistory,
  handleInvoicePaid,
  listMyEnrollments,
  updateAcademicSettings,
} from "../../index";
import { adminOne, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { addStudent, assertEventsValid, codeOf, eventsOf, makeWorld, seedHigher, type World } from "../support/world";

describeIntegration("O-01 : confirmation d'inscription par paiement OU manuelle (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });
  const newWorld = async (): Promise<World> => makeWorld(db, await db.createTenant());
  const pendingEnrollment = async (w: World) => {
    const s = await seedHigher(w); // pack HIGHER : politique ON_REGISTRATION_FEE_PAID -> PENDING
    const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
    expect(e.status).toBe("PENDING");
    return { s, e };
  };

  it("dérogation : refusée sans la permission dédiée, motif obligatoire, puis confirmée avec mode, motif et auteur tracés", async () => {
    const w = await newWorld();
    const { e } = await pendingEnrollment(w);

    // 1. sans la permission dédiée : 403 `academic.enrollment_override_required`, rien ne change
    const denied = await confirmEnrollmentManually(w.deps, w.ctx, e.id, { reason: "Paiement attendu du parent", overridePermitted: false });
    expect(codeOf(denied)).toBe("academic.enrollment_override_required");
    expect(!denied.ok && denied.error.httpStatus).toBe(403);
    expect(unwrap(await getEnrollment(w.deps, w.ctx, e.id)).status).toBe("PENDING");

    // 2. permission présente mais motif absent / trop court : refusé
    expect(codeOf(await confirmEnrollmentManually(w.deps, w.ctx, e.id, { overridePermitted: true }))).toBe("academic.enrollment_reason_required");
    expect(codeOf(await confirmEnrollmentManually(w.deps, w.ctx, e.id, { reason: "ok", overridePermitted: true }))).toBe("academic.enrollment_reason_required");
    expect(unwrap(await getEnrollment(w.deps, w.ctx, e.id)).status).toBe("PENDING");

    // 3. dérogation motivée
    const confirmed = unwrap(await confirmEnrollmentManually(w.deps, w.ctx, e.id, { reason: "  Échéancier accepté par la direction  ", overridePermitted: true }));
    expect(confirmed).toMatchObject({ status: "ACTIVE", confirmationMode: "OVERRIDE", confirmationReason: "Échéancier accepté par la direction", confirmedBy: w.ctx.userId });
    expect(confirmed.confirmedAt).not.toBeNull();

    // historique immuable : le motif de la dérogation y figure
    const hist = unwrap(await getEnrollmentHistory(w.deps, w.ctx, e.id));
    expect(hist.at(-1)).toMatchObject({ kind: "STATUS", toValue: { status: "ACTIVE" }, reason: "dérogation : Échéancier accepté par la direction", actorId: w.ctx.userId });

    // événement : `academic.enrollment.confirmed` porte le mode (additif) ; payload toujours conforme au schéma versionné
    const events = await eventsOf(w, "academic.enrollment.confirmed");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ v: 1, enrollmentId: e.id, status: "ACTIVE", previousStatus: "PENDING", confirmationMode: "OVERRIDE" });
    await assertEventsValid(w);

    // audit SENSIBLE de la dérogation, avec motif
    const audit = (w.audit as RecordingAudit).entries.find((x) => x.entry.action === "academic.enrollment.confirmation_overridden");
    expect(audit?.entry).toMatchObject({ sensitive: true, resourceType: "enrollment", resourceId: e.id, reason: "Échéancier accepté par la direction" });

    // idempotence : on ne confirme pas deux fois
    expect(codeOf(await confirmEnrollmentManually(w.deps, w.ctx, e.id, { reason: "Encore une fois", overridePermitted: true }))).toBe("academic.enrollment_transition");
  });

  it("la base impose le motif d'une dérogation (contrainte), même contournant l'application", async () => {
    const w = await newWorld();
    const { e } = await pendingEnrollment(w);
    await expect(db.admin.query("UPDATE academic.enrollments SET confirmation_mode = 'OVERRIDE' WHERE id = $1", [e.id])).rejects.toThrow(/enrollments_override_needs_reason/);
    await expect(db.admin.query("UPDATE academic.enrollments SET confirmation_mode = 'BIZARRE' WHERE id = $1", [e.id])).rejects.toThrow(/confirmation_mode/);
  });

  it("politique MANUAL : confirmation ordinaire d'une personne habilitée, sans dérogation ni motif obligatoire", async () => {
    const w = await newWorld();
    const { s } = await pendingEnrollment(w);
    unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "MANUAL" }));
    const e2 = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
    expect(e2.status).toBe("PENDING");
    const confirmed = unwrap(await confirmEnrollmentManually(w.deps, w.ctx, e2.id, { overridePermitted: false }));
    expect(confirmed).toMatchObject({ status: "ACTIVE", confirmationMode: "MANUAL", confirmationReason: null, confirmedBy: w.ctx.userId });
    const audit = (w.audit as RecordingAudit).entries.find((x) => x.entry.action === "academic.enrollment.confirmed_manually");
    expect(audit?.entry.sensitive).toBe(false);
    expect((await eventsOf(w, "academic.enrollment.confirmed")).at(-1)!.payload.confirmationMode).toBe("MANUAL");
    await assertEventsValid(w);
  });

  it("paiement : le comportement automatique reste inchangé et porte le mode PAYMENT", async () => {
    const w = await newWorld();
    const { e } = await pendingEnrollment(w);
    const report = unwrap(await handleInvoicePaid(w.deps, w.ctx, { v: 1, invoiceId: newId(), enrollmentId: e.id, containsRegistrationFee: true }));
    expect(report.enrollmentConfirmed).toBe(e.id);
    const after = unwrap(await getEnrollment(w.deps, w.ctx, e.id));
    expect(after).toMatchObject({ status: "ACTIVE", confirmationMode: "PAYMENT", confirmationReason: null, confirmedBy: w.ctx.userId });
    expect((await eventsOf(w, "academic.enrollment.confirmed")).at(-1)!.payload.confirmationMode).toBe("PAYMENT");
    // une facture soldée n'écrase jamais une dérogation déjà posée (l'inscription n'est plus PENDING)
    const second = unwrap(await handleInvoicePaid(w.deps, w.ctx, { v: 1, invoiceId: newId(), enrollmentId: e.id, containsRegistrationFee: true }));
    expect(second.enrollmentConfirmed).toBeNull();
    await assertEventsValid(w);
  });

  it("une inscription active dès la création (politique AUTO) porte le mode AUTO", async () => {
    const w = await newWorld();
    const s = await seedHigher(w);
    unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "AUTO" }));
    const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
    expect(e).toMatchObject({ status: "ACTIVE", confirmationMode: "AUTO" });
  });

  it("RLS A/B : un autre établissement ne voit ni ne confirme l'inscription (404), la dérogation d'un tenant reste invisible à l'autre", async () => {
    const a = await newWorld();
    const b = await newWorld();
    const { e } = await pendingEnrollment(a);
    expect(codeOf(await confirmEnrollmentManually(b.deps, b.ctx, e.id, { reason: "Tentative inter-tenant", overridePermitted: true }))).toBe("academic.enrollment_not_found");
    expect(unwrap(await getEnrollment(a.deps, a.ctx, e.id)).status).toBe("PENDING");
    unwrap(await confirmEnrollmentManually(a.deps, a.ctx, e.id, { reason: "Dérogation du tenant A", overridePermitted: true }));
    const leaked = await adminOne<{ n: string }>(db, "SELECT count(*)::text AS n FROM academic.enrollments WHERE tenant_id = $1 AND confirmation_mode = 'OVERRIDE'", [b.tenantId]);
    expect(leaked.n).toBe("0");
    expect(codeOf(await getEnrollment(b.deps, b.ctx, e.id))).toBe("academic.enrollment_not_found");
  });

  it("les familles ne voient jamais le motif ni l'auteur d'une dérogation", async () => {
    const w = await newWorld();
    const s = await seedHigher(w);
    const familyUser = newId();
    const student = addStudent(w, {}, familyUser);
    const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: s.classroomId }));
    unwrap(await confirmEnrollmentManually(w.deps, w.ctx, e.id, { reason: "Dérogation confidentielle", overridePermitted: true }));
    const mine = unwrap(await listMyEnrollments(w.deps, { ...w.ctx, userId: familyUser }));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ confirmationMode: "OVERRIDE", confirmationReason: null, confirmedBy: null });
    // le personnel de gestion, lui, voit le motif
    expect(unwrap(await getEnrollment(w.deps, w.ctx, e.id))).toMatchObject({ confirmationReason: "Dérogation confidentielle" });
  });
});
