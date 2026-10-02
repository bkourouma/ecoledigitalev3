/**
 * Isolation multi-tenant du module rules : test générique de la plateforme (`assertTenantIsolation`) avec la liste blanche du
 * module, puis preuves A/B sur les données réelles (variantes, liaisons, simulations, journaux).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import rulesAllowlist, { rulesIsolationAllowlistTables, rulesIsolationFixtures, rulesTenantTables } from "../../isolation-allowlist.rules";
import { putBinding, listTenantBindings } from "../application/bindings";
import { getSimulationView } from "../application/simulations";
import { adminCtx, adminRows, createRulesTestDb, describeIntegration, makeWorld, seedCatalog, type RulesTestDb, type TestWorld } from "./support/db";
import { derive, nationalVersion, simulateVersion } from "./support/flow";

describeIntegration("isolation multi-tenant", () => {
  let db: RulesTestDb;
  let world: TestWorld;

  beforeAll(async () => {
    db = await createRulesTestDb();
    world = makeWorld(db);
    await seedCatalog(world);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("test générique : toutes les tables de tenant ont tenant_id, RLS forcée, policy unique ; le national est en liste blanche justifiée", async () => {
    const report = await assertTenantIsolation({
      pool: db.appPool,
      schemas: ["rules"],
      allowlist: [...rulesIsolationAllowlistTables],
      fixtures: rulesIsolationFixtures as never,
    });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect([...report.allowlisted].sort()).toEqual([...rulesIsolationAllowlistTables].sort());
    // Toutes les tables de tenant attendues sont contrôlées (comportement A/B ou, à défaut, structure) : aucune oubliée.
    const checked = [...report.behavioural, ...report.structuralOnly.map((s) => s.table)].sort();
    expect(checked).toEqual([...rulesTenantTables].sort());
    expect(report.behavioural).toEqual(expect.arrayContaining(["rules.rule_sets", "rules.rule_bindings", "rules.simulations", "rules.evaluation_failures"]));
    console.info(`[rules] isolation : testées=${report.behavioural.length} structure seule=${report.structuralOnly.length} allowlist=${report.allowlisted.length}`);
  });

  it("chaque entrée de liste blanche est justifiée (≥ 20 caractères) et appartient au schéma rules", () => {
    for (const e of rulesAllowlist) {
      expect(e.table.startsWith("rules.")).toBe(true);
      expect(e.justification.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("un tenant ne lit jamais la variante, les liaisons ni la simulation d'un autre (RLS), même en connaissant les UUID", async () => {
    const a = await db.createTenant();
    const b = await db.createTenant();
    const ctxA = adminCtx(a);
    const ctxB = adminCtx(b);
    const variant = await derive(world.deps, ctxA, await nationalVersion(db, "CI-HIGHER-LMD"));
    const sim = await simulateVersion(world.deps, ctxA, variant.id);
    await putBinding(world.deps, ctxA, { contractId: "credit-semester@1", ruleSetCode: "CI-HIGHER-LMD", effectiveFrom: "2024-09-01" });

    const rowsAsB = await db.tenantDb.run(ctxB, async (tx) => ({
      versions: await tx.many("SELECT id FROM rules.rule_versions"),
      defs: await tx.many("SELECT id FROM rules.rule_definitions"),
      sets: await tx.many("SELECT id FROM rules.rule_sets"),
      events: await tx.many("SELECT id FROM rules.version_events"),
      sims: await tx.many("SELECT id FROM rules.simulations"),
      diffs: await tx.many("SELECT id FROM rules.simulation_differences"),
      bindings: await tx.many("SELECT id FROM rules.rule_bindings"),
    }));
    for (const [table, rows] of Object.entries(rowsAsB)) expect(rows, table).toEqual([]);
    expect((await getSimulationView(world.deps, ctxB, sim.id)).ok).toBe(false);
    const listedByB = await listTenantBindings(world.deps, ctxB);
    expect(listedByB.ok && listedByB.value).toEqual([]);

    // Et il ne peut pas écrire au nom de l'autre.
    await expect(
      db.tenantDb.run(ctxB, (tx) =>
        tx.query(
          "INSERT INTO rules.rule_bindings (id, tenant_id, contract_id, rule_set_code, effective_from) VALUES (gen_random_uuid(), $1, 'credit-semester@1', 'CI-HIGHER-LMD', '2030-01-01')",
          [a],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    // Sans contexte de tenant, rien n'est visible côté tenant (échec fermé) mais le catalogue national reste lisible.
    const none = await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM rules.rule_versions WHERE tenant_id = $1", [a]);
    expect(none[0]!.n).toBe("1");
    const system = await db.systemDb.run("test-sans-tenant", async (tx) => ({
      tenantRows: (await tx.many("SELECT id FROM rules.rule_versions")).length,
      national: (await tx.many("SELECT id FROM rules.national_rule_versions")).length,
    }));
    expect(system).toEqual({ tenantRows: 0, national: 8 }); // 3 portages du legacy + 5 versions fictives (Phase 4-5)
  });
});
