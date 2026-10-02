/**
 * Plugin Fastify d'observabilité (ADR-009). À enregistrer EN PREMIER (ses hooks ne s'appliquent qu'aux routes déclarées
 * après lui).
 *
 *  - `request_id` : `x-request-id` valide ou UUID v7, renvoyé dans la réponse, identique à `RequestContext.requestId` ;
 *  - corrélation des journaux (AsyncLocalStorage) : `request_id`, `tenant_id`, `user_id`, `module`, `trace_id`, `span_id` ;
 *  - span serveur nommé `METHOD <motif de route>` (jamais l'URL), attributs `tenant.id`, `enduser.id`, `ed.module` ;
 *  - UNE ligne de journal par requête (`request completed`) : méthode, motif de route, statut, durée, jamais la chaîne de
 *    requête ni les en-têtes ;
 *  - métriques HTTP par module et par route, pools PostgreSQL ;
 *  - routes `GET /health`, `GET /ready`, `GET /metrics` (jeton ou serveur dédié : jamais public sans authentification).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { normalizeChildBindings } from "@ecoledigitale/kernel";
import { Redis } from "ioredis";
import { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { authorizeMetrics, renderMetrics, startMetricsServer, type MetricsServer } from "./core/metrics-http";
import { enterCorrelation, type CorrelationFields } from "./core/correlation";
import { UNMATCHED_ROUTE } from "./core/metrics";
import {
  migrationsProbe,
  postgresProbe,
  redisProbe,
  renderReadiness,
  runProbes,
  workerHeartbeatProbe,
  type Probe,
} from "./core/health";
import { identityAttributes, recordSafeException, tracer } from "./core/tracing";
import { disableOutboxTraceContext, enableOutboxTraceContext } from "./outbox-trace";
import { expectedSchemaFromModules, storageProbeFromEnv } from "./probes";
import type { Observability } from "./observability";

declare module "fastify" {
  interface FastifyInstance {
    observability: Observability;
  }
}

export interface ObservabilityPluginOptions {
  observability: Observability;
  /** Variables d'environnement (défaut `process.env`) : `REDIS_URL`, `WORKER_QUEUE_PREFIX`, `STORAGE_*`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Sondes de readiness ; défaut : `defaultApiProbes`. Évaluée À CHAQUE requête (les pools v2 sont posés plus tard). */
  probes?: (app: FastifyInstance) => Probe[];
  /** Dossier des modules (schémas attendus) ; défaut : `apps/api/src/modules`. */
  modulesDir?: string;
  /** Clés de modules v2 (étiquette `module`) ; défaut : manifestes de `app.v2` quand la plateforme est assemblée. */
  moduleKeys?: Iterable<string>;
}

interface RequestState {
  start: bigint;
  span: Span | undefined;
  module: string;
  route: string;
  done: boolean;
}

const states = new WeakMap<FastifyRequest, RequestState>();

const MODULE_PATH_RE = /^\/api\/v1\/([a-z][a-z0-9_]*)(?:\/|$)/;

/** Module d'une route : clé de module v2 pour `/api/v1/<clé>/…`, `legacy` pour le reste de `/api/v1`, `platform` ailleurs. */
export function moduleOfRoute(routeUrl: string, moduleKeys: ReadonlySet<string>): string {
  const m = MODULE_PATH_RE.exec(routeUrl);
  if (!m) return routeUrl.startsWith("/api/") ? "legacy" : "platform";
  const key = m[1] as string;
  return moduleKeys.has(key) ? key : "legacy";
}

type Loose = Record<string, any>;

function identityOf(request: FastifyRequest): { tenantId?: string; userId?: string } {
  const r = request as unknown as Loose;
  const tenantId: unknown = r.ctx?.tenantId ?? r.tenantId;
  const userId: unknown = r.ctx?.userId ?? r.user?.id ?? r.userId ?? r.superAdmin?.id;
  return {
    ...(typeof tenantId === "string" && tenantId ? { tenantId } : {}),
    ...(typeof userId === "string" && userId ? { userId } : {}),
  };
}

function routeOf(request: FastifyRequest): string {
  const url = (request.routeOptions as { url?: string } | undefined)?.url;
  if (!url || url === "*" || (request as unknown as Loose).is404 === true) return UNMATCHED_ROUTE;
  return url;
}

/** Sondes de l'API : PostgreSQL (legacy et v2), Redis, migrations, worker vivant, stockage objet. */
export function defaultApiProbes(
  app: FastifyInstance,
  deps: { redis: ReturnType<typeof lazyRedis> | null; env: Readonly<Record<string, string | undefined>>; modulesDir?: string },
): Probe[] {
  const loose = app as unknown as Loose;
  const probes: Probe[] = [];
  const v2Pool = loose.v2?.pool as { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> } | undefined;
  const legacyPool = loose.pg as { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> } | undefined;
  const mainPool = v2Pool ?? legacyPool;
  if (mainPool) probes.push(postgresProbe(mainPool));
  if (v2Pool && legacyPool && legacyPool !== v2Pool) {
    // Deux bases (legacy et v2) : les deux doivent répondre pour que l'API soit utilisable.
    probes.push({ name: "postgres", check: () => postgresProbe(legacyPool).check() });
  }
  probes.push(redisProbe(deps.redis?.client ?? null));
  if (v2Pool) probes.push(migrationsProbe(v2Pool, expectedSchemaFromModules(deps.modulesDir)));
  else probes.push({ name: "migrations", check: async () => "skipped" });
  const prefix = deps.env.WORKER_QUEUE_PREFIX?.trim() || "ed";
  probes.push(workerHeartbeatProbe(deps.redis?.client ?? null, prefix));
  probes.push(v2Pool ? storageProbeFromEnv(deps.env) : { name: "storage", check: async () => "skipped" });
  return probes;
}

/** Client Redis des sondes : création paresseuse, délais courts, aucune file d'attente hors ligne. */
export function lazyRedis(url: string | undefined): { client: any; close(): Promise<void> } | null {
  if (!url) return null;
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    connectionName: "ed-api-probes",
    retryStrategy: (times: number) => Math.min(times * 500, 5_000),
  });
  client.on("error", () => undefined);
  return {
    client,
    close: async () => {
      if (client.status !== "end") await client.quit().catch(() => client.disconnect());
    },
  };
}

const plugin: FastifyPluginAsync<ObservabilityPluginOptions> = async (app, options) => {
  const { observability } = options;
  const { config, http } = observability;
  const env = options.env ?? process.env;
  app.decorate("observability", observability);
  // `request_id` (et le reste de la corrélation) vient du mixin : un enfant lié à `request_id` le doublerait dans la ligne JSON.
  normalizeChildBindings(app.log as unknown as { child: (bindings: any, options?: any) => any });
  app.setChildLoggerFactory((logger, _bindings, childOptions) => logger.child({}, childOptions));

  const probeRedis = lazyRedis(env.REDIS_URL?.trim() || undefined);
  const startedAt = Date.now();
  let moduleKeys: ReadonlySet<string> = new Set(options.moduleKeys ?? []);
  const refreshModuleKeys = (): ReadonlySet<string> => {
    if (moduleKeys.size === 0) {
      const manifests = ((app as unknown as Loose).v2?.manifests ?? []) as Array<{ key: string }>;
      if (manifests.length > 0) moduleKeys = new Set(manifests.map((m) => m.key));
    }
    return moduleKeys;
  };

  let outboxTraceEnabled = false;

  // --- pools PostgreSQL : suivis dès que la plateforme v2 est assemblée (onReady : tout est enregistré).
  app.addHook("onReady", async () => {
    const loose = app as unknown as Loose;
    if (loose.pg) observability.pools.track("legacy", loose.pg.pool ?? loose.pg);
    if (loose.v2?.pool) observability.pools.track("v2", loose.v2.pool);
    // Contexte de trace dans l'outbox : seulement si le traçage est actif et la colonne présente.
    if (loose.v2?.pool) {
      outboxTraceEnabled = await enableOutboxTraceContext(loose.v2.pool, { tracingEnabled: observability.tracing.enabled, logger: app.log });
    }
  });

  // --- hook d'entrée : identifiant, contexte de corrélation, span serveur
  app.addHook("onRequest", (request, reply, done) => {
    const route = routeOf(request);
    const module = moduleOfRoute(route === UNMATCHED_ROUTE ? request.url.split("?")[0] ?? "" : route, refreshModuleKeys());
    const requestId = request.id as string;
    reply.header("x-request-id", requestId);

    let span: Span | undefined;
    let parent = ROOT_CONTEXT;
    if (observability.tracing.enabled) {
      if (config.tracing.trustInboundTraceparent) parent = propagation.extract(ROOT_CONTEXT, request.headers);
      span = tracer().startSpan(
        `${request.method} ${route}`,
        { kind: SpanKind.SERVER, attributes: { "http.request.method": request.method, "http.route": route, ...identityAttributes({ requestId, module }) } },
        parent,
      );
    }
    const state: RequestState = { start: process.hrtime.bigint(), span, module, route, done: false };
    states.set(request, state);
    http.inFlight(1);

    const resolve = (): CorrelationFields => {
      const id = identityOf(request);
      return { ...(id.tenantId ? { tenant_id: id.tenantId } : {}), ...(id.userId ? { user_id: id.userId } : {}) };
    };
    reply.raw.once("close", () => finish(request, reply, state));
    const run = (): void => enterCorrelation({ request_id: requestId, module, resolve }, done);
    if (span) context.with(trace.setSpan(parent, span), run);
    else run();
  });

  app.addHook("onError", async (request, _reply, error) => {
    const state = states.get(request);
    if (state?.span) recordSafeException(state.span, error);
  });

  function finish(request: FastifyRequest, reply: FastifyReply, state: RequestState): void {
    if (state.done) return;
    state.done = true;
    http.inFlight(-1);
    // « close » suit toujours la fin de la réponse ; si `end()` n'a jamais été appelé, le client a abandonné.
    const aborted = !reply.raw.writableEnded;
    const status = aborted ? 499 : reply.statusCode;
    const seconds = Number(process.hrtime.bigint() - state.start) / 1e9;
    const route = routeOf(request);
    const identity = identityOf(request);
    http.observe({ module: state.module, method: request.method, route, status, durationSeconds: seconds, tenantId: identity.tenantId });

    const span = state.span;
    if (span) {
      span.updateName(`${request.method} ${route}`);
      span.setAttributes({ "http.response.status_code": status, "http.route": route, ...identityAttributes({ ...identity, module: state.module }) });
      if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }

    if (config.accessLog) {
      const line = {
        request_id: request.id,
        module: state.module,
        ...(identity.tenantId ? { tenant_id: identity.tenantId } : {}),
        ...(identity.userId ? { user_id: identity.userId } : {}),
        method: request.method,
        route,
        status,
        duration_ms: Math.round(seconds * 1000 * 100) / 100,
        ...(aborted ? { aborted: true } : {}),
        ...(span ? { trace_id: span.spanContext().traceId, span_id: span.spanContext().spanId } : {}),
      };
      if (status >= 500) app.log.error(line, "request completed");
      else app.log.info(line, "request completed");
    }
  }

  // --- santé
  const probes = (): Probe[] => (options.probes ? options.probes(app) : defaultApiProbes(app, { redis: probeRedis, env, ...(options.modulesDir ? { modulesDir: options.modulesDir } : {}) }));
  const publicRoute = { config: { public: true } };
  app.get("/health", publicRoute, async (_request, reply) => {
    reply.header("cache-control", "no-store");
    return { status: "ok", service: config.service, uptimeSec: Math.round((Date.now() - startedAt) / 1000) };
  });
  app.get("/ready", publicRoute, async (_request, reply) => {
    const report = await runProbes(probes(), config.health);
    reply.header("cache-control", "no-store").code(report.httpStatus);
    return renderReadiness(report, { details: config.health.details, service: config.service });
  });

  // --- métriques : jamais publiques sans authentification
  const exposure = config.metrics;
  if (exposure.mode === "inline") {
    app.get("/metrics", publicRoute, async (request, reply) => {
      if (authorizeMetrics({ tokenRequired: true }, exposure.token, request.headers.authorization) !== "ok") {
        return reply.code(401).header("www-authenticate", 'Bearer realm="metrics"').header("cache-control", "no-store").send({ error: "unauthorized" });
      }
      const { contentType, body } = await renderMetrics(observability.kit.registry);
      return reply.header("content-type", contentType).header("cache-control", "no-store").send(body);
    });
  }
  let dedicated: MetricsServer | undefined;
  if (exposure.mode === "dedicated") {
    app.addHook("onReady", async () => {
      dedicated = await startMetricsServer({
        registry: observability.kit.registry,
        host: exposure.host,
        port: exposure.port ?? 0,
        token: exposure.token,
        tokenRequired: Boolean(exposure.token),
        onError: (err) => app.log.error({ err }, "métriques : rendu impossible"),
      });
      app.log.info({ host: exposure.host, port: dedicated.port, token_required: Boolean(exposure.token) }, "serveur de métriques démarré");
    });
  }

  app.addHook("onClose", async () => {
    if (outboxTraceEnabled) disableOutboxTraceContext();
    await dedicated?.close();
    await probeRedis?.close();
    await observability.shutdown(); // vide les spans en attente (no-op si le traçage est inactif)
  });
};

export const observabilityPlugin = fp(plugin, { name: "observability", fastify: "4.x" });
export default observabilityPlugin;
