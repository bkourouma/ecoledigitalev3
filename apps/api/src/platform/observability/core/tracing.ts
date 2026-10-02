/**
 * Traçage OpenTelemetry (ADR-009).
 *
 *  - DÉSACTIVÉ par défaut : sans `OTEL_EXPORTER_OTLP_ENDPOINT`, aucun SDK n'est chargé en mémoire, aucun fournisseur de
 *    traces n'est enregistré et AUCUNE connexion réseau n'est ouverte. Les helpers (`withSpan`…) restent utilisables :
 *    ils retombent sur les spans inopérants de `@opentelemetry/api`.
 *  - Propagation W3C (`traceparent`) entre l'API et le worker via l'outbox puis les données des jobs BullMQ.
 *  - Échantillonnage `parentbased_traceidratio` : la décision d'un parent (local ou venu de l'outbox) est toujours respectée.
 *  - Tous les spans passent par `SanitizingSpanExporter` avant export (aucune donnée personnelle).
 *
 * Ce fichier n'importe ni Fastify ni module ; il est partagé avec `apps/worker`.
 */
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { scrubLogString } from "@ecoledigitale/kernel";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { ObservabilityConfig } from "./config";
import { SanitizingSpanExporter } from "./span-sanitizer";

export const TRACER_NAME = "ecoledigitale";

export interface TracingHandle {
  readonly enabled: boolean;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

const DISABLED: TracingHandle = Object.freeze({ enabled: false, forceFlush: async () => undefined, shutdown: async () => undefined });

export interface InitTracingOptions {
  /** Exportateur fourni (tests : `InMemorySpanExporter`) ; remplace l'exportateur OTLP et active le traçage. */
  exporter?: SpanExporter;
  /** `false` : n'installe pas les instrumentations automatiques `pg` / HTTP sortant / `fetch` (défaut `true`). */
  instrumentations?: boolean;
  /** Traitement synchrone des spans (tests) au lieu du traitement par lots. */
  synchronous?: boolean;
  /** Ratio d'échantillonnage forcé (tests). */
  sampleRatio?: number;
}

let active: { handle: TracingHandle; teardown: () => Promise<void> } | null = null;

/** Traçage actif dans ce processus ? */
export function isTracingEnabled(): boolean {
  return active !== null;
}

/**
 * Installe le SDK si (et seulement si) la configuration l'active. Idempotent par processus : un second appel renvoie
 * le même descripteur. SYNCHRONE : les instrumentations (`pg`, HTTP) doivent être enregistrées AVANT que ces modules ne
 * soient chargés ; l'entrée de l'API l'appelle donc en tout début, avant les imports de Fastify et de `pg`.
 * Les `require` sont paresseux : un processus sans traçage ne charge pas le SDK.
 */
export function initTracing(config: ObservabilityConfig, options: InitTracingOptions = {}): TracingHandle {
  if (active) return active.handle;
  if (!config.tracing.enabled && !options.exporter) return DISABLED;

  const sdkBase = require("@opentelemetry/sdk-trace-base") as typeof import("@opentelemetry/sdk-trace-base");
  const sdkNode = require("@opentelemetry/sdk-trace-node") as typeof import("@opentelemetry/sdk-trace-node");
  const resources = require("@opentelemetry/resources") as typeof import("@opentelemetry/resources");

  let inner: SpanExporter;
  if (options.exporter) {
    inner = options.exporter;
  } else {
    const otlp = require("@opentelemetry/exporter-trace-otlp-http") as typeof import("@opentelemetry/exporter-trace-otlp-http");
    inner = new otlp.OTLPTraceExporter({
      url: tracesUrl(config.tracing.endpoint as string),
      headers: { ...config.tracing.headers },
      timeoutMillis: config.tracing.exportTimeoutMs,
    });
  }
  const exporter = new SanitizingSpanExporter(inner);

  const ratio = options.sampleRatio ?? config.tracing.sampleRatio;
  const sampler = new sdkBase.ParentBasedSampler({ root: new sdkBase.TraceIdRatioBasedSampler(ratio) });
  const processor = options.synchronous
    ? new sdkBase.SimpleSpanProcessor(exporter)
    : new sdkBase.BatchSpanProcessor(exporter, { scheduledDelayMillis: 2_000, maxQueueSize: 4_096, maxExportBatchSize: 512 });

  const resource = resources.resourceFromAttributes({
    "service.name": config.serviceName,
    "deployment.environment.name": config.environment,
    "service.namespace": "ecoledigitale",
  });
  const provider = new sdkNode.NodeTracerProvider({ resource, sampler, spanProcessors: [processor] });
  provider.register({ propagator: new W3CTraceContextPropagator() });

  let disableInstrumentations: (() => void) | undefined;
  if (options.instrumentations !== false) {
    const { registerInstrumentations } = require("@opentelemetry/instrumentation") as typeof import("@opentelemetry/instrumentation");
    const { PgInstrumentation } = require("@opentelemetry/instrumentation-pg") as typeof import("@opentelemetry/instrumentation-pg");
    const { HttpInstrumentation } = require("@opentelemetry/instrumentation-http") as typeof import("@opentelemetry/instrumentation-http");
    const { UndiciInstrumentation } = require("@opentelemetry/instrumentation-undici") as typeof import("@opentelemetry/instrumentation-undici");
    const instances = [
      new PgInstrumentation({ requireParentSpan: true, ignoreConnectSpans: true, enhancedDatabaseReporting: false }),
      // Le serveur est tracé par notre propre hook (motif de route, sans chaîne de requête) : pas de span serveur automatique.
      new HttpInstrumentation({ ignoreIncomingRequestHook: () => true, requireParentforOutgoingSpans: true }),
      new UndiciInstrumentation({ requireParentforSpans: true }),
    ];
    const unregister = registerInstrumentations({ instrumentations: instances });
    disableInstrumentations = () => {
      unregister();
      for (const i of instances) i.disable();
    };
  }

  const handle: TracingHandle = {
    enabled: true,
    forceFlush: () => provider.forceFlush(),
    shutdown: async () => {
      await provider.shutdown().catch(() => undefined);
    },
  };
  active = {
    handle,
    teardown: async () => {
      disableInstrumentations?.();
      await provider.shutdown().catch(() => undefined);
      trace.disable();
      context.disable();
      propagation.disable();
      active = null;
    },
  };
  return handle;
}

function tracesUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return /\/v1\/traces$/.test(base) ? base : `${base}/v1/traces`;
}

/** Arrête le SDK et remet les fournisseurs globaux à zéro (arrêt du processus, tests). */
export async function shutdownTracing(): Promise<void> {
  const current = active;
  if (!current) return;
  await current.teardown();
}

// ---------------------------------------------------------------------------
// Helpers de spans
// ---------------------------------------------------------------------------

export const tracer = () => trace.getTracer(TRACER_NAME);

export { SpanKind, SpanStatusCode };

/** Enregistre une exception SANS donnée personnelle : type et message filtré, jamais la pile brute. */
export function recordSafeException(span: Span, error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  span.recordException({ name: err.name || "Error", message: scrubLogString(err.message) });
  span.setStatus({ code: SpanStatusCode.ERROR, message: scrubLogString(err.message).slice(0, 200) });
}

export interface WithSpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
  /** Contexte parent (ex. issu d'un `traceparent`) ; défaut : contexte actif. */
  parent?: Context;
}

/** Exécute `fn` dans un span (terminé et marqué en erreur si `fn` lève). */
export async function withSpan<T>(name: string, options: WithSpanOptions, fn: (span: Span) => Promise<T>): Promise<T> {
  const parent = options.parent ?? context.active();
  const span = tracer().startSpan(name, { kind: options.kind ?? SpanKind.INTERNAL, ...(options.attributes ? { attributes: options.attributes } : {}) }, parent);
  try {
    return await context.with(trace.setSpan(parent, span), () => fn(span));
  } catch (error) {
    recordSafeException(span, error);
    throw error;
  } finally {
    span.end();
  }
}

/** `traceparent` W3C du contexte indiqué (défaut : actif) ; `undefined` si le traçage est inactif ou le span invalide. */
export function currentTraceparent(ctx: Context = context.active()): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(ctx, carrier);
  const value = carrier.traceparent;
  return typeof value === "string" && TRACEPARENT_RE.test(value) ? value : undefined;
}

export const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

/** Contexte parent distant déduit d'un `traceparent` (hérite de `base`) ; `base` inchangé si absent ou invalide. */
export function contextFromTraceparent(traceparent: string | null | undefined, base: Context = context.active()): Context {
  if (typeof traceparent !== "string" || !TRACEPARENT_RE.test(traceparent)) return base;
  return propagation.extract(base, { traceparent });
}

/** Attributs d'identité d'un span (aucune PII : identifiants uniquement). */
export function identityAttributes(fields: { tenantId?: string | undefined; userId?: string | null | undefined; requestId?: string | undefined; module?: string | undefined }): Attributes {
  const attrs: Attributes = {};
  if (fields.tenantId) attrs["tenant.id"] = fields.tenantId;
  if (fields.userId) attrs["enduser.id"] = fields.userId;
  if (fields.requestId) attrs["request.id"] = fields.requestId;
  if (fields.module) attrs["ed.module"] = fields.module;
  return attrs;
}
