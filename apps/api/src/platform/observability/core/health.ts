/**
 * Santé : liveness (`/health`) et readiness (`/ready`), partagées par l'API et le worker (ADR-009).
 *
 *  - `/health` : le processus répond. Ne touche AUCUNE dépendance (sinon une panne de base redémarrerait en boucle
 *    tous les conteneurs, ce qui l'aggrave).
 *  - `/ready`  : sondes PostgreSQL, Redis, migrations, worker vivant, stockage objet. Chaque sonde a un délai maximal.
 *    Les sondes REQUISES (`OBS_READY_REQUIRE`, défaut `postgres,redis,migrations`) font passer le service en `not_ready`
 *    (HTTP 503) ; les autres signalent seulement une dégradation (`degraded`, HTTP 200) : redémarrer l'API ne répare ni un
 *    worker arrêté ni un bucket indisponible.
 *  - La réponse ne contient que des noms de sonde et des booléens ; les messages d'erreur ne sortent qu'avec
 *    `OBS_HEALTH_DETAILS=true` (réseau interne).
 */
import type { HealthConfig } from "./config";

export type ProbeName = "postgres" | "redis" | "migrations" | "worker" | "storage";

export interface Probe {
  name: ProbeName;
  /** Résout si la dépendance est saine ; lève (message court, sans secret) sinon. `skipped` : non configurée. */
  check(): Promise<void | "skipped">;
}

export interface ProbeResult {
  name: string;
  status: "ok" | "failed" | "skipped";
  required: boolean;
  durationMs: number;
  error?: string;
}

export type ReadinessStatus = "ready" | "degraded" | "not_ready";

export interface ReadinessReport {
  status: ReadinessStatus;
  httpStatus: 200 | 503;
  checks: ProbeResult[];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`délai de ${ms} ms dépassé`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function runProbes(probes: readonly Probe[], health: Pick<HealthConfig, "required" | "probeTimeoutMs">): Promise<ReadinessReport> {
  const checks = await Promise.all(
    probes.map(async (probe): Promise<ProbeResult> => {
      const started = Date.now();
      const required = health.required.has(probe.name);
      try {
        const outcome = await withTimeout(probe.check(), health.probeTimeoutMs);
        return { name: probe.name, status: outcome === "skipped" ? "skipped" : "ok", required, durationMs: Date.now() - started };
      } catch (err) {
        return { name: probe.name, status: "failed", required, durationMs: Date.now() - started, error: err instanceof Error ? err.message.slice(0, 300) : "échec" };
      }
    }),
  );
  const requiredFailed = checks.some((c) => c.status === "failed" && c.required);
  const anyFailed = checks.some((c) => c.status === "failed");
  const status: ReadinessStatus = requiredFailed ? "not_ready" : anyFailed ? "degraded" : "ready";
  return { status, httpStatus: requiredFailed ? 503 : 200, checks };
}

/** Corps public de `/ready` : noms et états ; messages d'erreur seulement si `details`. */
export function renderReadiness(report: ReadinessReport, options: { details: boolean; service: string }): Record<string, unknown> {
  return {
    status: report.status,
    service: options.service,
    checks: report.checks.map((c) => ({
      name: c.name,
      ok: c.status !== "failed",
      ...(c.status === "skipped" ? { skipped: true } : {}),
      required: c.required,
      ...(options.details ? { durationMs: c.durationMs, ...(c.error ? { error: c.error } : {}) } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Sondes réutilisables
// ---------------------------------------------------------------------------

interface QueryablePool {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

interface PingableRedis {
  ping(): Promise<string>;
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
}

export function postgresProbe(pool: QueryablePool): Probe {
  return {
    name: "postgres",
    async check() {
      await pool.query("SELECT 1");
    },
  };
}

export function redisProbe(redis: Pick<PingableRedis, "ping"> | null): Probe {
  return {
    name: "redis",
    async check() {
      if (!redis) return "skipped";
      const reply = await redis.ping();
      if (reply !== "PONG") throw new Error("réponse Redis inattendue");
    },
  };
}

/** Objets que les migrations doivent avoir créés. */
export interface ExpectedSchema {
  schemas: readonly string[];
  tables: readonly string[];
}

export const KERNEL_EXPECTED_TABLES = ["kernel.tenants", "kernel.domain_events", "kernel.processed_events"] as const;

/**
 * « Migrations appliquées » : `app_user` ne peut pas lire les tables de suivi du migrateur (`schema_migrations*`), le
 * contrôle est donc STRUCTUREL : schémas de module et tables du noyau présents. Il détecte un module ajouté dont la migration
 * n'a pas été jouée, pas une migration appliquée à moitié (limite documentée dans le runbook).
 */
export function migrationsProbe(pool: QueryablePool, expected: ExpectedSchema): Probe {
  return {
    name: "migrations",
    async check() {
      const res = await pool.query(
        `SELECT
           COALESCE((SELECT array_agg(s ORDER BY s) FROM unnest($1::text[]) AS s
                      WHERE NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = s)), '{}') AS missing_schemas,
           COALESCE((SELECT array_agg(t ORDER BY t) FROM unnest($2::text[]) AS t
                      WHERE to_regclass(t) IS NULL), '{}') AS missing_tables`,
        [[...expected.schemas], [...expected.tables]],
      );
      const row = res.rows[0] as { missing_schemas: string[]; missing_tables: string[] } | undefined;
      const missing = [...(row?.missing_schemas ?? []).map((s) => `schéma ${s}`), ...(row?.missing_tables ?? [])];
      if (missing.length > 0) throw new Error(`migrations non appliquées : ${missing.slice(0, 8).join(", ")}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Battement de cœur du worker (clé Redis partagée API / worker)
// ---------------------------------------------------------------------------

export const HEARTBEAT_TTL_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;

export const heartbeatKey = (prefix: string): string => `${prefix}:obs:workers`;

/** Sonde « worker vivant » : au moins un battement de cœur de moins de 30 s dans l'ensemble trié `<préfixe>:obs:workers`. */
export function workerHeartbeatProbe(redis: Pick<PingableRedis, "zcount"> | null, prefix: string, now: () => number = Date.now): Probe {
  return {
    name: "worker",
    async check() {
      if (!redis) return "skipped";
      const alive = await redis.zcount(heartbeatKey(prefix), now() - HEARTBEAT_TTL_MS, "+inf");
      if (alive < 1) throw new Error("aucun worker n'a émis de battement de cœur depuis 30 s");
    },
  };
}

export function storageProbe(check: () => Promise<void | "skipped">): Probe {
  return { name: "storage", check };
}
