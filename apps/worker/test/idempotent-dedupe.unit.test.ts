import { describe, expect, it, vi } from "vitest";
import { createDomainEvent, createRequestContext, newId, noopLogger } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { defineScheduledJob, idempotent, type EventHandlerContext, type ScopedTenantDb } from "../src/sdk";
import { BullEventPublisher, deadLetterJobId, eventJobOptions } from "../src/events/publisher";
import { toDomainEvent } from "../src/events/relay";
import { loadConfig, ConfigError } from "../src/config";
import { normalizeJobs, normalizeSubscribers, DiscoveryError } from "../src/discovery/discover";

const tenantId = newId();
const ctx = createRequestContext({ tenantId, userId: newId() });
const event = createDomainEvent({ type: "finance.payment.completed", payload: { v: 1 }, ctx });

/** Faux TenantDb : une « table » processed_events en mémoire, avec rollback si le handler lève. */
function fakeScopedDb(store: Set<string>): ScopedTenantDb {
  return {
    ctx,
    async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const pending = new Set<string>();
      const tx = {
        async query(_sql: string, params: readonly unknown[] = []) {
          const key = `${String(params[1])}|${String(params[2])}`;
          if (store.has(key) || pending.has(key)) return { rows: [], rowCount: 0 };
          pending.add(key);
          return { rows: [], rowCount: 1 };
        },
      } as unknown as Tx;
      const result = await fn(tx);
      for (const k of pending) store.add(k); // COMMIT
      return result; // si fn lève : `pending` est abandonné (ROLLBACK)
    },
  };
}

function handlerCtx(store: Set<string>): EventHandlerContext {
  return { tenantId, db: fakeScopedDb(store), systemDb: {} as never, tenantDb: {} as never, logger: noopLogger, subscriber: "billing.receipt", attempt: 1, jobId: "j1" };
}

describe("idempotent() : wrapper d'idempotence", () => {
  it("n'exécute le handler qu'UNE fois pour un même (abonné, événement)", async () => {
    const store = new Set<string>();
    const effect = vi.fn(async () => undefined);
    const handler = idempotent("billing.receipt", effect);

    await handler(event, handlerCtx(store));
    await handler(event, handlerCtx(store));
    await handler(event, handlerCtx(store));

    expect(effect).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });

  it("deux abonnés différents traitent chacun le même événement", async () => {
    const store = new Set<string>();
    const a = vi.fn(async () => undefined);
    const b = vi.fn(async () => undefined);
    await idempotent("sub.a", a)(event, handlerCtx(store));
    await idempotent("sub.b", b)(event, handlerCtx(store));
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("un échec annule la marque : l'événement reste rejouable", async () => {
    const store = new Set<string>();
    let attempts = 0;
    const handler = idempotent("billing.receipt", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("panne transitoire");
    });

    await expect(handler(event, handlerCtx(store))).rejects.toThrow("panne transitoire");
    expect(store.size).toBe(0);
    await handler(event, handlerCtx(store));
    expect(attempts).toBe(2);
    expect(store.size).toBe(1);
  });

  it("transmet event, contexte et transaction au handler", async () => {
    const store = new Set<string>();
    let seen: unknown[] = [];
    await idempotent("billing.receipt", async (e, c, tx) => {
      seen = [e.id, c.tenantId, typeof tx.query];
    })(event, handlerCtx(store));
    expect(seen).toEqual([event.id, tenantId, "function"]);
  });
});

describe("dédoublonnage : jobId = id d'événement", () => {
  it("les options du job portent l'id de l'événement (clé de dédoublonnage BullMQ)", () => {
    const opts = eventJobOptions(event);
    expect(opts.jobId).toBe(event.id);
    expect(opts.attempts).toBeGreaterThan(1);
    expect(opts.removeOnComplete).toBeTruthy();
  });

  it("publier deux fois le même événement soumet le même jobId", async () => {
    const calls: Array<{ name: string; opts: { jobId?: string } }> = [];
    const queue = {
      add: async (name: string, _data: unknown, opts: { jobId?: string }) => void calls.push({ name, opts }),
      addBulk: async (jobs: Array<{ name: string; opts: { jobId?: string } }>) => void calls.push(...jobs),
    };
    const publisher = new BullEventPublisher(queue as never);
    await publisher.publishMany([event]);
    await publisher.publish(event);
    expect(calls.map((c) => c.opts.jobId)).toEqual([event.id, event.id]);
    expect(calls[0]?.name).toBe("finance.payment.completed");
  });

  it("l'identifiant de dead-letter est déterministe et sans « : »", () => {
    const rec = { kind: "handler" as const, event, subscriber: "billing.receipt" };
    expect(deadLetterJobId(rec)).toBe(deadLetterJobId({ ...rec }));
    expect(deadLetterJobId(rec)).not.toContain(":");
    expect(deadLetterJobId({ kind: "relay", event })).toBe(`relay__${event.id}`);
  });

  it("toDomainEvent reconstruit l'enveloppe de la ligne d'outbox", () => {
    const e = toDomainEvent({
      id: event.id,
      tenant_id: tenantId,
      type: event.type,
      version: 2,
      aggregate_type: "payment",
      aggregate_id: "p1",
      actor_id: null,
      request_id: "req-1",
      payload: { v: 1 },
      occurred_at: new Date("2026-01-02T03:04:05.000Z"),
      attempts: 0,
    });
    expect(e).toEqual({
      id: event.id,
      type: "finance.payment.completed",
      version: 2,
      tenantId,
      occurredAt: "2026-01-02T03:04:05.000Z",
      payload: { v: 1 },
      aggregateType: "payment",
      aggregateId: "p1",
      requestId: "req-1",
    });
  });
});

describe("configuration (Zod, échec au démarrage)", () => {
  const ok = { REDIS_URL: "redis://localhost:6379", WORKER_DATABASE_URL: "postgres://u:p@localhost:5432/db" }; // secret-scan:allow (URL factice de test)

  it("accepte une configuration minimale et applique les défauts", () => {
    const c = loadConfig(ok);
    expect(c.WORKER_HTTP_PORT).toBe(8012);
    expect(c.WORKER_RELAY_ENABLED).toBe(true);
    expect(c.OUTBOX_RETENTION_DAYS).toBe(30);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it("échoue si REDIS_URL ou WORKER_DATABASE_URL manquent, sans jamais citer de valeur", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({ REDIS_URL: "http://secret-host", WORKER_DATABASE_URL: "mysql://u:motdepasse@h/db" });
      throw new Error("aurait dû échouer");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as Error).message).not.toContain("motdepasse");
      expect((e as Error).message).toContain("WORKER_DATABASE_URL");
    }
  });

  it("n'utilise JAMAIS DATABASE_URL en repli", () => {
    expect(() => loadConfig({ REDIS_URL: ok.REDIS_URL, DATABASE_URL: ok.WORKER_DATABASE_URL })).toThrow(/WORKER_DATABASE_URL/);
  });

  it("interprète les booléens et refuse les valeurs hors bornes", () => {
    expect(loadConfig({ ...ok, WORKER_RELAY_ENABLED: "false" }).WORKER_RELAY_ENABLED).toBe(false);
    expect(loadConfig({ ...ok, WORKER_RELAY_ENABLED: "0" }).WORKER_RELAY_ENABLED).toBe(false);
    expect(() => loadConfig({ ...ok, WORKER_RELAY_ENABLED: "peut-être" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...ok, WORKER_RELAY_BATCH_SIZE: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...ok, WORKER_RELAY_BACKOFF_BASE_MS: "5000", WORKER_RELAY_BACKOFF_MAX_MS: "1000" })).toThrow(/BACKOFF_MAX/);
  });
});

describe("définitions des modules", () => {
  const noop = async (): Promise<void> => undefined;

  it("defineScheduledJob valide nom, cron et handler", () => {
    expect(defineScheduledJob({ name: "ok-job", cron: "*/5 * * * *", handler: noop }).name).toBe("ok-job");
    expect(defineScheduledJob({ name: "ok-job2", cron: "*/5 * * * * *", perTenant: true, handler: noop }).perTenant).toBe(true);
    expect(() => defineScheduledJob({ name: "Bad", cron: "* * * * *", handler: noop })).toThrow(/nom invalide/);
    expect(() => defineScheduledJob({ name: "ok", cron: "toutes les heures", handler: noop })).toThrow(/cron/);
    expect(() => defineScheduledJob({ name: "ok", cron: "* * * * *", handler: undefined as never })).toThrow(/handler/);
  });

  it("la découverte accepte un tableau ou un objet seul, et rejette un export invalide avec le nom du module", () => {
    expect(normalizeSubscribers("m", [{ name: "m.a", pattern: "a.b", handler: noop }], "x")).toHaveLength(1);
    expect(normalizeSubscribers("m", { name: "m.a", pattern: "a.b", handler: noop }, "x")).toHaveLength(1);
    expect(normalizeSubscribers("m", undefined, "x")).toEqual([]);
    expect(() => normalizeSubscribers("finance", [{ name: "x", pattern: "a.b" }], "subscribers.ts")).toThrow(DiscoveryError);
    expect(() => normalizeSubscribers("finance", [{ name: "x", pattern: "a.b" }], "subscribers.ts")).toThrow(/finance/);
    expect(() => normalizeJobs("m", [{ name: "j", cron: "bad", handler: noop }], "jobs.ts")).toThrow(DiscoveryError);
  });
});
