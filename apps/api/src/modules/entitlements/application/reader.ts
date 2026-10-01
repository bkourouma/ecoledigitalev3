/**
 * Port `EntitlementsReader` et ses implémentations.
 *
 *   PgEntitlementsReader      calcule à chaque appel (vérité en base) ;
 *   CachedEntitlementsReader  cache COURT par tenant, invalidé par événement.
 *
 * Invalidation :
 *  - immédiate, dans le process, par les use cases de ce module (`CacheInvalidator`) ;
 *  - par événement (`handleEvent` / `bindToBus`) : `entitlements.subscription.changed`,
 *    `entitlements.override.changed`, `tenancy.tenant.status_changed`,
 *    `tenancy.tenant.provisioned` — c'est ce qui couvre les AUTRES instances de l'API ;
 *  - par le temps : TTL (30 s par défaut) ET `validUntil` du résultat (fin d'abonnement,
 *    expiration d'une surcharge) : un droit expiré n'est jamais servi après son échéance.
 */
import { createSystemContext, systemClock, type Clock, type EventBus, type Unsubscribe } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { INVALIDATING_EVENT_TYPES } from "../domain/events";
import { hasFeature as hasFeatureIn, type EffectiveEntitlements } from "../domain/resolve";
import { resolveEntitlements } from "./resolve-entitlements";
import type { CacheInvalidator } from "./support";

export interface EntitlementsReader {
  /** Droits effectifs du tenant. Lève `NotFoundError` si le tenant n'existe pas. */
  getEntitlements(tenantId: string): Promise<EffectiveEntitlements>;
  hasFeature(tenantId: string, featureKey: string): Promise<boolean>;
}

export class PgEntitlementsReader implements EntitlementsReader {
  constructor(
    private readonly db: TenantDb,
    private readonly clock: Clock = systemClock,
  ) {}

  getEntitlements(tenantId: string): Promise<EffectiveEntitlements> {
    return this.db.run(createSystemContext(tenantId), (tx) => resolveEntitlements(tx, tenantId, this.clock), {
      readOnly: true,
    });
  }

  async hasFeature(tenantId: string, featureKey: string): Promise<boolean> {
    return hasFeatureIn(await this.getEntitlements(tenantId), featureKey);
  }
}

export interface CachedReaderOptions {
  /** Durée de vie maximale d'une entrée (défaut 30 000 ms). */
  ttlMs?: number;
  /** Nombre maximal de tenants en cache (défaut 5 000) ; le plus ancien est évincé. */
  maxEntries?: number;
  clock?: Clock;
}

interface Entry {
  value: EffectiveEntitlements;
  expiresAtMs: number;
}

export class CachedEntitlementsReader implements EntitlementsReader, CacheInvalidator {
  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<EffectiveEntitlements>>();
  /** Incrémenté à chaque invalidation : un calcul démarré AVANT ne doit pas repeupler le cache APRÈS. */
  private readonly versions = new Map<string, number>();
  private globalVersion = 0;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly clock: Clock;

  constructor(
    private readonly inner: EntitlementsReader,
    options: CachedReaderOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 5_000;
    this.clock = options.clock ?? systemClock;
  }

  private versionOf(tenantId: string): string {
    return `${this.globalVersion}:${this.versions.get(tenantId) ?? 0}`;
  }

  async getEntitlements(tenantId: string): Promise<EffectiveEntitlements> {
    const nowMs = this.clock.now().getTime();
    const hit = this.entries.get(tenantId);
    if (hit && hit.expiresAtMs > nowMs) return hit.value;
    if (hit) this.entries.delete(tenantId);

    const pending = this.inflight.get(tenantId);
    if (pending) return pending;

    const versionAtStart = this.versionOf(tenantId);
    const load = this.inner
      .getEntitlements(tenantId)
      .then((value) => {
        // Invalidé pendant le calcul : on rend la valeur (cohérente à l'instant du calcul) mais on ne la met pas en cache.
        if (this.versionOf(tenantId) === versionAtStart && this.ttlMs > 0) {
          let expiresAtMs = nowMs + this.ttlMs;
          if (value.validUntil) expiresAtMs = Math.min(expiresAtMs, value.validUntil.getTime());
          if (expiresAtMs > nowMs) this.store(tenantId, { value, expiresAtMs });
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(tenantId) === load) this.inflight.delete(tenantId);
      });
    this.inflight.set(tenantId, load);
    return load;
  }

  async hasFeature(tenantId: string, featureKey: string): Promise<boolean> {
    return hasFeatureIn(await this.getEntitlements(tenantId), featureKey);
  }

  private store(tenantId: string, entry: Entry): void {
    this.entries.delete(tenantId);
    this.entries.set(tenantId, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
    this.inflight.delete(tenantId);
    this.versions.set(tenantId, (this.versions.get(tenantId) ?? 0) + 1);
  }

  invalidateAll(): void {
    this.entries.clear();
    this.inflight.clear();
    this.versions.clear();
    this.globalVersion += 1;
  }

  /** Réaction à un événement de domaine (relayé par l'outbox/le worker, ou par le bus en mémoire). */
  handleEvent(event: { type: string; tenantId: string }): boolean {
    if (!INVALIDATING_EVENT_TYPES.has(event.type)) return false;
    this.invalidate(event.tenantId);
    return true;
  }

  /** Abonne le cache à un bus d'événements ; renvoie la fonction de désabonnement. */
  bindToBus(bus: EventBus): Unsubscribe {
    return bus.subscribeAll((event) => {
      this.handleEvent(event);
    });
  }

  /** Nombre d'entrées (tests, métriques). */
  get size(): number {
    return this.entries.size;
  }
}
