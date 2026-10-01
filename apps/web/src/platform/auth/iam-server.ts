/**
 * Client SERVEUR du module `iam` (`/api/v1/iam/*`), utilisé par NextAuth (callbacks exécutés côté serveur Next).
 *
 * Transport « mobile » : le serveur Next est un client confidentiel de première partie. Le refresh token est
 * renvoyé dans le corps, rangé dans le JWT de session NextAuth (cookie chiffré HttpOnly, jamais exposé au
 * JavaScript de la page : voir `session` callback) et tourne à chaque usage. Aucun cookie `Path=/api/v1/iam` n'est
 * posé dans le navigateur par ces appels, donc aucune surface CSRF sur les routes à cookie de l'API.
 *
 * Adresse du client : le serveur Next relaie `x-forwarded-for` et `user-agent` du navigateur pour que le limiteur
 * de débit, le verrouillage et la liste « mes sessions » d'iam voient le vrai appareil et non le serveur web
 * (l'API doit faire confiance à ce relais : `TRUST_PROXY`, voir docs/architecture/auth-cutover.md).
 */
import {
  AuthenticatedResponseSchema,
  LoginResponseSchema,
  MfaVerifyResponseSchema,
  RefreshResponseSchema,
  type AuthenticatedResponse,
  type LoginResponse,
  type MfaVerifyResponse,
  type RefreshResponse,
} from "@ecoledigitale/contracts/v2/iam";
import type { ZodTypeAny, z } from "zod";

export interface ClientHints {
  /** Adresse du navigateur (premier élément de `x-forwarded-for`). */
  ip?: string | null;
  userAgent?: string | null;
}

/** Erreur d'API normalisée ; `message` est générique (jamais de détail interne). */
export class IamApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;
  constructor(init: { status: number; code: string; message?: string; retryAfterSec?: number | null }) {
    super(init.message ?? init.code);
    this.name = "IamApiError";
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSec = init.retryAfterSec ?? null;
  }
}

export interface IamServerClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

export function createIamServerClient(options: IamServerClientOptions) {
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call<S extends ZodTypeAny>(
    path: string,
    schema: S | null,
    init: { body?: Json; bearer?: string; hints?: ClientHints; method?: string; extraHeaders?: Record<string, string>; absolute?: boolean },
  ): Promise<S extends ZodTypeAny ? z.output<S> : undefined> {
    const headers: Record<string, string> = { Accept: "application/json", ...(init.extraHeaders ?? {}) };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`;
    if (init.hints?.ip) headers["X-Forwarded-For"] = init.hints.ip;
    if (init.hints?.userAgent) headers["User-Agent"] = init.hints.userAgent.slice(0, 300);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
    let response: Response;
    try {
      response = await doFetch(init.absolute ? `${base}${path}` : `${base}/api/v1/iam${path}`, {
        method: init.method ?? "POST",
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch {
      throw new IamApiError({ status: 0, code: "iam.unreachable", message: "Service d'authentification injoignable." });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 204) return undefined as never;
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      const code = typeof (body as { code?: unknown } | undefined)?.code === "string" ? (body as { code: string }).code : `http.${response.status}`;
      const retry = Number(response.headers.get("retry-after"));
      throw new IamApiError({ status: response.status, code, retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null });
    }
    if (schema === null) return body as never;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new IamApiError({ status: 502, code: "iam.response_invalid", message: "Réponse d'authentification invalide." });
    return parsed.data as never;
  }

  return {
    login(input: { email: string; password: string; tenantSlug?: string; activeRole?: string; deviceName?: string }, hints?: ClientHints): Promise<LoginResponse> {
      return call("/login", LoginResponseSchema, { body: { ...input, client: "mobile" }, ...(hints ? { hints } : {}) });
    },
    completeChallenge(input: { challengeToken: string; code?: string; recoveryCode?: string }, hints?: ClientHints): Promise<AuthenticatedResponse> {
      return call("/mfa/challenge", AuthenticatedResponseSchema, { body: { ...input, client: "mobile" }, ...(hints ? { hints } : {}) });
    },
    /** Enrôlement MFA consécutif à `mfa_enrollment_required` : `Authorization` = jeton d'enrôlement. */
    verifyEnrollment(input: { enrollmentToken: string; code: string }, hints?: ClientHints): Promise<MfaVerifyResponse> {
      return call("/mfa/verify", MfaVerifyResponseSchema, { body: { code: input.code, client: "mobile" }, bearer: input.enrollmentToken, ...(hints ? { hints } : {}) });
    },
    /**
     * Compte LEGACY du jeton d'accès (`GET /api/v1/auth/whoami`, passerelle IAM -> legacy). `null` si l'API legacy ne le
     * connaît pas (pas de compte legacy, route absente, panne) : l'identifiant de session reste alors celui de l'identité IAM.
     */
    async legacyUserId(accessToken: string, hints?: ClientHints): Promise<string | null> {
      try {
        const body = await call("/api/v1/auth/whoami", null, { method: "GET", bearer: accessToken, absolute: true, ...(hints ? { hints } : {}) });
        const id = (body as { id?: unknown } | undefined)?.id;
        return typeof id === "string" && id.length > 0 ? id : null;
      } catch {
        return null;
      }
    },
    /**
     * Connexion fédérée (Google) : le serveur web a vérifié l'identité (OAuth, `email_verified`) et présente le secret de
     * service `IAM_SERVICE_SECRET`. iam n'ouvre la session que pour une identité EXISTANTE et applique la politique MFA.
     */
    federatedLogin(input: { provider: "google"; email: string; tenantSlug?: string }, serviceSecret: string, hints?: ClientHints): Promise<LoginResponse> {
      return call("/federated-login", LoginResponseSchema, {
        body: { ...input, emailVerified: true, client: "mobile" },
        extraHeaders: { "x-iam-service-secret": serviceSecret },
        ...(hints ? { hints } : {}),
      });
    },
    refresh(refreshToken: string, hints?: ClientHints): Promise<RefreshResponse> {
      return call("/refresh", RefreshResponseSchema, { body: { refreshToken, client: "mobile" }, ...(hints ? { hints } : {}) });
    },
    /** Idempotent, ne révèle rien : accepte un jeton d'accès valide et/ou le refresh token. */
    async logout(input: { accessToken?: string; refreshToken?: string }, hints?: ClientHints): Promise<void> {
      await call("/logout", null, {
        body: input.refreshToken ? { refreshToken: input.refreshToken } : {},
        ...(input.accessToken ? { bearer: input.accessToken } : {}),
        ...(hints ? { hints } : {}),
      });
    },
    switchRole(accessToken: string, activeRole: string, hints?: ClientHints): Promise<LoginResponse> {
      return call("/switch-role", LoginResponseSchema, { body: { activeRole, client: "mobile" }, bearer: accessToken, ...(hints ? { hints } : {}) });
    },
    switchTenant(accessToken: string, tenantId: string, hints?: ClientHints): Promise<LoginResponse> {
      return call("/switch-tenant", LoginResponseSchema, { body: { tenantId, client: "mobile" }, bearer: accessToken, ...(hints ? { hints } : {}) });
    },
    changePassword(accessToken: string, input: { currentPassword: string; newPassword: string }, hints?: ClientHints): Promise<LoginResponse> {
      return call("/password/change", LoginResponseSchema, { body: { ...input, client: "mobile" }, bearer: accessToken, ...(hints ? { hints } : {}) });
    },
    disableMfa(accessToken: string, input: { password: string; code?: string; recoveryCode?: string }, hints?: ClientHints): Promise<LoginResponse> {
      return call("/mfa/disable", LoginResponseSchema, { body: { ...input, client: "mobile" }, bearer: accessToken, ...(hints ? { hints } : {}) });
    },
  };
}

export type IamServerClient = ReturnType<typeof createIamServerClient>;

/** Premier élément de `x-forwarded-for` (relayé par nginx), sinon `null`. */
export function clientHintsFromHeaders(headers: Record<string, string | string[] | undefined> | undefined): ClientHints {
  const get = (name: string): string | null => {
    const raw = headers?.[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const forwarded = get("x-forwarded-for")?.split(",")[0]?.trim() ?? get("x-real-ip");
  return { ip: forwarded ?? null, userAgent: get("user-agent") };
}
