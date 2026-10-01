/**
 * Compatibilité avec le RBAC legacy (rôles globaux `owner`, `admin`, `teacher`,
 * `student`, `parent`, `formateur`, + `admin_roles` / `role_menu_denials`).
 *
 * Le code legacy n'est PAS modifié. Ces fonctions pures permettent, tranche par
 * tranche, de remplacer une garde par rôle (`requireAdmin`, `requireOwner`…) par
 * une garde par permission SANS perte d'accès : `permissionsForLegacyRoles`
 * calcule ce qu'un porteur de ces rôles legacy obtiendrait avec les modèles v2.
 *
 * MAPPING (documenté aussi dans README.md) :
 *
 *   legacy                   modèle(s) v2
 *   -----------------------  ----------------------------------------------
 *   owner                    owner
 *   admin / administrateur   directeur + secretariat + econome
 *   teacher / formateur      enseignant
 *   student                  eleve
 *   parent                   parent
 *   super_admin              (aucun) — opérateur de la plateforme, hors RBAC tenant
 *
 * Pourquoi `admin` → trois modèles : l'« admin » legacy est un rôle fourre-tout
 * (structure académique, inscriptions, finances, rémunération — cf. le sidebar
 * `ADMIN_MENU_CATALOG`). Aucun modèle v2 isolé ne couvre ce périmètre ;
 * directeur (pilotage + académique) ∪ secretariat (dossiers) ∪ econome (finances)
 * le reproduit sans lui donner les droits propriétaire (abonnement, définition des
 * rôles). Les rôles administratifs personnalisés (`admin_roles`) sont des
 * restrictions de menus : ils se migrent en rôles personnalisés v2, pas ici.
 *
 * Un rôle inconnu ne donne RIEN (refus par défaut).
 */
import { resolveSystemRoles } from "./system-roles";
import type { PermissionCatalog } from "./permission-catalog";
import { SYSTEM_ROLE_TEMPLATES, type SystemRoleTemplate } from "../templates/system-roles";

export const LEGACY_ROLE_TO_TEMPLATES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  owner: ["owner"],
  admin: ["directeur", "secretariat", "econome"],
  administrateur: ["directeur", "secretariat", "econome"],
  teacher: ["enseignant"],
  formateur: ["enseignant"],
  student: ["eleve"],
  parent: ["parent"],
  // Opérateur de plateforme : ne reçoit aucun droit de tenant. Il agit par la console
  // super-admin, ou par impersonation (contexte d'un vrai utilisateur du tenant, auditée).
  super_admin: [],
});

const TEMPLATE_KEYS = new Set(SYSTEM_ROLE_TEMPLATES.map((t) => t.key));

/**
 * Modèles v2 correspondant à UN rôle legacy (insensible à la casse/espaces).
 * Accepte aussi une clé de modèle v2 telle quelle (`econome`, `educateur`…) pour
 * que des jetons mixtes soient traités sans cas particulier. Inconnu → `[]`.
 */
export function legacyRoleToTemplate(role: string): string[] {
  const key = String(role ?? "").trim().toLowerCase();
  if (key === "") return [];
  // `hasOwnProperty` : "__proto__" / "constructor" ne doivent pas atteindre le prototype d'Object.
  if (Object.prototype.hasOwnProperty.call(LEGACY_ROLE_TO_TEMPLATES, key)) {
    return [...(LEGACY_ROLE_TO_TEMPLATES[key] ?? [])];
  }
  return TEMPLATE_KEYS.has(key) ? [key] : [];
}

export interface LegacyPermissionResult {
  /** Permissions concrètes (triées). */
  readonly permissions: readonly string[];
  /** Modèles v2 retenus (sans doublon). */
  readonly templates: readonly string[];
  /** Rôles legacy qui n'ont donné aucun modèle (inconnus ou `super_admin`). */
  readonly unmappedRoles: readonly string[];
  /** Motifs de ces modèles sans correspondance dans le catalogue courant. */
  readonly pending: readonly string[];
}

/** Permissions obtenues par un ensemble de rôles legacy, résolues contre `catalog`. Pure. */
export function resolveLegacyRoles(
  roles: readonly string[],
  catalog: PermissionCatalog,
  templates: readonly SystemRoleTemplate[] = SYSTEM_ROLE_TEMPLATES,
): LegacyPermissionResult {
  const templateKeys = new Set<string>();
  const unmapped: string[] = [];
  for (const role of roles) {
    const mapped = legacyRoleToTemplate(role);
    if (mapped.length === 0) unmapped.push(String(role));
    for (const t of mapped) templateKeys.add(t);
  }
  const selected = templates.filter((t) => templateKeys.has(t.key));
  const permissions = new Set<string>();
  const pending = new Set<string>();
  for (const r of resolveSystemRoles(catalog, selected)) {
    for (const p of r.permissions) permissions.add(p);
    for (const p of r.pending) pending.add(p);
  }
  return Object.freeze({
    permissions: Object.freeze([...permissions].sort()),
    templates: Object.freeze([...templateKeys].sort()),
    unmappedRoles: Object.freeze(unmapped),
    pending: Object.freeze([...pending].sort()),
  });
}

/** Raccourci : les permissions concrètes d'un ensemble de rôles legacy. */
export function permissionsForLegacyRoles(roles: readonly string[], catalog: PermissionCatalog): string[] {
  return [...resolveLegacyRoles(roles, catalog).permissions];
}
