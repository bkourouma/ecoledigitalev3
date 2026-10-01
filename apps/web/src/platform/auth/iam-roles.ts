/**
 * Rôles IAM v2 -> vocabulaire de l'interface (legacy : `owner`, `admin`, `teacher`, `parent`, `student`, `formateur`).
 *
 * Toutes les pages, `routeForRole`, `isAdminRole` et les gardes lisent `session.activeRole` / `roles` /
 * `availableRoles` dans ce vocabulaire. Les rôles d'un accès IAM peuvent être des clés legacy (comptes importés par
 * `pnpm iam:import-legacy`) ou des modèles RBAC (`enseignant`, `directeur`… : comptes créés dans iam) ; la
 * traduction est l'INVERSE STRICT de `legacyRoleToTemplate`, partagée avec l'API
 * (`packages/contracts/src/v2/iam-legacy-roles.ts`). Les rôles IAM d'origine restent disponibles (`iamRoles`,
 * `iamActiveRole`) : c'est dans ce vocabulaire-là que l'API attend `switch-role`.
 */
import { iamRolesToLegacy } from "@ecoledigitale/contracts/v2/iam-legacy-roles";

export interface SessionRoleFields {
  activeRole: string;
  roles: string[];
  availableRoles: string[];
  iamActiveRole: string;
  iamRoles: string[];
}

/** Rôles de session à partir de ceux de l'accès IAM. Un rôle sans équivalent reste visible (l'API refusera les routes legacy). */
export function sessionRolesFromIam(iamActiveRole: string, iamRoles: readonly string[]): SessionRoleFields {
  const view = iamRolesToLegacy(iamActiveRole, iamRoles);
  const activeRole = view.active ?? iamActiveRole;
  return {
    activeRole,
    roles: [activeRole],
    availableRoles: view.available.length > 0 ? view.available : [...iamRoles],
    iamActiveRole,
    iamRoles: [...iamRoles],
  };
}

/**
 * Rôle IAM à demander à `switch-role` pour obtenir le rôle d'interface `legacyRole` : la clé identique si l'accès la
 * porte, sinon le premier rôle IAM qui s'y traduit (`directeur` pour `admin`). `null` si l'accès ne le permet pas.
 */
export function iamRoleForLegacy(legacyRole: string, iamRoles: readonly string[]): string | null {
  const wanted = legacyRole.trim().toLowerCase();
  if (iamRoles.some((r) => r.trim().toLowerCase() === wanted)) return iamRoles.find((r) => r.trim().toLowerCase() === wanted) ?? null;
  return iamRoles.find((r) => iamRolesToLegacy(r, iamRoles).active === wanted) ?? null;
}
