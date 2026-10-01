/**
 * Règles d'accès PURES (aucun import Next/NextAuth) : testables et partagées entre les gardes serveur
 * et, plus tard, le middleware. Les définitions de rôles reprennent exactement celles du Sidebar et des
 * gardes client existants (`lib/role-landing.ts`), afin qu'un menu et l'accès à sa page apparaissent et
 * disparaissent ensemble.
 */

import { isAdminRole } from "@/lib/role-landing";

/** Libellés historiques acceptés pour chaque rôle (comparaison en minuscules). */
export const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  admin: ["admin", "super_admin", "administrateur"],
  owner: ["owner"],
  teacher: ["teacher", "enseignant"],
  student: ["student", "étudiant", "etudiant"],
  parent: ["parent"],
  formateur: ["formateur"],
});

export interface SessionLike {
  user?: { id?: string } | null;
  roles?: unknown;
  activeRole?: unknown;
  requiresRoleSelection?: unknown;
  tenantId?: unknown;
  tenantSlug?: unknown;
  jwtToken?: unknown;
}

export function rolesOf(session: SessionLike | null | undefined): string[] {
  const roles = session?.roles;
  return Array.isArray(roles) ? roles.map((r) => String(r).toLowerCase()) : [];
}

/** Vrai si la session possède l'un des rôles demandés (alias historiques inclus). */
export function hasAnyRole(session: SessionLike | null | undefined, wanted: readonly string[]): boolean {
  const owned = new Set(rolesOf(session));
  if (owned.size === 0) return false;
  for (const role of wanted) {
    const key = role.toLowerCase();
    const accepted = ROLE_ALIASES[key] ?? [key];
    if (accepted.some((alias) => owned.has(alias))) return true;
  }
  return false;
}

/** Une permission accordée couvre la permission requise (`*` et `ressource.*` sont des jokers). */
export function matchesPermission(granted: string, required: string): boolean {
  if (granted === required || granted === "*") return true;
  if (granted.endsWith(".*")) return required.startsWith(granted.slice(0, -1));
  return false;
}

export function hasPermission(granted: readonly string[], required: string): boolean {
  return granted.some((g) => matchesPermission(g, required));
}

// ---------------------------------------------------------------------------------------------------------
// Espaces protégés
// ---------------------------------------------------------------------------------------------------------

function pathMatches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * `/owner/*` : réservé au propriétaire ; l'administration n'y a accès qu'à `/owner/acces`
 * (même règle que le garde client de `app/owner/layout.tsx`).
 */
export function canAccessOwnerPath(session: SessionLike | null | undefined, pathname: string | null): boolean {
  if (hasAnyRole(session, ["owner"])) return true;
  return Boolean(pathname) && isAdminRole(session?.roles) && pathMatches(pathname as string, "/owner/acces");
}

/** `/tableau-de-bord` : administration uniquement (le propriétaire a son propre tableau de bord). */
export function canAccessAdminDashboard(session: SessionLike | null | undefined): boolean {
  return isAdminRole(session?.roles);
}

/**
 * Écrans du Module Professionnel `/professionnel/admin/*` : administration et propriétaire.
 *
 * Exception documentée : la saisie des notes (`/professionnel/admin/notes`) est aussi l'écran de notation
 * de l'enseignant (entrée « Notes » de son menu). Tant que cet écran n'a pas été déplacé
 * vers un espace enseignant, il y garde l'accès — et seulement à celui-là.
 */
export const PROFESSIONAL_ADMIN_SHARED_PREFIXES: readonly string[] = Object.freeze(["/professionnel/admin/notes"]);

export function canAccessProfessionalAdminPath(session: SessionLike | null | undefined, pathname: string | null): boolean {
  if (isAdminRole(session?.roles) || hasAnyRole(session, ["owner"])) return true;
  if (!pathname || !hasAnyRole(session, ["teacher"])) return false;
  return PROFESSIONAL_ADMIN_SHARED_PREFIXES.some((prefix) => pathMatches(pathname, prefix));
}
