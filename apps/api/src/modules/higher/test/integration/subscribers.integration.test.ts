/**
 * Abonnés et job du worker, tels que `apps/worker` les exécute : contexte de handler réel, idempotence
 * (`kernel.processed_events`), audit RÉEL (module audit), règles RÉELLES (module rules) sur le `TenantDb` du worker,
 * ports des modules voisins fournis par `registerHigherWorkerPorts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext, newId, noopLogger, type DomainEvent } from "@ecoledigitale/kernel";
import type { EventHandlerContext } from "@ecoledigitale/worker/sdk";
import { createRulesDeps, ensureNationalCatalog, putBinding } from "../../../rules";
import { awardDiploma } from "../../application/awards";
import { createDiploma } from "../../application/diplomas";
import { updateHigherSettings } from "../../application/settings";
import jobs from "../../jobs";
import subscribers from "../../subscribers";
import { registerHigherWorkerPorts, resetHigherWorkerPorts } from "../../worker-ports";
import { adminOne, adminRows, createHigherTestDb, ctxFor, describeIntegration, type HigherTestDb } from "../support/db";
import { makeWorld, scriptRules, seedSchool, ueLine, type School, type TestWorld } from "../support/world";

describeIntegration("abonnés et job du worker (Postgres réel, audit et règles réels)", () => {
  let db: HigherTestDb;
  let world: TestWorld;
  let school: School;
  let unboundTenant: string;

  beforeAll(async () => {
    db = await createHigherTestDb(12, { withWorker: true, withAudit: true, withRules: true });
    const rulesDeps = createRulesDeps({ db: db.tenantDb, systemDb: db.systemDb });
    await ensureNationalCatalog(rulesDeps);
    world = makeWorld(db);
    school = await seedSchool(db, world, { students: 2 });
    unboundTenant = await db.createTenant();
    const bound = await putBinding(rulesDeps, ctxFor(school.tenantId), { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });
    if (!bound.ok) throw bound.error;
    // Les modules voisins (results, academic, people, reportcards) branchent leurs ports pour le worker.
    const { rules: _scripted, ...neighbours } = world.ports;
    registerHigherWorkerPorts(neighbours);
  });
  afterEach(() => undefined);
  afterAll(async () => {
    resetHigherWorkerPorts();
    await db.drop();
  });

  const handlerContext = (tenantId: string, name: string): EventHandlerContext => {
    const ctx = createSystemContext(tenantId);
    return {
      tenantId, subscriber: name, attempt: 1, jobId: "j1", logger: noopLogger, systemDb: db.systemDb, tenantDb: db.tenantDb,
      db: { ctx, run: (fn, options) => db.tenantDb.run(ctx, fn, options) },
    };
  };
  const deliver = async (tenantId: string, name: string, type: string, payload: Record<string, unknown>, id = newId()) => {
    const sub = subscribers.find((s) => s.name === name);
    if (!sub) throw new Error(`abonné introuvable : ${name}`);
    const event: DomainEvent = { id, type, version: 1, tenantId, occurredAt: new Date().toISOString(), payload: { v: 1, ...payload } };
    await sub.handler(event, handlerContext(tenantId, name));
    return event;
  };
  const events = (tenantId: string, type: string) => adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY id", [tenantId, type]);

  it("results.period.closed -> capitalisation, idempotente (même événement rejoué = ignoré) ; higher.credits.capitalized -> octroi automatique", async () => {
    const s = school;
    const st = s.students[0]!;
    const def = unwrapDef(await createDiploma(world.deps, s.admin.ctx, { code: "SUB-1", label: "Licence abonnés", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
    world.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!)]);
    world.ports.cycleResults.set(st.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "15", credits: 6 }] });

    const closed = await deliver(s.tenantId, "higher.capitalize-on-period-closed", "results.period.closed", { classroomId: s.classroomId, academicPeriodId: s.periodId, stateId: newId(), closureHash: "h", resultsVersion: 1 });
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.credit_ledger WHERE tenant_id = $1", [s.tenantId])).n)).toBe(1);
    // Rejeu du MÊME événement : marqué « traité », aucun second effet.
    await deliver(s.tenantId, "higher.capitalize-on-period-closed", "results.period.closed", { classroomId: s.classroomId, academicPeriodId: s.periodId }, closed.id);
    expect(await adminRows(db, "SELECT 1 FROM kernel.processed_events WHERE subscriber = 'higher.capitalize-on-period-closed' AND event_id = $1", [closed.id])).toHaveLength(1);
    expect(await events(s.tenantId, "higher.credits.capitalized")).toHaveLength(1);

    // Aucune évaluation de diplôme dans l'abonné de capitalisation (R-HIG-10) : l'octroi vient de l'événement suivant.
    expect(await adminRows(db, "SELECT 1 FROM higher.diploma_awards WHERE tenant_id = $1", [s.tenantId])).toHaveLength(0);
    const [cap] = await events(s.tenantId, "higher.credits.capitalized");
    await deliver(s.tenantId, "higher.evaluate-diplomas-on-capitalized", "higher.credits.capitalized", cap!.payload);
    const award = await adminOne<{ awarded_via: string; reference: string; rule_set_code: string; definition_id: string }>(db, "SELECT awarded_via, reference, rule_set_code, definition_id FROM higher.diploma_awards WHERE tenant_id = $1", [s.tenantId]);
    expect(award).toMatchObject({ awarded_via: "AUTO", reference: "DIP-2026-000001", rule_set_code: "CI-HIGHER-LMD", definition_id: def });
    // L'audit RÉEL a reçu l'octroi (même transaction).
    const audited = await adminRows<{ action: string; entity: string }>(db, "SELECT action, entity FROM audit.audit_log WHERE tenant_id = $1 AND action LIKE 'higher.%' ORDER BY id", [s.tenantId]);
    expect(audited.map((a) => a.action)).toEqual(["higher.ledger.capitalized", "higher.award.created"]);
  });

  it("une panne des règles (aucun jeu applicable) fait ÉCHOUER l'abonné d'éligibilité pour rejeu — la capitalisation, elle, est intacte", async () => {
    const s = await seedSchool(db, world, { students: 1, tenantId: unboundTenant });
    const st = s.students[0]!;
    unwrapDef(await createDiploma(world.deps, s.admin.ctx, { code: "SUB-2", label: "Sans règles", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
    world.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, st, s.ues[0]!)]);
    await deliver(unboundTenant, "higher.capitalize-on-period-closed", "results.period.closed", { classroomId: s.classroomId, academicPeriodId: s.periodId });
    const [cap] = await events(unboundTenant, "higher.credits.capitalized");
    await expect(deliver(unboundTenant, "higher.evaluate-diplomas-on-capitalized", "higher.credits.capitalized", cap!.payload)).rejects.toMatchObject({ code: "rules.no_active_ruleset" });
    expect(Number((await adminOne<{ n: string }>(db, "SELECT count(*) AS n FROM higher.credit_ledger WHERE tenant_id = $1 AND status = 'ACQUIRED'", [unboundTenant])).n)).toBe(1);
    expect(await adminRows(db, "SELECT 1 FROM higher.diploma_awards WHERE tenant_id = $1", [unboundTenant])).toHaveLength(0);
    // Le rejeu n'est pas marqué « traité » (la transaction a été annulée) : il pourra réussir après correction.
    expect(await adminRows(db, "SELECT 1 FROM kernel.processed_events WHERE subscriber = 'higher.evaluate-diplomas-on-capitalized' AND tenant_id = $1", [unboundTenant])).toHaveLength(0);
  });

  it("un payload inexploitable est journalisé et ignoré (jamais rejoué à l'infini)", async () => {
    await expect(deliver(school.tenantId, "higher.capitalize-on-period-closed", "results.period.closed", { classroomId: "pas-un-uuid" })).resolves.toBeDefined();
    await expect(deliver(school.tenantId, "higher.evaluate-diplomas-on-capitalized", "higher.credits.capitalized", {})).resolves.toBeDefined();
  });

  it("port manquant dans le worker : l'abonné échoue FERMÉ (higher.port_unavailable) et l'événement sera rejoué", async () => {
    resetHigherWorkerPorts();
    try {
      await expect(deliver(school.tenantId, "higher.capitalize-on-period-closed", "results.period.closed", { classroomId: school.classroomId, academicPeriodId: school.period2Id })).rejects.toMatchObject({ code: "higher.port_unavailable" });
    } finally {
      const { rules: _scripted, ...neighbours } = world.ports;
      registerHigherWorkerPorts(neighbours);
    }
  });

  it("job higher.expire-credits : balaie, tenant par tenant, les acquisitions périmées ; épargne celles d'un diplôme octroyé", async () => {
    const s = await seedSchool(db, world, { students: 2 });
    const [a, b] = s.students;
    world.clock.set("2025-02-01T10:00:00.000Z"); // capitalisation et octroi en février 2025 : les crédits (6 mois) sont encore valables
    await updateHigherSettings(world.deps, s.admin.ctx, { creditValidityMonths: 6 });
    world.ports.credits.setFinalLines(s.classroomId, s.periodId, [ueLine(s, a!, s.ues[0]!, { validatedAt: new Date("2025-01-10T10:00:00Z") }), ueLine(s, b!, s.ues[0]!, { validatedAt: new Date("2025-01-10T10:00:00Z") })]);
    const { capitalizePeriod } = await import("../../application/ledger");
    const r = await capitalizePeriod(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId });
    expect(r.ok && r.value.acquired).toBe(2);
    // A est diplômé sur cette UE (octroi manuel, règles scénarisées côté API) : son acquisition ne doit jamais expirer.
    scriptRules(world);
    unwrapDef(await createDiploma(world.deps, s.admin.ctx, { code: "SUB-EXP", label: "Diplôme d'une UE", gradeCode: "LICENCE", curriculumNodeId: s.cycleNodeId, uvRequired: 6, requirements: [{ ueNodeId: s.ues[0]!.nodeId }] }));
    const [defRow] = await adminRows<{ id: string }>(db, "SELECT id FROM higher.diploma_definitions WHERE tenant_id = $1", [s.tenantId]);
    world.ports.cycleResults.set(a!.studentId, s.cycleNodeId, { complete: true, semesters: [{ academicPeriodId: s.periodId, academicYearId: s.yearId, average: "12", credits: 6 }] });
    const awarded = await awardDiploma(world.deps, s.admin.ctx, { definitionId: defRow!.id, studentId: a!.studentId, via: "MANUAL" });
    expect(awarded.ok && awarded.value.status).toBe("AWARDED");

    const job = jobs[0]!;
    expect(job.name).toBe("higher.expire-credits");
    await (job as unknown as { handler: (c: unknown) => Promise<void> }).handler({ systemDb: db.systemDb, tenantDb: db.tenantDb, logger: noopLogger });
    const rows = await adminRows<{ student_id: string; status: string }>(db, "SELECT student_id, status FROM higher.credit_ledger WHERE tenant_id = $1", [s.tenantId]);
    expect(rows.find((x) => x.student_id === b!.studentId)?.status).toBe("EXPIRED"); // l'horloge réelle est postérieure à 2025-07
    expect(rows.find((x) => x.student_id === a!.studentId)?.status).toBe("ACQUIRED"); // soutient un diplôme octroyé
  });
});

function unwrapDef(r: { ok: boolean; value?: { definition: { id: string } }; error?: unknown }): string {
  if (!r.ok || !r.value) throw r.error;
  return r.value.definition.id;
}
