/**
 * Configuration du worker, validée par Zod AU DÉMARRAGE : une variable absente
 * ou invalide fait échouer le processus immédiatement (jamais de valeur par
 * défaut silencieuse pour un secret ou une URL de connexion).
 *
 * Le worker n'utilise JAMAIS `DATABASE_URL` (url du super-utilisateur ou du
 * propriétaire dans les anciens déploiements) : seulement `WORKER_DATABASE_URL`,
 * un rôle de connexion qui hérite de `app_user` (soumis à la RLS).
 */
import { z } from "zod";

const boolean = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return def;
      if (typeof v === "boolean") return v;
      const s = v.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(s)) return true;
      if (["0", "false", "no", "off"].includes(s)) return false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `booléen attendu (true/false), reçu "${v}"` });
      return z.NEVER;
    });

const int = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  REDIS_URL: z.string().regex(/^rediss?:\/\/.+/, "REDIS_URL doit commencer par redis:// ou rediss://"),
  WORKER_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, "WORKER_DATABASE_URL doit commencer par postgres:// ou postgresql://"),

  WORKER_HTTP_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_HTTP_PORT: int(8012, 0, 65535),
  WORKER_PG_POOL_MAX: int(10, 2, 100),
  WORKER_PG_STATEMENT_TIMEOUT_MS: int(30_000, 1000, 600_000),
  /** Préfixe des clés Redis BullMQ (isole plusieurs environnements sur un même Redis). */
  WORKER_QUEUE_PREFIX: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).default("ed"),
  WORKER_SHUTDOWN_TIMEOUT_MS: int(25_000, 1000, 300_000),
  /** Fuseau des expressions cron des jobs planifiés. */
  WORKER_TZ: z.string().min(1).default("UTC"),
  /** Dossiers (séparés par des virgules) contenant `<module>/subscribers.ts` et `<module>/jobs.ts`. */
  WORKER_MODULES_DIRS: optionalString,

  WORKER_RELAY_ENABLED: boolean(true),
  WORKER_RELAY_BATCH_SIZE: int(200, 1, 1000),
  /** Balayage de tous les tenants (filet de sécurité si LISTEN/NOTIFY est indisponible ou a raté un signal). */
  WORKER_RELAY_SWEEP_INTERVAL_MS: int(5_000, 100, 600_000),
  /** Intervalle de polling quand LISTEN/NOTIFY n'est pas connecté. */
  WORKER_RELAY_POLL_INTERVAL_MS: int(500, 50, 60_000),
  WORKER_RELAY_MAX_ATTEMPTS: int(10, 1, 1000),
  WORKER_RELAY_BACKOFF_BASE_MS: int(1_000, 10, 3_600_000),
  WORKER_RELAY_BACKOFF_MAX_MS: int(300_000, 10, 86_400_000),

  WORKER_SUBSCRIBERS_ENABLED: boolean(true),
  WORKER_ROUTER_CONCURRENCY: int(20, 1, 500),
  WORKER_SCHEDULER_ENABLED: boolean(true),
  /** Retire de Redis les planifications dont le code a disparu. */
  WORKER_PRUNE_SCHEDULERS: boolean(true),

  /** Conservation des événements publiés avant purge par le job `outbox-cleanup`. */
  OUTBOX_RETENTION_DAYS: int(30, 1, 3650),
  OUTBOX_CLEANUP_BATCH_SIZE: int(1000, 10, 50_000),
  /** Fonction SQL appelée par `ensure-partitions` si elle existe (module audit). */
  AUDIT_ENSURE_PARTITIONS_FN: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/, "attendu schema.fonction")
    .default("audit.ensure_partitions"),
  AUDIT_PARTITIONS_MONTHS_AHEAD: int(3, 1, 36),
});

export type WorkerConfig = Readonly<z.infer<typeof envSchema>>;

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuration du worker invalide :\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** Valide l'environnement. Les VALEURS ne sont jamais recopiées dans le message (secrets). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => {
        const key = i.path.join(".") || "(env)";
        const missing = i.code === "invalid_type" && i.received === "undefined";
        return `${key} : ${missing ? "variable obligatoire absente" : i.message}`;
      }),
    );
  }
  const cfg = parsed.data;
  if (cfg.WORKER_RELAY_BACKOFF_MAX_MS < cfg.WORKER_RELAY_BACKOFF_BASE_MS) {
    throw new ConfigError(["WORKER_RELAY_BACKOFF_MAX_MS doit être ≥ WORKER_RELAY_BACKOFF_BASE_MS"]);
  }
  return Object.freeze(cfg);
}

/** Masque le mot de passe d'une URL pour les journaux. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<url illisible>";
  }
}
