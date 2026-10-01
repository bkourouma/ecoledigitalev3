/**
 * Cache COURT des `PermissionSet`, en mémoire du processus.
 *
 *  - TTL court (défaut 30 s) : borne la durée pendant laquelle, sans événement,
 *    un retrait de droit reste ignoré (autres instances de l'API incluses) ;
 *  - invalidation immédiate sur `rbac.assignment.changed` / `rbac.role.changed`
 *    (`subscribeCacheInvalidation`) et directement après commit par les use cases
 *    de CE processus ;
 *  - « single-flight » : des chargements concurrents de la même clé partagent une
 *    seule requête SQL ;
 *  - une invalidation PENDANT un chargement empêche d'enregistrer le résultat
 *    (potentiellement périmé) : la requête suivante recharge.
 *
 * L'expiration des assignations (valid_until) n'est PAS portée par le TTL : le
 * `PermissionSet` conserve les fenêtres de validité et `can()` les évalue à
 * l'instant courant.
 */
import type { Clock, DomainEvent, EventBus, Unsubscribe } from "@ecoledigitale/kernel";
import { systemClock } from "@ecoledigitale/kernel";
import { RBAC_ASSIGNMENT_CHANGED, RBAC_ROLE_CHANGED, type AssignmentChangedPayload } from "../domain/events";
import type { PermissionSet } from "../domain/permission-set";

export interface PermissionSetCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  clock?: Clock;
}

interface Entry {
  set: PermissionSet;
  expiresAt: number;
}

interface InFlight {
  promise: Promise<PermissionSet>;
}

export class PermissionSetCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly clock: Clock;
  /** tenantId -> userId -> entrée. */
  private readonly entries = new Map<string, Map<string, Entry>>();
  private readonly inflight = new Map<string, InFlight>();
  private size = 0;

  constructor(options: PermissionSetCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.clock = options.clock ?? systemClock;
    if (!(this.ttlMs >= 0)) throw new RangeError("ttlMs doit être ≥ 0.");
  }

  private static key(tenantId: string, userId: string): string {
    return `${tenantId.toLowerCase()}:${userId.toLowerCase()}`;
  }

  get(tenantId: string, userId: string): PermissionSet | undefined {
    const t = tenantId.toLowerCase();
    const u = userId.toLowerCase();
    const entry = this.entries.get(t)?.get(u);
    if (!entry) return undefined;
    if (this.clock.now().getTime() >= entry.expiresAt) {
      this.deleteEntry(t, u);
      return undefined;
    }
    return entry.set;
  }

  set(tenantId: string, userId: string, set: PermissionSet): void {
    if (this.ttlMs === 0) return;
    const t = tenantId.toLowerCase();
    const u = userId.toLowerCase();
    let byUser = this.entries.get(t);
    if (!byUser) {
      byUser = new Map();
      this.entries.set(t, byUser);
    }
    if (!byUser.has(u)) {
      if (this.size >= this.maxEntries) this.evictOne();
      this.size += 1;
    }
    byUser.set(u, { set, expiresAt: this.clock.now().getTime() + this.ttlMs });
  }

  /**
   * Retourne le set en cache, sinon le charge via `loader` (une seule exécution
   * pour des appels concurrents) et le mémorise.
   */
  async getOrLoad(tenantId: string, userId: string, loader: () => Promise<PermissionSet>): Promise<PermissionSet> {
    const hit = this.get(tenantId, userId);
    if (hit) return hit;

    const key = PermissionSetCache.key(tenantId, userId);
    const running = this.inflight.get(key);
    if (running) return running.promise;

    const flight: InFlight = { promise: undefined as unknown as Promise<PermissionSet> };
    flight.promise = (async () => {
      try {
        const loaded = await loader();
        // Une invalidation survenue pendant le chargement a retiré `flight` : ne pas mémoriser.
        if (this.inflight.get(key) === flight) this.set(tenantId, userId, loaded);
        return loaded;
      } finally {
        if (this.inflight.get(key) === flight) this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, flight);
    return flight.promise;
  }

  invalidateUser(tenantId: string, userId: string): void {
    this.deleteEntry(tenantId.toLowerCase(), userId.toLowerCase());
    this.inflight.delete(PermissionSetCache.key(tenantId, userId));
  }

  /** Un rôle a changé : tous les utilisateurs du tenant sont potentiellement touchés. */
  invalidateTenant(tenantId: string): void {
    const t = tenantId.toLowerCase();
    const byUser = this.entries.get(t);
    if (byUser) {
      this.size -= byUser.size;
      this.entries.delete(t);
    }
    const prefix = `${t}:`;
    for (const k of [...this.inflight.keys()]) if (k.startsWith(prefix)) this.inflight.delete(k);
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
    this.size = 0;
  }

  get entryCount(): number {
    return this.size;
  }

  private deleteEntry(t: string, u: string): void {
    const byUser = this.entries.get(t);
    if (byUser?.delete(u)) {
      this.size -= 1;
      if (byUser.size === 0) this.entries.delete(t);
    }
  }

  private evictOne(): void {
    // Politique simple : la plus ancienne insertion (ordre d'itération des Map).
    for (const [t, byUser] of this.entries) {
      for (const u of byUser.keys()) {
        this.deleteEntry(t, u);
        return;
      }
    }
  }
}

/**
 * Branche l'invalidation sur le bus d'événements (relais d'outbox → bus en mémoire).
 * `rbac.assignment.changed` n'invalide que l'utilisateur concerné ; `rbac.role.changed`
 * invalide le tenant entier.
 */
export function subscribeCacheInvalidation(bus: EventBus, cache: PermissionSetCache): Unsubscribe {
  const offAssignment = bus.subscribe(RBAC_ASSIGNMENT_CHANGED, (event: DomainEvent<string, unknown>) => {
    const payload = event.payload as Partial<AssignmentChangedPayload> | undefined;
    if (payload?.userId) cache.invalidateUser(event.tenantId, payload.userId);
    else cache.invalidateTenant(event.tenantId);
  });
  const offRole = bus.subscribe(RBAC_ROLE_CHANGED, (event: DomainEvent<string, unknown>) => {
    cache.invalidateTenant(event.tenantId);
  });
  return () => {
    offAssignment();
    offRole();
  };
}
