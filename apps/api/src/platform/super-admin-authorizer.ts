/**
 * `SuperAdminAuthorizer` : qui est opérateur de la plateforme ?
 *
 * Implémenté à partir du JWT super-admin LEGACY (`services/super-admin-jwt.service.ts`), qui est SÉPARÉ du JWT
 * tenant (émetteur `ecoledigitale-super-admin`, audience `super-admin`, `scope: super_admin`, secret
 * `SUPER_ADMIN_JWT_SECRET`). Le même authorizer sert :
 *   - le module `entitlements` (routes `/api/v1/entitlements/admin/*`) ;
 *   - le module `iam` (impersonation `POST /api/v1/iam/impersonation`) ;
 *   - le module `platform` (console `/api/v1/platform/*`).
 *
 * Contrôles (tous obligatoires, échec fermé) :
 *   1. jeton porteur présent et de la bonne forme ;
 *   2. signature, émetteur, audience, expiration (`verify`) ET `scope === "super_admin"` ;
 *   3. identifiant d'opérateur = UUID ;
 *   4. jeton non révoqué (liste noire legacy) — vérifié sur TOUTES les méthodes HTTP (le middleware legacy ne le
 *      vérifie que sur POST/PUT/PATCH/DELETE : défaut connu, non reproduit ici) ;
 *   5. compte opérateur actif.
 *
 * Aucun contexte de tenant n'est exigé : un opérateur n'a pas de rôle de tenant (voir `entitlements` README).
 * Les dépendances sont injectables : les tests n'ont besoin ni de la base legacy ni de ses services.
 */
import { ForbiddenError, UnauthorizedError, isUuid } from "@ecoledigitale/kernel";
import type { SuperAdminAuthorizer, SuperAdminIdentity } from "./runtime";

export interface SuperAdminTokenClaims {
  superAdminId: string;
  email: string;
  jti: string;
  scope: string;
}

export interface SuperAdminAuthDeps {
  /** Vérifie signature, émetteur, audience, expiration ; LÈVE si le jeton est invalide. */
  verify(token: string): SuperAdminTokenClaims;
  isRevoked(claims: SuperAdminTokenClaims): Promise<boolean>;
  /** `false` ⇒ compte désactivé ou inconnu. Absent ⇒ pas de contrôle (déconseillé hors tests). */
  isActive?(superAdminId: string): Promise<boolean>;
}

const BEARER = /^Bearer ([A-Za-z0-9._-]{20,4096})$/;

export const SuperAdminAuthCode = {
  missing: "platform.operator_token_missing",
  invalid: "platform.operator_token_invalid",
  revoked: "platform.operator_token_revoked",
  inactive: "platform.operator_inactive",
} as const;

export function createSuperAdminAuthorizer(deps: SuperAdminAuthDeps): SuperAdminAuthorizer {
  return {
    async authorize(request): Promise<SuperAdminIdentity> {
      const header = request.headers.authorization;
      const token = typeof header === "string" ? BEARER.exec(header)?.[1] : undefined;
      if (!token) throw new UnauthorizedError("Authentification de l'opérateur requise.", { code: SuperAdminAuthCode.missing });

      let claims: SuperAdminTokenClaims;
      try {
        claims = deps.verify(token);
      } catch {
        // Jeton de tenant, expiré, forgé… : message unique, sans détail exploitable.
        throw new UnauthorizedError("Jeton d'opérateur invalide.", { code: SuperAdminAuthCode.invalid });
      }
      if (claims.scope !== "super_admin" || !isUuid(claims.superAdminId) || typeof claims.jti !== "string" || claims.jti === "") {
        throw new UnauthorizedError("Jeton d'opérateur invalide.", { code: SuperAdminAuthCode.invalid });
      }
      if (await deps.isRevoked(claims)) {
        throw new UnauthorizedError("Jeton d'opérateur révoqué.", { code: SuperAdminAuthCode.revoked });
      }
      if (deps.isActive && !(await deps.isActive(claims.superAdminId))) {
        throw new ForbiddenError("Compte opérateur désactivé.", { code: SuperAdminAuthCode.inactive });
      }
      return { actorId: claims.superAdminId.toLowerCase(), email: claims.email };
    },
  };
}

/** Pool legacy minimal (`fastify.pg`). */
export interface LegacyQueryPool {
  connect(): Promise<{ query(text: string, values?: unknown[]): Promise<{ rows: any[] }>; release(): void }>;
}

/**
 * Dépendances branchées sur le code legacy (JWT super-admin, liste noire, table `super_admin_users`).
 * Imports DYNAMIQUES : `super-admin-jwt.service` lève à l'import si aucun secret n'est défini, et le démarrage
 * legacy ne doit pas dépendre de ce fichier.
 */
export async function legacySuperAdminAuthDeps(pool: LegacyQueryPool): Promise<SuperAdminAuthDeps> {
  const [{ verifySuperAdminToken }, { isBlacklisted }] = await Promise.all([
    import("../services/super-admin-jwt.service"),
    import("../services/blacklist.service"),
  ]);
  // `isBlacklisted` n'utilise que `fastify.pg.connect()`.
  const fastifyLike = { pg: pool } as unknown as Parameters<typeof isBlacklisted>[0];
  return {
    verify: (token) => verifySuperAdminToken(token),
    isRevoked: (claims) => isBlacklisted(fastifyLike, { scope: "super_admin", tokenJti: claims.jti }),
    isActive: async (superAdminId) => {
      const client = await pool.connect();
      try {
        const res = await client.query("SELECT is_active FROM super_admin_users WHERE id = $1", [superAdminId]);
        return res.rows[0]?.is_active === true;
      } finally {
        client.release();
      }
    },
  };
}
