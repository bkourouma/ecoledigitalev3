import { describe, expect, it } from "vitest";
import { UnavailableError, createRequestContext } from "@ecoledigitale/kernel";
import { TenantBulkhead, TenantDb, TENANT_BUSY_CODE, bulkheadOptionsFromEnv, type PgPoolLike, type PoolClientLike } from "../src";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "44444444-4444-4444-8444-444444444444";
const U = "33333333-3333-4333-8333-333333333333";

const mk = (over: Partial<ConstructorParameters<typeof TenantBulkhead>[0]> = {}) =>
  new TenantBulkhead({ maxPerTenant: 2, globalMax: 4, maxWaitMs: 1000, maxQueuePerTenant: 10, retryAfterSeconds: 3, ...over });

const tick = () => new Promise<void>((r) => setImmediate(r));

describe("TenantBulkhead", () => {
  it("plafonne les transactions concurrentes d'un tenant sans gêner les autres", async () => {
    const b = mk();
    const a1 = await b.acquire(A);
    await b.acquire(A);
    let a3 = false;
    const p3 = b.acquire(A).then((r) => {
      a3 = true;
      return r;
    });
    await tick();
    expect(a3).toBe(false); // plafond du tenant A atteint
    const rb = await b.acquire(B); // le tenant B passe tout de suite
    expect(b.stats()).toMatchObject({ active: 3, queued: 1, tenantsAtCap: 1 });
    a1();
    await p3;
    expect(a3).toBe(true);
    rb();
  });

  it("libère idempotente : un double release ne rend pas deux places", async () => {
    const b = mk({ maxPerTenant: 1, globalMax: 2 });
    const r = await b.acquire(A);
    r();
    r();
    expect(b.stats().active).toBe(0);
    await b.acquire(A);
    await expect(Promise.race([b.acquire(A), new Promise((res) => setTimeout(() => res("pending"), 30))])).resolves.toBe("pending");
  });

  it("sert les tenants en tourniquet quand le total est saturé (pas de FIFO global)", async () => {
    const b = mk({ maxPerTenant: 4, globalMax: 4 });
    const held = await Promise.all([b.acquire(A), b.acquire(A), b.acquire(A), b.acquire(A)]);
    const order: string[] = [];
    // A met 4 demandes en file AVANT que B n'en mette une : en FIFO B passerait en dernier.
    const aw = [1, 2, 3, 4].map(() => b.acquire(A).then((r) => (order.push("A"), r)));
    const bw = b.acquire(B).then((r) => (order.push("B"), r));
    held[0]!();
    await tick();
    expect(order).toEqual(["A"]); // le premier de la file est A…
    const next = await aw[0]!;
    next();
    await tick();
    expect(order).toEqual(["A", "B"]); // …puis le tour de B, avant les autres A
    (await bw)();
    for (const h of held.slice(1)) h();
    for (const w of aw.slice(1)) (await w)();
  });

  it("refuse après maxWaitMs avec 503 tenant_busy et Retry-After", async () => {
    const b = mk({ maxPerTenant: 1, globalMax: 1, maxWaitMs: 40 });
    await b.acquire(A);
    const seen: string[] = [];
    const observed = new TenantBulkhead({
      maxPerTenant: 1,
      globalMax: 1,
      maxWaitMs: 40,
      maxQueuePerTenant: 5,
      retryAfterSeconds: 3,
      observer: { rejected: (reason) => seen.push(reason) },
    });
    await observed.acquire(A);
    const err = await observed.acquire(A).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnavailableError);
    const e = err as UnavailableError;
    expect(e.httpStatus).toBe(503);
    expect(e.code).toBe(TENANT_BUSY_CODE);
    expect(e.retryAfterSeconds).toBe(3);
    expect(seen).toEqual(["timeout"]);
    expect(observed.stats().queued).toBe(0); // la demande expirée a quitté la file
  });

  it("refuse tout de suite quand la file du tenant est pleine", async () => {
    const b = mk({ maxPerTenant: 1, globalMax: 1, maxQueuePerTenant: 1 });
    await b.acquire(A);
    void b.acquire(A).catch(() => undefined);
    const err = await b.acquire(A).catch((e: unknown) => e);
    expect((err as UnavailableError).code).toBe(TENANT_BUSY_CODE);
    expect((err as UnavailableError).details).toMatchObject({ reason: "queue_full" });
    // un autre tenant a sa propre file
    expect(b.stats().queued).toBe(1);
  });

  it("un tenant qui expire ne bloque pas la file des autres", async () => {
    const b = mk({ maxPerTenant: 1, globalMax: 2, maxWaitMs: 30 });
    const a = await b.acquire(A);
    await b.acquire(C);
    await expect(b.acquire(A)).rejects.toBeInstanceOf(UnavailableError);
    a();
    const rb = await b.acquire(B);
    rb();
  });

  it("valide ses options", () => {
    expect(() => mk({ maxPerTenant: 0 })).toThrow(TypeError);
    expect(() => mk({ maxPerTenant: 3, globalMax: 2 })).toThrow(TypeError);
    expect(() => mk({ maxWaitMs: -1 })).toThrow(TypeError);
  });
});

describe("bulkheadOptionsFromEnv", () => {
  it("défauts prudents : moitié du pool par tenant, plafond total = pool", () => {
    expect(bulkheadOptionsFromEnv(10, {})).toMatchObject({ maxPerTenant: 5, globalMax: 10, maxWaitMs: 8000, maxQueuePerTenant: 200 });
    expect(bulkheadOptionsFromEnv(1, {})).toMatchObject({ maxPerTenant: 1, globalMax: 1 });
  });
  it("désactivable et configurable", () => {
    expect(bulkheadOptionsFromEnv(10, { V2_DB_TENANT_BULKHEAD: "off" })).toBeUndefined();
    expect(bulkheadOptionsFromEnv(10, { V2_DB_TENANT_BULKHEAD: "0" })).toBeUndefined();
    expect(
      bulkheadOptionsFromEnv(10, { V2_DB_TENANT_MAX_CONCURRENCY: "3", V2_DB_TENANT_MAX_WAIT_MS: "500", V2_DB_TENANT_MAX_QUEUE: "7" }),
    ).toMatchObject({ maxPerTenant: 3, maxWaitMs: 500, maxQueuePerTenant: 7 });
    // valeur invalide : retombe sur le défaut ; un plafond > pool est ramené au pool
    expect(bulkheadOptionsFromEnv(10, { V2_DB_TENANT_MAX_CONCURRENCY: "abc" })?.maxPerTenant).toBe(5);
    expect(bulkheadOptionsFromEnv(4, { V2_DB_TENANT_MAX_CONCURRENCY: "99" })?.maxPerTenant).toBe(4);
  });
});

function countingPool() {
  let inUse = 0;
  let peak = 0;
  const client: PoolClientLike = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    release() {
      inUse -= 1;
    },
  };
  const pool: PgPoolLike = {
    async connect() {
      inUse += 1;
      peak = Math.max(peak, inUse);
      return client;
    },
  };
  return { pool, peak: () => peak, inUse: () => inUse };
}

const ctx = (tenantId: string) => createRequestContext({ tenantId, userId: U, roles: ["admin"], requestId: "r" });

describe("TenantDb + bulkhead", () => {
  it("la place est prise avant la connexion et rendue après, même en cas d'erreur", async () => {
    const f = countingPool();
    const bulkhead = mk({ maxPerTenant: 1, globalMax: 2 });
    const db = new TenantDb(f.pool, { bulkhead });
    await expect(
      db.run(ctx(A), async () => {
        expect(bulkhead.stats().active).toBe(1);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(bulkhead.stats().active).toBe(0);
    await db.run(ctx(A), async () => 1);
    expect(f.inUse()).toBe(0);
  });

  it("n'ouvre jamais plus de connexions par tenant que le plafond", async () => {
    const f = countingPool();
    const db = new TenantDb(f.pool, { bulkhead: mk({ maxPerTenant: 2, globalMax: 8, maxWaitMs: 5000 }) });
    await Promise.all(
      Array.from({ length: 12 }, () =>
        db.run(ctx(A), async () => {
          await new Promise((r) => setTimeout(r, 5));
        }),
      ),
    );
    expect(f.peak()).toBe(2);
  });

  it("un run imbriqué (SAVEPOINT) ne reprend pas de place : pas d'interblocage à plafond 1", async () => {
    const f = countingPool();
    const bulkhead = mk({ maxPerTenant: 1, globalMax: 1, maxWaitMs: 200 });
    const db = new TenantDb(f.pool, { bulkhead });
    const out = await db.run(ctx(A), async () => db.run(ctx(A), async () => "ok"));
    expect(out).toBe("ok");
    expect(bulkhead.stats().active).toBe(0);
  });

  it("un tenant saturé reçoit tenant_busy sans consommer de connexion", async () => {
    const f = countingPool();
    const db = new TenantDb(f.pool, { bulkhead: mk({ maxPerTenant: 1, globalMax: 1, maxWaitMs: 20 }) });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = db.run(ctx(A), async () => gate);
    await tick();
    await expect(db.run(ctx(A), async () => 1)).rejects.toMatchObject({ code: TENANT_BUSY_CODE, httpStatus: 503 });
    expect(f.peak()).toBe(1);
    release();
    await holder;
  });

  it("sans bulkhead (désactivé) : comportement historique, aucune attente", async () => {
    const f = countingPool();
    const db = new TenantDb(f.pool);
    expect(db.bulkhead).toBeUndefined();
    await Promise.all(Array.from({ length: 6 }, () => db.run(ctx(A), async () => new Promise((r) => setTimeout(r, 5)))));
    expect(f.peak()).toBe(6);
  });
});
