import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { Redis } from "ioredis";
import { PgOutboxWriter, SystemDb, TenantDb, migrate } from "@ecoledigitale/database";
import { createDomainEvent, createRequestContext, newId, noopLogger, type DomainEvent } from "@ecoledigitale/kernel";
import { WorkerApp, type WorkerAppOptions } from "../src/app";
import { loadConfig, type WorkerConfig } from "../src/config";
import { createLogger, type Logger } from "../src/logger";

const here = dirname(fileURLToPath(import.meta.url));
export const WORKER_ROOT = resolve(here, "..");
export const BASELINE_DIR = resolve(here, "../../../packages/database/migrations");
export const WORKER_MIGRATIONS_DIR = resolve(here, "../migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
export const hasInfra = Boolean(TEST_DATABASE_URL && TEST_REDIS_URL);

if (!hasInfra) {
  console.warn(
    "[worker] TEST_DATABASE_URL / TEST_REDIS_URL absentes : les tests d'intégration sont IGNORÉS. " +
      "Lancez `pnpm --filter @ecoledigitale/worker test:integration` (Postgres + Redis jetables dans Docker).",
  );
}

/** `describe` réservé aux tests qui ont besoin d'un vrai Postgres ET d'un vrai Redis. */
export const describeIntegration: typeof describe = describe.skipIf(!hasInfra) as unknown as typeof describe;

const rand = (n = 4): string => randomBytes(n).toString("hex");

function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface Tenant {
  id: string;
  slug: string;
}

export interface TestEnv {
  dbName: string;
  /** Connexion SUPERUSER, réservée à la préparation et aux vérifications des tests. */
  admin: Client;
  adminUrl: string;
  /** URL d'un rôle de connexion membre de app_user (ce que le worker doit utiliser). */
  appUrl: string;
  appRole: string;
  redisUrl: string;
  prefix: string;
  appPool: Pool;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  redis: Redis;
  tenants: Tenant[];
  addTenant(slug?: string): Promise<Tenant>;
  /** Variables d'environnement d'un worker de test (peut être surchargé). */
  env(overrides?: Record<string, string>): NodeJS.ProcessEnv;
  config(overrides?: Record<string, string>): WorkerConfig;
  app(options?: WorkerAppOptions, overrides?: Record<string, string>): WorkerApp;
  /** Supprime toutes les clés BullMQ du préfixe de cet environnement (entre deux tests). */
  flushRedis(): Promise<void>;
  drop(): Promise<void>;
}

export async function createTestEnv(tenantCount = 3): Promise<TestEnv> {
  const dbName = `ed_wk_${rand()}_test`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${dbName}"`);

  const adminUrl = urlFor(dbName);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  // Baseline v2 + migrations du worker (plage 0600-0699), même runner, table de suivi partagée.
  await migrate({ client: admin, dirs: [BASELINE_DIR, WORKER_MIGRATIONS_DIR], role: "migrator", logger: noopLogger });

  const appRole = `wk_app_${rand()}`;
  const appPassword = rand(16);
  await admin.query(`CREATE ROLE "${appRole}" LOGIN PASSWORD '${appPassword}' IN ROLE app_user`);
  const appUrl = urlFor(dbName, appRole, appPassword);

  const appPool = new Pool({ connectionString: appUrl, max: 20 });
  const tenantDb = new TenantDb(appPool);
  const systemDb = new SystemDb(tenantDb, { logger: noopLogger });

  const prefix = `t${rand(3)}`;
  const redisUrl = TEST_REDIS_URL as string;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const tenants: Tenant[] = [];
  const env: TestEnv = {
    dbName,
    admin,
    adminUrl,
    appUrl,
    appRole,
    redisUrl,
    prefix,
    appPool,
    tenantDb,
    systemDb,
    redis,
    tenants,
    async addTenant(slug = `t${tenants.length + 1}-${rand(2)}`) {
      const id = newId();
      await admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, slug, `Tenant ${slug}`]);
      const t = { id, slug };
      tenants.push(t);
      return t;
    },
    env(overrides = {}) {
      return {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        REDIS_URL: redisUrl,
        WORKER_DATABASE_URL: appUrl,
        WORKER_HTTP_HOST: "127.0.0.1",
        WORKER_HTTP_PORT: "0",
        WORKER_QUEUE_PREFIX: prefix,
        WORKER_PG_POOL_MAX: "10",
        WORKER_RELAY_SWEEP_INTERVAL_MS: "500",
        WORKER_RELAY_POLL_INTERVAL_MS: "100",
        WORKER_RELAY_BACKOFF_BASE_MS: "50",
        WORKER_RELAY_BACKOFF_MAX_MS: "200",
        WORKER_SHUTDOWN_TIMEOUT_MS: "10000",
        ...overrides,
      };
    },
    config(overrides) {
      return loadConfig(env.env(overrides));
    },
    app(options = {}, overrides) {
      return new WorkerApp(env.config(overrides), {
        logger: createLogger("silent"),
        moduleDirs: [],
        bundled: undefined,
        ...options,
      });
    },
    flushRedis: () => redisCleanup(redis, prefix),
    async drop() {
      await redisCleanup(redis, prefix).catch(() => undefined);
      await redis.quit().catch(() => undefined);
      await appPool.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      try {
        await maintenance.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
        await maintenance.query(`DROP ROLE IF EXISTS "${appRole}"`);
      } finally {
        await maintenance.end().catch(() => undefined);
      }
    },
  };

  for (let i = 0; i < tenantCount; i++) await env.addTenant();
  return env;
}

async function redisCleanup(redis: Redis, prefix: string): Promise<void> {
  const stream = redis.scanStream({ match: `${prefix}:*`, count: 500 });
  for await (const keys of stream as AsyncIterable<string[]>) {
    if (keys.length > 0) await redis.del(...keys);
  }
}

/** Écrit `count` événements dans l'outbox du tenant, dans UNE transaction (comme un use case). */
export async function writeEvents(
  env: TestEnv,
  tenant: Tenant,
  count: number,
  type = "test.thing.happened",
  payload: (i: number) => unknown = (i) => ({ v: 1, i }),
): Promise<DomainEvent[]> {
  const ctx = createRequestContext({ tenantId: tenant.id, userId: newId(), roles: ["admin"] });
  const events = Array.from({ length: count }, (_, i) => createDomainEvent({ type, payload: payload(i), ctx }));
  await env.tenantDb.run(ctx, async (tx) => {
    await new PgOutboxWriter(tx).append(events);
  });
  return events;
}

export async function countPublished(env: TestEnv): Promise<number> {
  const r = await env.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE published_at IS NOT NULL");
  return r.rows[0].n;
}

export async function waitFor<T>(
  fn: () => Promise<T | false | undefined | null> | T | false | undefined | null,
  { timeoutMs = 30_000, intervalMs = 50, label = "condition" }: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Délai dépassé (${timeoutMs} ms) en attendant : ${label}${last ? ` — ${String(last)}` : ""}`);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Logger pino qui conserve les lignes en mémoire (assertions sur les journaux). */
export function captureLogger(level = "debug"): { logger: Logger; lines: Array<Record<string, any>> } {
  const lines: Array<Record<string, any>> = [];
  const logger = createLogger(level, {
    write(chunk: string) {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(JSON.parse(l));
    },
  });
  return { logger, lines };
}
