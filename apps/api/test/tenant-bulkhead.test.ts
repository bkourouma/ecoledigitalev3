/**
 * Bulkhead par tenant côté API : 503 `tenant_busy` + `Retry-After` pour le tenant saturé, aucun effet sur les autres tenants,
 * configuration par l'environnement, désactivation, métriques Prometheus. Sans base (faux pool).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestContext } from "@ecoledigitale/kernel";
import { v2ContextPlugin } from "../src/platform/v2-context";
import { v2ErrorHandler } from "../src/platform/v2-http";
import { createBulkheadMetrics } from "../src/platform/observability/core/bulkhead-metrics";
import { createMetricsKit } from "../src/platform/observability/core/metrics";

const TENANT_A = "0192f0a4-7b1e-7c3a-8d2e-3f4a5b6c7d8e";
const TENANT_B = "0192f0a4-7b1e-7c3a-8d2e-bbbbbbbbbbbb";
const USER = "0192f0a4-7b1e-7c3a-8d2e-aaaaaaaaaaaa";

const SAFE_ROLE = { role: "ed_v2_app", rolsuper: false, rolbypassrls: false, member_of_app_user: true, member_of_migrator: false, app_user_exists: true };

function fakePool(max = 10) {
  const client = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    release: vi.fn(),
  };
  return {
    options: { max },
    query: vi.fn(async () => ({ rows: [SAFE_ROLE] })),
    connect: vi.fn(async () => client),
    on: vi.fn(),
    end: vi.fn(async () => undefined),
  };
}

async function build(opts: Record<string, unknown>, pool = fakePool()): Promise<{ app: FastifyInstance; release: () => void; started: () => number }> {
  const app = Fastify({ logger: false });
  await app.register(v2ContextPlugin, { pool: pool as never, manifests: [], ...opts });
  let release: () => void = () => undefined;
  let gate: Promise<void> = new Promise((r) => (release = r));
  let started = 0;
  await app.register(async (scope) => {
    scope.setErrorHandler(v2ErrorHandler);
    scope.get("/slow/:tenant", async (request) => {
      const tenantId = (request.params as { tenant: string }).tenant;
      const ctx = createRequestContext({ tenantId, userId: USER, roles: ["admin"], requestId: `req-${Math.random().toString(36).slice(2, 10)}` });
      await app.v2.tenantDb.run(ctx, async () => {
        started += 1;
        await gate;
      });
      return { ok: true };
    });
  });
  await app.ready();
  return {
    app,
    release: () => {
      release();
      gate = Promise.resolve();
    },
    started: () => started,
  };
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  delete process.env.V2_DB_TENANT_BULKHEAD;
  delete process.env.V2_DB_TENANT_MAX_CONCURRENCY;
});

describe("bulkhead par tenant : réponse 503 tenant_busy", () => {
  it("le tenant saturé reçoit 503 + Retry-After ; un autre tenant n'est pas ralenti", async () => {
    const { app, release, started } = await build({ tenantBulkhead: { maxPerTenant: 1, globalMax: 4, maxWaitMs: 60, maxQueuePerTenant: 5, retryAfterSeconds: 3 } });
    const holder = app.inject({ method: "GET", url: `/slow/${TENANT_A}` });
    await tick();
    expect(started()).toBe(1);

    const busy = await app.inject({ method: "GET", url: `/slow/${TENANT_A}` });
    expect(busy.statusCode).toBe(503);
    expect(busy.headers["retry-after"]).toBe("3");
    expect(busy.json()).toMatchObject({ status: 503, code: "tenant_busy", kind: "unavailable" });

    // Un autre tenant passe pendant que A est saturé.
    const other = app.inject({ method: "GET", url: `/slow/${TENANT_B}` });
    await tick();
    expect(started()).toBe(2);

    release();
    expect((await holder).statusCode).toBe(200);
    expect((await other).statusCode).toBe(200);
    await app.close();
  });

  it("désactivé (tenantBulkhead: false) : aucune limite, aucun 503", async () => {
    const { app, release, started } = await build({ tenantBulkhead: false });
    expect(app.v2.tenantDb.bulkhead).toBeUndefined();
    const reqs = [1, 2, 3].map(() => app.inject({ method: "GET", url: `/slow/${TENANT_A}` }));
    await tick();
    expect(started()).toBe(3);
    release();
    for (const r of await Promise.all(reqs)) expect(r.statusCode).toBe(200);
    await app.close();
  });
});

describe("configuration par l'environnement", () => {
  it("actif par défaut : la moitié du pool par tenant, plafond total = pool", async () => {
    const { app } = await build({}, fakePool(10));
    expect(app.v2.tenantDb.bulkhead?.options).toMatchObject({ maxPerTenant: 5, globalMax: 10, maxWaitMs: 8000 });
    await app.close();
  });

  it("V2_DB_TENANT_BULKHEAD=off le désactive ; V2_DB_TENANT_MAX_CONCURRENCY le règle", async () => {
    process.env.V2_DB_TENANT_BULKHEAD = "off";
    const off = await build({});
    expect(off.app.v2.tenantDb.bulkhead).toBeUndefined();
    await off.app.close();

    delete process.env.V2_DB_TENANT_BULKHEAD;
    process.env.V2_DB_TENANT_MAX_CONCURRENCY = "2";
    const on = await build({}, fakePool(10));
    expect(on.app.v2.tenantDb.bulkhead?.options.maxPerTenant).toBe(2);
    await on.app.close();
  });
});

describe("métriques Prometheus du bulkhead", () => {
  it("expose actifs, files, refus par motif et attente, sans étiquette de tenant", async () => {
    const { app, release } = await build({ tenantBulkhead: { maxPerTenant: 1, globalMax: 2, maxWaitMs: 30, maxQueuePerTenant: 5 } });
    const kit = createMetricsKit("api", { defaultMetrics: false });
    createBulkheadMetrics(kit).track("v2", app.v2.tenantDb.bulkhead!);
    const holder = app.inject({ method: "GET", url: `/slow/${TENANT_A}` });
    await tick();
    await app.inject({ method: "GET", url: `/slow/${TENANT_A}` }); // refusé après 30 ms
    const text = await kit.registry.metrics();
    expect(text).toMatch(/ed_db_tenant_bulkhead\{[^}]*pool="v2"[^}]*state="active"[^}]*\} 1/);
    expect(text).toMatch(/ed_db_tenant_bulkhead\{[^}]*state="tenants_at_cap"[^}]*\} 1/);
    expect(text).toMatch(/ed_db_tenant_bulkhead_rejected_total\{[^}]*reason="timeout"[^}]*\} 1/);
    expect(text).toMatch(/ed_db_tenant_bulkhead_wait_seconds_count\{[^}]*\} 1/); // seules les places ACCORDÉES sont observées
    expect(text).not.toContain(TENANT_A);
    release();
    await holder;
    await app.close();
  });
});
