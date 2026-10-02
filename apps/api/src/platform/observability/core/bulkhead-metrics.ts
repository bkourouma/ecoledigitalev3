/**
 * Métriques du bulkhead par tenant (équité du pool PostgreSQL, `@ecoledigitale/database`).
 *
 * Aucune étiquette `tenant_id` (cardinalité, voir `metrics.ts`) : les jauges disent si UN tenant sature (`tenants_at_cap`,
 * `max_one_tenant`), les journaux (`tenant_busy`) disent lequel.
 */
import { Counter, Gauge, Histogram, type MetricsKit } from "./metrics";

/** Forme minimale de `TenantBulkhead`. */
export interface BulkheadLike {
  stats(): { active: number; queued: number; tenantsAtCap: number; maxActiveForOneTenant: number };
  observe(observer: {
    acquired?(waitedMs: number): void;
    rejected?(reason: "timeout" | "queue_full", tenantId: string): void;
  }): void;
}

export interface BulkheadMetrics {
  /** Suit un bulkhead : jauges lues au scrape, attente et refus comptés au fil de l'eau. */
  track(name: string, bulkhead: BulkheadLike): void;
}

export function createBulkheadMetrics(kit: MetricsKit): BulkheadMetrics {
  const registers = [kit.registry];
  const tracked = new Map<string, BulkheadLike>();
  new Gauge({
    name: "ed_db_tenant_bulkhead",
    help: "Bulkhead par tenant : transactions en cours (active), en attente (queued), tenants au plafond (tenants_at_cap), maximum d'un seul tenant (max_one_tenant).",
    labelNames: ["pool", "state"],
    registers,
    collect() {
      this.reset();
      for (const [name, b] of tracked) {
        const s = b.stats();
        this.set({ pool: name, state: "active" }, s.active);
        this.set({ pool: name, state: "queued" }, s.queued);
        this.set({ pool: name, state: "tenants_at_cap" }, s.tenantsAtCap);
        this.set({ pool: name, state: "max_one_tenant" }, s.maxActiveForOneTenant);
      }
    },
  });
  const wait = new Histogram({
    name: "ed_db_tenant_bulkhead_wait_seconds",
    help: "Attente d'une place du bulkhead avant d'ouvrir une transaction (0 quand elle est immédiate).",
    labelNames: ["pool"],
    buckets: [0.001, 0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers,
  });
  const rejected = new Counter({
    name: "ed_db_tenant_bulkhead_rejected_total",
    help: "Transactions refusées par le bulkhead (503 tenant_busy), par motif : timeout (attente maximale) ou queue_full (file pleine).",
    labelNames: ["pool", "reason"],
    registers,
  });
  return {
    track(name, bulkhead) {
      if (tracked.get(name) === bulkhead) return;
      tracked.set(name, bulkhead);
      bulkhead.observe({
        acquired: (ms) => wait.observe({ pool: name }, ms / 1000),
        rejected: (reason) => rejected.inc({ pool: name, reason }),
      });
    },
  };
}
