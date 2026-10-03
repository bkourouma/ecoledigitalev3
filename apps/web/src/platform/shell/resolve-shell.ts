/**
 * Quelle coque pour quel utilisateur (fonctions PURES, sans import Next).
 *
 * La coque se choisit d'après la SESSION (rôle actif, à défaut permissions), JAMAIS d'après l'URL seule : un même écran de module
 * (`/v2/finance/me/*`, `/v2/examinations/family`, `/v2/schoollife/saisie`...) sert la gestion, les familles et le personnel
 * enseignant ; il s'affiche dans la coque du portail de celui qui le consulte. Les gardes de page et l'API restent les barrières.
 *
 *   - parent                                   -> portail parent
 *   - élève / étudiant                         -> portail élève
 *   - enseignant, instituteur, formateur       -> portail enseignant
 *   - propriétaire, direction, économat, secrétariat, études, examens, admissions, éducateur... -> coque de gestion
 *   - rôle inconnu : permissions (famille / élève / enseignant sans droit de gestion), sinon gestion.
 */

import { hasPermission } from "@/platform/auth/policies";
import { PORTAL_GUARD, type PortalKey } from "@/platform/portal/menus";

export type ShellKind = { kind: "management" } | { kind: "portal"; portal: PortalKey };

/** Rôle actif -> portail (comparaison en minuscules, alias historiques et rôles v2 inclus). */
export const PORTAL_OF_ROLE: Readonly<Record<string, PortalKey>> = Object.freeze({
  parent: "parent",
  student: "student",
  eleve: "student",
  élève: "student",
  etudiant: "student",
  étudiant: "student",
  teacher: "teacher",
  enseignant: "teacher",
  instituteur: "teacher",
  instituteur_maternelle: "teacher",
  formateur: "teacher",
});

/** Rôles de gestion connus (documentation et tests ; tout rôle non listé comme portail reçoit la coque de gestion). */
export const MANAGEMENT_ROLES: readonly string[] = Object.freeze([
  "owner",
  "proprietaire",
  "admin",
  "super_admin",
  "administrateur",
  "directeur",
  "directeur_etudes",
  "responsable_pedagogique",
  "secretariat",
  "econome",
  "educateur",
  "responsable_examens",
  "admissions_officer",
]);

/** Permissions qui signent un compte de GESTION : sa présence écarte le repli « enseignant » par permissions. */
const MANAGEMENT_MARKERS = ["tenancy.institution.read", "rbac.role.read", "people.student.read", "academic.year.read", "finance.invoice.read", "analytics.read", "staff.read"];

export interface ShellInput {
  activeRole?: unknown;
  roles?: unknown;
}

export function activeRoleKey(input: ShellInput): string | null {
  const active = typeof input.activeRole === "string" && input.activeRole !== "" ? input.activeRole : null;
  const first = Array.isArray(input.roles) && typeof input.roles[0] === "string" ? (input.roles[0] as string) : null;
  const role = active ?? first;
  return role ? role.toLowerCase() : null;
}

/** `true` quand le rôle est un rôle de portail connu (inutile alors de lire les permissions). */
export function isKnownRole(role: string | null): boolean {
  return role !== null && (role in PORTAL_OF_ROLE || MANAGEMENT_ROLES.includes(role));
}

export function resolveShellKind(input: ShellInput, permissions: readonly string[] | null = null): ShellKind {
  const role = activeRoleKey(input);
  if (role && role in PORTAL_OF_ROLE) return { kind: "portal", portal: PORTAL_OF_ROLE[role]! };
  if (role && MANAGEMENT_ROLES.includes(role)) return { kind: "management" };
  // Rôle absent ou inconnu : les permissions tranchent (échec « fermé » vers la gestion, dont le menu n'affiche que le permis).
  if (permissions) {
    const has = (list: readonly string[]) => list.some((p) => hasPermission(permissions, p));
    const managing = has(MANAGEMENT_MARKERS);
    if (!managing && has(PORTAL_GUARD.parent)) return { kind: "portal", portal: "parent" };
    if (!managing && has(PORTAL_GUARD.student)) return { kind: "portal", portal: "student" };
    if (!managing && has(PORTAL_GUARD.teacher)) return { kind: "portal", portal: "teacher" };
  }
  return { kind: "management" };
}
