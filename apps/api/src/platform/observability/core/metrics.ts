/**
 * Métriques Prometheus (prom-client) : registre par processus, séries communes et séries HTTP de l'API (ADR-009).
 *
 * CARDINALITÉ. Une série = une combinaison de valeurs d'étiquettes. Les étiquettes utilisées ici forment des ensembles
 * finis, connus au démarrage : `module` (≈ 25), `route` (motif Fastify, jamais l'URL), `method`, `status_class`, `queue`,
 * `subscriber`, `job`. `tenant_id` n'est PAS une étiquette des séries à fort volume (ordre de grandeur : 10² tenants ×
 * 10³ routes × 10 buckets > 10⁶ séries pour un seul histogramme) : l'analyse par tenant se fait dans les journaux et les
 * traces. Option bornée : `METRICS_TENANT_LABEL_MAX` active un compteur unique plafonné (`CardinalityGuard`).
 */
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from "prom-client";
import type { MetricsConfig, ServiceKind } from "./config";

export { Counter, Gauge, Histogram, Registry };

export const OVERFLOW_LABEL = "__other__";
export const UNMATCHED_ROUTE = "__unmatched__";

/** Limite le nombre de valeurs distinctes d'une étiquette : au-delà, tout est agrégé sous `__other__`. */
export class CardinalityGuard {
  private readonly seen = new Set<string>();
  private overflowed = 0;

  constructor(
    private readonly limit: number,
    private readonly overflow: string = OVERFLOW_LABEL,
  ) {}

  resolve(value: string): string {
    if (this.seen.has(value)) return value;
    if (this.seen.size >= this.limit) {
      this.overflowed += 1;
      return this.overflow;
    }
    this.seen.add(value);
    return value;
  }

  get size(): number {
    return this.seen.size;
  }

  /** Nombre d'observations repliées sur `__other__` (signal de plafond atteint). */
  get overflowCount(): number {
    return this.overflowed;
  }
}

export const HTTP_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
export const JOB_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
export const LAG_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300, 900, 3600];

export interface MetricsKit {
  readonly registry: Registry;
  readonly service: ServiceKind;
}

/** Registre dédié (jamais le registre global : plusieurs instances coexistent dans les tests) + métriques de processus. */
export function createMetricsKit(service: ServiceKind, options: { version?: string; defaultMetrics?: boolean } = {}): MetricsKit {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  if (options.defaultMetrics !== false) collectDefaultMetrics({ register: registry });
  new Gauge({
    name: "ed_build_info",
    help: "Version du service (valeur constante 1).",
    labelNames: ["version"],
    registers: [registry],
  }).set({ version: options.version ?? process.env.npm_package_version ?? "0.0.0" }, 1);
  return { registry, service };
}

/** `2xx`, `3xx`… (jamais le code exact : borne la cardinalité). */
export function statusClass(status: number): string {
  if (!Number.isInteger(status) || status < 100 || status > 599) return "unknown";
  return `${Math.floor(status / 100)}xx`;
}

export interface HttpObservation {
  module: string;
  method: string;
  route: string;
  status: number;
  durationSeconds: number;
  tenantId?: string | undefined;
}

export interface HttpMetrics {
  readonly routes: CardinalityGuard;
  inFlight(delta: 1 | -1): void;
  observe(o: HttpObservation): void;
}

const KNOWN_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function createHttpMetrics(kit: MetricsKit, config: Pick<MetricsConfig, "routeLabelLimit" | "tenantLabelMax">): HttpMetrics {
  const registers = [kit.registry];
  const requests = new Counter({
    name: "ed_http_requests_total",
    help: "Requêtes HTTP terminées, par module, méthode, motif de route et classe de statut.",
    labelNames: ["module", "method", "route", "status_class"],
    registers,
  });
  const duration = new Histogram({
    name: "ed_http_request_duration_seconds",
    help: "Durée des requêtes HTTP, par module, méthode et motif de route.",
    labelNames: ["module", "method", "route"],
    buckets: HTTP_BUCKETS,
    registers,
  });
  const inflight = new Gauge({ name: "ed_http_requests_in_flight", help: "Requêtes HTTP en cours de traitement.", registers });
  const routes = new CardinalityGuard(config.routeLabelLimit);
  let tenantRequests: Counter<"tenant_id"> | undefined;
  const tenants = config.tenantLabelMax > 0 ? new CardinalityGuard(config.tenantLabelMax, "other") : undefined;
  if (tenants) {
    tenantRequests = new Counter({
      name: "ed_tenant_http_requests_total",
      help: `Requêtes par tenant, limitées aux ${config.tenantLabelMax} premiers tenants vus (les autres : « other »).`,
      labelNames: ["tenant_id"],
      registers,
    });
  }
  return {
    routes,
    inFlight: (delta) => (delta === 1 ? inflight.inc() : inflight.dec()),
    observe(o) {
      const method = KNOWN_METHODS.has(o.method) ? o.method : "OTHER";
      const route = o.route === UNMATCHED_ROUTE ? UNMATCHED_ROUTE : routes.resolve(o.route);
      requests.inc({ module: o.module, method, route, status_class: statusClass(o.status) });
      duration.observe({ module: o.module, method, route }, o.durationSeconds);
      if (tenantRequests && tenants && o.tenantId) tenantRequests.inc({ tenant_id: tenants.resolve(o.tenantId) });
    },
  };
}

// ---------------------------------------------------------------------------
// Pools PostgreSQL
// ---------------------------------------------------------------------------

/** Forme minimale d'un `pg.Pool` (compteurs publics et `connect`). */
export interface PoolLike {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly options?: { max?: number };
  connect: (...args: any[]) => any;
}

export interface PoolMetrics {
  /** Suit un pool : jauges lues au scrape + durée d'acquisition d'une connexion mesurée en enveloppant `connect()`. */
  track(name: string, pool: PoolLike): void;
}

export function createPoolMetrics(kit: MetricsKit): PoolMetrics {
  const pools = new Map<string, PoolLike>();
  const registers = [kit.registry];
  new Gauge({
    name: "ed_pg_pool_connections",
    help: "Connexions du pool PostgreSQL par état : total, idle (inactives), waiting (requêtes en attente d'une connexion), max.",
    labelNames: ["pool", "state"],
    registers,
    collect() {
      this.reset();
      for (const [name, pool] of pools) {
        this.set({ pool: name, state: "total" }, pool.totalCount);
        this.set({ pool: name, state: "idle" }, pool.idleCount);
        this.set({ pool: name, state: "waiting" }, pool.waitingCount);
        this.set({ pool: name, state: "max" }, pool.options?.max ?? 0);
      }
    },
  });
  new Gauge({
    name: "ed_pg_pool_utilization_ratio",
    help: "Part du pool utilisée (connexions occupées / maximum).",
    labelNames: ["pool"],
    registers,
    collect() {
      this.reset();
      for (const [name, pool] of pools) {
        const max = pool.options?.max ?? 0;
        if (max > 0) this.set({ pool: name }, Math.min(1, (pool.totalCount - pool.idleCount) / max));
      }
    },
  });
  const acquire = new Histogram({
    name: "ed_pg_pool_acquire_seconds",
    help: "Délai d'obtention d'une connexion du pool (inclut l'attente quand le pool est saturé).",
    labelNames: ["pool"],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers,
  });
  const wrapped = new WeakSet<object>();
  return {
    track(name, pool) {
      pools.set(name, pool);
      if (wrapped.has(pool)) return;
      wrapped.add(pool);
      const original = pool.connect.bind(pool) as (...args: any[]) => any;
      pool.connect = (...args: any[]) => {
        if (args.length > 0 && typeof args[args.length - 1] === "function") return original(...args); // forme à rappel : non mesurée
        const start = process.hrtime.bigint();
        const result = original(...args) as Promise<unknown>;
        const done = () => acquire.observe({ pool: name }, Number(process.hrtime.bigint() - start) / 1e9);
        result.then(done, done);
        return result;
      };
    },
  };
}
