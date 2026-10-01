/**
 * Offres (ex. « cohortes / sessions d'UE ») : machine d'états, statut `FULL` dérivé de la capacité, éligibilité à
 * l'inscription dans l'ORDRE FIGÉ de la spec (AC5.1). Règles pures, miroir des déclencheurs SQL.
 */
import type { AcademicOfferingStatus, AcademicPeriodStatus } from "@ecoledigitale/contracts/src/v2/academic";
import { gradingIsClosed } from "./calendar";
import type { IsoDate } from "./dates";
import { AcademicCode } from "./errors";

// ---------------------------------------------------------------------------
// Machine d'états : DRAFT -> OPEN <-> FULL -> IN_PROGRESS -> COMPLETED ; CANCELLED terminal
// (+ réouvertures motivées COMPLETED -> OPEN | IN_PROGRESS et CANCELLED -> DRAFT)
// ---------------------------------------------------------------------------

export const OFFERING_TRANSITIONS: Readonly<Record<AcademicOfferingStatus, readonly AcademicOfferingStatus[]>> = Object.freeze({
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["DRAFT", "FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  FULL: ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["OPEN", "IN_PROGRESS"],
  CANCELLED: ["DRAFT"],
});

export function canTransitionOffering(from: AcademicOfferingStatus, to: AcademicOfferingStatus): boolean {
  return OFFERING_TRANSITIONS[from].includes(to);
}

/** `FULL` n'est JAMAIS posé à la main : seuls ces états sont posés par l'utilisateur. */
export function isManualOfferingTarget(to: AcademicOfferingStatus): boolean {
  return to !== "FULL";
}

/** Une réouverture (sortie d'un état terminal) exige un motif, une date de fin cohérente et une permission. */
export function isOfferingReopening(from: AcademicOfferingStatus, to: AcademicOfferingStatus): boolean {
  return (from === "COMPLETED" && (to === "OPEN" || to === "IN_PROGRESS")) || (from === "CANCELLED" && to === "DRAFT");
}

/** Offres que le job de finalisation passe à COMPLETED (AC3.5) : jamais `DRAFT` ni `CANCELLED`. */
export const FINALIZABLE_OFFERING_STATUSES: readonly AcademicOfferingStatus[] = Object.freeze(["OPEN", "FULL", "IN_PROGRESS"]);

export function shouldFinalizeOffering(offering: { status: AcademicOfferingStatus; endsOn: IsoDate }, today: IsoDate): boolean {
  return FINALIZABLE_OFFERING_STATUSES.includes(offering.status) && offering.endsOn < today;
}

// ---------------------------------------------------------------------------
// Capacité et statut dérivé
// ---------------------------------------------------------------------------

export interface HeldCourse {
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  holdExpiresAt: string | null;
}

/** R17 : une place est réservée par une sélection PENDING non expirée, CONFIRMED ou COMPLETED. */
export function holdsPlace(course: HeldCourse, now: Date): boolean {
  if (course.status === "CONFIRMED" || course.status === "COMPLETED") return true;
  if (course.status === "PENDING") return course.holdExpiresAt === null || new Date(course.holdExpiresAt).getTime() > now.getTime();
  return false;
}

export function countHeldPlaces(courses: readonly HeldCourse[], now: Date): number {
  return courses.filter((c) => holdsPlace(c, now)).length;
}

/**
 * Statut `OPEN`/`FULL` dérivé (parité `computeSessionCapacityStatus`, miroir de `sync_offering_fullness`) :
 *   OPEN -> FULL quand les places réservées atteignent la capacité ;
 *   FULL -> OPEN quand une place se libère ET que la fenêtre d'inscription est encore valide (ou absente).
 * Les autres statuts ne changent jamais ; capacité NULL = illimité.
 */
export function deriveOfferingStatus(input: {
  status: AcademicOfferingStatus;
  capacity: number | null;
  held: number;
  registrationClosesAt: string | null;
  now: Date;
}): AcademicOfferingStatus {
  if (input.capacity === null || (input.status !== "OPEN" && input.status !== "FULL")) return input.status;
  if (input.status === "OPEN" && input.held >= input.capacity) return "FULL";
  if (input.status === "FULL" && input.held < input.capacity) {
    const windowStillValid = input.registrationClosesAt === null || input.now.getTime() <= new Date(input.registrationClosesAt).getTime();
    if (windowStillValid) return "OPEN";
  }
  return input.status;
}

export function remainingPlaces(capacity: number | null, held: number): number | null {
  return capacity === null ? null : Math.max(0, capacity - held);
}

export function checkOfferingDates(input: {
  startsOn: IsoDate;
  endsOn: IsoDate;
  yearStartsOn: IsoDate;
  yearEndsOn: IsoDate;
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
}): { code: string; message: string } | null {
  if (input.endsOn < input.startsOn) return { code: AcademicCode.OFFERING_DATES_INVALID, message: "La date de fin précède la date de début." };
  if (input.startsOn < input.yearStartsOn || input.endsOn > input.yearEndsOn) {
    return { code: AcademicCode.OFFERING_OUTSIDE_YEAR, message: `Les dates de l'offre dépassent l'année (${input.yearStartsOn} -> ${input.yearEndsOn}).` };
  }
  const opens = input.registrationOpensAt ?? null;
  const closes = input.registrationClosesAt ?? null;
  if ((opens === null) !== (closes === null)) return { code: AcademicCode.OFFERING_DATES_INVALID, message: "Les deux bornes de la fenêtre d'inscription vont ensemble." };
  if (opens !== null && closes !== null && new Date(closes).getTime() < new Date(opens).getTime()) {
    return { code: AcademicCode.OFFERING_DATES_INVALID, message: "La fermeture de la fenêtre d'inscription précède son ouverture." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Éligibilité (AC5.1) : ordre figé, premier échec renvoyé
// ---------------------------------------------------------------------------

export interface EligibilityFacts {
  offering: {
    status: AcademicOfferingStatus;
    capacity: number | null;
    registrationOpensAt: string | null;
    registrationClosesAt: string | null;
  };
  /** État effectif de la période de l'offre pour la classe ; `null` si le nœud n'est lié à aucune période. */
  periodState: AcademicPeriodStatus | null;
  now: Date;
  /** Sélection vivante du MÊME nœud, la même année, dans n'importe quelle classe (hors annulées et hors expirées). */
  hasLiveDuplicate: boolean;
  /** Places réservées HORS les lignes de l'apprenant lui-même (D1 : son propre siège n'est pas compté contre lui). */
  heldByOthers: number;
  /** Lignées de prérequis non validées. */
  missingPrerequisites: readonly string[];
  /** L'apprenant a déjà validé la lignée de ce nœud (avertissement, AC5.7). */
  alreadyCompleted: boolean;
}

export interface EligibilityFailure {
  code: (typeof AcademicCode)[keyof typeof AcademicCode];
  message: string;
  /** Un `override` motivé (permission sensible) peut-il lever cet obstacle ? La capacité dure, jamais. */
  overridable: boolean;
}

export interface EligibilityWarning {
  code: string;
  message: string;
  requiresOverride: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  failure: EligibilityFailure | null;
  missingPrerequisites: string[];
  warnings: EligibilityWarning[];
  remainingPlaces: number | null;
}

/**
 * Ordre : offre non ouverte -> période de l'offre close (état effectif >= GRADING_CLOSED) -> fenêtre [ouverture,
 * fermeture] (bornes incluses ; absente = inscriptible tant que l'offre est ouverte) -> doublon vivant -> capacité ->
 * prérequis. Le statut `FULL` est DÉRIVÉ de la capacité : il passe la première étape et c'est la capacité (calculée
 * hors les lignes de l'apprenant) qui tranche, pour ne pas bloquer le détenteur de la dernière place.
 */
export function evaluateEligibility(facts: EligibilityFacts): EligibilityResult {
  const { offering } = facts;
  const remaining = remainingPlaces(offering.capacity, facts.heldByOthers);
  const warnings: EligibilityWarning[] = [];
  if (facts.alreadyCompleted) {
    warnings.push({ code: AcademicCode.ALREADY_COMPLETED, message: "Cette unité est déjà validée par l'apprenant.", requiresOverride: true });
  }
  const fail = (code: EligibilityFailure["code"], message: string, overridable: boolean): EligibilityResult => ({
    eligible: false,
    failure: { code, message, overridable },
    missingPrerequisites: code === AcademicCode.PREREQUISITES_UNMET ? [...facts.missingPrerequisites] : [],
    warnings,
    remainingPlaces: remaining,
  });

  if (offering.status !== "OPEN" && offering.status !== "FULL") {
    return fail(AcademicCode.OFFERING_NOT_OPEN, "L'offre n'est pas ouverte à l'inscription.", false);
  }
  if (facts.periodState !== null && gradingIsClosed(facts.periodState)) {
    return fail(AcademicCode.PERIOD_CLOSED, "La période de cette offre est close pour la classe.", true);
  }
  const opens = offering.registrationOpensAt;
  const closes = offering.registrationClosesAt;
  if (opens !== null && closes !== null) {
    const t = facts.now.getTime();
    if (t < new Date(opens).getTime() || t > new Date(closes).getTime()) {
      return fail(AcademicCode.REGISTRATION_WINDOW_CLOSED, "La fenêtre d'inscription de cette offre est fermée.", true);
    }
  }
  if (facts.hasLiveDuplicate) {
    return fail(AcademicCode.DUPLICATE_ENROLLMENT, "L'apprenant suit déjà cette unité cette année.", false);
  }
  if (offering.capacity !== null && facts.heldByOthers >= offering.capacity) {
    return fail(AcademicCode.OFFERING_FULL, "L'offre est complète.", false);
  }
  if (facts.missingPrerequisites.length > 0) {
    return fail(AcademicCode.PREREQUISITES_UNMET, "Des prérequis ne sont pas validés.", true);
  }
  return { eligible: true, failure: null, missingPrerequisites: [], warnings, remainingPlaces: remaining };
}

/**
 * Applique une dérogation motivée (AC5.1b) : lève les obstacles `overridable` (fenêtre, période, prérequis) et
 * les avertissements `requiresOverride`. Un obstacle non dérogeable (capacité, doublon, offre fermée) subsiste.
 * Renvoie les obstacles effectivement dépassés (pour l'historique et l'audit).
 */
export function applyOverride(
  facts: EligibilityFacts,
  override: { reason: string } | undefined,
): { allowed: boolean; result: EligibilityResult; bypassed: string[] } {
  const base = evaluateEligibility(facts);
  if (base.eligible) {
    const needsOverride = base.warnings.some((w) => w.requiresOverride);
    if (!needsOverride) return { allowed: true, result: base, bypassed: [] };
    return override ? { allowed: true, result: base, bypassed: base.warnings.filter((w) => w.requiresOverride).map((w) => w.code) } : { allowed: false, result: base, bypassed: [] };
  }
  if (!override) return { allowed: false, result: base, bypassed: [] };

  // On neutralise un par un les obstacles dérogeables, dans l'ordre d'évaluation.
  const bypassed: string[] = [];
  let working: EligibilityFacts = facts;
  for (let guard = 0; guard < 8; guard += 1) {
    const r = evaluateEligibility(working);
    if (r.eligible) {
      bypassed.push(...r.warnings.filter((w) => w.requiresOverride).map((w) => w.code));
      return { allowed: true, result: r, bypassed };
    }
    const failure = r.failure as EligibilityFailure;
    if (!failure.overridable) return { allowed: false, result: r, bypassed };
    bypassed.push(failure.code);
    if (failure.code === AcademicCode.PERIOD_CLOSED) working = { ...working, periodState: null };
    else if (failure.code === AcademicCode.REGISTRATION_WINDOW_CLOSED) working = { ...working, offering: { ...working.offering, registrationOpensAt: null, registrationClosesAt: null } };
    else if (failure.code === AcademicCode.PREREQUISITES_UNMET) working = { ...working, missingPrerequisites: [] };
  }
  return { allowed: false, result: evaluateEligibility(working), bypassed };
}
