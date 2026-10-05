/**
 * Assemblage PARTAGÉ de l'exécution de finance : registre des fournisseurs de paiement, coffre des secrets, source de
 * configuration par tenant. Utilisé À L'IDENTIQUE par l'API (`http/plugin.ts`) et par le worker (`jobs.ts` : rapprochement
 * des paiements en attente) — un seul endroit où se décide qui peut parler à quel fournisseur avec quels identifiants.
 *
 * Variables (voir README et `docs/architecture/platform-assembly.md`) : `FINANCE_ENV`, `FINANCE_SECRETS_KEYS`,
 * `FINANCE_SECRETS_ACTIVE_KEY`, `FINANCE_PROVIDER_ENV_FALLBACK`, `FINANCE_PROVIDER_CONFIG_CACHE_MS`,
 * `FINANCE_PROVIDER_<NOM>_[SANDBOX_]BASE_URL`, `FINANCE_RECONCILIATION_*`.
 */
import type { Clock, Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { ReconciliationConfig } from "../application/deps";
import type { AuditPort } from "../application/ports/audit";
import type { SecretStorePort } from "../application/ports/secret-store";
import { CompositeConfigSource, TenantProviderConfigSource } from "./provider-config-source";
import { endpointsFromEnv, registerPaymentProviders } from "./providers/definitions";
import { createProviderRegistry, EnvProviderConfigSource, isDevLikeEnvironment, type AppEnvironment, type ProviderRegistry } from "./providers/registry";
import { SANDBOX_PROVIDER_NAME } from "./providers/sandbox-provider";
import { secretStoreFromEnv } from "./secrets/aes-gcm-secret-store";

type Env = Readonly<Record<string, string | undefined>>;

/** Environnement d'exécution des fournisseurs de paiement : `FINANCE_ENV`, sinon dérivé de `NODE_ENV` (défaut SÛR : production). */
export function financeEnvironmentOf(env: Env): AppEnvironment {
  const raw = (env.FINANCE_ENV ?? env.NODE_ENV ?? "").trim().toLowerCase();
  return raw === "development" || raw === "test" || raw === "staging" || raw === "production" ? raw : "production";
}

/** `FINANCE_PROVIDER_CONFIG_CACHE_MS` : durée du cache de configuration des fournisseurs (0 à 300 000 ms ; sinon défaut 15 000). */
export function configCacheMsOf(env: Env): { ttlMs?: number } {
  const n = Number(env.FINANCE_PROVIDER_CONFIG_CACHE_MS);
  return env.FINANCE_PROVIDER_CONFIG_CACHE_MS !== undefined && Number.isInteger(n) && n >= 0 && n <= 300_000 ? { ttlMs: n } : {};
}

function intIn(env: Env, name: string, min: number, max: number): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/**
 * Réglages du rapprochement lus dans l'environnement (valeur invalide ou absente : défaut du module) :
 * `FINANCE_RECONCILIATION_MIN_AGE_MS` (60 s – 7 j), `_MAX_ATTEMPTS` (1 – 100), `_BACKOFF_BASE_MS` (1 s – 24 h),
 * `_BACKOFF_MAX_MS` (1 s – 7 j), `_LEASE_MS` (10 s – 6 h), `_BATCH_SIZE` (1 – 500).
 */
export function reconciliationConfigFromEnv(env: Env): Partial<ReconciliationConfig> {
  const out: Partial<ReconciliationConfig> = {};
  const set = <K extends keyof ReconciliationConfig>(key: K, value: number | undefined): void => {
    if (value !== undefined) out[key] = value as ReconciliationConfig[K];
  };
  set("minAgeMs", intIn(env, "FINANCE_RECONCILIATION_MIN_AGE_MS", 60_000, 7 * 86_400_000));
  set("maxAttempts", intIn(env, "FINANCE_RECONCILIATION_MAX_ATTEMPTS", 1, 100));
  set("backoffBaseMs", intIn(env, "FINANCE_RECONCILIATION_BACKOFF_BASE_MS", 1_000, 86_400_000));
  set("backoffMaxMs", intIn(env, "FINANCE_RECONCILIATION_BACKOFF_MAX_MS", 1_000, 7 * 86_400_000));
  set("leaseMs", intIn(env, "FINANCE_RECONCILIATION_LEASE_MS", 10_000, 6 * 3_600_000));
  set("batchSize", intIn(env, "FINANCE_RECONCILIATION_BATCH_SIZE", 1, 500));
  return out;
}

export interface FinanceProviderRuntimeInput {
  readonly db: TenantDb;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly env: Env;
  readonly audit: AuditPort;
}

export interface FinanceProviderRuntime {
  readonly environment: AppEnvironment;
  readonly secrets: SecretStorePort;
  readonly providers: ProviderRegistry;
  readonly tenantConfig: TenantProviderConfigSource;
}

/** Registre + coffre + configuration par tenant. Le coffre sans clé maître est « indisponible » (jamais de secret en clair). */
export function createFinanceProviderRuntime(input: FinanceProviderRuntimeInput): FinanceProviderRuntime {
  const { env } = input;
  const environment = financeEnvironmentOf(env);
  const secrets = secretStoreFromEnv(env, (message) => input.logger.error({ message }, "finance : coffre des secrets invalide"));
  const tenantConfig = new TenantProviderConfigSource({
    db: input.db,
    secrets,
    audit: input.audit,
    clock: input.clock,
    logger: input.logger,
    ...configCacheMsOf(env),
  });
  // Compte PLATEFORME (configuration d'ENVIRONNEMENT) : repli d'un établissement sans configuration propre (Q-PAY-30,
  // décision du 2026-10-05). Actif par défaut ; `FINANCE_PROVIDER_ENV_FALLBACK=false` le coupe. Sans réglages d'environnement
  // pour le fournisseur, le repli ne produit rien (`finance.provider_not_configured`). La sandbox interne reste pilotée par
  // l'environnement (`allowSandbox` d'un tenant de démonstration).
  const envFallback = env.FINANCE_PROVIDER_ENV_FALLBACK?.trim().toLowerCase() !== "false";
  const providers = createProviderRegistry({
    environment,
    logger: input.logger,
    configSource: new CompositeConfigSource(tenantConfig, new EnvProviderConfigSource(env), {
      allowEnvFallback: envFallback,
      alwaysEnv: [SANDBOX_PROVIDER_NAME],
    }),
  });
  registerPaymentProviders(providers, {
    clock: input.clock,
    logger: input.logger,
    endpoints: endpointsFromEnv(env),
    allowInsecureHttp: isDevLikeEnvironment(environment),
  });
  return { environment, secrets, providers, tenantConfig };
}
