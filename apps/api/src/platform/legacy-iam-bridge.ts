/**
 * Passerelle IAM v2 -> API legacy (coexistence, ADR-008).
 *
 * `iam` devient la seule source d'authentification : les routes LEGACY (`/api/v1/students`, `/api/v1/teachers`…)
 * doivent donc accepter un jeton d'accès IAM v2 et lui construire l'`request.user` qu'elles attendent. Ce fichier
 * porte tout ce qui ne dépend pas de Fastify en plus des deux fonctions branchées par le middleware legacy :
 *
 *   1. `iamRolesToLegacy`        rôles de l'accès IAM -> rôles legacy (inverse STRICT de `legacyRoleToTemplate`) ;
 *   2. `LEGACY_TOKEN_SUNSET`     date d'extinction des jetons legacy (`isLegacyTokenSunsetReached`) ;
 *   3. `attachIamLegacyUser`     construit `request.user` (identifiant du compte LEGACY, rôles legacy) ;
 *   4. `peekJwtTyp`              aiguillage jeton IAM / jeton legacy sans rien accorder (en-tête seulement).
 *
 * Contraintes
 *  - AUCUN import de `pg`, du noyau ou des modules v2 : le middleware legacy importe ce fichier, y compris quand la
 *    plateforme v2 est désactivée (alors rien ne l'appelle : comportement legacy inchangé) ;
 *  - l'authentification elle-même (signature, session, révocation sur TOUTES les méthodes, époque, accès et
 *    tenant actifs) est faite par `app.iam.authenticate` dans le crochet `onRequest` de `platform/v2-auth.ts` ; ce
 *    fichier ne fait que traduire son résultat. Le tenant d'un jeton IAM n'est donc jamais lu avant vérification.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { iamRolesToLegacy } from "@ecoledigitale/contracts/src/v2/iam-legacy-roles";
import { setRlsContext } from "../services/rls-context.service";

// -----------------------------------------------------------------------------
// 1. Rôles : inverse documenté de `legacyRoleToTemplate` (modules/rbac/domain/legacy.ts)
// -----------------------------------------------------------------------------
// Fonctions pures partagées avec le web : packages/contracts/src/v2/iam-legacy-roles.ts (voir sa documentation).
export { LEGACY_ROLE_COMPOSITION, LEGACY_ROLE_KEYS, iamRolesToLegacy, type LegacyRoleView } from "@ecoledigitale/contracts/src/v2/iam-legacy-roles";

// -----------------------------------------------------------------------------
// 2. Extinction des jetons legacy (LEGACY_TOKEN_SUNSET)
// -----------------------------------------------------------------------------

export class LegacySunsetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacySunsetConfigError";
  }
}

/**
 * Lit `LEGACY_TOKEN_SUNSET` : date ISO 8601 (`2026-12-01` = 2026-12-01T00:00:00Z, ou date-heure avec fuseau).
 * Absente ou vide : pas d'extinction (les jetons legacy restent acceptés). Invalide : ERREUR — une faute de frappe
 * ne doit ni couper tous les utilisateurs ni laisser les jetons legacy vivre indéfiniment sans que personne le sache
 * (le middleware legacy appelle `assertLegacySunsetConfig` au démarrage).
 */
export function parseLegacyTokenSunset(raw: string | undefined): Date | null {
  const value = raw?.trim();
  if (!value) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    throw new LegacySunsetConfigError("LEGACY_TOKEN_SUNSET doit être une date ISO 8601 avec fuseau (ex. 2026-12-01 ou 2026-12-01T00:00:00Z).");
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new LegacySunsetConfigError("LEGACY_TOKEN_SUNSET n'est pas une date valide.");
  return date;
}

export function legacyTokenSunsetDate(env: NodeJS.ProcessEnv = process.env): Date | null {
  return parseLegacyTokenSunset(env.LEGACY_TOKEN_SUNSET);
}

/** Vrai quand les jetons legacy de tenant ne sont plus acceptés (la date est atteinte). */
export function isLegacyTokenSunsetReached(now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  const at = legacyTokenSunsetDate(env);
  return at !== null && now.getTime() >= at.getTime();
}

/** À appeler au démarrage : lève si la variable est mal formée. */
export function assertLegacySunsetConfig(env: NodeJS.ProcessEnv = process.env): void {
  legacyTokenSunsetDate(env);
}

// -----------------------------------------------------------------------------
// 3. Aiguillage des jetons et passerelle de configuration
// -----------------------------------------------------------------------------

/**
 * Type d'en-tête (`typ`) d'un JWT, SANS vérifier quoi que ce soit : sert uniquement à aiguiller un jeton vers
 * l'authentification IAM (`at+jwt` / `imp+jwt`) ou legacy (`JWT`). Rien n'est accordé sur cette base.
 */
export function peekJwtTyp(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot > 200) return null;
  try {
    const header = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf8")) as { typ?: unknown };
    return typeof header.typ === "string" ? header.typ : null;
  } catch {
    return null;
  }
}

export function isIamAccessTokenShape(token: string): boolean {
  const typ = peekJwtTyp(token);
  return typ === "at+jwt" || typ === "imp+jwt";
}

/** Interrupteur de retour arrière : `V2_LEGACY_IAM_BRIDGE=0` (ou `false`) refuse à nouveau les jetons IAM sur les routes legacy. */
export function legacyIamBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.V2_LEGACY_IAM_BRIDGE?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off");
}

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Posé par `platform/v2-auth.ts` sur une route LEGACY quand un jeton IAM v2 porté par la requête n'a pas pu être
     * authentifié (signature, expiration, session révoquée, accès/tenant inactif, MFA requise…). Le middleware legacy
     * y lit le statut et le code à renvoyer ; jamais de détail interne.
     */
    iamAuthFailure?: { status: number; code: string; message: string };
  }
}

// -----------------------------------------------------------------------------
// 4. request.user legacy à partir de l'accès IAM
// -----------------------------------------------------------------------------

interface LegacyUserRow {
  id: string;
  email: string;
  user_is_active: boolean;
  tenant_is_active: boolean;
}

/** Code stable renvoyé au client legacy pour un échec d'authentification IAM. */
export function legacyCodeForIamError(code: string | undefined): string {
  switch (code) {
    case "iam.token_expired":
      return "TOKEN_EXPIRED";
    case "iam.session_revoked":
      return "TOKEN_REVOKED";
    case "iam.mfa_required":
      return "MFA_REQUIRED";
    default:
      return "TOKEN_INVALID";
  }
}

/**
 * Construit `request.user` (et `userId`, `isAdmin`, `tenantId`, `tenantSlug`) pour un jeton IAM déjà authentifié par
 * le crochet `onRequest`. Renvoie `true` quand une réponse d'erreur a été envoyée (convention du middleware legacy).
 *
 *  - rôles : ceux de l'ACCÈS IAM (autorité), traduits en vocabulaire legacy ; seul le rôle actif est « roles[0] »,
 *    comme pour les jetons legacy ;
 *  - identifiant utilisateur : celui du compte LEGACY du même e-mail dans le tenant du jeton (les tables legacy
 *    référencent `users.id`, pas l'identité IAM). Pas de compte legacy -> 403 `LEGACY_ACCOUNT_MISSING` ;
 *  - un compte legacy ou un tenant legacy désactivé reste refusé (le legacy a ses propres drapeaux).
 */
export async function attachIamLegacyUser(fastify: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const principal = request.iamAuth?.principal;
  if (!principal) {
    const failure = request.iamAuthFailure ?? { status: 401, code: "TOKEN_INVALID", message: "Authentication failed" };
    await reply.status(failure.status).send({ error: failure.status === 403 ? "Forbidden" : "Authentication Failed", message: failure.message, code: failure.code });
    return true;
  }

  const tenantId = principal.ctx.tenantId;
  if (request.tenantId && request.tenantId !== tenantId) {
    await reply.status(401).send({ error: "Tenant Mismatch", message: "Token tenant does not match request context", code: "TENANT_MISMATCH" });
    return true;
  }

  const view = iamRolesToLegacy(principal.activeRole, principal.availableRoles);
  if (view.active === null || view.available.length === 0) {
    fastify.log.warn({ tenantId, identityId: principal.identityId, activeRole: principal.activeRole, unmapped: view.unmapped }, "iam -> legacy : aucun rôle legacy équivalent");
    await reply.status(403).send({ error: "Forbidden", message: "This role has no access to this area yet", code: "LEGACY_ROLE_UNMAPPED" });
    return true;
  }

  setRlsContext({ tenantId, isSuperAdmin: false });
  const client = await fastify.pg.connect();
  try {
    const result = await client.query<LegacyUserRow>(
      `SELECT u.id, u.email, COALESCE(u.is_active, true) AS user_is_active, COALESCE(t.is_active, true) AS tenant_is_active
         FROM users u INNER JOIN tenants t ON t.id = u.tenant_id
        WHERE u.tenant_id = $1 AND LOWER(u.email) = LOWER($2)
        ORDER BY u.created_at ASC
        LIMIT 1`,
      [tenantId, principal.email],
    );
    const row = result.rows[0];
    if (!row) {
      fastify.log.warn({ tenantId, identityId: principal.identityId }, "iam -> legacy : aucun compte legacy pour cet accès");
      await reply.status(403).send({ error: "Forbidden", message: "No legacy account for this access", code: "LEGACY_ACCOUNT_MISSING" });
      return true;
    }
    if (!row.tenant_is_active) {
      await reply.status(403).send({ error: "Tenant Disabled", message: "This tenant is disabled", code: "TENANT_DISABLED" });
      return true;
    }
    if (!row.user_is_active) {
      await reply.status(403).send({ error: "Account Disabled", message: "This account is disabled", code: "ACCOUNT_DISABLED" });
      return true;
    }

    request.tenantId = tenantId;
    request.tenantSlug = principal.tenantSlug;
    request.user = {
      id: row.id,
      email: row.email,
      tenantId,
      tenantSlug: principal.tenantSlug,
      activeRole: view.active,
      role: view.active,
      roles: [view.active],
      availableRoles: view.available,
      authSource: "iam",
      iamSessionId: principal.sessionId,
      iamIdentityId: principal.identityId,
      ...(principal.impersonatedBy ? { impersonatedBySuperAdminId: principal.impersonatedBy } : {}),
    };
    request.userId = row.id;
    request.isAdmin = view.active === "admin";
    // Des routes legacy lisent l'en-tête `X-User-Id` (injecté par le navigateur depuis le jeton : ici l'identité IAM).
    // On y pose toujours l'identifiant du compte legacy déduit du jeton vérifié : jamais une valeur fournie par le client.
    (request.headers as Record<string, string>)["x-user-id"] = row.id;
    if (principal.impersonatedBy) {
      // Chaque requête faite sous impersonation est journalisée par plugins/super-admin-audit.ts (acteur réel +
      // utilisateur imité). On ne pose PAS `request.superAdmin` : les routes `/super-admin/*` s'y fient.
      request.iamImpersonation = { superAdminId: principal.impersonatedBy, tenantId, tenantSlug: principal.tenantSlug, impersonatedUserId: row.id };
    }
    return false;
  } finally {
    client.release();
  }
}
