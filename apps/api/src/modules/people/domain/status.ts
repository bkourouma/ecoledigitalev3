/**
 * Machines d'états du statut d'un élève et d'un membre du personnel (fonctions PURES).
 *
 * Les transitions légales sont AUSSI imposées par la base (`people.students_guard`, `people.staff_guard`) : ce module
 * en donne la lecture côté application pour répondre par une erreur métier explicite plutôt que par une violation SQL.
 * Les deux tables de transitions DOIVENT rester identiques à celles des déclencheurs (test de cohérence).
 */
import type { PeopleStaffStatus, PeopleStudentStatus } from "@ecoledigitale/contracts/src/v2/people";

export const STUDENT_STATUSES: readonly PeopleStudentStatus[] = ["ACTIVE", "INACTIVE", "SUSPENDED", "GRADUATED", "WITHDRAWN", "TRANSFERRED_OUT", "EXCLUDED", "ARCHIVED"];

/** Sorties définitives : elles déclenchent le retrait des inscriptions (academic) et la suspension de l'accès (iam). */
export const FINAL_STUDENT_STATUSES: readonly PeopleStudentStatus[] = ["GRADUATED", "WITHDRAWN", "TRANSFERRED_OUT", "EXCLUDED"];

/** Statuts qui exigent un motif (AC3.1). */
const REASON_REQUIRED_TARGETS: readonly PeopleStudentStatus[] = ["EXCLUDED", "WITHDRAWN", "TRANSFERRED_OUT", "SUSPENDED"];

/**
 * Statuts qui sanctionnent : suspension et exclusion sont l'ACTE d'un utilisateur identifié (jamais d'un acteur système) et
 * portent toujours un motif (spec 006 §7.4 / §11.5 : appelés par l'acte humain qui applique une mesure de vie scolaire).
 */
const HUMAN_ACT_TARGETS: readonly PeopleStudentStatus[] = ["SUSPENDED", "EXCLUDED"];
export function requiresHumanActor(to: PeopleStudentStatus): boolean {
  return HUMAN_ACT_TARGETS.includes(to);
}

const STUDENT_TRANSITIONS: Readonly<Record<PeopleStudentStatus, readonly PeopleStudentStatus[]>> = {
  ACTIVE: ["INACTIVE", "SUSPENDED", "GRADUATED", "WITHDRAWN", "TRANSFERRED_OUT", "EXCLUDED"],
  INACTIVE: ["ACTIVE", "GRADUATED", "WITHDRAWN", "TRANSFERRED_OUT", "EXCLUDED"],
  SUSPENDED: ["ACTIVE", "INACTIVE", "WITHDRAWN", "TRANSFERRED_OUT", "EXCLUDED"],
  GRADUATED: ["ARCHIVED", "ACTIVE"],
  WITHDRAWN: ["ARCHIVED", "ACTIVE"],
  TRANSFERRED_OUT: ["ARCHIVED", "ACTIVE"],
  EXCLUDED: ["ARCHIVED", "ACTIVE"],
  ARCHIVED: ["ACTIVE"],
};

export function allowedStudentTransitions(from: PeopleStudentStatus): readonly PeopleStudentStatus[] {
  return STUDENT_TRANSITIONS[from];
}

export function canTransitionStudent(from: PeopleStudentStatus, to: PeopleStudentStatus): boolean {
  return STUDENT_TRANSITIONS[from].includes(to);
}

export function isFinalStudentStatus(status: PeopleStudentStatus): boolean {
  return FINAL_STUDENT_STATUSES.includes(status);
}

/**
 * Un motif est exigé pour `SUSPENDED`, `EXCLUDED`, `WITHDRAWN`, `TRANSFERRED_OUT` et pour tout retour vers `ACTIVE` depuis un statut
 * final ou `ARCHIVED` (réinscription).
 */
export function studentReasonRequired(from: PeopleStudentStatus, to: PeopleStudentStatus): boolean {
  if (REASON_REQUIRED_TARGETS.includes(to)) return true;
  return to === "ACTIVE" && (isFinalStudentStatus(from) || from === "ARCHIVED");
}

/** Un statut pour lequel `left_on` est posé par le changement de statut (R4). */
export function setsLeftOn(to: PeopleStudentStatus): boolean {
  return to === "WITHDRAWN" || to === "EXCLUDED" || to === "TRANSFERRED_OUT" || to === "GRADUATED";
}

/** Statuts à partir desquels l'accès au portail de l'élève doit être suspendu (consommé par `iam`). */
export function suspendsPortalAccess(to: PeopleStudentStatus): boolean {
  return to === "WITHDRAWN" || to === "EXCLUDED" || to === "TRANSFERRED_OUT" || to === "ARCHIVED";
}

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

export const STAFF_STATUSES: readonly PeopleStaffStatus[] = ["ACTIVE", "ON_LEAVE", "SUSPENDED", "LEFT"];

export function canTransitionStaff(from: PeopleStaffStatus, to: PeopleStaffStatus): boolean {
  if (from === "LEFT") return to === "ACTIVE";
  return true;
}

/** Les statuts qui ferment l'accès aux affectations nouvelles. */
export function staffCanReceiveAssignments(status: PeopleStaffStatus): boolean {
  return status === "ACTIVE" || status === "ON_LEAVE";
}

/** `LEFT` et `SUSPENDED` : `people.staff.deactivated` est publié (paie, accès). */
export function deactivatesStaff(to: PeopleStaffStatus): boolean {
  return to === "LEFT" || to === "SUSPENDED";
}
