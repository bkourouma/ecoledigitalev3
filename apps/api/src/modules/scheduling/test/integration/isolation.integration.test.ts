/**
 * Isolation multi-tenant du module (ADR-002, critère de sortie 1) : test générique `assertTenantIsolation` sur
 * les 19 tables du schéma, et isolation de bout en bout à travers les cas d'usage (deux tenants).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { createOccurrence } from "../../application/occurrences";
import { listPayableHours, validateOccurrence } from "../../application/validation";
import { getOccurrence, listOccurrences } from "../../application/views";
import { listRooms } from "../../application/reference";
import { fixtures, schedulingTenantTables } from "../../../isolation-allowlist.scheduling";
import { createSchedulingTestDb, describeIntegration, type SchedulingTestDb } from "../support/db";
import { addClass, addRoom, addStaff, createWorld, expectErr, unwrap } from "../support/world";

describeIntegration("isolation multi-tenant", () => {
  let db: SchedulingTestDb;
  beforeAll(async () => {
    db = await createSchedulingTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  it("assertTenantIsolation : RLS forcée, policy unique, index tenant_id sur les 19 tables ; aucune table globale", async () => {
    const report = await checkTenantIsolation({ pool: db.appPool, schemas: ["kernel", "scheduling"], allowlist: ["kernel.tenants"], fixtures });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    const covered = [...report.behavioural, ...report.structuralOnly.map((s) => s.table)].filter((t) => t.startsWith("scheduling."));
    expect(covered.sort()).toEqual([...schedulingTenantTables].sort());
    // Les tables simples sont aussi vérifiées en COMPORTEMENT (deux tenants) ; les autres le sont par sql-guards.
    expect(report.behavioural.filter((t) => t.startsWith("scheduling.")).length).toBeGreaterThanOrEqual(9);
    // La séance (agrégat central, CHECK de bornes horaires) est vérifiée en COMPORTEMENT grâce aux `fixtures`, pas en structure seule.
    expect(report.behavioural).toContain("scheduling.session_occurrences");
    expect(report.structuralOnly.filter((s) => s.table.startsWith("scheduling.")).map((s) => s.reason).filter((r) => /check constraint/.test(r))).toEqual([]);
    console.info(`[isolation] scheduling : comportement=${report.behavioural.filter((t) => t.startsWith("scheduling.")).join(", ")} ; structure seule=${report.structuralOnly.filter((s) => s.table.startsWith("scheduling.")).map((s) => `${s.table} (${s.reason})`).join(" ; ")}`);
    await assertTenantIsolation({ pool: db.appPool, schemas: ["kernel", "scheduling"], allowlist: ["kernel.tenants"], fixtures });
  });

  it("à travers les cas d'usage : un tenant ne lit ni ne verrouille rien chez l'autre, et ne subit aucun de ses conflits", async () => {
    const a = await createWorld({ db });
    const b = await createWorld({ db });
    const teacher = addStaff(a, "Prof A");
    const cls = addClass(a, "Classe A");
    const room = await addRoom(a, "ISO", 30);
    const occ = unwrap(
      await createOccurrence(a.deps, a.ctx, { kind: "LESSON", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, roomId: room.id, date: "2026-10-05", startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacher }] }),
    ).occurrence;
    await expectErr(getOccurrence(b.deps, b.ctx, { occurrenceId: occ.id }), "scheduling.not_found");
    expect(unwrap(await listOccurrences(b.deps, b.ctx, {})).items).toEqual([]);
    expect(unwrap(await listRooms(b.deps, b.ctx, {}))).toEqual([]);
    await expectErr(validateOccurrence(b.deps, b.ctx, { occurrenceId: occ.id }), "scheduling.not_found");
    expect(unwrap(await listPayableHours(b.deps, b.ctx, { from: "2026-01-01", to: "2026-12-31" }))).toEqual([]);
    // Mêmes identifiants (enseignant, classe, salle) réservés par B au même créneau : aucun conflit inter-tenant.
    b.academic.addClassroom({ id: cls.classroomId, institutionId: b.institutionId, campusId: b.campusId, academicYearId: b.yearId, name: "Classe B", headcount: null });
    b.academic.addNode({ id: cls.nodeId, label: "x", hoursTotalMinutes: null, subjectId: null });
    b.people.addStaff({ id: teacher, displayName: "Prof B", status: "ACTIVE", userId: null });
    unwrap(
      await createOccurrence(b.deps, b.ctx, { kind: "LESSON", classroomId: cls.classroomId, curriculumNodeId: cls.nodeId, date: "2026-10-05", startTime: "08:00", endTime: "09:00", staff: [{ staffId: teacher }] }),
    );
  });
});
