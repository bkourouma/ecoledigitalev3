/**
 * Harnais du test de sortie de phase 1 : démarre la plateforme v2 COMME `src/index.ts` le fait.
 *
 *   Fastify  +  base legacy simulée (`fastify.pg`)  +  VRAIS plugins legacy (tenant-context, auth-middleware)
 *   +  `registerV2Platform` (migrations réelles, rôle app_user, Redis, rattrapage, modules)
 *   +  VRAI worker (relais d'outbox, abonnés et jobs des modules découverts sur disque), en processus.
 *
 * Postgres (TEST_DATABASE_URL) et Redis (REDIS_URL) doivent être JETABLES.
 */
import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { noopLogger } from "@ecoledigitale/kernel";
import { WorkerApp } from "../../../../worker/src/app";
import { loadConfig } from "../../../../worker/src/config";
import { createLogger } from "../../../../worker/src/logger";
import { configureTenantSync } from "../../../src/platform/tenant-sync";
import { resetPublicRoutesForTests } from "../../../src/platform/public-routes";
import { resetRegistryForTests } from "../../../src/modules/registry";
import { registerV2Platform, type V2PlatformStatus } from "../../../src/platform/v2-bootstrap";
import { createLoginRole } from "../../../src/platform/v2-login-role";
import { runV2Migrations } from "../../../src/platform/v2-migrations";
import { createEphemeralDb, randomSuffix, type EphemeralDb } from "../../helpers/fixtures";
import { FakeLegacyDb } from "./fake-legacy";

export const REDIS_URL = process.env.REDIS_URL ?? process.env.TEST_REDIS_URL;

export interface Invitation {
  kind: "invitation" | "password_reset";
  email: string;
  token: string;
  tenantName?: string;
}

export interface HttpResult<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
  raw: string;
}

export interface Phase1Env {
  app: FastifyInstance;
  db: EphemeralDb;
  legacy: FakeLegacyDb;
  status: V2PlatformStatus;
  /** Variables passées à `registerV2Platform`. */
  env: Record<string, string>;
  queuePrefix: string;
  worker: WorkerApp;
  /** Jeton super-admin legacy (opérateur de la plateforme). */
  operatorToken: string;
  operatorId: string;
  /** Invitations « envoyées » par le notifieur de comptes (jamais écrites dans les journaux). */
  invitations: Invitation[];
  http<T = any>(method: string, url: string, options?: { token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string }): Promise<HttpResult<T>>;
  generateLegacyToken(user: { id: string; tenantId: string; tenantSlug: string; role: string }): string;
  stop(): Promise<void>;
}

const rand = (n = 16): string => randomBytes(n).toString("hex");

export async function waitFor<T>(
  fn: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  { timeoutMs = 30_000, intervalMs = 100, label = "condition" }: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
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
  throw new Error(`Délai dépassé (${timeoutMs} ms) : ${label}${last ? ` — ${String(last)}` : ""}`);
}

export async function startPhase1Platform(options: { startWorker?: boolean; legacyTenants?: Array<{ id: string; slug: string; name: string; is_active: boolean }> } = {}): Promise<Phase1Env> {
  if (!REDIS_URL) throw new Error("REDIS_URL requis");
  const saved = { ...process.env };

  // --- Secrets de test (aléatoires, jamais écrits sur disque) ---------------------------------------------
  const legacySecret = rand(24);
  process.env.JWT_SECRET = legacySecret;
  process.env.SUPER_ADMIN_JWT_SECRET = rand(24);
  const queuePrefix = `p1${randomSuffix()}`;
  const auditKey = rand(16);
  process.env.AUDIT_HMAC_KEY = auditKey;
  process.env.REDIS_URL = REDIS_URL;
  process.env.WORKER_QUEUE_PREFIX = queuePrefix;

  resetRegistryForTests();
  resetPublicRoutesForTests();

  // --- Base v2 : migrations RÉELLES (baseline, worker, tous les modules) ----------------------------------
  const roleName = `ed_p1_${randomSuffix()}`;
  const db = await createEphemeralDb("p1_test", [roleName]);
  await runV2Migrations({ url: db.adminUrl, logger: noopLogger });
  const appUrl = (await createLoginRole({ adminUrl: db.adminUrl, role: roleName })).applicationUrl;

  // --- Base legacy simulée + VRAIS plugins legacy ---------------------------------------------------------
  const legacy = new FakeLegacyDb();
  for (const t of options.legacyTenants ?? []) legacy.tenants.push(t);
  const operatorId = "0192f0a4-7b1e-7c3a-8d2e-0000000000f1";
  legacy.superAdmins.set(operatorId, { active: true });

  const app = Fastify({ logger: false });
  app.decorate("pg", legacy.pool as never);
  const { default: tenantContextPlugin } = await import("../../../src/plugins/tenant-context");
  const { default: authMiddleware } = await import("../../../src/plugins/auth-middleware");
  const { generateSuperAdminToken } = await import("../../../src/services/super-admin-jwt.service");
  const { generateToken } = await import("../../../src/services/jwt.service");
  await app.register(tenantContextPlugin);
  await app.register(authMiddleware);

  // --- Plateforme v2 --------------------------------------------------------------------------------------
  const invitations: Invitation[] = [];
  const env: Record<string, string> = {
    NODE_ENV: "test",
    V2_DATABASE_URL: appUrl,
    REDIS_URL,
    WORKER_QUEUE_PREFIX: queuePrefix,
    IAM_JWT_SECRET: rand(32),
    IAM_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    IAM_SCRYPT_LOG_N: "10",
    IAM_COOKIE_SECURE: "false",
    AUDIT_HMAC_KEY: auditKey,
  };
  const status = await registerV2Platform(app, {
    env: env as NodeJS.ProcessEnv,
    legacyPool: legacy.pool as never,
    runtime: {
      accountNotifier: {
        async sendInvitation(m) {
          invitations.push({ kind: "invitation", email: m.email, token: m.token, tenantName: m.tenantName });
        },
        async sendPasswordReset(m) {
          invitations.push({ kind: "password_reset", email: m.email, token: m.token });
        },
      },
    },
  });
  // Une route legacy ordinaire, enregistrée APRÈS la plateforme comme dans index.ts.
  app.get("/api/v1/legacy-probe", async (request) => ({ userId: request.userId ?? null, role: request.user?.activeRole ?? null }));
  await app.ready();

  // --- Worker (processus unique pour le test) -------------------------------------------------------------
  const worker = new WorkerApp(
    loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      REDIS_URL,
      WORKER_DATABASE_URL: appUrl,
      WORKER_HTTP_HOST: "127.0.0.1",
      WORKER_HTTP_PORT: "0",
      WORKER_QUEUE_PREFIX: queuePrefix,
      WORKER_RELAY_SWEEP_INTERVAL_MS: "500",
      WORKER_RELAY_POLL_INTERVAL_MS: "100",
      WORKER_RELAY_BACKOFF_BASE_MS: "50",
      WORKER_RELAY_BACKOFF_MAX_MS: "500",
      WORKER_SHUTDOWN_TIMEOUT_MS: "10000",
    } as NodeJS.ProcessEnv),
    { logger: createLogger("silent") },
  );
  if (options.startWorker !== false) await worker.start();

  const operatorToken = generateSuperAdminToken(operatorId, "ops@plateforme.test");

  const http: Phase1Env["http"] = async (method, url, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let payload: string | undefined;
    if (opts.rawBody !== undefined) payload = opts.rawBody;
    else if (opts.body !== undefined) payload = JSON.stringify(opts.body);
    if (payload !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const res = await app.inject({ method: method as never, url, headers, ...(payload !== undefined ? { payload } : {}) });
    let body: any = res.body;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON (CSV) : conservé tel quel */
    }
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, raw: res.body };
  };

  return {
    app,
    db,
    legacy,
    status,
    env,
    queuePrefix,
    worker,
    operatorToken,
    operatorId,
    invitations,
    http,
    generateLegacyToken: (u) =>
      generateToken({
        iss: "ecoledigitale",
        aud: u.tenantSlug,
        sub: u.id,
        userId: u.id,
        scope: "tenant_user",
        tenantId: u.tenantId,
        tenantSlug: u.tenantSlug,
        roles: [u.role],
        activeRole: u.role,
      } as never),
    async stop() {
      await worker.stop("test").catch(() => undefined);
      configureTenantSync(null);
      await app.close().catch(() => undefined);
      const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
      try {
        const stream = redis.scanStream({ match: `${queuePrefix}:*`, count: 500 });
        for await (const keys of stream as AsyncIterable<string[]>) if (keys.length > 0) await redis.del(...keys);
      } finally {
        await redis.quit().catch(() => undefined);
      }
      await db.drop();
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    },
  };
}
