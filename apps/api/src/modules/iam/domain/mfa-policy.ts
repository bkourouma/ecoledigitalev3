/**
 * Politique MFA par rôle / permission sensible (pure).
 *
 * Le module `rbac` (à venir) fournira les permissions marquées `sensitive` dans
 * les manifestes ; d'ici là, la politique repose sur la liste de rôles de la
 * configuration (`IAM_MFA_REQUIRED_ROLES`) et sur toute permission sensible
 * explicitement passée à `requiredFor`.
 */
export interface MfaPolicy {
  /** La MFA est-elle OBLIGATOIRE pour quelqu'un qui détient ces rôles (et éventuellement ces permissions sensibles) ? */
  requiredFor(roles: readonly string[], sensitivePermissions?: readonly string[]): boolean;
  readonly requiredRoles: readonly string[];
}

export function createMfaPolicy(requiredRoles: readonly string[]): MfaPolicy {
  const set = new Set(requiredRoles.map((r) => r.trim().toLowerCase()).filter(Boolean));
  return Object.freeze({
    requiredRoles: Object.freeze([...set]),
    requiredFor(roles: readonly string[], sensitivePermissions: readonly string[] = []): boolean {
      if (sensitivePermissions.length > 0) return true;
      return roles.some((r) => set.has(r.trim().toLowerCase()));
    },
  });
}

/** Raccourci conforme à la spécification : `mfaRequiredFor(roles)`. */
export function mfaRequiredFor(requiredRoles: readonly string[], roles: readonly string[], sensitivePermissions?: readonly string[]): boolean {
  return createMfaPolicy(requiredRoles).requiredFor(roles, sensitivePermissions);
}
