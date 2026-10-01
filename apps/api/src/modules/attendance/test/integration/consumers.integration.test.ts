import { afterAll, beforeAll, expect, it } from "vitest";
import { createSystemContext, newId, noopLogger, unwrap, type DomainEvent } from "@ecoledigitale/kernel";
import type { EventHandlerContext } from "@ecoledigitale/worker/sdk";
import { acceptJustification, submitJustification } from "../../application/justifications";
import { instantiateAttendancePack, listCallPolicyDefinitions, listJustificationReasons, listLeaveTypeDefinitions, listStatusDefinitions, upsertJustificationReason, upsertStatusDefinition } from "../../application/reference";
import { markStudentRecords, openAttendanceSession, reopenAttendanceSession, submitAttendanceSession, validateAttendanceSession } from "../../application/sessions";
import { getAttendanceSummary, removeSummaryOverride } from "../../application/summaries";
import jobs from "../../jobs";
import { audit } from "../../../audit";
import subscribers from "../../subscribers";
import { adminOne, adminRows, createAttendanceTestDb, ctxFor, describeIntegration, type AttendanceTestDb } from "../support/db";
import { CAPS, addOccurrence, makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("référentiels de pack, abonnés d'événements et job de recalcul (Postgres réel)", () => {
  let db: AttendanceTestDb;
  let world: TestWorld;
  let school: School;

  beforeAll(async () => {
    db = await createAttendanceTestDb(12, { withWorker: true, withAudit: true });
    world = makeWorld(db, "2025-10-01T12:00:00.000Z");
    school = await seedSchool(db, world, { students: 4 });
  });
  afterAll(async () => {
    await db.drop();
  });

  const sys = () => createSystemContext(school.tenantId);
  const events = (type: string) => adminRows<any>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY id", [school.tenantId, type]);

  /** Contexte d'un abonné du worker, tel que `apps/worker` le fournit. */
  const handlerContext = (name: string): EventHandlerContext => {
    const ctx = sys();
    return {
      tenantId: school.tenantId, subscriber: name, attempt: 1, jobId: "j1", logger: noopLogger, systemDb: db.systemDb, tenantDb: db.tenantDb,
      db: { ctx, run: (fn, options) => db.tenantDb.run(ctx, fn, options) },
    };
  };
  const deliver = async (name: string, type: string, payload: Record<string, unknown>, id = newId()) => {
    const sub = subscribers.find((s) => s.name === name);
    if (!sub) throw new Error(`abonné introuvable : ${name}`);
    const event: DomainEvent = { id, type, version: 1, tenantId: school.tenantId, occurredAt: new Date().toISOString(), payload: { v: 1, ...payload } };
    await sub.handler(event, handlerContext(name));
    return event;
  };

  it("modèle de pack : amorçage idempotent et NON destructif ; politiques d'appel par établissement ; modèle invalide refusé", async () => {
    const t = await db.createTenant();
    const ctx = ctxFor(t);
    const first = unwrap(await instantiateAttendancePack(world.deps, ctx, { institutionIds: [school.institutionId] }));
    expect(first).toMatchObject({ statuses: 9, reasons: 5, leaveTypes: 5, policies: 3 });
    const again = unwrap(await instantiateAttendancePack(world.deps, ctx, { institutionIds: [school.institutionId] }));
    expect(again).toEqual({ statuses: 0, reasons: 0, leaveTypes: 0, policies: 0 });

    // L'établissement modifie un motif et ajoute un statut : un nouvel amorçage n'y touche pas.
    unwrap(await upsertJustificationReason(world.deps, ctx, { code: "ILLNESS", label: "Maladie (certificat exigé)", requiresAttachment: true }));
    unwrap(await upsertStatusDefinition(world.deps, ctx, { subjectKind: "STUDENT", code: "SUSPENDED", label: "Exclu temporairement", countsAsAbsence: true }));
    unwrap(await instantiateAttendancePack(world.deps, ctx, { institutionIds: [school.institutionId] }));
    expect(unwrap(await listJustificationReasons(world.deps, ctx)).find((r) => r.code === "ILLNESS")).toMatchObject({ label: "Maladie (certificat exigé)", requiresAttachment: true });
    expect(unwrap(await listStatusDefinitions(world.deps, ctx, "STUDENT")).map((s) => s.code)).toEqual(expect.arrayContaining(["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE", "SUSPENDED"]));
    expect(unwrap(await listStatusDefinitions(world.deps, ctx, "STAFF")).map((s) => s.code).sort()).toEqual(["ABSENT", "LATE", "ON_LEAVE", "PRESENT"]);
    expect(unwrap(await listLeaveTypeDefinitions(world.deps, ctx)).map((l) => l.code).sort()).toEqual(["ANNUAL", "AUTHORIZED_ABSENCE", "MATERNITY", "SICK", "UNPAID"]);
    const policies = unwrap(await listCallPolicyDefinitions(world.deps, ctx));
    expect(policies.find((p) => p.educationLevelCode === "PRIMARY")).toMatchObject({ callScope: "DAILY", editWindowMinutes: null });
    expect(policies.find((p) => p.educationLevelCode === "*")).toMatchObject({ callScope: "SESSION", editWindowMinutes: 120 });
    // Les référentiels sont PAR TENANT : l'autre tenant n'en voit rien.
    expect((await listStatusDefinitions(world.deps, school.admin.ctx)).ok).toBe(true);
    expect(unwrap(await listStatusDefinitions(world.deps, school.admin.ctx)).some((s) => s.code === "SUSPENDED")).toBe(false);

    const bad = await instantiateAttendancePack(world.deps, ctx, { pack: { section: "attendance", schemaVersion: 1, educationSystem: "CI", statusDefinitions: [{ subject: "STUDENT", code: "x", label: "x" }] } });
    expect(bad.ok).toBe(false);
  });

  it("abonné `tenancy.tenant.provisioned` : référentiels du pack pour le tenant, rejoué sans effet (idempotence par événement)", async () => {
    const t = await db.createTenant();
    const sub = subscribers.find((s) => s.name === "attendance.seed-reference-data")!;
    const ctxT = createSystemContext(t);
    const hctx: EventHandlerContext = {
      ...handlerContext(sub.name), tenantId: t, db: { ctx: ctxT, run: (fn, options) => db.tenantDb.run(ctxT, fn, options) },
    };
    const event: DomainEvent = { id: newId(), type: "tenancy.tenant.provisioned", version: 1, tenantId: t, occurredAt: new Date().toISOString(), payload: { v: 1, institutionId: school.institutionId } };
    await sub.handler(event, hctx);
    expect((await adminOne<any>(db, "SELECT count(*)::int AS n FROM attendance.status_definitions WHERE tenant_id = $1", [t])).n).toBe(9);
    expect((await adminOne<any>(db, "SELECT count(*)::int AS n FROM attendance.call_policies WHERE tenant_id = $1", [t])).n).toBe(3);
    await sub.handler(event, hctx); // livraison en double
    expect((await adminOne<any>(db, "SELECT count(*)::int AS n FROM attendance.status_definitions WHERE tenant_id = $1", [t])).n).toBe(9);
    expect((await adminOne<any>(db, "SELECT count(*)::int AS n FROM kernel.processed_events WHERE tenant_id = $1 AND subscriber = $2", [t, sub.name])).n).toBe(1);
  });

  it("`scheduling.occurrence.cancelled` : appel ouvert, soumis ou VALIDÉ annulé (réouverture automatique motivée, auditée) ; récapitulatifs recalculés ; rejeu sans effet", async () => {
    const mk = async (date: string, finish: "OPEN" | "SUBMITTED" | "VALIDATED") => {
      const occ = addOccurrence(world, school, { date });
      const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
      unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: [{ studentId: school.students[0]!.studentId, statusCode: "ABSENT" }] }));
      if (finish !== "OPEN") unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }));
      if (finish === "VALIDATED") unwrap(await validateAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, caps: CAPS.admin }));
      return { occ, session };
    };
    const open = await mk("2025-09-22", "OPEN");
    const submitted = await mk("2025-09-23", "SUBMITTED");
    const validated = await mk("2025-09-24", "VALIDATED");
    const before = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: school.students[0]!.enrollmentId, periodId: school.termId }));
    expect(before.derived.absentCount).toBeGreaterThanOrEqual(2);

    for (const x of [open, submitted, validated]) {
      const ev = await deliver("attendance.cancel-session-on-occurrence-cancelled", "scheduling.occurrence.cancelled", { occurrenceId: x.occ.occurrenceId });
      await deliver("attendance.cancel-session-on-occurrence-cancelled", "scheduling.occurrence.cancelled", { occurrenceId: x.occ.occurrenceId }, ev.id); // même événement : ignoré
      const row = await adminOne<any>(db, "SELECT status, note FROM attendance.sessions WHERE id = $1", [x.session.id]);
      expect(row.status).toBe("CANCELLED");
      expect(row.note).toMatch(/occurrence_cancelled/);
    }
    const cancelled = (await events("attendance.session.cancelled")).filter((e) => [open, submitted, validated].some((x) => x.session.id === e.payload.sessionId));
    expect(cancelled).toHaveLength(3);
    expect(cancelled.every((e) => e.payload.cause === "OCCURRENCE_CANCELLED")).toBe(true);
    // Seul l'appel soumis ou validé laisse une trace d'audit (sensible) dans le VRAI journal chaîné ; l'acteur est le système.
    const audits = await adminRows<any>(db, "SELECT action, entity, severity, actor_type, actor_id, reason FROM audit.audit_log WHERE tenant_id = $1 AND action = 'attendance.session.cancelled'", [school.tenantId]);
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.severity === "notice" && a.actor_type === "system" && a.actor_id === null && a.entity === "attendance_session")).toBe(true);
    expect(audits[0].reason).toMatch(/occurrence_cancelled/);
    const chain = await db.tenantDb.run(sys(), (tx) => audit.verifyChain(tx, school.tenantId));
    expect(chain.ok).toBe(true);

    const after = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: school.students[0]!.enrollmentId, periodId: school.termId }));
    expect(after.derived.absentCount).toBe(before.derived.absentCount - 2); // les deux appels soumis/validés ne comptent plus
    // Une occurrence sans appel, ou inconnue : sans effet ni erreur.
    await deliver("attendance.cancel-session-on-occurrence-cancelled", "scheduling.occurrence.cancelled", { occurrenceId: newId() });
    await deliver("attendance.cancel-session-on-occurrence-cancelled", "scheduling.occurrence.cancelled", { sansIdentifiant: true });
  });

  it("changements d'inscription et de période : récapitulatifs rejoués sans port d'un autre module ; job de recalcul = filet de sécurité idempotent", async () => {
    const e = school.students[1]!;
    const occ = addOccurrence(world, school, { date: "2025-09-25" });
    const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    unwrap(await markStudentRecords(world.deps, school.teacher.ctx, { sessionId: session.id, entries: [{ studentId: e.studentId, statusCode: "ABSENT" }] }));
    unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }));
    const summary = () => adminOne<any>(db, "SELECT absent_count, computed_at FROM attendance.period_summaries WHERE enrollment_id = $1 AND period_id = $2", [e.enrollmentId, school.termId]);
    const initial = await summary();
    expect(initial.absent_count).toBe(1);

    // Réparation hors cas d'usage (SQL direct), puis événement : le récapitulatif est rejoué.
    await db.admin.query("UPDATE attendance.student_records SET status_code = 'PRESENT', counted_minutes = NULL, updated_at = now() + interval '1 minute' WHERE session_id = $1 AND enrollment_id = $2", [session.id, e.enrollmentId]);
    await deliver("attendance.refresh-summaries-on-enrollment-change.withdrawn", "academic.enrollment.withdrawn", { enrollmentId: e.enrollmentId });
    expect((await summary()).absent_count).toBe(0);

    await db.admin.query("UPDATE attendance.student_records SET status_code = 'ABSENT', counted_minutes = 60, updated_at = now() + interval '2 minutes' WHERE session_id = $1 AND enrollment_id = $2", [session.id, e.enrollmentId]);
    await deliver("attendance.refresh-summaries-on-period-change.closed", "academic.period.closed", { periodId: school.termId });
    expect((await summary()).absent_count).toBe(1);
    expect((await events("attendance.summary.recomputed")).some((ev) => ev.payload.cause === "PERIOD_CHANGED" && ev.payload.enrollmentId === e.enrollmentId)).toBe(true);

    // Job `attendance.recompute-summaries` : un récapitulatif périmé est rattrapé, puis plus rien à faire.
    await db.admin.query("UPDATE attendance.student_records SET status_code = 'PRESENT', counted_minutes = NULL, updated_at = now() + interval '3 minutes' WHERE session_id = $1 AND enrollment_id = $2", [session.id, e.enrollmentId]);
    const job = jobs[0]!;
    expect(job.perTenant).not.toBe(true);
    await job.handler({ name: job.name, logger: noopLogger, systemDb: db.systemDb, tenantDb: db.tenantDb } as never);
    expect((await summary()).absent_count).toBe(0);
    const eventsBefore = (await events("attendance.summary.recomputed")).length;
    await job.handler({ name: job.name, logger: noopLogger, systemDb: db.systemDb, tenantDb: db.tenantDb } as never);
    expect((await events("attendance.summary.recomputed")).length).toBe(eventsBefore); // idempotent : aucun nouvel événement
    expect(job.cron).toMatch(/^\S+ \S+ \* \* \*$/);
  });

  it("surcharge retirée ou posée avant tout calcul : aucune erreur ; réouverture d'un appel validé conserve les récapitulatifs", async () => {
    const e = school.students[3]!;
    expect((await removeSummaryOverride(world.deps, school.admin.ctx, { enrollmentId: e.enrollmentId, periodId: school.termId })).ok).toBe(false);
    const occ = addOccurrence(world, school, { date: "2025-09-26" });
    const { session } = unwrap(await openAttendanceSession(world.deps, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrenceId, caps: {} }));
    unwrap(await submitAttendanceSession(world.deps, school.teacher.ctx, { sessionId: session.id, allPresent: true }));
    unwrap(await validateAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, caps: CAPS.admin }));
    const before = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: e.enrollmentId, periodId: school.termId }));
    unwrap(await reopenAttendanceSession(world.deps, school.admin.ctx, { sessionId: session.id, reason: "Contrôle de la direction", caps: CAPS.admin }));
    const after = unwrap(await getAttendanceSummary(world.deps, school.admin.ctx, { enrollmentId: e.enrollmentId, periodId: school.termId }));
    expect(after.derived).toEqual(before.derived);
    // Justificatif accepté APRÈS la clôture d'une période : l'excuse s'applique et republie le récapitulatif (pas de verrou).
    const j = unwrap(await submitJustification(world.deps, school.admin.ctx, { studentId: e.studentId, fromDate: "2025-09-26", toDate: "2025-09-26", reasonCode: "OTHER", caps: CAPS.admin }));
    expect(unwrap(await acceptJustification(world.deps, school.admin.ctx, { justificationId: j.justification.id, caps: CAPS.admin })).justification.status).toBe("ACCEPTED");
  });
});
