/**
 * Gardes SERVEUR pour layouts et server components (App Router).
 *
 * `createGuards` est une fabrique sans import Next : les dépendances (session, redirection, chemin
 * courant, permissions) sont injectées. `server.ts` en fournit l'instance branchée sur NextAuth et
 * `next/navigation` ; les tests injectent des doubles.
 *
 *   const session = await requireSession();                       // sinon -> /login
 *   await requireRole("admin", "owner");                          // sinon -> /unauthorized (403)
 *   await requirePermission("finance.payment.read");              // sinon -> /unauthorized
 *   await requireAccess((s, pathname) => canAccessOwnerPath(s, pathname));
 *
 * Ces gardes COMPLÈTENT les gardes client (qui restent) ; la vraie barrière sur les données demeure
 * l'API (RBAC + RLS).
 */

import { hasAnyRole, hasPermission, type SessionLike } from "./policies";

export const LOGIN_PATH = "/login";
export const FORBIDDEN_PATH = "/unauthorized";
export const SELECT_ROLE_PATH = "/select-role";

export interface GuardDeps<S extends SessionLike = SessionLike> {
  getSession(): Promise<S | null>;
  /** Doit lever (comme `redirect` de Next) : le garde ne continue jamais après. */
  redirect(path: string): never;
  /** Chemin de la requête courante (en-tête `x-pathname` posé par le middleware), sinon `null`. */
  getPathname(): Promise<string | null> | string | null;
  /** Permissions de l'utilisateur ; `null` quand l'API RBAC est indisponible. */
  fetchPermissions(session: S): Promise<readonly string[] | null>;
}

export interface RequireSessionOptions {
  /** Renvoie vers `/select-role` tant que l'utilisateur doit choisir son rôle actif (défaut : non). */
  requireRoleSelected?: boolean;
}

export interface RequirePermissionOptions extends RequireSessionOptions {
  /**
   * Rôles acceptés si le service de permissions est indisponible (transition avant la livraison du
   * module RBAC). Sans cette option, l'indisponibilité REFUSE l'accès (fail-closed).
   */
  fallbackRoles?: readonly string[];
}

export function createGuards<S extends SessionLike = SessionLike>(deps: GuardDeps<S>) {
  async function requireSession(options: RequireSessionOptions = {}): Promise<S> {
    const session = await deps.getSession();
    // Même critère que les gardes client (`if (!session)`) : pas de boucle /login <-> page si le jeton est atypique.
    if (!session) return deps.redirect(LOGIN_PATH);
    if (options.requireRoleSelected && session.requiresRoleSelection === true) {
      return deps.redirect(SELECT_ROLE_PATH);
    }
    return session;
  }

  async function requireRole(...roles: string[]): Promise<S> {
    const session = await requireSession();
    if (!hasAnyRole(session, roles)) return deps.redirect(FORBIDDEN_PATH);
    return session;
  }

  /** Garde générique : `predicate(session, pathname)` doit renvoyer vrai. */
  async function requireAccess(predicate: (session: S, pathname: string | null) => boolean): Promise<S> {
    const session = await requireSession();
    const pathname = (await deps.getPathname()) ?? null;
    if (!predicate(session, pathname)) return deps.redirect(FORBIDDEN_PATH);
    return session;
  }

  async function requirePermission(permission: string, options: RequirePermissionOptions = {}): Promise<S> {
    const session = await requireSession(options);
    let granted: readonly string[] | null = null;
    try {
      granted = await deps.fetchPermissions(session);
    } catch {
      granted = null;
    }
    if (granted === null) {
      // Service indisponible : refus, sauf repli explicite par rôles.
      if (options.fallbackRoles && hasAnyRole(session, options.fallbackRoles)) return session;
      return deps.redirect(FORBIDDEN_PATH);
    }
    if (!hasPermission(granted, permission)) return deps.redirect(FORBIDDEN_PATH);
    return session;
  }

  return { requireSession, requireRole, requireAccess, requirePermission };
}

export type Guards<S extends SessionLike = SessionLike> = ReturnType<typeof createGuards<S>>;
