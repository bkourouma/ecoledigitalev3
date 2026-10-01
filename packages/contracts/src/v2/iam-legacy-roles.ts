/**
 * Rôles d'un accès IAM v2 -> rôles du legacy (vocabulaire `owner`, `admin`, `teacher`, `parent`, `student`,
 * `formateur`), pendant la coexistence (ADR-008). FONCTIONS PURES, partagées par l'API (passerelle IAM -> legacy,
 * `apps/api/src/platform/legacy-iam-bridge.ts`) et par le web (pages, `/select-role`, atterrissage par rôle).
 *
 * C'est l'INVERSE STRICT de `legacyRoleToTemplate` (modules/rbac/domain/legacy.ts), dont le miroir
 * `LEGACY_ROLE_COMPOSITION` est vérifié par un test (`apps/api/test/legacy-iam-bridge.test.ts`) :
 *
 *   legacy                     modèles RBAC v2
 *   -------------------------  ----------------------------------------
 *   owner                      owner
 *   admin                      directeur + secretariat + econome
 *   teacher                    enseignant
 *   student                    eleve
 *   parent                     parent
 *
 *  - une clé legacy (`owner`, `admin`, `teacher`…) vaut elle-même : c'est ce que l'import des comptes écrit dans
 *    l'accès (`pnpm iam:import-legacy`) ;
 *  - une clé de modèle RBAC ne vaut un rôle legacy que si l'accès tient TOUS les modèles qui le composent
 *    (moindre privilège) : `directeur` seul n'est PAS `admin` ;
 *  - `super_admin` et toute clé inconnue : aucun rôle legacy (échec fermé).
 */

/** Rôles globaux du legacy (table `roles`). Conservés tels quels dans `iam.memberships.roles` à l'import. */
export const LEGACY_ROLE_KEYS: readonly string[] = Object.freeze(["owner", "admin", "administrateur", "teacher", "formateur", "student", "parent"]);

/** Pour chaque rôle legacy, les modèles RBAC v2 qui le composent (miroir de `LEGACY_ROLE_TO_TEMPLATES`). */
export const LEGACY_ROLE_COMPOSITION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  owner: ["owner"],
  admin: ["directeur", "secretariat", "econome"],
  teacher: ["enseignant"],
  student: ["eleve"],
  parent: ["parent"],
});

/** Ordre de préférence quand plusieurs rôles legacy sont tenus (même ordre que `ROLE_PRIORITY` du legacy). */
const LEGACY_PRIORITY = ["admin", "owner", "teacher", "parent", "student", "formateur", "administrateur"];

export interface LegacyRoleView {
  /** Rôle actif en vocabulaire legacy, ou `null` si le rôle actif n'a aucun équivalent (accès refusé : échec fermé). */
  active: string | null;
  /** Rôles legacy tenus (sans doublon, triés par priorité). */
  available: string[];
  /** Rôles IAM qui n'ont donné aucun rôle legacy (journalisés, jamais élevés). */
  unmapped: string[];
}

const norm = (role: string): string => String(role ?? "").trim().toLowerCase();

function priorityOf(role: string): number {
  const i = LEGACY_PRIORITY.indexOf(role);
  return i === -1 ? LEGACY_PRIORITY.length : i;
}

export function iamRolesToLegacy(activeRole: string, roles: readonly string[]): LegacyRoleView {
  const held = new Set(roles.map(norm).filter(Boolean));
  const legacy = new Set<string>();

  for (const role of held) {
    if (LEGACY_ROLE_KEYS.includes(role)) legacy.add(role);
  }
  const coveredTemplates = new Set<string>();
  for (const [legacyRole, templates] of Object.entries(LEGACY_ROLE_COMPOSITION)) {
    if (!templates.every((t) => held.has(t))) continue; // composition incomplète : rien n'est élevé
    legacy.add(legacyRole);
    for (const t of templates) coveredTemplates.add(t);
  }
  const unmapped = [...held].filter((role) => !LEGACY_ROLE_KEYS.includes(role) && !coveredTemplates.has(role));

  const available = [...legacy].sort((a, b) => priorityOf(a) - priorityOf(b) || a.localeCompare(b));
  const active = norm(activeRole);
  let mapped: string | null = null;
  if (LEGACY_ROLE_KEYS.includes(active)) mapped = active;
  else {
    // Rôle actif exprimé en modèle v2 : le rôle legacy complet qu'il contribue à composer et que l'accès tient.
    mapped = available.find((l) => (LEGACY_ROLE_COMPOSITION[l] ?? []).includes(active)) ?? null;
  }
  return { active: mapped !== null && available.includes(mapped) ? mapped : null, available, unmapped: unmapped.sort() };
}
