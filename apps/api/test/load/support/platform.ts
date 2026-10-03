/**
 * Plateforme du test de charge : même assemblage que `phase2/support/platform.ts` (API v2 réelle + vrai worker en processus, Postgres
 * et Redis JETABLES), avec trois différences voulues :
 *   - l'API ÉCOUTE sur un vrai port (127.0.0.1) et les appels passent par `fetch` (sockets réelles, keep-alive), pas par `inject` ;
 *   - le coût scrypt de IAM est celui de PRODUCTION (logN 16) sauf `ED_LOAD_SCRYPT_LOG_N` ;
 *   - un « pg_stat_statements du pauvre » mesure chaque requête SQL (texte normalisé, durée) pour trouver les pires requêtes.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";
import pg from "pg";
import { configureTenantSync } from "../../../src/platform/tenant-sync";
import { FakePdfRenderer, resetReportcardsWorkerResources, setReportcardsWorkerResources } from "../../../src/modules/reportcards";
import { WorkerApp } from "../../../../worker/src/app";
import { loadConfig } from "../../../../worker/src/config";
import { createLogger } from "../../../../worker/src/logger";
import { bootInstance, flushQueuePrefix, legacyModule, prepareInfra, REDIS_URL, type HttpResult, type Phase1Env } from "../../phase1/support/harness";
import { detectChrome, type Phase2Env } from "../../phase2/support/platform";
import { REAL_PDF, SCRYPT_LOG_N } from "../config";

// ---------------------------------------------------------------------------
// Capture des requêtes SQL (poste de travail de l'analyse de performance)
// ---------------------------------------------------------------------------

export interface SqlStat {
  key: string;
  text: string;
  calls: number;
  totalMs: number;
  maxMs: number;
  /** Paramètres de l'exécution la plus lente (données de test). */
  slowestValues: unknown[];
}

const sqlStats = new Map<string, SqlStat>();
let sqlCaptureOn = false;
let restoreQuery: (() => void) | null = null;

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 4000);

export function startSqlCapture(): void {
  if (restoreQuery) return;
  const proto = pg.Client.prototype as unknown as { query: (...a: any[]) => any };
  const original = proto.query;
  proto.query = function patched(this: unknown, ...args: any[]) {
    const first = args[0];
    const text: string | undefined = typeof first === "string" ? first : first && typeof first.text === "string" ? first.text : undefined;
    if (!sqlCaptureOn || !text || typeof args[args.length - 1] === "function") return original.apply(this, args);
    const values: unknown[] = Array.isArray(args[1]) ? args[1] : first && Array.isArray(first.values) ? first.values : [];
    const t0 = performance.now();
    const out = original.apply(this, args);
    if (out && typeof out.then === "function") {
      const record = (): void => {
        const d = performance.now() - t0;
        const norm = normalize(text);
        const key = norm;
        const s = sqlStats.get(key) ?? { key, text: norm, calls: 0, totalMs: 0, maxMs: 0, slowestValues: [] };
        s.calls += 1;
        s.totalMs += d;
        if (d >= s.maxMs) {
          s.maxMs = d;
          s.slowestValues = values;
        }
        sqlStats.set(key, s);
      };
      out.then(record, record);
    }
    return out;
  };
  restoreQuery = () => {
    proto.query = original;
  };
}

export function setSqlCapture(on: boolean): void {
  sqlCaptureOn = on;
}
export function resetSqlStats(): void {
  sqlStats.clear();
}
export function sqlTop(by: "total" | "mean" | "max", n: number, minCalls = 1): SqlStat[] {
  const score = (s: SqlStat): number => (by === "total" ? s.totalMs : by === "mean" ? s.totalMs / s.calls : s.maxMs);
  return [...sqlStats.values()].filter((s) => s.calls >= minCalls).sort((a, b) => score(b) - score(a)).slice(0, n);
}
export function stopSqlCapture(): void {
  restoreQuery?.();
  restoreQuery = null;
  sqlCaptureOn = false;
}

/**
 * Remet à zéro les compteurs du limiteur d'IP de IAM (clés Redis `<préfixe>:iam:rl:w:<portée>:<empreinte>`). Les limites de PRODUCTION restent actives
 * (elles ne sont pas modifiées) ; on n'efface que l'historique accumulé par la génération du jeu de données (une seule IP, 127.0.0.1,
 * enchaîne des dizaines d'activations de comptes : au-delà de 20 réinitialisations de mot de passe par heure le limiteur répond 429).
 */
export async function resetIpLimiters(scopes: string[] = ["reset:ip", "forgot:ip", "login:ip", "refresh:ip"]): Promise<void> {
  const redis = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
  try {
    let deleted = 0;
    for (const scope of scopes) {
      for await (const keys of redis.scanStream({ match: `*:iam:rl:w:${scope}:*`, count: 500 }) as AsyncIterable<string[]>) {
        if (keys.length > 0) deleted += await redis.del(...keys);
      }
    }
    if (process.env.ED_LOAD_DEBUG === "1") console.log(`[load] limiteurs remis à zéro : ${deleted} clés (${scopes.join(", ")})`);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Plateforme
// ---------------------------------------------------------------------------

export type LoadEnv = Phase2Env & { baseUrl: string; infraAppUrl: string };

export async function startLoadPlatform(): Promise<LoadEnv> {
  const infra = await prepareInfra();
  infra.env.IAM_SCRYPT_LOG_N = SCRYPT_LOG_N;

  const storageDir = mkdtempSync(join(tmpdir(), "ed-load-objects-"));
  const chromePath = REAL_PDF ? detectChrome() : null;
  const { privateKey } = generateKeyPairSync("ed25519");
  const signingKey = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const signingKeyId = `load-${randomBytes(4).toString("hex")}-key`;
  const extra: Record<string, string> = {
    STORAGE_DISK_DIR: storageDir,
    STORAGE_SIGNING_SECRET: randomBytes(24).toString("hex"),
    STORAGE_PUBLIC_BASE_URL: "http://localhost:3001",
    REPORTCARDS_SIGNING_KEY: signingKey,
    REPORTCARDS_SIGNING_KEY_ID: signingKeyId,
    REPORTCARDS_VERIFICATION_BASE_URL: "https://verif.ecoledigitale.test",
    V2_APP_BASE_URL: "https://app.ecoledigitale.test",
    IAM_ACCESS_TTL_SEC: "3600",
    // Cache du verdict de session : désactivé en test par défaut ; `V2_SESSION_CACHE=on pnpm test:load` mesure « après ».
    ...(process.env.V2_SESSION_CACHE ? { V2_SESSION_CACHE: process.env.V2_SESSION_CACHE } : {}),
    ...(chromePath ? { REPORTCARDS_CHROME_PATH: chromePath, REPORTCARDS_CHROME_NO_SANDBOX: process.env.CI ? "1" : "0" } : {}),
  };
  Object.assign(process.env, extra);
  if (!chromePath) setReportcardsWorkerResources({ renderer: new FakePdfRenderer() });

  startSqlCapture();
  const { app, status } = await bootInstance(infra, { extraEnv: extra });
  const workerLog: string[] = [];
  const worker = new WorkerApp(
    loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
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
    { logger: createLogger("warn", { write: (line: string) => void workerLog.push(line) }) },
  );
  await worker.start();

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

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
    const res = await fetch(baseUrl + url, { method, headers, ...(payload !== undefined ? { body: payload } : {}) });
    const raw = await res.text();
    let body: any = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      /* corps non JSON : conservé tel quel */
    }
    return { status: res.status, body, headers: Object.fromEntries(res.headers.entries()) as Record<string, unknown>, raw } as HttpResult;
  };

  return {
    app,
    db: infra.db,
    legacy: infra.legacy,
    status,
    env: { ...infra.env, ...extra },
    queuePrefix: infra.queuePrefix,
    worker,
    workerLog,
    operatorToken,
    operatorId: infra.operatorId,
    invitations: infra.invitations,
    http,
    generateLegacyToken: (u) =>
      generateToken({ iss: "ecoledigitale", aud: u.tenantSlug, sub: u.id, userId: u.id, scope: "tenant_user", tenantId: u.tenantId, tenantSlug: u.tenantSlug, roles: [u.role], activeRole: u.role } as never),
    storageDir,
    realPdf: chromePath !== null,
    chromePath,
    signingKeyId,
    baseUrl,
    infraAppUrl: infra.appUrl,
    async stop() {
      stopSqlCapture();
      await worker.stop("test").catch(() => undefined);
      configureTenantSync(null);
      resetReportcardsWorkerResources();
      await app.close().catch(() => undefined);
      await flushQueuePrefix(infra.queuePrefix);
      await infra.db.drop();
      rmSync(storageDir, { recursive: true, force: true });
      infra.restoreEnv();
    },
  };
}
