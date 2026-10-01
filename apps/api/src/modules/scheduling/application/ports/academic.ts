/**
 * Port `AcademicQuery` — lecture du cœur académique (spec 004), implémenté par le module `academic`
 * au câblage. `scheduling` ne connaît les classes, offres, nœuds de curriculum, périodes et inscriptions
 * que par UUID, SANS clé étrangère : ce port est le seul moyen de les vérifier (conventions n° 1).
 *
 * Échec fermé : sans ce port, aucune écriture liée à une classe n'est possible
 * (`scheduling.academic_unavailable`) ; les séances sans classe (réunions, réservations de salle)
 * restent possibles.
 */
import type { RequestContext } from "@ecoledigitale/kernel";

export interface ClassroomInfo {
  readonly id: string;
  readonly institutionId: string;
  readonly campusId: string | null;
  readonly academicYearId: string;
  readonly name: string;
  /** Effectif actif (pour l'avertissement de capacité de salle) ; null si inconnu. */
  readonly headcount: number | null;
}

/** Statuts d'offre à la carte (spec 004). Seuls `OPEN`, `FULL`, `IN_PROGRESS` sont planifiables (R15). */
export type OfferingStatus = "DRAFT" | "OPEN" | "FULL" | "IN_PROGRESS" | "CLOSED" | "CANCELLED";
export const SCHEDULABLE_OFFERING_STATUSES: readonly OfferingStatus[] = Object.freeze(["OPEN", "FULL", "IN_PROGRESS"]);

export interface OfferingInfo {
  readonly id: string;
  readonly classroomId: string;
  readonly curriculumNodeId: string;
  readonly status: OfferingStatus;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly label: string;
  /** Offre à la carte : la classe n'est pas réunie (`claims_classroom = false`). */
  readonly aLaCarte: boolean;
  readonly headcount: number | null;
}

export interface CurriculumNodeInfo {
  readonly id: string;
  readonly label: string;
  /** Volume horaire du nœud en MINUTES (plafond optionnel de la génération, AC2.3) ; null si non défini. */
  readonly hoursTotalMinutes: number | null;
  /** Matière du catalogue (pour l'adéquation des compétences) ; null si non définie. */
  readonly subjectId: string | null;
}

export interface PeriodInfo {
  readonly id: string;
  readonly academicYearId: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

export interface StudentPlacements {
  /** Classes où l'apprenant a une inscription active. */
  readonly classroomIds: readonly string[];
  /** Offres à la carte auxquelles il est inscrit (sélection confirmée). */
  readonly offeringIds: readonly string[];
}

export interface AcademicQuery {
  getClassroom(ctx: RequestContext, id: string): Promise<ClassroomInfo | null>;
  getOffering(ctx: RequestContext, id: string): Promise<OfferingInfo | null>;
  getCurriculumNode(ctx: RequestContext, id: string): Promise<CurriculumNodeInfo | null>;
  getPeriod(ctx: RequestContext, id: string): Promise<PeriodInfo | null>;
  /** Année (et période) qui contiennent la date, pour un établissement. */
  resolvePeriodForDate(ctx: RequestContext, institutionId: string, date: string): Promise<{ academicYearId: string; periodId: string | null } | null>;
  /** Placements ACTIFS d'un apprenant (classes et offres), pour l'emploi du temps élève/parent. */
  listStudentPlacements(ctx: RequestContext, studentId: string): Promise<StudentPlacements>;
}
