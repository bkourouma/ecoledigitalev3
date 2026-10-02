/**
 * Bulkhead par tenant devant le pool PostgreSQL (« voisin bruyant »).
 *
 * Sans lui, le pool (10 connexions) est servi en FIFO : un tenant qui lance 24 requêtes simultanées met ses
 * demandes devant celles des autres, et ses transactions bloquées sur un verrou gapless (`people.next_number`)
 * gardent leur connexion. Le bulkhead :
 *
 *  1. plafonne le nombre de transactions CONCURRENTES par tenant (`maxPerTenant`) ;
 *  2. plafonne le total (`globalMax`, = taille du pool) pour que l'attente se fasse ICI, en file par tenant, et non
 *     dans la file FIFO du pool ;
 *  3. sert les files des tenants en TOURNIQUET (un tenant à la fois, chacun son tour) dès qu'une place se libère ;
 *  4. borne l'attente (`maxWaitMs`) et la taille de la file (`maxQueuePerTenant`) : au-delà, 503 `tenant_busy`
 *     avec `Retry-After`, plutôt qu'une latence sans borne.
 *
 * Il n'altère ni la transaction, ni la RLS, ni les variables de session : il se contente de retarder (ou de
 * refuser) l'ouverture d'une transaction. Un `run` imbriqué (SAVEPOINT) ne repasse pas par ici : il réutilise la
 * place de la transaction externe, donc aucun risque d'interblocage par re-acquisition.
 *
 * Désactivable : ne pas passer de bulkhead à `TenantDb` (ou `V2_DB_TENANT_BULKHEAD=off` côté API).
 */
import { UnavailableError } from "@ecoledigitale/kernel";

export const TENANT_BUSY_CODE = "tenant_busy";

export interface BulkheadOptions {
  /** Transactions simultanées maximales pour un même tenant (≥ 1). */
  maxPerTenant: number;
  /** Transactions simultanées maximales, tous tenants confondus (≥ maxPerTenant) ; `undefined` = pas de plafond global. */
  globalMax?: number;
  /** Attente maximale d'une place, ms ; au-delà : 503 `tenant_busy`. */
  maxWaitMs: number;
  /** Demandes en attente maximales par tenant ; au-delà : 503 immédiat. */
  maxQueuePerTenant: number;
  /** Valeur de `Retry-After` suggérée, secondes. */
  retryAfterSeconds?: number;
  observer?: BulkheadObserver;
}

/** Crochets d'observation (métriques, journaux). Ne doivent jamais lever. */
export interface BulkheadObserver {
  /** Une place a été accordée après `waitedMs` d'attente (0 si immédiate). */
  acquired?(waitedMs: number): void;
  /** Une demande a été refusée. */
  rejected?(reason: "timeout" | "queue_full", tenantId: string): void;
}

export interface BulkheadStats {
  /** Transactions en cours (places occupées). */
  active: number;
  /** Demandes en attente d'une place. */
  queued: number;
  /** Tenants ayant atteint leur plafond. */
  tenantsAtCap: number;
  /** Plus grand nombre de transactions simultanées d'un seul tenant. */
  maxActiveForOneTenant: number;
}

interface Waiter {
  readonly tenantId: string;
  readonly enqueuedAt: number;
  grant: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export type BulkheadRelease = () => void;

export class TenantBulkhead {
  private readonly active = new Map<string, number>();
  private readonly queues = new Map<string, Waiter[]>();
  /** Ordre du tourniquet : tenants ayant au moins une demande en file. */
  private readonly rotation: string[] = [];
  private readonly observers: BulkheadObserver[] = [];
  private totalActive = 0;
  private totalQueued = 0;
  readonly options: Readonly<BulkheadOptions> & { readonly retryAfterSeconds: number };

  constructor(options: BulkheadOptions) {
    if (!Number.isInteger(options.maxPerTenant) || options.maxPerTenant < 1) {
      throw new TypeError("maxPerTenant doit être un entier ≥ 1.");
    }
    if (options.globalMax !== undefined && (!Number.isInteger(options.globalMax) || options.globalMax < options.maxPerTenant)) {
      throw new TypeError("globalMax doit être un entier ≥ maxPerTenant.");
    }
    if (!Number.isFinite(options.maxWaitMs) || options.maxWaitMs < 0) throw new TypeError("maxWaitMs doit être ≥ 0.");
    if (!Number.isInteger(options.maxQueuePerTenant) || options.maxQueuePerTenant < 0) {
      throw new TypeError("maxQueuePerTenant doit être un entier ≥ 0.");
    }
    this.options = Object.freeze({ retryAfterSeconds: 1, ...options });
    if (options.observer) this.observers.push(options.observer);
  }

  stats(): BulkheadStats {
    let atCap = 0;
    let max = 0;
    for (const n of this.active.values()) {
      if (n >= this.options.maxPerTenant) atCap += 1;
      if (n > max) max = n;
    }
    return { active: this.totalActive, queued: this.totalQueued, tenantsAtCap: atCap, maxActiveForOneTenant: max };
  }

  /**
   * Obtient une place pour une nouvelle transaction du tenant. Renvoie la fonction qui la libère (idempotente).
   * `tenantId` vide = transaction système sans tenant : même traitement, sous la clé `""`.
   */
  async acquire(tenantId: string): Promise<BulkheadRelease> {
    if (this.canStart(tenantId) && !this.queues.has(tenantId)) {
      this.take(tenantId);
      this.emitAcquired(0);
      return this.releaser(tenantId);
    }
    const queue = this.queues.get(tenantId);
    if ((queue?.length ?? 0) >= this.options.maxQueuePerTenant) {
      this.emitRejected("queue_full", tenantId);
      throw this.busy("queue_full");
    }
    return await new Promise<BulkheadRelease>((resolve, reject) => {
      const waiter: Waiter = {
        tenantId,
        enqueuedAt: Date.now(),
        grant: () => {
          if (waiter.timer) clearTimeout(waiter.timer);
          this.emitAcquired(Date.now() - waiter.enqueuedAt);
          resolve(this.releaser(tenantId));
        },
        timer: undefined,
      };
      waiter.timer = setTimeout(() => {
        if (!this.removeWaiter(waiter)) return;
        this.emitRejected("timeout", tenantId);
        reject(this.busy("timeout"));
      }, this.options.maxWaitMs);
      waiter.timer.unref?.();
      let q = this.queues.get(tenantId);
      if (!q) {
        q = [];
        this.queues.set(tenantId, q);
        this.rotation.push(tenantId);
      }
      q.push(waiter);
      this.totalQueued += 1;
    });
  }

  /** Ajoute un observateur (métriques) après construction. */

  observe(observer: BulkheadObserver): void {

    this.observers.push(observer);

  }


  private emitAcquired(waitedMs: number): void {

    for (const o of this.observers) {

      try {

        o.acquired?.(waitedMs);

      } catch {

        /* un observateur ne casse jamais une transaction */

      }

    }

  }


  private emitRejected(reason: "timeout" | "queue_full", tenantId: string): void {

    for (const o of this.observers) {

      try {

        o.rejected?.(reason, tenantId);

      } catch {

        /* idem */

      }

    }

  }


  private busy(reason: "timeout" | "queue_full"): UnavailableError {
    return new UnavailableError("Établissement momentanément très sollicité : réessayez dans un instant.", {
      code: TENANT_BUSY_CODE,
      details: { retryAfterSeconds: this.options.retryAfterSeconds, reason },
    });
  }

  private canStart(tenantId: string): boolean {
    if ((this.active.get(tenantId) ?? 0) >= this.options.maxPerTenant) return false;
    if (this.options.globalMax !== undefined && this.totalActive >= this.options.globalMax) return false;
    return true;
  }

  private take(tenantId: string): void {
    this.active.set(tenantId, (this.active.get(tenantId) ?? 0) + 1);
    this.totalActive += 1;
  }

  private releaser(tenantId: string): BulkheadRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.active.get(tenantId) ?? 1) - 1;
      if (n <= 0) this.active.delete(tenantId);
      else this.active.set(tenantId, n);
      this.totalActive -= 1;
      this.dispatch();
    };
  }

  private removeWaiter(waiter: Waiter): boolean {
    const q = this.queues.get(waiter.tenantId);
    if (!q) return false;
    const i = q.indexOf(waiter);
    if (i < 0) return false;
    q.splice(i, 1);
    this.totalQueued -= 1;
    if (q.length === 0) this.dropQueue(waiter.tenantId);
    return true;
  }

  private dropQueue(tenantId: string): void {
    this.queues.delete(tenantId);
    const r = this.rotation.indexOf(tenantId);
    if (r >= 0) this.rotation.splice(r, 1);
  }

  /** Accorde les places libres en tourniquet entre les tenants en attente (un par tour). */
  private dispatch(): void {
    let scanned = 0;
    while (this.rotation.length > 0 && scanned < this.rotation.length) {
      if (this.options.globalMax !== undefined && this.totalActive >= this.options.globalMax) return;
      const tenantId = this.rotation[0]!;
      const q = this.queues.get(tenantId);
      if (!q || q.length === 0) {
        this.dropQueue(tenantId);
        scanned = 0;
        continue;
      }
      if ((this.active.get(tenantId) ?? 0) >= this.options.maxPerTenant) {
        // Ce tenant est au plafond : on passe au suivant sans le perdre.
        this.rotation.push(this.rotation.shift()!);
        scanned += 1;
        continue;
      }
      const waiter = q.shift()!;
      this.totalQueued -= 1;
      this.take(tenantId);
      this.rotation.shift();
      if (q.length === 0) this.queues.delete(tenantId);
      else this.rotation.push(tenantId);
      scanned = 0;
      waiter.grant();
    }
  }
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Configuration par variables d'environnement. Retourne `undefined` si le bulkhead est désactivé.
 *
 *  - `V2_DB_TENANT_BULKHEAD`          : `off`/`false`/`0` désactive (défaut : actif) ;
 *  - `V2_DB_TENANT_MAX_CONCURRENCY`   : transactions simultanées par tenant (défaut : la moitié du pool, ≥ 1) ;
 *  - `V2_DB_TENANT_MAX_WAIT_MS`       : attente maximale d'une place (défaut 8000, sous le délai d'instruction de 15 s) ;
 *  - `V2_DB_TENANT_MAX_QUEUE`         : demandes en attente par tenant (défaut 200) ;
 *  - `V2_DB_TENANT_RETRY_AFTER_S`     : valeur de `Retry-After` (défaut 2).
 *
 * Le plafond total est la taille du pool : les attentes se font dans les files par tenant, en tourniquet.
 */
export function bulkheadOptionsFromEnv(poolMax: number, env: NodeJS.ProcessEnv = process.env): BulkheadOptions | undefined {
  const flag = (env.V2_DB_TENANT_BULKHEAD ?? "on").trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0" || flag === "disabled") return undefined;
  const pool = Math.max(1, Math.trunc(poolMax));
  const perTenant = Math.min(pool, intEnv(env, "V2_DB_TENANT_MAX_CONCURRENCY", Math.max(1, Math.floor(pool / 2)), 1));
  return {
    maxPerTenant: perTenant,
    globalMax: pool,
    maxWaitMs: intEnv(env, "V2_DB_TENANT_MAX_WAIT_MS", 8_000, 0),
    maxQueuePerTenant: intEnv(env, "V2_DB_TENANT_MAX_QUEUE", 200, 0),
    retryAfterSeconds: intEnv(env, "V2_DB_TENANT_RETRY_AFTER_S", 2, 1),
  };
}
