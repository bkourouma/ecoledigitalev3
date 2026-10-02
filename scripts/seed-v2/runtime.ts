/**
 * Démarre la plateforme v2 EN PROCESSUS pour le seed : Fastify + `registerV2Platform` (migrations déjà appliquées, rôle applicatif
 * soumis à la RLS) + le vrai worker (relais d'outbox, abonnés). Le seed n'a ainsi AUCUN accès SQL direct : il appelle l'API HTTP
 * publique (`app.inject`) avec de vrais comptes IAM, comme le fait le test de sortie de phase 2.
 *
 * Particularités :
 *  - l'opérateur de la console plateforme est un jeton aléatoire propre à ce processus (aucune base legacy requise) ;
 *  - les invitations ne sont pas envoyées : le notifieur en mémoire en garde les jetons pour que le seed active les comptes ;
 *  - les secrets (JWT IAM, chiffrement MFA, HMAC d'audit) viennent de l'environnement : ce sont ceux de l'API qui servira la base ensuite.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { UnauthorizedError } from "../../packages/kernel/src/index";
import { WorkerApp } from "../../apps/worker/src/app";
import { loadConfig } from "../../apps/worker/src/config";
import { createLogger } from "../../apps/worker/src/logger";
import { resetRegistryForTests } from "../../apps/api/src/modules/registry";
import { configureTenantSync } from "../../apps/api/src/platform/tenant-sync";
import { resetPublicRoutesForTests } from "../../apps/api/src/platform/public-routes";
import { registerV2Platform } from "../../apps/api/src/platform/v2-bootstrap";
import { MemoryRateLimiter } from "../../apps/api/src/modules/iam";

/**
 * Limiteur de débit du seed : le processus du seed est local et de confiance (adresse 127.0.0.1 unique) et active des dizaines de
 * comptes d'affilée : le plafond horaire par adresse de l'API (réponse 429 `iam.too_many_attempts`) le bloquerait. L'API de la
 * démonstration, elle, garde son limiteur Redis.
 */
class SeedRateLimiter extends MemoryRateLimiter {
  override async hit(_key: string, _rule: Parameters<MemoryRateLimiter["hit"]>[1]): ReturnType<MemoryRateLimiter["hit"]> {
    return { allowed: true, count: 0, retryAfterMs: 0 };
  }
}

const apiRequire = createRequire(resolve(__dirname, "../../apps/api/package.json"));
const { Redis } = apiRequire("ioredis") as { Redis: new (url: string, opts: { maxRetriesPerRequest: number }) => { keys(p: string): Promise<string[]>; del(...k: string[]): Promise<unknown>; disconnect(): void } };

export interface HttpResult {
  status: number;
  body: any;
  headers: Record<string, unknown>;
  /** Octets bruts de la réponse (fichiers : XLSX, PDF). */
  raw?: Buffer;
}
export type Http = (method: string, url: string, options?: { token?: string; body?: unknown; rawBody?: string | Buffer; headers?: Record<string, string> }) => Promise<HttpResult>;

export interface Invitation {
  kind: "invitation" | "password_reset";
  email: string;
  token: string;
}

export interface SeedPlatform {
  http: Http;
  operatorToken: string;
  invitations: Invitation[];
  /** Lignes d'avertissement ou d'erreur du worker (diagnostic). */
  workerLog: string[];
  stop(): Promise<void>;
}

interface FastifyLike {
  inject(opts: { method: string; url: string; headers?: Record<string, string>; payload?: string | Buffer }): Promise<{ statusCode: number; body: string; headers: Record<string, unknown>; rawPayload?: Buffer }>;
  ready(): Promise<unknown>;
  close(): Promise<unknown>;
}

export async function startSeedPlatform(env: NodeJS.ProcessEnv): Promise<SeedPlatform> {
  const databaseUrl = env.V2_DATABASE_URL as string;
  const redisUrl = env.REDIS_URL as string;
  const queuePrefix = `seed${randomBytes(4).toString("hex")}`;
  // Le worker et l'API lisent `process.env` : on y pose le préfixe de file de ce processus (restauré à l'arrêt).
  const saved = { WORKER_QUEUE_PREFIX: process.env.WORKER_QUEUE_PREFIX };
  process.env.WORKER_QUEUE_PREFIX = queuePrefix;

  const operatorToken = randomBytes(32).toString("base64url");
  const operatorId = randomUUID();
  const operatorDigest = createHmac("sha256", "seed-operator").update(operatorToken).digest();
  const invitations: Invitation[] = [];

  resetRegistryForTests();
  resetPublicRoutesForTests();
  const fastify = apiRequire("fastify") as (opts: { logger: boolean }) => FastifyLike & Record<string, unknown>;
  const app = fastify({ logger: false });

  const apiEnv = {
    ...env,
    NODE_ENV: env.NODE_ENV ?? "development",
    V2_DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    WORKER_QUEUE_PREFIX: queuePrefix,
    // Les sessions du seed durent le temps du seed.
    IAM_ACCESS_TTL_SEC: "3600",
    IAM_COOKIE_SECURE: "false",
  } as NodeJS.ProcessEnv;

  await registerV2Platform(app as never, {
    env: apiEnv,
    skipLegacyCatchUp: true,
    runtime: {
      rateLimiter: new SeedRateLimiter(),
      superAdminAuthorizer: {
        async authorize(request: { headers: Record<string, unknown> }) {
          const header = request.headers.authorization;
          const token = typeof header === "string" ? /^Bearer (\S+)$/.exec(header)?.[1] : undefined;
          const digest = token ? createHmac("sha256", "seed-operator").update(token).digest() : null;
          if (!digest || !timingSafeEqual(digest, operatorDigest)) {
            throw new UnauthorizedError("Jeton d'opérateur invalide.", { code: "platform.operator_token_invalid" });
          }
          return { actorId: operatorId, email: "seed@plateforme.test" };
        },
      } as never,
      accountNotifier: {
        async sendInvitation(m: { email: string; token: string }) {
          invitations.push({ kind: "invitation", email: m.email, token: m.token });
        },
        async sendPasswordReset(m: { email: string; token: string }) {
          invitations.push({ kind: "password_reset", email: m.email, token: m.token });
        },
      } as never,
    },
  });
  await app.ready();

  const workerLog: string[] = [];
  const worker = new WorkerApp(
    loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      REDIS_URL: redisUrl,
      WORKER_DATABASE_URL: databaseUrl,
      WORKER_HTTP_HOST: "127.0.0.1",
      WORKER_HTTP_PORT: "0",
      WORKER_QUEUE_PREFIX: queuePrefix,
      WORKER_RELAY_SWEEP_INTERVAL_MS: "500",
      WORKER_RELAY_POLL_INTERVAL_MS: "100",
      WORKER_RELAY_BACKOFF_BASE_MS: "50",
      WORKER_RELAY_BACKOFF_MAX_MS: "500",
      WORKER_SHUTDOWN_TIMEOUT_MS: "10000",
      AUDIT_HMAC_KEY: env.AUDIT_HMAC_KEY as string,
    } as NodeJS.ProcessEnv),
    { logger: createLogger("warn", { write: (line: string) => void workerLog.push(line) }) },
  );
  await worker.start();

  const http: Http = async (method, url, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const payload = options.rawBody !== undefined ? options.rawBody : options.body !== undefined ? JSON.stringify(options.body) : undefined;
    if (payload !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url, headers, ...(payload !== undefined ? { payload } : {}) });
    let body: any = res.body;
    try {
      body = res.body ? JSON.parse(res.body) : null;
    } catch {
      /* corps non JSON conservé tel quel */
    }
    return { status: res.statusCode, body, headers: res.headers, ...(res.rawPayload ? { raw: res.rawPayload } : {}) };
  };

  return {
    http,
    operatorToken,
    invitations,
    workerLog,
    async stop() {
      await worker.stop("seed").catch(() => undefined);
      configureTenantSync(null);
      await app.close().catch(() => undefined);
      const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
      try {
        const keys = await redis.keys(`${queuePrefix}*`);
        if (keys.length > 0) await redis.del(...keys);
      } catch {
        /* nettoyage au mieux */
      } finally {
        redis.disconnect();
      }
      if (saved.WORKER_QUEUE_PREFIX === undefined) delete process.env.WORKER_QUEUE_PREFIX;
      else process.env.WORKER_QUEUE_PREFIX = saved.WORKER_QUEUE_PREFIX;
    },
  };
}

/** Attend qu'une condition asynchrone devienne vraie (événements relayés par le worker). */
export async function waitFor<T>(check: () => Promise<T | false | null | undefined>, options: { label: string; timeoutMs?: number; intervalMs?: number }): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 45_000);
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${options.label}`);
    await new Promise((r) => setTimeout(r, options.intervalMs ?? 250));
  }
}
