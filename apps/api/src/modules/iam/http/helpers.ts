/**
 * Aides HTTP : cookies (sans dépendance), métadonnées de requête, sérialisation
 * des réponses d'authentification.
 *
 * Choix de transport du refresh token (ADR-008) :
 *  - WEB (`client: "web"`, défaut) : cookie `HttpOnly; Secure; SameSite=Lax;
 *    Path=/api/v1/iam`. Inaccessible au JavaScript (XSS ne peut pas l'exfiltrer),
 *    jamais envoyé hors des routes iam. Le corps de réponse NE contient PAS le refresh token.
 *    Les routes qui s'appuient sur ce cookie (refresh, logout) contrôlent l'en-tête
 *    `Origin` (refus 403 si l'origine n'est pas autorisée) ; les corps non JSON sont
 *    refusés (415 formulaire, 400 text/plain rejeté par le schéma strict) ;
 *  - MOBILE (`client: "mobile"`) : le refresh token est dans le CORPS de la réponse
 *    (stockage Keychain/Keystore côté app) et renvoyé dans le corps de `/refresh`.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { ForbiddenError, newId, type AppError } from "@ecoledigitale/kernel";
import { AuthErrorCodes, type LoginResponse, type MfaVerifyResponse } from "@ecoledigitale/contracts/v2/iam";
import type { IamConfig } from "../config";
import { cleanIp, cleanText, type RequestMeta } from "../application/deps";
import type { LoginOutcome, AuthenticatedOutcome } from "../application/session-issue";

export type Client = "web" | "mobile";

export function requestMeta(request: FastifyRequest): RequestMeta {
  const ua = request.headers["user-agent"];
  return {
    ip: cleanIp(request.ip),
    userAgent: cleanText(typeof ua === "string" ? ua : null, 300),
    requestId: typeof request.id === "string" && request.id.length > 0 && request.id.length <= 100 ? request.id : newId(),
  };
}

export function noStore(reply: FastifyReply): void {
  void reply.header("Cache-Control", "no-store");
  void reply.header("Pragma", "no-cache");
}

// -----------------------------------------------------------------------------
// Cookies
// -----------------------------------------------------------------------------

export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (typeof header !== "string" || header.length > 8192) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      return /^[A-Za-z0-9._~-]+$/.test(value) ? value : null;
    }
  }
  return null;
}

function cookieAttributes(config: IamConfig, extra: string[]): string {
  const attrs = ["Path=" + config.cookie.path, "HttpOnly", "SameSite=Lax", ...extra];
  if (config.cookie.secure) attrs.push("Secure");
  if (config.cookie.domain) attrs.push("Domain=" + config.cookie.domain);
  return attrs.join("; ");
}

export function setRefreshCookie(reply: FastifyReply, config: IamConfig, token: string, expiresAt: Date, now: Date): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  void reply.header("Set-Cookie", `${config.cookie.name}=${token}; ${cookieAttributes(config, [`Max-Age=${maxAge}`, `Expires=${expiresAt.toUTCString()}`])}`);
}

export function clearRefreshCookie(reply: FastifyReply, config: IamConfig): void {
  void reply.header("Set-Cookie", `${config.cookie.name}=; ${cookieAttributes(config, ["Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"])}`);
}

/** Contrôle CSRF complémentaire à SameSite=Lax pour les routes qui lisent le cookie. */
export function assertAllowedOrigin(request: FastifyRequest, config: IamConfig): AppError | null {
  const origin = request.headers.origin;
  if (origin === undefined) return null; // client non navigateur (mobile, curl) : pas de cookie ambiant à protéger
  if (typeof origin !== "string") return deny();
  if (config.allowedOrigins.length > 0) return config.allowedOrigins.includes(origin) ? null : deny();
  // Aucune liste configurée : même origine uniquement.
  const host = request.headers.host;
  try {
    return typeof host === "string" && new URL(origin).host === host ? null : deny();
  } catch {
    return deny();
  }
}

const deny = (): AppError => new ForbiddenError("Origine non autorisée.", { code: AuthErrorCodes.forbidden });

// -----------------------------------------------------------------------------
// En-tête Authorization
// -----------------------------------------------------------------------------

const BEARER = /^Bearer ([A-Za-z0-9._-]{20,4096})$/;

export function bearerToken(request: FastifyRequest): string | null {
  const h = request.headers.authorization;
  if (typeof h !== "string") return null;
  const m = BEARER.exec(h);
  return m ? (m[1] as string) : null;
}

// -----------------------------------------------------------------------------
// Réponses
// -----------------------------------------------------------------------------

const ttlSec = (o: AuthenticatedOutcome): number => Math.max(1, o.session.claims.exp - o.session.claims.iat);

export function authenticatedBody(now: Date, o: AuthenticatedOutcome, client: Client): Extract<LoginResponse, { status: "authenticated" }> {
  const refreshTtl = o.session.refreshExpiresAt ? Math.max(1, Math.floor((o.session.refreshExpiresAt.getTime() - now.getTime()) / 1000)) : undefined;
  return {
    status: "authenticated",
    tokenType: "Bearer",
    accessToken: o.session.accessToken,
    expiresIn: ttlSec(o),
    ...(client === "mobile" && o.session.refreshToken ? { refreshToken: o.session.refreshToken, ...(refreshTtl ? { refreshExpiresIn: refreshTtl } : {}) } : {}),
    sessionId: o.session.sessionId,
    user: o.user,
    tenants: o.tenants,
  };
}

/** Prépare la réponse (cookie ou corps) pour un résultat d'authentification quelconque. */
export function presentOutcome(reply: FastifyReply, config: IamConfig, now: Date, outcome: LoginOutcome, client: Client): LoginResponse {
  noStore(reply);
  switch (outcome.status) {
    case "authenticated":
      if (client === "web" && outcome.session.refreshToken && outcome.session.refreshExpiresAt) {
        setRefreshCookie(reply, config, outcome.session.refreshToken, outcome.session.refreshExpiresAt, now);
      }
      return authenticatedBody(now, outcome, client);
    case "mfa_required":
      return { status: "mfa_required", challengeToken: outcome.challengeToken, expiresIn: outcome.expiresInSec, methods: outcome.methods };
    case "mfa_enrollment_required":
      return { status: "mfa_enrollment_required", enrollmentToken: outcome.enrollmentToken, expiresIn: outcome.expiresInSec };
  }
}

export function presentVerify(reply: FastifyReply, config: IamConfig, now: Date, recoveryCodes: string[], session: AuthenticatedOutcome | undefined, client: Client): MfaVerifyResponse {
  noStore(reply);
  if (!session) return { recoveryCodes };
  if (client === "web" && session.session.refreshToken && session.session.refreshExpiresAt) {
    setRefreshCookie(reply, config, session.session.refreshToken, session.session.refreshExpiresAt, now);
  }
  return { recoveryCodes, session: authenticatedBody(now, session, client) };
}
