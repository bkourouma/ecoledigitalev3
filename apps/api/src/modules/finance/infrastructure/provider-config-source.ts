/**
 * Sources de configuration des fournisseurs pour le `ProviderRegistry`.
 *
 *  - `TenantProviderConfigSource` : lit `finance.provider_configs` du tenant demandé (RLS), ouvre les secrets au
 *    moment de l'usage. Cache mémoire COURT (15 s par défaut) : l'ouverture des secrets est AUDITÉE
 *    (`finance.provider_secret.accessed`, une entrée par remplissage du cache, jamais une valeur) ; invalidé par les
 *    écritures d'administration du processus. Une désactivation faite par un autre processus s'applique au plus tard
 *    à l'expiration du cache.
 *  - `CompositeConfigSource` : configuration du tenant d'abord ; la configuration d'ENVIRONNEMENT ne sert de repli que
 *    si on l'autorise (déploiement mono-établissement, développement) — jamais par défaut en production : l'argent d'un
 *    établissement ne doit pas arriver sur le compte marchand de la plateforme.
 */
import { createSystemContext, noopLogger, systemClock, type Clock, type Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { AuditPort } from "../application/ports/audit";
import { SecretStoreError, type SecretStorePort } from "../application/ports/secret-store";
import { getProviderConfig } from "./provider-config-repository";
import type { ProviderConfigSource, ProviderSettings } from "./providers/registry";

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
    if (this.options.alwaysEnv?.includes(provider)) return this.envSource.get(tenantId, provider);
    const own = await this.tenantSource.get(tenantId, provider);
    if (own) return own;
    return this.options.allowEnvFallback ? this.envSource.get(tenantId, provider) : null;
  }
}
