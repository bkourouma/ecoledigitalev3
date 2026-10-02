import { afterAll, beforeAll, expect, it } from "vitest";
import { createRequestContext, newId, type RequestContext } from "@ecoledigitale/kernel";
import { TenantBulkhead, TenantDb } from "../src";
import { applyBaseline, createTestDb, describeIntegration, type TestDb } from "./helpers";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ctx = (tenantId: string): RequestContext => createRequestContext({ tenantId, userId: USER });

describeIntegration("bulkhead par tenant sur un vrai pool Postgres (équité, RLS)", () => {
  let db: TestDb;
  let appUrl: string;

  beforeAll(async () => {
    db = await createTestDb("bulkhead_test");
    await applyBaseline(db);
    await db.admin.query(`INSERT INTO kernel.tenants (id, slug, name) VALUES ($1,'ecole-a','A'), ($2,'ecole-b','B')`, [A, B]);
    await db.admin.query(`
      SET ROLE migrator;
      CREATE TABLE kernel.notes (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES kernel.tenants(id), body text NOT NULL);
      SELECT kernel.enable_tenant_rls('kernel.notes');
      RESET ROLE;
    `);
    appUrl = (await db.createLogin("it_app", "app_user")).url;
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** A inonde (16 transactions lentes), puis B lance UNE transaction : durée vue par B. */
  async function victimLatency(tdb: TenantDb): Promise<number> {
    const flood = Array.from({ length: 16 }, () => tdb.run(ctx(A), (tx) => tx.query("SELECT pg_sleep(0.15)")));
    await new Promise((r) => setTimeout(r, 30));
    const t0 = performance.now();
    await tdb.run(ctx(B), (tx) => tx.query("SELECT 1"));
    const ms = performance.now() - t0;
    await Promise.all(flood);
    return ms;
  }

  it("sans bulkhead B attend derrière la file FIFO de A ; avec bulkhead B passe presque tout de suite", async () => {
    const plain = new TenantDb(db.pool(appUrl, 4));
    const fair = new TenantDb(db.pool(appUrl, 4), { bulkhead: new TenantBulkhead({ maxPerTenant: 2, globalMax: 4, maxWaitMs: 10_000, maxQueuePerTenant: 100 }) });
    const without = await victimLatency(plain);
    const withB = await victimLatency(fair);
    expect(without).toBeGreaterThan(300); // ~4 vagues de 150 ms devant lui
    expect(withB).toBeLessThan(250); // une place lui est toujours réservée
    expect(withB).toBeLessThan(without / 2);
  });

  it("RLS A/B inchangée : chaque tenant ne voit que ses lignes, sous le bulkhead", async () => {
    const tdb = new TenantDb(db.pool(appUrl, 4), { bulkhead: new TenantBulkhead({ maxPerTenant: 2, globalMax: 4, maxWaitMs: 10_000, maxQueuePerTenant: 100 }) });
    await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => tdb.run(ctx(A), (tx) => tx.query("INSERT INTO kernel.notes (id, tenant_id, body) VALUES ($1,$2,$3)", [newId(), A, `a${i}`]))),
      ...Array.from({ length: 6 }, (_, i) => tdb.run(ctx(B), (tx) => tx.query("INSERT INTO kernel.notes (id, tenant_id, body) VALUES ($1,$2,$3)", [newId(), B, `b${i}`]))),
    ]);
    const seenA = await tdb.run(ctx(A), (tx) => tx.many<{ body: string }>("SELECT body FROM kernel.notes"));
    const seenB = await tdb.run(ctx(B), (tx) => tx.many<{ body: string }>("SELECT body FROM kernel.notes"));
    expect(seenA).toHaveLength(6);
    expect(seenA.every((r) => r.body.startsWith("a"))).toBe(true);
    expect(seenB.every((r) => r.body.startsWith("b"))).toBe(true);
    // Écrire pour l'autre tenant reste refusé par la RLS.
    await expect(tdb.run(ctx(A), (tx) => tx.query("INSERT INTO kernel.notes (id, tenant_id, body) VALUES ($1,$2,'x')", [newId(), B]))).rejects.toThrow();
    // Les places sont toutes rendues (y compris après l'erreur).
    expect(tdb.bulkhead!.stats().active).toBe(0);
  });
});
