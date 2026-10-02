/**
 * Provisioning d'un tenant avec le catalogue RÉEL (tous les modules découverts) : les onze rôles système
 * sont créés, AUCUN motif ne reste « en attente » (ni en base, ni dans le log d'avertissement), et les
 * permissions stockées sont exactement celles que résout le catalogue.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSystemContext, noopLogger } from "@ecoledigitale/kernel";
import { SYSTEM_ROLE_TEMPLATES, instantiateSystemRoles, resolveSystemRoles, syncPermissionCatalog, syncRbac } from "../index";
import { createRbacTestDb, describeIntegration, type RbacTestDb } from "./db";
import { loadRealCatalog, type RealCatalog } from "./real-catalog";

describeIntegration("rôles système — provisioning contre le catalogue réel", () => {
  let db: RbacTestDb;
  let real: RealCatalog;
  let tenant: string;
  const warnings: Array<Record<string, unknown>> = [];
  const spyLogger = { ...noopLogger, warn: (obj: Record<string, unknown>) => void warnings.push(obj) };

  beforeAll(async () => {
    real = await loadRealCatalog();
    db = await createRbacTestDb();
    await db.systemDb.run("rbac-real-sync", (tx) => syncPermissionCatalog(tx, real.manifests));
    tenant = await db.createTenant("ecole-reelle");
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("instanciation : onze rôles, aucun motif en attente (rapport, base et log)", async () => {
    const report = await db.systemDb.runForTenant("rbac-real-provision", tenant, (tx) => instantiateSystemRoles(tx, tenant, { logger: spyLogger }));
    expect(report.created).toHaveLength(11);
    expect(report.created).toContain("personnel");
    expect(report.pendingByRole).toEqual({});
    expect(warnings).toEqual([]);

    const pending = await db.tenantDb.run(createSystemContext(tenant), (tx) => tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM rbac.role_pending_permissions"));
    expect(pending?.n).toBe(0);
  });

  it("les permissions stockées de chaque rôle = celles du catalogue réel résolu ; owner/directeur à `*` seuls", async () => {
    const expected = new Map(resolveSystemRoles(real.catalog, SYSTEM_ROLE_TEMPLATES).map((r) => [r.template.key, [...r.permissions].sort()]));
    const rows = await db.tenantDb.run(createSystemContext(tenant), (tx) =>
      tx.many<{ key: string; permission_key: string }>(
        "SELECT r.key, p.permission_key FROM rbac.role_permissions p JOIN rbac.roles r ON r.id = p.role_id",
      ),
    );
    const stored = new Map<string, string[]>();
    for (const row of rows) stored.set(row.key, [...(stored.get(row.key) ?? []), row.permission_key]);
    for (const [key, perms] of expected) expect([...(stored.get(key) ?? [])].sort(), key).toEqual(perms);

    const wide = [...stored.entries()].filter(([, perms]) => perms.length >= real.catalog.keys.length - 5).map(([key]) => key).sort();
    expect(wide).toEqual(["directeur", "owner"]);
    expect(stored.get("owner")).not.toContain("rules.platform.manage");
  });

  it("syncRbac complet (tous les tenants) sur le catalogue réel : aucun échec, aucun motif en attente, rien ne change au second passage", async () => {
    const first = await syncRbac(db.systemDb, real.manifests, { logger: spyLogger, force: true });
    expect(first.tenants.failed).toEqual([]);
    const second = await syncRbac(db.systemDb, real.manifests, { logger: spyLogger });
    expect(second.reconciled).toBe(false);
    expect(warnings).toEqual([]);
  });
});
