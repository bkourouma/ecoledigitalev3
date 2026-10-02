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
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { Redis } from "ioredis";
import { noopLogger } from "@ecoledigitale/kernel";
import { WorkerApp } from "../../../../worker/src/app";
import { loadConfig } from "../../../../worker/src/config";
import { createLogger, type Logger as WorkerLogger } from "../../../../worker/src/logger";
import type { WorkerObservability } from "../../../../worker/src/observability";
import { configureTenantSync } from "../../../src/platform/tenant-sync";
import { resetPublicRoutesForTests } from "../../../src/platform/public-routes";
import { resetRegistryForTests } from "../../../src/modules/registry";
import { registerV2Platform, type V2PlatformStatus } from "../../../src/platform/v2-bootstrap";
import { createLoginRole } from "../../../src/platform/v2-login-role";
import { runV2Migrations } from "../../../src/platform/v2-migrations";
import { createEphemeralDb, randomSuffix, type EphemeralDb } from "../../helpers/fixtures";
import { FakeLegacyDb } from "./fake-legacy";

export const REDIS_URL = process.env.REDIS_URL ?? process.env.TEST_REDIS_URL;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Charge un module du code LEGACY (`apps/api/src/<chemin>`) sans le faire entrer dans le programme TypeScript
 * strict de la plateforme v2 (`tsconfig.v2.json`) : le legacy n'est pas écrit pour ces options. Le chargement
 * est tardif — après la pose des secrets de test — car `jwt.service` exige `JWT_SECRET` dès son import.
 */
export async function legacyModule<T>(relativeToSrc: string): Promise<T> {
  const url = pathToFileURL(resolve(here, "../../../src", relativeToSrc)).href;
  return (await import(/* @vite-ignore */ url)) as T;
}

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

type LegacyTenantInput = { id: string; slug: string; name: string; is_active: boolean };

/** Infrastructure partagée par une ou plusieurs instances de l'API : base migrée, secrets, base legacy simulée. */
export interface Infra {
  db: EphemeralDb;
  appUrl: string;
  legacy: FakeLegacyDb;
  /** Variables passées à `registerV2Platform`. */
  env: Record<string, string>;
  queuePrefix: string;
  operatorId: string;
  invitations: Invitation[];
  restoreEnv(): void;
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

/** Secrets de test (aléatoires, jamais écrits sur disque), base v2 migrée (migrations RÉELLES), base legacy simulée. */
export async function prepareInfra(options: { legacyTenants?: LegacyTenantInput[] } = {}): Promise<Infra> {
  if (!REDIS_URL) throw new Error("REDIS_URL requis");
  const saved = { ...process.env };
  process.env.JWT_SECRET = rand(24);
  process.env.SUPER_ADMIN_JWT_SECRET = rand(24);
  const queuePrefix = `p1${randomSuffix()}`;
  const auditKey = rand(16);
  process.env.AUDIT_HMAC_KEY = auditKey;
  process.env.REDIS_URL = REDIS_URL;
  process.env.WORKER_QUEUE_PREFIX = queuePrefix;

  resetRegistryForTests();
  resetPublicRoutesForTests();

  const roleName = `ed_p1_${randomSuffix()}`;
  const db = await createEphemeralDb("p1_test", [roleName]);
  await runV2Migrations({ url: db.adminUrl, logger: noopLogger });
  const appUrl = (await createLoginRole({ adminUrl: db.adminUrl, role: roleName })).applicationUrl;

  const legacy = new FakeLegacyDb();
  for (const t of options.legacyTenants ?? []) legacy.tenants.push(t);
  const operatorId = "0192f0a4-7b1e-7c3a-8d2e-0000000000f1";
  legacy.superAdmins.set(operatorId, { active: true });

  return {
    db,
    appUrl,
    legacy,
    queuePrefix,
    operatorId,
    invitations: [],
    env: {
      NODE_ENV: "test",
      V2_DATABASE_URL: appUrl,
      REDIS_URL,
      WORKER_QUEUE_PREFIX: queuePrefix,
      IAM_JWT_SECRET: rand(32),
      IAM_MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      IAM_SCRYPT_LOG_N: "10",
      IAM_COOKIE_SECURE: "false",
      AUDIT_HMAC_KEY: auditKey,
    },
    restoreEnv() {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    },
  };
}

/** Une instance de l'API : Fastify + vrais plugins legacy + `registerV2Platform`, comme `src/index.ts`. */
export interface BootInstanceOptions {
  extraEnv?: Record<string, string>;
  /** Options de Fastify (défaut : `{ logger: false }`) — l'observabilité (ADR-009) fournit les siennes. */
  fastify?: FastifyServerOptions;
  /** Exécuté AVANT tout autre plugin (c'est la place du plugin d'observabilité : ses hooks ne couvrent que les routes déclarées après lui). */
  beforePlatform?: (app: FastifyInstance) => Promise<void>;
}

export async function bootInstance(infra: Infra, options: BootInstanceOptions = {}): Promise<{ app: FastifyInstance; status: V2PlatformStatus }> {
  const app = Fastify(options.fastify ?? { logger: false });
  await options.beforePlatform?.(app);
  app.decorate("pg", infra.legacy.pool as never);
  const { default: tenantContextPlugin } = await legacyModule<{ default: never }>("plugins/tenant-context");
  const { default: authMiddleware } = await legacyModule<{ default: never }>("plugins/auth-middleware");
  await app.register(tenantContextPlugin);
  await app.register(authMiddleware);

  const status = await registerV2Platform(app, {
    env: { ...infra.env, ...(options.extraEnv ?? {}) } as NodeJS.ProcessEnv,
    legacyPool: infra.legacy.pool as never,
    runtime: {
      accountNotifier: {
        async sendInvitation(m) {
          infra.invitations.push({ kind: "invitation", email: m.email, token: m.token, tenantName: m.tenantName });
        },
        async sendPasswordReset(m) {
          infra.invitations.push({ kind: "password_reset", email: m.email, token: m.token });
        },
      },
    },
  });
  // Une route legacy ordinaire, enregistrée APRÈS la plateforme comme dans index.ts.
  app.get("/api/v1/legacy-probe", async (request) => ({ userId: request.userId ?? null, role: request.user?.activeRole ?? null }));
  await app.ready();
  return { app, status };
}

export async function flushQueuePrefix(prefix: string): Promise<void> {
  const redis = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
  try {
    for await (const keys of redis.scanStream({ match: `${prefix}:*`, count: 500 }) as AsyncIterable<string[]>) if (keys.length > 0) await redis.del(...keys);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

export interface Phase1Env {
  app: FastifyInstance;
  db: EphemeralDb;
  legacy: FakeLegacyDb;
  status: V2PlatformStatus;
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

export interface WorkerForOptions {
  logger?: WorkerLogger;
  /** `undefined` : observabilité par défaut (environnement) ; `null` : aucune ; fonction : construite avec l'infrastructure (préfixe de files). */
  observability?: WorkerObservability | null | ((infra: Infra) => WorkerObservability);
}

export function workerFor(infra: Infra, options: WorkerForOptions = {}): WorkerApp {
  return new WorkerApp(
    loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      REDIS_URL: REDIS_URL as string,
      WORKER_DATABASE_URL: infra.appUrl,
      WORKER_HTTP_HOST: "127.0.0.1",
      WORKER_HTTP_PORT: "0",
      WORKER_QUEUE_PREFIX: infra.queuePrefix,
      WORKER_RELAY_SWEEP_INTERVAL_MS: "500",
      WORKER_RELAY_POLL_INTERVAL_MS: "100",
      WORKER_RELAY_BACKOFF_BASE_MS: "50",
      WORKER_RELAY_BACKOFF_MAX_MS: "500",
      WORKER_SHUTDOWN_TIMEOUT_MS: "10000",
    } as NodeJS.ProcessEnv),
    {
      logger: options.logger ?? createLogger("silent"),
      ...(options.observability !== undefined ? { observability: typeof options.observability === "function" ? options.observability(infra) : options.observability } : {}),
    },
  );
}

export async function startPhase1Platform(
  options: { startWorker?: boolean; legacyTenants?: LegacyTenantInput[]; instance?: BootInstanceOptions; worker?: WorkerForOptions } = {},
): Promise<Phase1Env> {
  const infra = await prepareInfra(options.legacyTenants ? { legacyTenants: options.legacyTenants } : {});
  const { app, status } = await bootInstance(infra, options.instance ?? {});

  const worker = workerFor(infra, options.worker ?? {});
  if (options.startWorker !== false) await worker.start();

  const { generateSuperAdminToken } = await legacyModule<{ generateSuperAdminToken(id: string, email: string): string }>("services/super-admin-jwt.service");
  const { generateToken } = await legacyModule<{ generateToken(payload: Record<string, unknown>): string }>("services/jwt.service");
  const operatorToken = generateSuperAdminToken(infra.operatorId, "ops@plateforme.test");

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
    db: infra.db,
    legacy: infra.legacy,
    status,
    env: infra.env,
    queuePrefix: infra.queuePrefix,
    worker,
    operatorToken,
    operatorId: infra.operatorId,
    invitations: infra.invitations,
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
      await flushQueuePrefix(infra.queuePrefix);
      await infra.db.drop();
      infra.restoreEnv();
    },
  };
}
