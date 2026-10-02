/**
 * Client API typé de la plateforme (fetch natif, sans dépendance).
 *
 *  - en-têtes `X-Tenant` / `Authorization` (via `getTenant` / `getToken`) ;
 *  - erreurs normalisées `{ code, message, details }` (voir errors.ts) ;
 *  - validation Zod des réponses (schémas de `@ecoledigitale/contracts`, ex. `packages/contracts/src/v2/*`) ;
 *  - retries pour les requêtes idempotentes (GET/HEAD/PUT/DELETE/OPTIONS, ou POST avec `idempotencyKey`) ;
 *  - annulation (`signal`) et délai maximal (`timeoutMs`).
 *
 * Le patch historique de `window.fetch` (lib/fetch-interceptor.ts) reste actif : ce client appelle
 * `globalThis.fetch` à chaque requête, donc il en bénéficie tant qu'il existe, sans en dépendre.
 */

import type { ZodTypeAny, z } from "zod";
import { ApiError, ClientErrorCode, normalizeErrorResponse } from "./errors";

/** Portée de cache du client sans tenant (console plateforme). */
export const PLATFORM_SCOPE = "platform";

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
export type QueryValue = string | number | boolean | Date | null | undefined;
export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export interface ApiClientOptions {
  /** Préfixe des URL ; `""` pour le même domaine (réécriture Next `/api/v1/*`). */
  baseUrl: string;
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Vrai : une requête non anonyme sans jeton échoue localement (401) au lieu de partir sans
   * `Authorization`. Évite, avec le patch historique de `window.fetch`, la redirection automatique vers /login.
   */
  requireToken?: boolean;
  /** Slug ou identifiant du tenant ; `null` = inconnu (les requêtes échouent avec TENANT_UNKNOWN). */
  getTenant?: () => string | null | undefined;
  /**
   * Console plateforme (opérateur super-admin) : les routes `/api/v1/platform/*` ne sont pas rattachées à un tenant.
   * Le client n'exige alors aucun tenant et n'envoie pas `X-Tenant` ; `getTenant()` renvoie `PLATFORM_SCOPE`
   * (clé de cache stable, jamais confondue avec un vrai tenant). Le jeton reste exigé / envoyé.
   */
  tenantless?: boolean;
  /** Implémentation de fetch (tests). Défaut : `globalThis.fetch`, résolu à chaque appel. */
  fetch?: typeof fetch;
  /** Nombre maximal de nouvelles tentatives (défaut 2). */
  retries?: number;
  /** Délai de base du backoff exponentiel, en ms (défaut 300). */
  retryDelayMs?: number;
  /** Délai maximal d'une tentative, en ms (défaut 30 000 ; 0 = illimité). */
  timeoutMs?: number;
  /** Appelé sur toute réponse 401 (déconnexion, rafraîchissement, redirection…). */
  onUnauthorized?: (error: ApiError) => void;
  /** Injectable pour les tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Générateur de jitter dans [0,1) (tests). */
  random?: () => number;
}

export interface RequestOptions<S extends ZodTypeAny | undefined = undefined> {
  query?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Schéma Zod de la réponse ; si fourni, la réponse est validée et typée. */
  schema?: S;
  responseType?: "json" | "text" | "blob";
  retries?: number;
  timeoutMs?: number;
  /** Autorise les retries d'un POST/PATCH (envoyée en en-tête `Idempotency-Key`). */
  idempotencyKey?: string;
  /** Requête publique : n'exige ni tenant ni jeton. */
  anonymous?: boolean;
}

type Out<S extends ZodTypeAny | undefined, Fallback> = S extends ZodTypeAny ? z.output<S> : Fallback;

export interface ApiClient {
  readonly baseUrl: string;
  getTenant(): string | null;
  request<T = unknown, S extends ZodTypeAny | undefined = undefined>(
    method: HttpMethod,
    path: string,
    options?: RequestOptions<S>,
  ): Promise<Out<S, T>>;
  get<T = unknown, S extends ZodTypeAny | undefined = undefined>(path: string, options?: RequestOptions<S>): Promise<Out<S, T>>;
  post<T = unknown, S extends ZodTypeAny | undefined = undefined>(path: string, body?: unknown, options?: RequestOptions<S>): Promise<Out<S, T>>;
  put<T = unknown, S extends ZodTypeAny | undefined = undefined>(path: string, body?: unknown, options?: RequestOptions<S>): Promise<Out<S, T>>;
  patch<T = unknown, S extends ZodTypeAny | undefined = undefined>(path: string, body?: unknown, options?: RequestOptions<S>): Promise<Out<S, T>>;
  delete<T = unknown, S extends ZodTypeAny | undefined = undefined>(path: string, options?: RequestOptions<S>): Promise<Out<S, T>>;
}

const IDEMPOTENT_METHODS: ReadonlySet<HttpMethod> = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 10_000;

export function buildQueryString(query?: QueryParams): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values as QueryValue[]) {
      if (value === undefined || value === null) continue;
      search.append(key, value instanceof Date ? value.toISOString() : String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortedError(cause?: unknown): ApiError {
  return new ApiError({ code: ClientErrorCode.ABORTED, message: "Requête annulée.", cause });
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS);
  return null;
}

async function readBody(response: Response, responseType: "json" | "text" | "blob"): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  if (responseType === "blob") return response.blob();
  const text = await response.text();
  if (text === "") return undefined;
  if (responseType === "text") return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Corps binaire (fichier, tampon) : jamais sérialisé en JSON. */
function isBinaryBody(body: unknown): boolean {
  return (typeof Blob !== "undefined" && body instanceof Blob) || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const defaultRetries = options.retries ?? 2;
  const baseDelay = options.retryDelayMs ?? 300;
  const defaultTimeout = options.timeoutMs ?? 30_000;

  const currentTenant = (): string | null => {
    if (options.tenantless) return PLATFORM_SCOPE;
    const tenant = options.getTenant?.();
    return typeof tenant === "string" && tenant.trim() !== "" ? tenant.trim() : null;
  };

  async function request<T, S extends ZodTypeAny | undefined>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions<S> = {},
  ): Promise<Out<S, T>> {
    if (opts.signal?.aborted) throw abortedError(opts.signal.reason);

    const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
    if (!opts.anonymous) {
      const tenant = currentTenant();
      if (!tenant && !options.tenantless) {
        throw new ApiError({
          code: ClientErrorCode.TENANT_UNKNOWN,
          message: "Établissement inconnu : impossible d'appeler l'API sans tenant.",
        });
      }
      if (tenant && !options.tenantless) headers["X-Tenant"] = tenant;
      const token = await options.getToken?.();
      if (token) headers.Authorization = `Bearer ${token}`;
      else if (options.requireToken) {
        throw new ApiError({ code: "UNAUTHORIZED", message: "Authentification requise.", status: 401 });
      }
    }

    let payload: BodyInit | undefined;
    if (opts.body !== undefined && method !== "GET" && method !== "HEAD") {
      if (isBinaryBody(opts.body)) {
        // Fichier envoyé tel quel (pièces d'élève) : le `Content-Type` est celui du fichier, fixé par l'appelant dans `headers`.
        payload = opts.body as BodyInit;
      } else if (typeof FormData !== "undefined" && opts.body instanceof FormData) {
        payload = opts.body; // le navigateur fixe le Content-Type multipart
      } else if ((typeof Blob !== "undefined" && opts.body instanceof Blob) || opts.body instanceof ArrayBuffer || ArrayBuffer.isView(opts.body)) {
        // Fichier envoyé BRUT (imports 031) : ni JSON ni multipart ; le type réel est contrôlé par le serveur sur les octets.
        payload = opts.body as BodyInit;
        headers["Content-Type"] ??= "application/octet-stream";
      } else {
        payload = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
        headers["Content-Type"] ??= "application/json";
      }
    }
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

    const url = joinUrl(options.baseUrl, path) + buildQueryString(opts.query);
    const canRetry = IDEMPOTENT_METHODS.has(method) || Boolean(opts.idempotencyKey);
    const maxRetries = canRetry ? (opts.retries ?? defaultRetries) : 0;
    const timeoutMs = opts.timeoutMs ?? defaultTimeout;
    const responseType = opts.responseType ?? "json";

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      let timedOut = false;
      const onUserAbort = () => controller.abort(opts.signal?.reason);
      opts.signal?.addEventListener("abort", onUserAbort, { once: true });
      // Annulation survenue pendant l'attente du jeton / du backoff : l'écouteur ne l'a pas vue.
      if (opts.signal?.aborted) onUserAbort();
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              controller.abort();
            }, timeoutMs)
          : null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onUserAbort);
      };

      let retryDelay: number | null = null;
      let failure: ApiError;
      try {
        const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
        const response = await doFetch(url, { method, headers, body: payload, signal: controller.signal });
        const requestId = response.headers.get("x-request-id");

        if (response.ok) {
          const data = await readBody(response, responseType);
          cleanup();
          if (opts.schema) {
            const parsed = opts.schema.safeParse(data);
            if (!parsed.success) {
              throw new ApiError({
                code: ClientErrorCode.RESPONSE_INVALID,
                message: "Réponse de l'API invalide.",
                status: response.status,
                details: { issues: parsed.error.issues },
                requestId: requestId ?? undefined,
              });
            }
            return parsed.data as Out<S, T>;
          }
          return data as Out<S, T>;
        }

        const errorBody = await readBody(response, "json").catch(() => undefined);
        cleanup();
        failure = normalizeErrorResponse(response.status, errorBody, requestId);
        if (RETRYABLE_STATUS.has(response.status)) {
          retryDelay = parseRetryAfter(response.headers.get("retry-after"));
        } else {
          if (response.status === 401) options.onUnauthorized?.(failure);
          throw failure;
        }
      } catch (error) {
        cleanup();
        if (error instanceof ApiError) {
          if (!RETRYABLE_STATUS.has(error.status) || error.code === ClientErrorCode.RESPONSE_INVALID) throw error;
          failure = error;
        } else if (opts.signal?.aborted) {
          throw abortedError(error);
        } else if (timedOut) {
          failure = new ApiError({ code: ClientErrorCode.TIMEOUT, message: "Le serveur met trop de temps à répondre.", cause: error });
        } else {
          failure = new ApiError({ code: ClientErrorCode.NETWORK, message: "Connexion au serveur impossible.", cause: error });
        }
      }

      if (attempt >= maxRetries) throw failure;
      const backoff = retryDelay ?? baseDelay * 2 ** attempt * (0.5 + random() / 2);
      attempt += 1;
      await sleep(backoff, opts.signal);
    }
  }

  const client: ApiClient = {
    baseUrl: options.baseUrl,
    getTenant: currentTenant,
    request,
    get: (path, o) => request("GET", path, o),
    post: (path, body, o) => request("POST", path, { ...o, body }),
    put: (path, body, o) => request("PUT", path, { ...o, body }),
    patch: (path, body, o) => request("PATCH", path, { ...o, body }),
    delete: (path, o) => request("DELETE", path, o),
  } as ApiClient;
  return client;
}
