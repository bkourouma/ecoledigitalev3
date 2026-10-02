/**
 * Serveur HTTP minimal (aucune dépendance, port interne : jamais publié hors du réseau de l'orchestrateur) :
 *   GET /health   liveness : le process répond (200 tant qu'il n'est pas en arrêt), aucune dépendance sondée.
 *   GET /ready    readiness : sondes Redis, PostgreSQL, migrations (requises par défaut) et stockage objet (facultative).
 *                 503 si le démarrage n'est pas terminé, si un arrêt est en cours ou si une sonde REQUISE échoue ;
 *                 200 `degraded` si seule une sonde facultative échoue (ADR-009).
 *   GET /metrics  métriques Prometheus : 404 par défaut ; jeton `Authorization: Bearer` si `METRICS_TOKEN` est défini, sans jeton
 *                 seulement quand le serveur écoute en loopback (voir `resolveMetricsExposure`).
 * Aucune donnée sensible n'est exposée : la réponse de `/ready` ne contient que des noms de sonde et des booléens.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Registry } from "prom-client";
import { renderReadiness, runProbes, type Probe } from "../../../api/src/platform/observability/core/health";
import { authorizeMetrics, renderMetrics } from "../../../api/src/platform/observability/core/metrics-http";
import type { Logger } from "../logger";

/** Sonde de readiness (nom connu de `OBS_READY_REQUIRE`). */
export type ReadinessProbe = Probe;

export interface HealthServerOptions {
  host: string;
  port: number;
  logger: Logger;
  probes: Probe[];
  isReady: () => boolean;
  info?: () => Record<string, unknown>;
  /** Sondes requises, détail des erreurs, délai (défaut : postgres, redis, migrations ; sans détail ; 2 s). */
  health?: { required: ReadonlySet<string>; details: boolean; probeTimeoutMs: number };
  /** Exposition de `/metrics` ; absent ou `mode: "none"` : 404. */
  metrics?: { mode: "none" | "inline"; registry: Registry; token?: string | undefined; tokenRequired: boolean };
}

const DEFAULT_HEALTH = { required: new Set(["postgres", "redis", "migrations"]), details: false, probeTimeoutMs: 2_000 };

export class HealthServer {
  private server: Server | null = null;
  private readonly startedAt = Date.now();

  constructor(private readonly options: HealthServerOptions) {}

  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? this.options.port;
  }

  async start(): Promise<void> {
    const { host, port, logger } = this.options;
    const server = createServer((req, res) => {
      void this.handle(req.method ?? "GET", req.url ?? "/", req.headers.authorization, (status, body, headers) => {
        const payload = typeof body === "string" ? body : JSON.stringify(body);
        res.writeHead(status, {
          "content-type": typeof body === "string" ? "text/plain" : "application/json",
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(payload),
          ...(headers ?? {}),
        });
        res.end(payload);
      });
    });
    server.keepAliveTimeout = 1_000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    logger.info({ host, port: this.port, metrics: this.options.metrics?.mode ?? "none" }, "serveur de santé démarré (/health, /ready, /metrics)");
  }

  private async handle(
    method: string,
    url: string,
    authorization: string | undefined,
    reply: (status: number, body: unknown, headers?: Record<string, string>) => void,
  ): Promise<void> {
    const path = url.split("?")[0];
    if (method !== "GET" && method !== "HEAD") return reply(405, { error: "method_not_allowed" });
    if (path === "/health") {
      return reply(200, {
        status: "ok",
        service: "worker",
        uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
        ...(this.options.info?.() ?? {}),
      });
    }
    if (path === "/ready") {
      if (!this.options.isReady()) return reply(503, { status: "not_ready", reason: "starting_or_stopping" });
      const health = this.options.health ?? DEFAULT_HEALTH;
      const report = await runProbes(this.options.probes, health);
      return reply(report.httpStatus, renderReadiness(report, { details: health.details, service: "worker" }));
    }
    if (path === "/metrics") {
      const metrics = this.options.metrics;
      if (!metrics || metrics.mode === "none") return reply(404, { error: "not_found" });
      if (authorizeMetrics({ tokenRequired: metrics.tokenRequired }, metrics.token, authorization) !== "ok") {
        return reply(401, { error: "unauthorized" }, { "www-authenticate": 'Bearer realm="metrics"' });
      }
      try {
        const { contentType, body } = await renderMetrics(metrics.registry);
        return reply(200, body, { "content-type": contentType });
      } catch (err) {
        this.options.logger.error({ err: err instanceof Error ? err.message : String(err) }, "métriques : rendu impossible");
        return reply(500, { error: "metrics_unavailable" });
      }
    }
    return reply(404, { error: "not_found" });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }
}
