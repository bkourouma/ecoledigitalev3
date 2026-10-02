/**
 * API PUBLIQUE du module `iam` (ADR-001 : seul point d'import pour les autres modules
 * et pour l'API legacy pendant la coexistence).
 *
 * Usage typique (câblage dans le registre / le basculement du login) :
 *
 *   const config = loadIamConfig();                       // lève si un secret manque
 *   const iam = createIamService({ config, tenantDb, systemDb, limiter: new RedisRateLimiter(redis), notifier });
 *   await registerIam(app, { iam, requirePermission, authenticateSuperAdmin });   // /api/v1/iam/*
 *
 *   // N'importe où ailleurs : transformer un jeton en contexte (toutes méthodes HTTP, révocation comprise)
 *   const r = await buildRequestContextFromToken(token, iam, { expectedTenantSlug });
 *   if (r.ok) { const { ctx, claims } = r.value; ... }
 */
import { resolve } from "node:path";
import type { RequestContext, Result, AppError } from "@ecoledigitale/kernel";
import type { AuthenticateOptions, AuthenticatedRequest } from "./application/sessions";
import type { IamService } from "./application/service";
import { peekJwtTyp } from "./domain/tokens";

export { default as manifest } from "./manifest";

// Configuration
export { loadIamConfig, loadFederationSecret, buildIamConfig, IamConfigError, type IamConfig, type IamConfigInput } from "./config";

// Composition et use cases
export { createIamService, createBackgroundTasks, type IamService, type IamServiceOptions } from "./application/service";
export { type LoginOutcome, type AuthenticatedOutcome, type IssuedSession, type UserSummary } from "./application/session-issue";
export { type ProvisionInput, type ProvisionOutcome } from "./application/members";
export { type AuthenticatedRequest, type AuthenticateOptions } from "./application/sessions";
export { IAM_EVENT, type IamEventType, type IamDeps, type RequestMeta } from "./application/deps";
export {
  noopNotifier,
  type AccountNotifier,
  type AuthenticatedPrincipal,
  type BackgroundTasks,
  type RateLimiter,
  type SuperAdminActor,
  type SuperAdminAuthenticator,
} from "./application/ports";

// Jetons
export {
  verifyAccessToken,
  type AccessClaims,
  type ImpersonationClaims,
  type BearerClaims,
} from "./domain/access-token";

// Annuaire minimal des accès (repli de nom d'affichage pour les adaptateurs de plateforme)
export { getMemberEmails } from "./application/directory";

// Politiques
export { createMfaPolicy, mfaRequiredFor, type MfaPolicy } from "./domain/mfa-policy";
export { PasswordPolicy, type PasswordIssue } from "./domain/password-policy";
export { PasswordHasher } from "./domain/password-hash";

// Limiteurs de débit
export { MemoryRateLimiter } from "./infrastructure/rate-limiter.memory";
export { RedisRateLimiter, type RedisLike } from "./infrastructure/rate-limiter.redis";

// HTTP
export { iamPlugin, iamAuthHook, registerIam, IAM_PREFIX, type IamPluginOptions } from "./http/plugin";

/**
 * Ce jeton est-il un jeton porteur IAM v2 (accès ou impersonation) ? Lecture de l'en-tête SEULEMENT, sans
 * rien accorder : sert à la plateforme à aiguiller un jeton vers l'authentification IAM ou legacy (les JWT
 * legacy portent `typ: "JWT"`). La vérification réelle (signature, session, révocation) reste à `authenticate`.
 */
export function isIamBearerToken(token: string): boolean {
  const typ = peekJwtTyp(token);
  return typ === "at+jwt" || typ === "imp+jwt";
}

/** Dossier des migrations SQL du module (schéma `iam`), à passer au runner de `@ecoledigitale/database`. */
export const IAM_MIGRATIONS_DIR = resolve(__dirname, "migrations");

/**
 * Transforme un jeton d'accès en `RequestContext` : signature, en-tête, forme, dates,
 * puis ÉTAT DE LA SESSION en base (révocation, époque, accès actif, tenant actif) —
 * pour toutes les méthodes HTTP. Le tenant du jeton n'est utilisé qu'après la
 * vérification de signature, et confronté à la session lue sous RLS.
 *
 * Contexte renvoyé : `roles = [rôle actif]` ; `actor = "superAdmin"` pour une
 * impersonation (l'acteur réel est dans `principal.impersonatedBy` / `claims.act`).
 */
export async function buildRequestContextFromToken(
  token: string,
  iam: Pick<IamService, "authenticate">,
  options?: AuthenticateOptions,
): Promise<Result<{ ctx: RequestContext; claims: AuthenticatedRequest["claims"]; principal: AuthenticatedRequest["principal"] }, AppError>> {
  const result = await iam.authenticate(token, options);
  if (!result.ok) return result;
  const { principal, claims } = result.value;
  return { ok: true, value: { ctx: principal.ctx, claims, principal } };
}
