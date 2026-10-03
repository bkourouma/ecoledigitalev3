/**
 * Aides des tests du cache de verdict de session : proxy TCP coupable devant Redis (« Redis tué en cours de test »),
 * connexion ioredis configurée comme en production, fabrique d'instances d'API simulées partageant le même Redis.
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { noopLogger } from "@ecoledigitale/kernel";
import { createIamService, SessionVerdictCache, type IamService } from "../../src/modules/iam";
import type { Harness } from "../../src/modules/iam/test/helpers";

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

/** Proxy TCP vers Redis : `sever()` coupe tout (Redis « tué »), `restore()` le rétablit, `setDelay()` le ralentit. */
export class RedisProxy {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private delayMs = 0;
  port = 0;
  private readonly target: { host: string; port: number };

  constructor(redisUrl: string) {
    const u = new URL(redisUrl);
    this.target = { host: u.hostname, port: Number(u.port || 6379) };
  }

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    await this.listen(this.port);
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((client) => {
        const upstream = connect(this.target);
        this.sockets.add(client);
        this.sockets.add(upstream);
        const drop = (): void => {
          client.destroy();
          upstream.destroy();
          this.sockets.delete(client);
          this.sockets.delete(upstream);
        };
        client.on("error", drop).on("close", drop);
        upstream.on("error", drop).on("close", drop);
        client.on("data", (chunk) => {
          if (this.delayMs > 0) setTimeout(() => upstream.write(chunk), this.delayMs);
          else upstream.write(chunk);
        });
        upstream.on("data", (chunk) => client.write(chunk));
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        this.port = (server.address() as { port: number }).port;
        this.server = server;
        resolve();
      });
    });
  }

  /** Redis « tué » : plus d'écoute, toutes les connexions coupées. */
  async sever(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  async restore(): Promise<void> {
    if (!this.server) await this.listen(this.port);
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  async stop(): Promise<void> {
    await this.sever();
  }
}

/** Connexion ioredis dédiée, configurée comme `startSessionVerdictCacheFromEnv` (sans file d'attente hors ligne). */
export async function openRedis(url: string): Promise<import("ioredis").Redis> {
  const { Redis } = await import("ioredis");
  const redis = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1000,
    commandTimeout: 600,
    retryStrategy: (times: number) => Math.min(times * 50, 200),
  });
  redis.on("error", () => undefined);
  await new Promise<void>((resolve, reject) => {
    if (redis.status === "ready") return resolve();
    const timer = setTimeout(() => reject(new Error("Redis non prêt")), 5000);
    redis.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return redis;
}

export interface Instance {
  name: string;
  iam: IamService;
  cache: SessionVerdictCache;
  redis: import("ioredis").Redis;
}

export interface InstanceOptions {
  prefix: string;
  redisUrl: string;
  ttlMs?: number;
  redisTimeoutMs?: number;
  breakerMs?: number;
  pendingTtlMs?: number;
  now?: () => number;
}

/** Une « instance d'API » : son propre service IAM, son propre cache local, sa propre connexion Redis ; base partagée. */
export async function makeInstance(h: Harness, name: string, o: InstanceOptions): Promise<Instance> {
  const redis = await openRedis(o.redisUrl);
  const cache = new SessionVerdictCache({
    redis,
    prefix: o.prefix,
    ttlMs: o.ttlMs ?? 3000,
    redisTimeoutMs: o.redisTimeoutMs ?? 150,
    breakerMs: o.breakerMs ?? 200,
    ...(o.pendingTtlMs !== undefined ? { pendingTtlMs: o.pendingTtlMs } : {}),
    ...(o.now ? { now: o.now } : {}),
    logger: noopLogger,
  });
  const iam = createIamService({
    config: h.config,
    tenantDb: h.tenantDb,
    systemDb: h.systemDb,
    limiter: h.limiter,
    notifier: h.notifier,
    clock: h.clock,
    logger: noopLogger,
    sleep: async () => undefined,
    verdictCache: cache,
  });
  return { name, iam, cache, redis };
}

export async function closeInstance(i: Instance): Promise<void> {
  await i.iam.drainBackground().catch(() => undefined);
  i.redis.disconnect();
}

export async function eventually<T>(fn: () => Promise<T | false | undefined | null>, timeoutMs = 5000, stepMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("eventually : délai dépassé");
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
