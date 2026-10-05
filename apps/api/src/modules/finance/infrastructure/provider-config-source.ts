/**
 * Sources de configuration des fournisseurs pour le `ProviderRegistry`.
 *
 *  - `TenantProviderConfigSource` : lit `finance.provider_configs` du tenant demandé (RLS), ouvre les secrets au
 *    moment de l'usage. Cache mémoire COURT (15 s par défaut) : l'ouverture des secrets est AUDITÉE
 *    (`finance.provider_secret.accessed`, une entrée par remplissage du cache, jamais une valeur) ; invalidé par les
 *    écritures d'administration du processus. Une désactivation faite par un autre processus s'applique au plus tard
 *    à l'expiration du cache.
 *  - `CompositeConfigSource` : compte de l'ÉTABLISSEMENT d'abord ; en son absence (aucune ligne de configuration pour
 *    ce fournisseur), repli sur le compte de la PLATEFORME (configuration d'environnement) — Q-PAY-30. Une ligne
 *    existante mais DÉSACTIVÉE n'ouvre pas le repli : l'établissement a choisi de ne pas proposer ce fournisseur.
 *    Le repli se coupe par `allowEnvFallback: false` (`FINANCE_PROVIDER_ENV_FALLBACK=false`). Chaque lecture dit de quel
 *    compte elle vient (`getAccount`) : le paiement garde la trace du compte qui a reçu l'argent.
 */
import { createSystemContext, noopLogger, systemClock, type Clock, type Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { AuditPort } from "../application/ports/audit";
import { SecretStoreError, type SecretStorePort } from "../application/ports/secret-store";
import { getProviderConfig } from "./provider-config-repository";
import type { AccountedSettings, ProviderAccount, ProviderConfigSource, ProviderSettings } from "./providers/registry";

export interface TenantProviderConfigSourceOptions {
  readonly db: TenantDb;
  readonly secrets: SecretStorePort;
  readonly audit: AuditPort;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly ttlMs?: number;
}

interface CacheEntry {
  readonly at: number;
  readonly value: ProviderSettings | null;
}

export const DEFAULT_CONFIG_CACHE_MS = 15_000;

export class TenantProviderConfigSource implements ProviderConfigSource {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly ttlMs: number;

  constructor(private readonly options: TenantProviderConfigSourceOptions) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.ttlMs = options.ttlMs ?? DEFAULT_CONFIG_CACHE_MS;
  }

  invalidate(tenantId: string, provider?: string): void {
    if (provider) this.cache.delete(`${tenantId}|${provider}`);
    else for (const k of [...this.cache.keys()]) if (k.startsWith(`${tenantId}|`)) this.cache.delete(k);
  }

  async get(tenantId: string, provider: string): Promise<ProviderSettings | null> {
    const key = `${tenantId}|${provider}`;
    const now = this.clock.now().getTime();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = await this.load(tenantId, provider);
    this.cache.set(key, { at: now, value });
    return value;
  }

  private async load(tenantId: string, provider: string): Promise<ProviderSettings | null> {
    const ctx = createSystemContext(tenantId);
    const { secrets, audit } = this.options;
    return this.options.db.run(ctx, async (tx) => {
      const row = await getProviderConfig(tx, provider);
      if (!row) return null;
      // Désactivé : rien n'est déchiffré.
      if (!row.enabled) return { enabled: "false", mode: row.mode };
      const out: Record<string, string> = { ...row.settings, mode: row.mode, enabled: "true" };
      const fields = Object.keys(row.secrets);
      const opened: string[] = [];
      for (const field of fields) {
        try {
          out[field] = await secrets.open({ tenantId, provider, field }, row.secrets[field] as string);
          opened.push(field);
        } catch (e) {
          // Illisible (clé retirée, enveloppe altérée, coffre indisponible) : le champ manque, le registre refusera.
          this.logger.error(
            { tenantId, provider, field, reason: e instanceof SecretStoreError ? e.reason : "unknown" },
            "fournisseur de paiement : secret illisible",
          );
        }
      }
      if (opened.length > 0) {
        await audit.record(tx, ctx, {
          action: "finance.provider_secret.accessed",
          resourceType: "provider_config",
          resourceId: row.id,
          sensitive: true,
          metadata: { provider, fields: opened, purpose: "resolve" },
        });
      }
      return out;
    });
  }
}

export interface CompositeConfigSourceOptions {
  /** Autorise le repli sur la configuration d'environnement (partagée par tous les tenants). */
  readonly allowEnvFallback: boolean;
  /** Fournisseurs toujours lus dans l'environnement (ex. `sandbox` : `allowSandbox` d'un tenant de démonstration). */
  readonly alwaysEnv?: readonly string[];
}

export class CompositeConfigSource implements ProviderConfigSource {
  constructor(
    private readonly tenantSource: ProviderConfigSource,
    private readonly envSource: ProviderConfigSource,
    private readonly options: CompositeConfigSourceOptions,
  ) {}

  async get(tenantId: string, provider: string): Promise<ProviderSettings | null> {
    return (await this.getAccount(tenantId, provider))?.settings ?? null;
  }

  async getAccount(tenantId: string, provider: string, wanted?: ProviderAccount): Promise<AccountedSettings | null> {
    if (this.options.alwaysEnv?.includes(provider)) {
      const settings = await this.envSource.get(tenantId, provider);
      return settings ? { account: "PLATFORM", settings } : null;
    }
    if (wanted === "TENANT") {
      const own = await this.tenantSource.get(tenantId, provider);
      return own ? { account: "TENANT", settings: own } : null;
    }
    if (wanted === "PLATFORM") {
      // Paiement déjà initié sur le compte plateforme : on l'interroge LÀ, même si l'établissement a configuré le sien
      // depuis (l'argent est parti vers le compte plateforme).
      const platform = await this.envSource.get(tenantId, provider);
      return platform ? { account: "PLATFORM", settings: platform } : null;
    }
    const own = await this.tenantSource.get(tenantId, provider);
    if (own) return { account: "TENANT", settings: own };
    if (!this.options.allowEnvFallback) return null;
    const platform = await this.envSource.get(tenantId, provider);
    return platform ? { account: "PLATFORM", settings: platform } : null;
  }

  async platformSettings(provider: string): Promise<ProviderSettings | null> {
    if (!this.options.allowEnvFallback) return null;
    return this.envSource.get("", provider);
  }
}
