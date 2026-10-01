/**
 * Serveur HTTP minimal (aucune dépendance) :
 *   GET /health  liveness : le process répond (200 tant qu'il n'est pas en arrêt).
 *   GET /ready   readiness : Redis ET PostgreSQL répondent, démarrage terminé, pas d'arrêt en cours.
 * Aucune donnée sensible n'est exposée ; le port n'est pas publié hors du réseau interne.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "../logger";

export interface ReadinessProbe {
  name: string;
  check(): Promise<void>;
}

export interface HealthServerOptions {
  host: string;
  port: number;
  logger: Logger;
  probes: ReadinessProbe[];
  isReady: () => boolean;
  info?: () => Record<string, unknown>;
}

const PROBE_TIMEOUT_MS = 2_000;

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`délai de ${ms} ms dépassé`)), ms);
    p.then(
      () => {
        clearTimeout(t);
        resolve();
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

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
      void this.handle(req.method ?? "GET", req.url ?? "/", (status, body) => {
        const json = JSON.stringify(body);
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(json) });
        res.end(json);
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
    logger.info({ host, port: this.port }, "serveur de santé démarré (/health, /ready)");
  }

  private async handle(method: string, url: string, reply: (status: number, body: unknown) => void): Promise<void> {
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
      const results = await Promise.all(
        this.options.probes.map(async (probe) => {
          try {
            await withTimeout(probe.check(), PROBE_TIMEOUT_MS);
            return { name: probe.name, ok: true as const };
          } catch (err) {
            return { name: probe.name, ok: false as const, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );
      const ok = results.every((r) => r.ok);
      return reply(ok ? 200 : 503, { status: ok ? "ready" : "not_ready", checks: results });
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
