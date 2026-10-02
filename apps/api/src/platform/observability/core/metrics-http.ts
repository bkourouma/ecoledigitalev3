/**
 * Exposition de `/metrics` : jeton, serveur dédié, rendu (ADR-009).
 *
 * `/metrics` n'est JAMAIS public sans authentification : voir `resolveMetricsExposure` (config.ts).
 * Le jeton est comparé en temps constant ; il n'est jamais journalisé.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Registry } from "prom-client";
import type { MetricsExposure } from "./config";

/** Comparaison en temps constant (hachage préalable : longueurs égales, aucune fuite de longueur). */
export function tokensEqual(expected: string, given: string): boolean {
  const a = createHash("sha256").update(expected).digest();
  const b = createHash("sha256").update(given).digest();
  return timingSafeEqual(a, b);
}

/** Extrait le jeton d'un en-tête `Authorization: Bearer <jeton>` ; `undefined` sinon. */
export function bearerToken(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(raw);
  return m?.[1];
}

export type MetricsAuthResult = "ok" | "unauthorized";

/** Autorise (ou non) une requête de métriques selon l'exposition résolue. */
export function authorizeMetrics(exposure: Pick<MetricsExposure, "tokenRequired">, token: string | undefined, authorization: string | string[] | undefined): MetricsAuthResult {
  if (!exposure.tokenRequired) return "ok";
  if (!token) return "unauthorized"; // jeton exigé mais non configuré : on refuse toujours
  const given = bearerToken(authorization);
  return given !== undefined && tokensEqual(token, given) ? "ok" : "unauthorized";
}

export async function renderMetrics(registry: Registry): Promise<{ contentType: string; body: string }> {
  return { contentType: registry.contentType, body: await registry.metrics() };
}

export interface MetricsServerOptions {
  registry: Registry;
  host: string;
  port: number;
  token?: string | undefined;
  tokenRequired: boolean;
  /** Appelé avant le rendu (rafraîchissement des jauges lues à la demande). */
  beforeRender?: () => Promise<void>;
  onError?: (err: unknown) => void;
}

export interface MetricsServer {
  readonly port: number;
  close(): Promise<void>;
}

/** Serveur HTTP dédié : `GET /metrics` uniquement, 401 sans jeton valide quand il est exigé, 404 partout ailleurs. */
export async function startMetricsServer(options: MetricsServerOptions): Promise<MetricsServer> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const finish = (status: number, body: string, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "cache-control": "no-store", "content-length": Buffer.byteLength(body), ...headers });
      res.end(body);
    };
    if (path !== "/metrics") return finish(404, "not found\n", { "content-type": "text/plain" });
    if (req.method !== "GET" && req.method !== "HEAD") return finish(405, "method not allowed\n", { "content-type": "text/plain", allow: "GET, HEAD" });
    if (authorizeMetrics({ tokenRequired: options.tokenRequired }, options.token, req.headers.authorization) !== "ok") {
      return finish(401, "unauthorized\n", { "content-type": "text/plain", "www-authenticate": 'Bearer realm="metrics"' });
    }
    void (async () => {
      try {
        await options.beforeRender?.();
        const { contentType, body } = await renderMetrics(options.registry);
        finish(200, req.method === "HEAD" ? "" : body, { "content-type": contentType });
      } catch (err) {
        options.onError?.(err);
        finish(500, "metrics unavailable\n", { "content-type": "text/plain" });
      }
    })();
  });
  server.keepAliveTimeout = 1_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
