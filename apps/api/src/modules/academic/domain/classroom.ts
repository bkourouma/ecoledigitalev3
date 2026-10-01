/**
 * Classes / promotions (`Classroom`, jamais la salle physique) : machine d'états et règles d'accès.
 * Miroir de `classrooms_guard`.
 */
import type { AcademicClassroomStatus } from "@ecoledigitale/contracts/src/v2/academic";

export const CLASSROOM_TRANSITIONS: Readonly<Record<AcademicClassroomStatus, readonly AcademicClassroomStatus[]>> = Object.freeze({
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "CANCELLED", "DRAFT"],
  COMPLETED: ["ARCHIVED", "ACTIVE"],
  CANCELLED: ["DRAFT"],
  ARCHIVED: ["COMPLETED"],
});

export function canTransitionClassroom(from: AcademicClassroomStatus, to: AcademicClassroomStatus): boolean {
  return CLASSROOM_TRANSITIONS[from].includes(to);
}

/** Action d'état -> statut cible (routes `/classrooms/:id/{activate,complete,cancel}`). */
export const CLASSROOM_ACTION_TARGETS = Object.freeze({ activate: "ACTIVE", complete: "COMPLETED", cancel: "CANCELLED" } as const satisfies Record<string, AcademicClassroomStatus>);
export type ClassroomAction = keyof typeof CLASSROOM_ACTION_TARGETS;

/**
 * Une classe accepte de nouvelles inscriptions en brouillon (pré-inscriptions avant l'ouverture) comme active ;
 * terminée, annulée ou archivée, jamais.
 */
export function classroomAcceptsEnrollment(status: AcademicClassroomStatus): boolean {
  return status === "DRAFT" || status === "ACTIVE";
}

/** Une classe active exige un curriculum choisi ET publié (AC3.1, Q-07). */
export function classroomActivationProblem(input: { curriculumVersionId: string | null; versionStatus: string | null }): "curriculum_required" | "curriculum_draft" | null {
  if (input.curriculumVersionId === null) return "curriculum_required";
  if (input.versionStatus === "DRAFT" || input.versionStatus === null) return "curriculum_draft";
  return null;
}

/** Date de fin d'une classe bornée à son année : contrôle de cohérence, jamais de constante. */
export function classroomDatesProblem(startsOn: string | null, endsOn: string | null): boolean {
  return startsOn !== null && endsOn !== null && endsOn < startsOn;
}
