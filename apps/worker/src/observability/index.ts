/**
 * Observabilité du worker (ADR-009) : corrélation des journaux, spans (relais, routeur, abonnés, jobs planifiés), métriques
 * Prometheus, battement de cœur et jauges métier. Tout est OPTIONNEL côté appelant (`observability` absent = comportement
 * d'avant) et sans effet réseau sans configuration.
 *
 * Corrélation requête -> événement -> job : le relais transmet `request_id` (colonne d'outbox) et `traceparent` (colonne 0604)
 * dans les données du job BullMQ ; le routeur et l'abonné en font le parent de leurs spans et reposent `request_id` sur leurs
 * lignes de journal. Les spans « consommateur » sont des enfants du span HTTP d'origine : UNE trace par requête.
 */
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { DomainEvent } from "@ecoledigitale/kernel";
import type { SystemDb } from "@ecoledigitale/database";
import {
  ObservabilityConfigError,
  loadObservabilityConfig,
  type EnvLike,
  type ObservabilityConfig,
} from "../../../api/src/platform/observability/core/config";
import { enableAmbientRequestId, runWithCorrelation } from "../../../api/src/platform/observability/core/correlation";
import { createMetricsKit, type MetricsKit } from "../../../api/src/platform/observability/core/metrics";
import {
  SpanKind,
  contextFromTraceparent,
  currentTraceparent,
  identityAttributes,
  initTracing,
  recordSafeException,
  tracer,
  type InitTracingOptions,
  type TracingHandle,
} from "../../../api/src/platform/observability/core/tracing";
import { context, trace } from "@opentelemetry/api";
import type { Logger } from "../logger";
import { BusinessGauges } from "./business-gauges";
import { startHeartbeat, type Heartbeat } from "./heartbeat";
import {
  createWorkerMetrics,
  type PendingEntry,
  type QueueSnapshot,
  type ScheduledOutcome,
  type SubscriberOutcome,
  type WorkerMetrics,
} from "./metrics";
import { CachedValue, snapshotQueue } from "./queue-stats";

export { ObservabilityConfigError };
export type { SubscriberOutcome, ScheduledOutcome };

/** Contexte de trace transporté dans les données d'un job BullMQ, à côté de `event`. */
export interface JobTrace {
  traceparent?: string;
}

export const LAST_SUCCESS_FIELD_PREFIX = "job-last-success";

/** Module d'un abonné ou d'un job : préfixe de son nom (`finance.send-receipt` -> `finance`), `worker` pour le socle. */
export function moduleOfName(name: string): string {
  const dot = name.indexOf(".");
  return dot > 0 ? name.slice(0, dot) : "worker";
}

const RENDER_RE = /render/i;

/** Ce que le relais d'outbox signale (implémenté par `WorkerObservability`, absent des tests qui n'en veulent pas). */
export interface RelayObserver {
  published(events: readonly DomainEvent[], nowMs: number): void;
  publishFailed(): void;
  dead(): void;
  infraFailure(): void;
  sweepDone(nowMs: number): void;
  /** Reste d'événements non publiés d'un tenant après un passage (`null` : plus rien en attente). */
  tenantPending(tenantId: string, remaining: PendingEntry | null): void;
}

export interface EventJobInput {
  stage: "route" | "handle";
  /** Abonné (`handle`) ou file source (`route`). */
  name: string;
  queue: string;
  event: DomainEvent;
  jobId: string | undefined;
  attempt: number;
  trace?: JobTrace | undefined;
}

export interface JobObservability {
  /** Exécute `fn` dans le contexte de corrélation et le span consommateur de cet événement. */
  runEventJob<T>(input: EventJobInput, fn: () => Promise<T>): Promise<T>;
  observeSubscriber(subscriber: string, outcome: SubscriberOutcome, seconds: number): void;
  observeRouter(outcome: "success" | "failure"): void;
  /** `traceparent` du contexte courant, à déposer dans les données d'un nouveau job. */
  jobTrace(): JobTrace;
  runScheduledJob<T>(name: string, runId: string, fn: () => Promise<T>): Promise<T>;
  observeScheduledSkipped(name: string): void;
}

export interface WorkerObservabilityOptions {
  config: ObservabilityConfig;
  logger: Logger;
  tracing: TracingHandle;
  prefix: string;
  /** Intervalle de calcul des jauges métier (défaut 60 s ; `0` : désactivées). */
  businessIntervalMs?: number;
  paymentsStaleMinutes?: number;
}

export class WorkerObservability implements JobObservability, RelayObserver {
  readonly config: ObservabilityConfig;
  readonly kit: MetricsKit;
  readonly metrics: WorkerMetrics;
  readonly tracing: TracingHandle;

  private readonly logger: Logger;
  private readonly prefix: string;
  private readonly pendingByTenant = new Map<string, PendingEntry>();
  private readonly queueProviders: Array<() => Array<{ name: string; queue: Queue }>> = [];
  private readonly queueStats: CachedValue<readonly QueueSnapshot[]>;
  private readonly lastSuccess: CachedValue<Record<string, number>>;
  private business: BusinessGauges | null = null;
  private heartbeat: Heartbeat | null = null;
  private redis: Redis | null = null;
  private readonly options: WorkerObservabilityOptions;

  constructor(options: WorkerObservabilityOptions) {
    this.options = options;
    this.config = options.config;
    this.logger = options.logger;
    this.prefix = options.prefix;
    this.tracing = options.tracing;
    this.kit = createMetricsKit("worker");
    const warn = (what: string) => (err: unknown) => this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, `métriques : ${what} indisponible`);
    this.queueStats = new CachedValue<readonly QueueSnapshot[]>(
      options.config.metrics.collectCacheMs,
      async () => {
        const out: QueueSnapshot[] = [];
        for (const provider of this.queueProviders) for (const { name, queue } of provider()) out.push(await snapshotQueue(name, queue));
        return out;
      },
      [],
      warn("statistiques des files"),
    );
    this.lastSuccess = new CachedValue<Record<string, number>>(
      options.config.metrics.collectCacheMs,
      async () => {
        if (!this.redis) return {};
        const raw = await this.redis.hgetall(this.lastSuccessKey);
        return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]).filter(([, v]) => Number.isFinite(v)));
      },
      {},
      warn("dernières réussites des jobs"),
    );
    this.metrics = createWorkerMetrics(this.kit, {
      pending: () => this.pendingByTenant,
      queues: () => this.queueStats.get(),
      jobLastSuccess: () => this.lastSuccess.get(),
      paymentsPending: () => this.business?.paymentsPending() ?? null,
    });
  }

  private get lastSuccessKey(): string {
    return `${this.prefix}:obs:${LAST_SUCCESS_FIELD_PREFIX}`;
  }

  // ---------------------------------------------------------------- câblage

  /** Files dont la profondeur est exposée (fournisseur appelé à chaque rafraîchissement : les files des abonnés démarrent plus tard). */
  registerQueues(provider: () => Array<{ name: string; queue: Queue }>): void {
    this.queueProviders.push(provider);
  }

  /** Démarre le battement de cœur et les jauges métier. */
  start(deps: { failfast: Redis; systemDb: SystemDb }): void {
    this.redis = deps.failfast;
    this.heartbeat = startHeartbeat(deps.failfast, this.prefix, {
      onBeat: (t) => this.metrics.heartbeat.set(t),
      onError: (err) => this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, "battement de cœur : écriture Redis impossible"),
    });
    const interval = this.options.businessIntervalMs ?? 60_000;
    if (interval > 0) {
      this.business = new BusinessGauges({ systemDb: deps.systemDb, logger: this.logger, intervalMs: interval, staleMinutes: this.options.paymentsStaleMinutes ?? 30 });
      this.business.start();
    }
  }

  async stop(): Promise<void> {
    await this.heartbeat?.stop();
    await this.business?.stop();
    this.heartbeat = null;
    this.business = null;
    if (this.tracing.enabled) await this.tracing.shutdown();
  }

  /** Force le calcul des jauges métier (tests). */
  async refreshBusinessGauges(): Promise<void> {
    await this.business?.refresh();
  }

  // ---------------------------------------------------------------- relais

  published(events: readonly DomainEvent[], nowMs: number): void {
    this.metrics.outboxPublished.inc(events.length);
    for (const e of events) {
      const occurred = Date.parse(e.occurredAt);
      if (Number.isFinite(occurred)) this.metrics.outboxLag.observe(Math.max(0, (nowMs - occurred) / 1000));
    }
    if (events.length > 0) this.metrics.outboxLastPublish.set(nowMs / 1000);
  }
  publishFailed(): void {
    this.metrics.outboxPublishFailures.inc();
  }
  dead(): void {
    this.metrics.outboxDead.inc();
  }
  infraFailure(): void {
    this.metrics.outboxInfraFailures.inc();
  }
  sweepDone(nowMs: number): void {
    this.metrics.outboxLastSweep.set(nowMs / 1000);
  }
  tenantPending(tenantId: string, remaining: PendingEntry | null): void {
    if (remaining === null || remaining.count <= 0) this.pendingByTenant.delete(tenantId);
    else this.pendingByTenant.set(tenantId, remaining);
  }

  // ---------------------------------------------------------------- événements

  async runEventJob<T>(input: EventJobInput, fn: () => Promise<T>): Promise<T> {
    const { event } = input;
    const module = input.stage === "handle" ? moduleOfName(input.name) : "worker";
    const traceparent = input.trace?.traceparent ?? event.traceparent;
    return runWithCorrelation(
      {
        tenant_id: event.tenantId,
        event_id: event.id,
        module,
        ...(input.jobId ? { job_id: input.jobId } : {}),
        // Le `request_id` de la requête HTTP d'origine ; à défaut l'identifiant de l'événement (comme `scopeDb`).
        request_id: event.requestId ?? event.id,
      },
      async () => {
        if (!this.tracing.enabled) return fn();
        const parent = contextFromTraceparent(traceparent, context.active());
        const span = tracer().startSpan(
          input.stage === "handle" ? `handle ${input.name}` : `route ${event.type}`,
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              "messaging.system": "bullmq",
              "messaging.destination.name": input.queue,
              "messaging.message.id": event.id,
              "messaging.operation.type": "process",
              "ed.event.type": event.type,
              "ed.attempt": input.attempt,
              ...(input.stage === "handle" ? { "ed.subscriber": input.name } : {}),
              ...identityAttributes({ tenantId: event.tenantId, requestId: event.requestId, module }),
            },
          },
          parent,
        );
        try {
          return await context.with(trace.setSpan(parent, span), fn);
        } catch (err) {
          recordSafeException(span, err);
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  observeSubscriber(subscriber: string, outcome: SubscriberOutcome, seconds: number): void {
    const module = moduleOfName(subscriber);
    this.metrics.subscriberJobs.inc({ module, subscriber, outcome });
    this.metrics.subscriberDuration.observe({ module, subscriber }, seconds);
    if (RENDER_RE.test(subscriber)) {
      this.metrics.pdfDuration.observe({ kind: subscriber }, seconds);
      if (outcome !== "success") this.metrics.pdfFailures.inc({ kind: subscriber });
    }
  }

  observeRouter(outcome: "success" | "failure"): void {
    this.metrics.routerJobs.inc({ outcome });
  }

  jobTrace(): JobTrace {
    const traceparent = currentTraceparent();
    return traceparent ? { traceparent } : {};
  }

  // ---------------------------------------------------------------- jobs planifiés

  async runScheduledJob<T>(name: string, runId: string, fn: () => Promise<T>): Promise<T> {
    const started = process.hrtime.bigint();
    const module = moduleOfName(name);
    return runWithCorrelation({ job_id: runId, module, request_id: `job-${name}-${runId}`.slice(0, 100) }, async () => {
      const span = this.tracing.enabled
        ? tracer().startSpan(`job ${name}`, { kind: SpanKind.INTERNAL, attributes: { "ed.job": name, "ed.module": module } }, context.active())
        : undefined;
      try {
        const result = span ? await context.with(trace.setSpan(context.active(), span), fn) : await fn();
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        this.metrics.scheduledRuns.inc({ job: name, outcome: "success" });
        this.metrics.scheduledDuration.observe({ job: name }, seconds);
        this.recordLastSuccess(name);
        return result;
      } catch (err) {
        this.metrics.scheduledRuns.inc({ job: name, outcome: "failure" });
        this.metrics.scheduledDuration.observe({ job: name }, Number(process.hrtime.bigint() - started) / 1e9);
        if (span) recordSafeException(span, err);
        throw err;
      } finally {
        span?.end();
      }
    });
  }

  observeScheduledSkipped(name: string): void {
    this.metrics.scheduledRuns.inc({ job: name, outcome: "skipped" });
  }

  private recordLastSuccess(name: string): void {
    const redis = this.redis;
    if (!redis) return;
    void redis.hset(this.lastSuccessKey, name, String(Math.floor(Date.now() / 1000))).catch(() => undefined);
  }
}

export interface CreateWorkerObservabilityOptions {
  env?: EnvLike;
  logger: Logger;
  prefix: string;
  tracing?: InitTracingOptions;
  businessIntervalMs?: number;
  paymentsStaleMinutes?: number;
}

/**
 * Charge la configuration d'observabilité du worker et installe le traçage si (et seulement si) il est configuré.
 * Lève `ObservabilityConfigError` si une variable est invalide (le point d'entrée sort alors avec le code 78).
 */
export function createWorkerObservability(options: CreateWorkerObservabilityOptions): WorkerObservability {
  const env = options.env ?? process.env;
  const config = loadObservabilityConfig("worker", env);
  const tracing = initTracing(config, options.tracing);
  enableAmbientRequestId();
  const staleRaw = Number(env.OBS_PAYMENTS_STALE_MINUTES);
  const intervalRaw = Number(env.OBS_BUSINESS_GAUGES_INTERVAL_MS);
  return new WorkerObservability({
    config,
    logger: options.logger,
    tracing,
    prefix: options.prefix,
    businessIntervalMs: options.businessIntervalMs ?? (Number.isFinite(intervalRaw) && env.OBS_BUSINESS_GAUGES_INTERVAL_MS !== undefined && env.OBS_BUSINESS_GAUGES_INTERVAL_MS !== "" ? intervalRaw : 60_000),
    paymentsStaleMinutes: options.paymentsStaleMinutes ?? (Number.isFinite(staleRaw) && staleRaw > 0 ? staleRaw : 30),
  });
}
