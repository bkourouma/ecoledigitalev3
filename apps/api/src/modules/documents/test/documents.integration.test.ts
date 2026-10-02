/**
 * Test d'intégration (Postgres réel, rôle applicatif soumis à la RLS). S'ignore sans TEST_DATABASE_URL.
 * Contient le contrôle d'isolation multi-tenant du module : assertTenantIsolation (structure + comportement A/B).
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { createRequestContext, systemClock, unwrap } from "@ecoledigitale/kernel";
import allowlist from "../../isolation-allowlist.documents";
import { createItem, listItems } from "../application/items";
import type { AuditEntry } from "../application/ports";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "./support/db";

describeIntegration("module documents : base réelle", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  const audited: AuditEntry[] = [];
  const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";

  const ctxOf = (tenantId: string) => createRequestContext({ tenantId, userId: USER });
  const deps = (failAudit = false) => ({
    tenantDb: db.tenantDb,
    clock: systemClock,
    audit: {
      record: async (_tx: unknown, entry: AuditEntry) => {
        if (failAudit) throw new Error("audit indisponible");
        audited.push(entry);
      },
    },
  });

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("tenant-a");
    tenantB = await db.createTenant("tenant-b");
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("assertTenantIsolation : chaque table du schéma documents est isolée par tenant (RLS forcée)", async () => {
    const report = await assertTenantIsolation({
      pool: db.appPool,
      schemas: ["documents"],
      allowlist: allowlist.map((entry) => entry.table),
    });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(report.behavioural).toContain("documents.items");
  });

  it("n'expose les éléments d'un tenant qu'à ce tenant", async () => {
    unwrap(await createItem(deps(), ctxOf(tenantA), { label: "Alpha" }));
    unwrap(await createItem(deps(), ctxOf(tenantB), { label: "Beta" }));
    expect((await listItems(deps(), ctxOf(tenantA))).map((i) => i.label)).toEqual(["Alpha"]);
    expect((await listItems(deps(), ctxOf(tenantB))).map((i) => i.label)).toEqual(["Beta"]);
    expect(audited.map((a) => a.action)).toContain("documents.item.create");
  });

  it("écrit l'événement d'outbox avec la ligne, et annule les deux si l'audit échoue", async () => {
    const created = unwrap(await createItem(deps(), ctxOf(tenantA), { label: "Avec événement" }));
    const events = await db.admin.query("SELECT type, tenant_id, payload FROM kernel.domain_events WHERE aggregate_id = $1", [created.id]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows.at(0)).toMatchObject({ type: "documents.item.created", tenant_id: tenantA, payload: { v: 1, itemId: created.id } });

    await expect(createItem(deps(true), ctxOf(tenantA), { label: "Annulé" })).rejects.toThrow(/audit indisponible/);
    const leftovers = await db.admin.query("SELECT 1 FROM documents.items WHERE label = 'Annulé'");
    expect(leftovers.rows).toHaveLength(0);
    const orphanEvents = await db.admin.query("SELECT 1 FROM kernel.domain_events WHERE type = 'documents.item.created' AND tenant_id = $1", [tenantA]);
    expect(orphanEvents.rows).toHaveLength(2); // « Alpha » et « Avec événement » seulement
  });
});
