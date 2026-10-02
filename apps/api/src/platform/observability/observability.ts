/**
 * Assemblage de l'observabilité d'un processus API (ADR-009) : configuration, traçage, registre de métriques, options
 * pino/Fastify. Aucun effet de bord réseau sans configuration.
 *
 *   const observability = createObservability("api");
 *   const app = Fastify({ ...observability.fastifyOptions });
 *   await app.register(observabilityPlugin, { observability });   // premier plugin : ses hooks s'appliquent à toutes les routes
 */
import type { FastifyServerOptions } from "fastify";
import { buildPinoOptions, newId, type PinoOptionsLike } from "@ecoledigitale/kernel";
import { loadObservabilityConfig, type EnvLike, type ObservabilityConfig, type ServiceKind } from "./core/config";
import { correlationMixin, enableAmbientRequestId } from "./core/correlation";
import { createBulkheadMetrics, type BulkheadMetrics } from "./core/bulkhead-metrics";
import { createHttpMetrics, createMetricsKit, createPoolMetrics, type HttpMetrics, type MetricsKit, type PoolMetrics } from "./core/metrics";
import { initTracing, shutdownTracing, type InitTracingOptions, type TracingHandle } from "./core/tracing";

export interface CreateObservabilityOptions {
  env?: EnvLike;
  /** Options du traçage (tests : exportateur en mémoire). */
  tracing?: InitTracingOptions;
  /** Flux d'écriture des journaux (tests : capture) ; défaut : sortie standard. */
  logStream?: { write(chunk: string): void };
  version?: string;
}

export interface Observability {
  readonly config: ObservabilityConfig;
  readonly kit: MetricsKit;
  readonly http: HttpMetrics;
  readonly pools: PoolMetrics;
  readonly bulkheads: BulkheadMetrics;
  readonly tracing: TracingHandle;
  readonly loggerOptions: PinoOptionsLike;
  /** À répartir dans `Fastify({ ... })` : journal pino commun, identifiant de requête, journal d'accès unique. */
  readonly fastifyOptions: FastifyServerOptions;
  /** Arrête le traçage (vide les spans en attente). */
  shutdown(): Promise<void>;
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,100}$/;

/**
 * Identifiant de requête : `x-request-id` valide, sinon UUID v7 généré. La valeur retenue est RÉÉCRITE dans l'en-tête
 * pour que `requestIdFrom` (plateforme v2, contexte de requête) relise exactement la même et que `RequestContext.requestId`,
 * les journaux, la colonne `kernel.domain_events.request_id` et les spans partagent un seul identifiant.
 */
export function resolveRequestId(headers: Record<string, string | string[] | undefined>): string {
  const raw = headers["x-request-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = typeof value === "string" && REQUEST_ID_RE.test(value) ? value : newId();
  headers["x-request-id"] = id;
  return id;
}

export function createObservability(service: ServiceKind, options: CreateObservabilityOptions = {}): Observability {
  const config = loadObservabilityConfig(service, options.env ?? process.env);
  const tracing = initTracing(config, options.tracing);
  enableAmbientRequestId();
  const kit = createMetricsKit(service, options.version ? { version: options.version } : {});
  const http = createHttpMetrics(kit, config.metrics);
  const pools = createPoolMetrics(kit);
  const bulkheads = createBulkheadMetrics(kit);
  const loggerOptions = buildPinoOptions({ service, level: config.logLevel, mixin: correlationMixin });
  return {
    config,
    kit,
    http,
    pools,
    bulkheads,
    tracing,
    loggerOptions,
    fastifyOptions: {
      logger: { ...loggerOptions, ...(options.logStream ? { stream: options.logStream } : {}) } as unknown as FastifyServerOptions["logger"],
      genReqId: (req) => resolveRequestId(req.headers),
      requestIdHeader: false,
      requestIdLogLabel: "request_id",
      disableRequestLogging: true,
    },
    shutdown: () => (tracing.enabled ? shutdownTracing() : Promise.resolve()),
  };
}
