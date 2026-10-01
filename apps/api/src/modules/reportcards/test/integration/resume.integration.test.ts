import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createBatch } from "../../application/issue";
import { makeSampleBundle } from "../../infrastructure/in-memory-ports";
import { adminRows, createReportcardsTestDb, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { makeWorld, seedSchool, type TestWorld } from "../support/world";

describeIntegration("reprise d'un lot : rejouer le même lot ne retraite que ce qui n'est pas encore émis", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
  });
  afterAll(async () => {
    await db.drop();
  });

  const cards = (tenantId: string) => adminRows<any>(db, "SELECT id, enrollment_id, version FROM reportcards.report_cards WHERE tenant_id = $1 ORDER BY enrollment_id", [tenantId]);

  it("une inscription en échec ou exclue est reprise au rejeu ; les bulletins déjà émis ne sont ni recréés ni modifiés ; un rejeu sans changement est neutre", async () => {
    const t = await db.createTenant();
    const school = await seedSchool(world, t, { students: 3 });
    const [a, b, c] = school.students;
    world.results.failingEnrollments.add(b!.enrollmentId); // le module results est en panne pour b
    world.results.bundles.delete(`${c!.enrollmentId}:${school.periodId}`); // pas encore de résultat pour c
    const params = { classroomId: school.classroomId, academicPeriodId: school.periodId };

    const first = unwrap(await createBatch(world.deps, school.admin.ctx, params));
    expect(first).toMatchObject({ replayed: false });
    expect(first.batch).toMatchObject({ total: 3, issued: 1, excluded: 1, failed: 1 });
    const issuedFirst = await cards(t);
    expect(issuedFirst).toHaveLength(1);

    // Rien n'a changé : rejeu neutre (aucune écriture, aucun événement ni audit supplémentaire).
    const eventsBefore = (await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE tenant_id = $1", [t])).length;
    const auditBefore = world.audit.entries.length;
    const idle = unwrap(await createBatch(world.deps, school.admin.ctx, params));
    expect(idle.replayed).toBe(true);
    expect(idle.batch.id).toBe(first.batch.id);
    expect((await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE tenant_id = $1", [t])).length).toBe(eventsBefore);
    expect(world.audit.entries.length).toBe(auditBefore);

    // La panne est résolue et le résultat de c est disponible : le MÊME lot est repris.
    world.results.failingEnrollments.clear();
    world.results.setBundle(c!.enrollmentId, school.periodId, c!.bundle);
    const resumed = unwrap(await createBatch(world.deps, school.admin.ctx, params));
    expect(resumed.replayed).toBe(false);
    expect(resumed.batch.id).toBe(first.batch.id);
    expect(resumed.batch).toMatchObject({ total: 3, issued: 3, excluded: 0, failed: 0 });
    expect(resumed.items.map((i) => i.outcome)).toEqual(["ISSUED", "ISSUED", "ISSUED"]);
    const all = await cards(t);
    expect(all).toHaveLength(3);
    expect(all.find((x) => x.enrollment_id === a!.enrollmentId)!.id).toBe(issuedFirst[0].id); // le premier bulletin n'a pas été recréé
    expect(all.every((x) => x.version === 1)).toBe(true);
    expect((await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'reportcards.snapshot.created'", [t])).length).toBe(3);
    expect(world.audit.actions).toContain("reportcards.batch.resumed");

    // Et de nouveau neutre.
    expect(unwrap(await createBatch(world.deps, school.admin.ctx, params)).replayed).toBe(true);
  });

  it("une inscription arrivée après le premier passage est émise au rejeu (inscrit tardif), sans toucher aux autres", async () => {
    const t = await db.createTenant();
    const school = await seedSchool(world, t, { students: 2 });
    const params = { classroomId: school.classroomId, academicPeriodId: school.periodId };
    unwrap(await createBatch(world.deps, school.admin.ctx, params));
    const late = { studentId: newId(), enrollmentId: newId() };
    world.results.setBundle(late.enrollmentId, school.periodId, makeSampleBundle({ ...late, classroomId: school.classroomId, periodId: school.periodId, yearId: school.yearId, stateId: school.stateId, ruleVersionId: school.ruleVersionId, pack: "SECONDARY", lastName: "TARDIF", firstNames: "Inscrit" }));
    world.results.setRoster(school.classroomId, school.periodId, [...school.students.map((s) => ({ enrollmentId: s.enrollmentId, studentId: s.studentId, outcome: "FINAL" as const })), { ...late, outcome: "FINAL" as const }]);
    const again = unwrap(await createBatch(world.deps, school.admin.ctx, params));
    expect(again.replayed).toBe(false);
    expect(again.batch).toMatchObject({ total: 3, issued: 3 });
    expect(await cards(t)).toHaveLength(3);
  });
});
