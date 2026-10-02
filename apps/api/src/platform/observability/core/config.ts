/**
 * Configuration de l'observabilité (ADR-009), lue dans l'environnement et validée AU DÉMARRAGE.
 *
 * Principes
 *  - AUCUN appel réseau sans configuration : le traçage n'est actif que si un point d'accès OTLP est fourni ;
 *  - `/metrics` n'est jamais public sans authentification (voir `resolveMetricsExposure`) ;
 *  - les VALEURS des variables ne sont jamais recopiées dans un message d'erreur (jetons, en-têtes OTLP).
 *
 * Ce fichier n'importe ni Fastify, ni pg, ni module : il est partagé avec `apps/worker`.
 */

export type ServiceKind = "api" | "worker";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export class ObservabilityConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuration d'observabilité invalide :\n  - ${issues.join("\n  - ")}`);
    this.name = "ObservabilityConfigError";
  }
}

export interface TracingConfig {
  enabled: boolean;
  /** URL de base OTLP/HTTP (`http://collector:4318`) ou URL complète du chemin `/v1/traces`. */
  endpoint?: string;
  /** En-têtes d'authentification de l'exportateur (`OTEL_EXPORTER_OTLP_HEADERS`) : SECRETS, jamais journalisés. */
  headers: Readonly<Record<string, string>>;
  /** Part des traces racines conservées (0..1). Les décisions d'un parent sont toujours respectées. */
  sampleRatio: number;
  /** API seulement : continuer le `traceparent` d'une requête entrante (passerelle de confiance). */
  trustInboundTraceparent: boolean;
  exportTimeoutMs: number;
}

export type MetricsMode = "none" | "inline" | "dedicated";

export interface MetricsConfig {
  /** Où `/metrics` est exposé : `none` (nulle part), `inline` (port applicatif, jeton obligatoire), `dedicated` (port dédié). */
  mode: MetricsMode;
  token?: string;
  host: string;
  /** Port du serveur dédié (`0` = port libre, tests). */
  port?: number;
  /** Nombre maximal de valeurs distinctes de l'étiquette `route` avant repli sur `__other__`. */
  routeLabelLimit: number;
  /** Nombre maximal de tenants distingués par `ed_tenant_http_requests_total` (`0` = série désactivée). */
  tenantLabelMax: number;
  /** Durée de mise en cache des statistiques de files et des jauges métier lues à la demande. */
  collectCacheMs: number;
}

export interface HealthConfig {
  /** Sondes dont l'échec rend le service « non prêt » (503) ; les autres signalent seulement une dégradation. */
  required: ReadonlySet<string>;
  /** Ajoute le message d'erreur de chaque sonde à `/ready` (réseau interne uniquement). */
  details: boolean;
  probeTimeoutMs: number;
}

export interface ObservabilityConfig {
  service: ServiceKind;
  serviceName: string;
  environment: string;
  logLevel: string;
  /** Une ligne `request completed` par requête HTTP (API). */
  accessLog: boolean;
  tracing: TracingConfig;
  metrics: MetricsConfig;
  health: HealthConfig;
}

const LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
export const DEFAULT_REQUIRED_PROBES = ["postgres", "redis", "migrations"] as const;
export const KNOWN_PROBES = ["postgres", "redis", "migrations", "worker", "storage"] as const;

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);

function readBool(env: EnvLike, name: string, fallback: boolean, issues: string[]): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (TRUE.has(raw)) return true;
  if (FALSE.has(raw)) return false;
  issues.push(`${name} : booléen attendu (true/false)`);
  return fallback;
}

function readInt(env: EnvLike, name: string, fallback: number, min: number, max: number, issues: string[]): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    issues.push(`${name} : entier entre ${min} et ${max} attendu`);
    return fallback;
  }
  return n;
}

/** `loopback` : seule la machine locale peut joindre cette adresse. */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || h === "127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** `OTEL_EXPORTER_OTLP_HEADERS` : `clé=valeur,clé2=valeur2`. Les valeurs ne sont jamais journalisées. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponentSafe(value);
  }
  return out;
}

function decodeURIComponentSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export const MIN_METRICS_TOKEN_LENGTH = 24;

export interface MetricsExposureInput {
  service: ServiceKind;
  token?: string | undefined;
  /** Port dédié demandé (`METRICS_PORT`). */
  port?: number | undefined;
  /** Adresse d'écoute du serveur dédié (`METRICS_HOST`) ; pour le worker : celle du serveur de santé. */
  host: string;
}

export interface MetricsExposure {
  mode: MetricsMode;
  /** Le client doit présenter `Authorization: Bearer <jeton>`. */
  tokenRequired: boolean;
  /** Explication (journal de démarrage) ; ne contient jamais le jeton. */
  reason: string;
}

/**
 * Règle de protection de `/metrics` (ADR-009) :
 *   1. serveur dédié (`METRICS_PORT`)      -> écoute `METRICS_HOST` (loopback par défaut) ; jeton OBLIGATOIRE hors loopback ;
 *   2. sinon jeton (`METRICS_TOKEN`)        -> route `/metrics` du port applicatif, jeton obligatoire ;
 *   3. sinon                                -> `/metrics` n'existe pas (404).
 * Le serveur de santé du worker est un port interne : `/metrics` y est servi sans jeton seulement s'il écoute en loopback.
 */
export function resolveMetricsExposure(input: MetricsExposureInput): MetricsExposure {
  const hasToken = Boolean(input.token);
  if (input.service === "worker") {
    if (hasToken) return { mode: "inline", tokenRequired: true, reason: "jeton METRICS_TOKEN requis sur le serveur de santé" };
    if (isLoopbackHost(input.host)) return { mode: "inline", tokenRequired: false, reason: "serveur de santé lié à une adresse loopback" };
    return { mode: "none", tokenRequired: true, reason: "serveur de santé exposé hors loopback sans METRICS_TOKEN : /metrics désactivé" };
  }
  if (input.port !== undefined) {
    if (hasToken) return { mode: "dedicated", tokenRequired: true, reason: "port dédié, jeton requis" };
    if (isLoopbackHost(input.host)) return { mode: "dedicated", tokenRequired: false, reason: "port dédié lié à une adresse loopback" };
    return { mode: "none", tokenRequired: true, reason: "port dédié non loopback sans METRICS_TOKEN : refusé" };
  }
  if (hasToken) return { mode: "inline", tokenRequired: true, reason: "route /metrics du port applicatif, jeton requis" };
  return { mode: "none", tokenRequired: true, reason: "ni METRICS_PORT ni METRICS_TOKEN : /metrics n'est pas exposé" };
}

export function loadObservabilityConfig(service: ServiceKind, env: EnvLike = process.env): ObservabilityConfig {
  const issues: string[] = [];
  const nodeEnv = (env.NODE_ENV ?? "development").trim().toLowerCase();
  const production = nodeEnv === "production";

  // --- journaux
  const logRaw = (env.LOG_LEVEL ?? "").trim().toLowerCase();
  let logLevel = production ? "info" : "debug";
  if (logRaw) {
    if (LOG_LEVELS.has(logRaw)) logLevel = logRaw;
    else issues.push("LOG_LEVEL : fatal, error, warn, info, debug, trace ou silent attendu");
  }

  // --- traces
  const sdkDisabled = readBool(env, "OTEL_SDK_DISABLED", false, issues);
  const endpoint = (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT)?.trim() || undefined;
  if (endpoint && !/^https?:\/\/[^\s]+$/i.test(endpoint)) issues.push("OTEL_EXPORTER_OTLP_ENDPOINT : URL http(s):// attendue");
  const ratioRaw = env.OTEL_TRACES_SAMPLER_ARG?.trim();
  let sampleRatio = production ? 0.1 : 1;
  if (ratioRaw) {
    const r = Number(ratioRaw);
    if (Number.isFinite(r) && r >= 0 && r <= 1) sampleRatio = r;
    else issues.push("OTEL_TRACES_SAMPLER_ARG : nombre entre 0 et 1 attendu");
  }
  const tracing: TracingConfig = {
    enabled: Boolean(endpoint) && !sdkDisabled && (env.OTEL_TRACES_EXPORTER ?? "otlp").trim().toLowerCase() !== "none",
    ...(endpoint ? { endpoint } : {}),
    headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS),
    sampleRatio,
    trustInboundTraceparent: readBool(env, "OBS_TRUST_INBOUND_TRACEPARENT", false, issues),
    exportTimeoutMs: readInt(env, "OTEL_EXPORTER_OTLP_TIMEOUT", 10_000, 100, 120_000, issues),
  };

  // --- métriques
  const token = env.METRICS_TOKEN?.trim() || undefined;
  if (token && token.length < MIN_METRICS_TOKEN_LENGTH) issues.push(`METRICS_TOKEN : ${MIN_METRICS_TOKEN_LENGTH} caractères minimum`);
  const portRaw = env.METRICS_PORT?.trim();
  const port = portRaw ? readInt(env, "METRICS_PORT", 0, 0, 65_535, issues) : undefined;
  const host = (env.METRICS_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
  const metricsHost = service === "worker" ? (env.WORKER_HTTP_HOST ?? "127.0.0.1").trim() || "127.0.0.1" : host;
  const exposure = resolveMetricsExposure({ service, token, port, host: metricsHost });
  if (service === "api" && port !== undefined && exposure.mode === "none" && exposure.reason.includes("refusé")) {
    issues.push("METRICS_PORT : un serveur de métriques lié à une adresse non loopback exige METRICS_TOKEN");
  }
  const metrics: MetricsConfig = {
    mode: exposure.mode,
    ...(token ? { token } : {}),
    host: metricsHost,
    ...(port !== undefined ? { port } : {}),
    routeLabelLimit: readInt(env, "OBS_ROUTE_LABEL_LIMIT", 1_500, 10, 100_000, issues),
    tenantLabelMax: readInt(env, "METRICS_TENANT_LABEL_MAX", 0, 0, 1_000, issues),
    collectCacheMs: readInt(env, "OBS_COLLECT_CACHE_MS", 10_000, 0, 600_000, issues),
  };

  // --- santé
  const requiredRaw = env.OBS_READY_REQUIRE?.trim();
  const required = new Set<string>();
  if (requiredRaw) {
    for (const name of requiredRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      if (!(KNOWN_PROBES as readonly string[]).includes(name)) issues.push(`OBS_READY_REQUIRE : sonde inconnue « ${name} » (${KNOWN_PROBES.join(", ")})`);
      else required.add(name);
    }
  } else {
    for (const name of DEFAULT_REQUIRED_PROBES) required.add(name);
  }
  const health: HealthConfig = {
    required,
    details: readBool(env, "OBS_HEALTH_DETAILS", false, issues),
    probeTimeoutMs: readInt(env, "OBS_PROBE_TIMEOUT_MS", 2_000, 100, 30_000, issues),
  };

  const accessLog = readBool(env, "OBS_ACCESS_LOG", true, issues);
  if (issues.length > 0) throw new ObservabilityConfigError(issues);

  return {
    service,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || `ecoledigitale-${service}`,
    environment: (env.OBS_ENVIRONMENT ?? nodeEnv).trim() || nodeEnv,
    logLevel,
    accessLog,
    tracing,
    metrics,
    health,
  };
}
