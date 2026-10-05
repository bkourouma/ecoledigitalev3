/**
 * Types du GÉNÉRATEUR d'emploi du temps (spec 017, question O-05). Domaine PUR : aucun accès base, aucune horloge
 * implicite, aucun `Math.random`.
 *
 * Modèle : une SEMAINE TYPE. La semaine est une grille `jours × périodes` ; une « séance » occupe 1..n périodes
 * CONSÉCUTIVES d'un même jour. Les besoins (matière × classe × nombre de séances par semaine) sont placés de façon
 * à respecter les contraintes DURES (aucun conflit enseignant / classe / salle, disponibilités, capacité et type de
 * salle) ; les contraintes SOUPLES (trous, répartition, préférences) sont pondérées et minimisées.
 *
 * Aucune règle officielle n'est codée ici : jours, périodes, besoins, disponibilités, salles et pondérations viennent
 * tous de l'appelant (paramètres de l'établissement).
 */

/** Une case de la semaine type : `weekday` (ISO 1..7) et `period` (index dans `GenProblem.periods`). */
export interface SlotRef {
  readonly weekday: number;
  readonly period: number;
}

export interface GenPeriod {
  readonly startMinute: number;
  readonly endMinute: number;
  /** Identifiant de la plage de la grille (`time_slots.id`) si la période en vient. */
  readonly timeSlotId?: string | null;
  readonly label?: string | null;
}

export interface GenTeacher {
  readonly id: string;
  readonly label?: string | null;
  /** Créneaux où l'enseignant est INDISPONIBLE (dur). */
  readonly unavailable: readonly SlotRef[];
  /** Créneaux à éviter (souple). */
  readonly avoid: readonly SlotRef[];
  /** Créneaux préférés (souple) : si renseigné, tout autre créneau est légèrement pénalisé. */
  readonly prefer: readonly SlotRef[];
  /** Plafond de périodes par jour / par semaine (dur) ; `null` = aucun. */
  readonly maxPeriodsPerDay: number | null;
  readonly maxPeriodsPerWeek: number | null;
}

export interface GenClass {
  readonly id: string;
  readonly label?: string | null;
  readonly headcount: number | null;
  /** Créneaux fermés pour cette classe (dur). */
  readonly closed: readonly SlotRef[];
}

export interface GenRoom {
  readonly id: string;
  readonly code: string;
  readonly capacity: number | null;
  readonly roomTypeCode: string;
  readonly features: readonly string[];
  readonly closed: readonly SlotRef[];
}

export interface GenRequirement {
  readonly id: string;
  readonly classroomId: string;
  readonly curriculumNodeId: string;
  readonly offeringId: string | null;
  readonly label: string;
  /** Nombre de séances par semaine. */
  readonly sessionsPerWeek: number;
  /** Durée d'une séance en périodes consécutives. */
  readonly sessionPeriods: number;
  /** Enseignants candidats, par ordre de préférence. Vide : séance sans enseignant (signalé). */
  readonly teacherIds: readonly string[];
  /** Une salle est-elle requise ? Faux : séance sans salle (plein air, salle virtuelle…). */
  readonly needsRoom: boolean;
  readonly roomTypeCode: string | null;
  readonly requiredFeatures: readonly string[];
  /** Salle imposée (dur). */
  readonly roomId: string | null;
  /** Séances de ce besoin au plus par jour (dur) ; `null` = ⌈séances / jours⌉. */
  readonly maxPerDay: number | null;
  /** Périodes préférées (souple) ; vide = indifférent. */
  readonly preferredPeriods: readonly number[];
}

/** Occupation déjà décidée ailleurs (autre emploi du temps, séance verrouillée) : consomme des ressources, ne bouge pas. */
export interface GenFixedPlacement {
  readonly classroomId: string | null;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly weekday: number;
  readonly startPeriod: number;
  readonly periods: number;
}

export interface GenWeights {
  /** Trou dans la journée d'une classe, par période vide entre deux cours. */
  readonly gap: number;
  /** Trou dans la journée d'un enseignant. */
  readonly teacherGap: number;
  /** Deux séances du même besoin le même jour. */
  readonly spread: number;
  /** Écart de charge entre les jours d'une classe (somme des carrés). */
  readonly balance: number;
  /** Créneau évité / non préféré. */
  readonly preference: number;
  /** Changement d'enseignant pour un même besoin. */
  readonly teacherChange: number;
}

export const DEFAULT_WEIGHTS: GenWeights = Object.freeze({ gap: 10, teacherGap: 4, spread: 6, balance: 1, preference: 3, teacherChange: 5 });

/** Pénalité (de l'objectif interne) d'une séance non placée : toujours pire que n'importe quelle contrainte souple. */
export const UNPLACED_PENALTY = 1_000_000;

export interface GenProblem {
  /** Jours ouvrés (ISO 1..7), distincts. */
  readonly weekdays: readonly number[];
  /** Périodes d'enseignement d'une journée (hors pauses), ordonnées, sans chevauchement. */
  readonly periods: readonly GenPeriod[];
  /** Cases fermées pour tous (dur). */
  readonly closed: readonly SlotRef[];
  readonly classes: readonly GenClass[];
  readonly teachers: readonly GenTeacher[];
  readonly rooms: readonly GenRoom[];
  readonly requirements: readonly GenRequirement[];
  readonly fixed: readonly GenFixedPlacement[];
  readonly weights: GenWeights;
  /** Graine : même graine ⇒ même résultat (à budget d'itérations atteint). */
  readonly seed: string | number;
  /** Budget d'amélioration locale (déterministe). */
  readonly maxIterations: number;
  /** Limite de temps (filet de sécurité) ; la sortie par la limite de temps n'est pas reproductible à l'identique. */
  readonly timeLimitMs: number;
}

// ---------------------------------------------------------------------------
// Résultat
// ---------------------------------------------------------------------------

export const UNPLACED_REASONS = [
  "NO_CONTIGUOUS_PERIODS",
  "SLOT_CLOSED",
  "CLASS_BUSY",
  "REQUIREMENT_DAY_CAP",
  "TEACHER_UNAVAILABLE",
  "TEACHER_BUSY",
  "TEACHER_LIMIT",
  "NO_ROOM_CANDIDATE",
  "ROOM_BUSY",
  "CLASS_OVERLOADED",
] as const;
export type UnplacedReason = (typeof UNPLACED_REASONS)[number];

export interface GenPlacement {
  readonly requirementId: string;
  /** Rang de la séance au sein du besoin (0..sessionsPerWeek-1). */
  readonly sessionIndex: number;
  readonly classroomId: string;
  readonly curriculumNodeId: string;
  readonly offeringId: string | null;
  readonly teacherId: string | null;
  readonly roomId: string | null;
  readonly weekday: number;
  readonly startPeriod: number;
  readonly periods: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly timeSlotId: string | null;
}

export interface GenUnplaced {
  readonly requirementId: string;
  readonly classroomId: string;
  readonly curriculumNodeId: string;
  readonly label: string;
  readonly requested: number;
  readonly missing: number;
  /** Causes, de la plus fréquente à la moins fréquente : `count` = nombre de créneaux candidats écartés pour cette cause. */
  readonly reasons: ReadonlyArray<{ readonly code: UnplacedReason; readonly count: number; readonly detail?: string }>;
}

export interface GenScoreBreakdown {
  readonly gap: number;
  readonly teacherGap: number;
  readonly spread: number;
  readonly balance: number;
  readonly preference: number;
  readonly teacherChange: number;
}

export interface GenResult {
  readonly placements: readonly GenPlacement[];
  readonly unplaced: readonly GenUnplaced[];
  /** Coût souple pondéré (plus petit = meilleur), hors séances non placées. */
  readonly softCost: number;
  readonly breakdown: GenScoreBreakdown;
  readonly stats: {
    readonly sessions: number;
    readonly placed: number;
    readonly unplacedSessions: number;
    readonly iterations: number;
    readonly accepted: number;
    readonly improvements: number;
    readonly stoppedBy: "ITERATIONS" | "TIME_LIMIT" | "NOTHING_TO_IMPROVE";
    readonly elapsedMs: number;
    readonly seed: string | number;
    readonly initialSoftCost: number;
  };
  /** Avertissements (séance sans enseignant, salle introuvable…). */
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly requirementId?: string; readonly message: string }>;
}

export class GenProblemError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "GenProblemError";
  }
}
