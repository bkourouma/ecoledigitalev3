/**
 * Port `PeopleQuery` — lecture du personnel, des affectations et des tuteurs (specs 008/009),
 * implémenté par le module `people` au câblage.
 *
 * Repli (spec 017 §7) : sans ce port, la planification fonctionne SANS avertissements de
 * disponibilité ni contrôle d'affectation/compétence, et sans vérification du statut du personnel ;
 * les vues « parent » et « élève » échouent fermées (on ne devine jamais un lien de tutelle).
 */
import type { RequestContext } from "@ecoledigitale/kernel";

export type StaffStatus = "ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "LEFT";

export interface StaffInfo {
  readonly id: string;
  readonly displayName: string;
  readonly status: StaffStatus;
  /** Compte utilisateur lié (pour « mon emploi du temps ») ; null si aucun. */
  readonly userId: string | null;
}

export interface StaffAvailabilityInfo {
  readonly staffId: string;
  /** Jour ISO 1..7 pour une règle hebdomadaire ; null pour une date précise. */
  readonly weekday: number | null;
  readonly date: string | null;
  /** `HH:MM` (heure locale de l'établissement). */
  readonly startTime: string;
  readonly endTime: string;
  readonly kind: "AVAILABLE" | "UNAVAILABLE";
}

export interface StaffCompetencyInfo {
  readonly staffId: string;
  readonly subjectId: string | null;
  readonly curriculumNodeId: string | null;
}

/** Statuts d'un membre du personnel pour lesquels on peut planifier (R15). */
export const PLANNABLE_STAFF_STATUSES: readonly StaffStatus[] = Object.freeze(["ACTIVE", "ON_LEAVE"]);

export interface PeopleQuery {
  getStaffByIds(ctx: RequestContext, ids: readonly string[]): Promise<StaffInfo[]>;
  /** Membres du personnel enseignant (catégorie `can_teach`), pour proposer des remplaçants. */
  listTeachingStaff(ctx: RequestContext): Promise<StaffInfo[]>;
  listAvailabilities(ctx: RequestContext, staffIds: readonly string[], range: { from: string; to: string }): Promise<StaffAvailabilityInfo[]>;
  listCompetencies(ctx: RequestContext, staffIds: readonly string[]): Promise<StaffCompetencyInfo[]>;
  isStaffAssignedToClassroom(ctx: RequestContext, staffId: string, classroomId: string, onDate?: string): Promise<boolean>;
  /** L'utilisateur est-il tuteur (lié, non révoqué) de cet élève ? Revérifié à chaque lecture. */
  isGuardianOfStudent(ctx: RequestContext, userId: string, studentId: string): Promise<boolean>;
  /** Membre du personnel lié à l'utilisateur (identité dérivée du jeton, jamais d'un paramètre). */
  resolveStaffForUser(ctx: RequestContext, userId: string): Promise<string | null>;
  /** Élève lié à l'utilisateur. */
  resolveStudentForUser(ctx: RequestContext, userId: string): Promise<string | null>;
}
