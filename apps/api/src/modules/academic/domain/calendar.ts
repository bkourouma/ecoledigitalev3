/**
 * Calendrier académique : années, périodes typées, plan de périodes, états de période.
 * Règles pures (aucune E/S). Les types et libellés de périodes sont de la DONNÉE : aucune périodicité,
 * aucun libellé et aucun pivot de date n'est codé ici (AC1.6).
 */
import type { AcademicClassroomPeriodStatus, AcademicPeriodStatus, AcademicYearStatus } from "@ecoledigitale/contracts/src/v2/academic";
import { addDays, compareDates, inclusiveDays, rangesOverlap, type IsoDate } from "./dates";
import type { AcademicPeriod, PeriodPlanSlot } from "./records";

// ---------------------------------------------------------------------------
// Années
// ---------------------------------------------------------------------------

/** DRAFT -> OPEN -> CLOSED -> ARCHIVED (ADR : une année archivée est en lecture seule). */
export const YEAR_TRANSITIONS: Readonly<Record<AcademicYearStatus, readonly AcademicYearStatus[]>> = Object.freeze({
  DRAFT: ["OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
  ARCHIVED: [],
});

export function canTransitionYear(from: AcademicYearStatus, to: AcademicYearStatus): boolean {
  return YEAR_TRANSITIONS[from].includes(to);
}

export interface DateRange {
  startsOn: IsoDate;
  endsOn: IsoDate;
}

export type YearPlacement =
  | { ok: true }
  | { ok: false; code: "overlap"; withId: string }
  | { ok: false; code: "gap"; withId: string; gapDays: number; side: "previous" | "next" };

/**
 * Place une année candidate parmi les années d'un établissement : jamais de chevauchement (R1) ni de trou avec
 * l'année précédente ET l'année suivante (règle 0118). La première année d'un établissement est libre.
 */
export function checkYearPlacement(
  candidate: DateRange,
  existing: ReadonlyArray<DateRange & { id: string }>,
  ignoreId?: string,
): YearPlacement {
  const others = existing.filter((y) => y.id !== ignoreId);
  for (const y of others) {
    if (rangesOverlap(candidate.startsOn, candidate.endsOn, y.startsOn, y.endsOn)) return { ok: false, code: "overlap", withId: y.id };
  }
  const previous = others.filter((y) => y.endsOn < candidate.startsOn).sort((a, b) => compareDates(b.endsOn, a.endsOn))[0];
  if (previous) {
    const gapDays = inclusiveDays(previous.endsOn, candidate.startsOn) - 2;
    if (gapDays > 0) return { ok: false, code: "gap", withId: previous.id, gapDays, side: "previous" };
  }
  const next = others.filter((y) => y.startsOn > candidate.endsOn).sort((a, b) => compareDates(a.startsOn, b.startsOn))[0];
  if (next) {
    const gapDays = inclusiveDays(candidate.endsOn, next.startsOn) - 2;
    if (gapDays > 0) return { ok: false, code: "gap", withId: next.id, gapDays, side: "next" };
  }
  return { ok: true };
}

export interface YearCloseFacts {
  periods: ReadonlyArray<Pick<AcademicPeriod, "code" | "status">>;
  /** Offres encore ouvertes (`OPEN`, `FULL` ou `IN_PROGRESS`) sur les classes de l'année. */
  liveOfferings: number;
}

/** Raisons pour lesquelles une année ne peut pas être clôturée (AC7.4, R5). Liste vide = clôturable. */
export function yearCloseBlockers(facts: YearCloseFacts): string[] {
  const blockers: string[] = [];
  const open = facts.periods.filter((p) => p.status !== "CLOSED");
  if (open.length > 0) blockers.push(`${open.length} période(s) non clôturée(s) : ${open.map((p) => p.code).join(", ")}.`);
  if (facts.liveOfferings > 0) blockers.push(`${facts.liveOfferings} offre(s) encore ouverte(s) ou en cours.`);
  return blockers;
}

// ---------------------------------------------------------------------------
// États de période : PLANNED -> OPEN -> GRADING_CLOSED -> CLOSED, retour d'un seul pas
// ---------------------------------------------------------------------------

export const PERIOD_ORDER: readonly AcademicPeriodStatus[] = Object.freeze(["PLANNED", "OPEN", "GRADING_CLOSED", "CLOSED"] as const);

export function periodStateRank(state: AcademicPeriodStatus): number {
  return PERIOD_ORDER.indexOf(state);
}

export type PeriodStep = "forward" | "backward" | "same" | "illegal";

/** Sens d'une transition : un seul pas en avant ou en arrière est légal (miroir de `academic_periods_guard`). */
export function periodStep(from: AcademicPeriodStatus, to: AcademicPeriodStatus): PeriodStep {
  const delta = periodStateRank(to) - periodStateRank(from);
  if (delta === 0) return "same";
  if (delta === 1) return "forward";
  if (delta === -1) return "backward";
  return "illegal";
}

/** Dates modifiables tant que la période est PLANNED ou OPEN (AC1.3, R3). */
export function periodDatesEditable(state: AcademicPeriodStatus): boolean {
  return state === "PLANNED" || state === "OPEN";
}

/**
 * État EFFECTIF d'une période pour une classe (R4) : l'état explicite de la classe s'il existe, sinon celui de la
 * période — la classe SURCHARGE la période.
 */
export function effectivePeriodState(periodState: AcademicPeriodStatus, classroomState: AcademicClassroomPeriodStatus | null | undefined): AcademicPeriodStatus {
  return classroomState ?? periodState;
}

/** La saisie des notes est arrêtée (état effectif >= GRADING_CLOSED). */
export function gradingIsClosed(state: AcademicPeriodStatus): boolean {
  return periodStateRank(state) >= periodStateRank("GRADING_CLOSED");
}

/** États explicites d'une classe qu'il faut modifier pour que la clôture de toute la période s'applique à elle. */
export function alignClassroomStates(
  target: AcademicPeriodStatus,
  explicit: ReadonlyArray<{ classroomId: string; status: AcademicClassroomPeriodStatus }>,
  direction: "close" | "reopen",
): Array<{ classroomId: string; steps: AcademicClassroomPeriodStatus[] }> {
  if (target === "PLANNED") return [];
  const targetRank = periodStateRank(target);
  const out: Array<{ classroomId: string; steps: AcademicClassroomPeriodStatus[] }> = [];
  for (const s of explicit) {
    const rank = periodStateRank(s.status);
    if (direction === "close" && rank < targetRank) {
      // Chemin légal pas à pas (OPEN -> GRADING_CLOSED -> CLOSED).
      const steps: AcademicClassroomPeriodStatus[] = [];
      for (let r = rank + 1; r <= targetRank; r += 1) steps.push(PERIOD_ORDER[r] as AcademicClassroomPeriodStatus);
      out.push({ classroomId: s.classroomId, steps });
    } else if (direction === "reopen" && rank > targetRank) {
      out.push({ classroomId: s.classroomId, steps: [target as AcademicClassroomPeriodStatus] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan de périodes : répartition de l'année sans trou ni chevauchement
// ---------------------------------------------------------------------------

export interface AllocatedPeriod {
  type: string;
  ordinal: number;
  label: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** Poids de la période dans la moyenne annuelle (copié du créneau, défaut 1). */
  averageWeight: number;
}

export type PlanAllocation = { ok: true; periods: AllocatedPeriod[] } | { ok: false; reason: string };

/**
 * Répartit `[yearStart, yearEnd]` entre les créneaux d'un plan, proportionnellement à leur poids (défaut 1 : parts
 * égales), en jours entiers, de façon contiguë : la première période commence au début de l'année, la dernière
 * finit à sa fin, la veille de chacune est le dernier jour de la précédente. Les jours restants sont répartis
 * déterministiquement (arrondi cumulatif).
 */
export function allocatePeriodPlan(yearStart: IsoDate, yearEnd: IsoDate, slots: readonly PeriodPlanSlot[]): PlanAllocation {
  if (slots.length === 0) return { ok: false, reason: "Le plan ne contient aucun créneau." };
  const totalDays = inclusiveDays(yearStart, yearEnd);
  if (totalDays < slots.length) return { ok: false, reason: "L'année est plus courte que le nombre de périodes du plan." };
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.type}#${s.ordinal}`;
    if (seen.has(key)) return { ok: false, reason: `Créneau en double : ${s.type} n° ${s.ordinal}.` };
    seen.add(key);
  }
  const weights = slots.map((s) => s.weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const periods: AllocatedPeriod[] = [];
  let cumulative = 0;
  let previousBoundary = 0;
  for (const [i, slot] of slots.entries()) {
    cumulative += weights[i] as number;
    // Arrondi cumulatif : floor(totalDays * cumulative / totalWeight) (entiers exacts, sans flottant).
    const boundary = i === slots.length - 1 ? totalDays : Math.floor((totalDays * cumulative) / totalWeight);
    if (boundary <= previousBoundary) return { ok: false, reason: "Un créneau du plan n'obtient aucun jour (poids trop faibles)." };
    periods.push({
      type: slot.type,
      ordinal: slot.ordinal,
      label: slot.label,
      startsOn: addDays(yearStart, previousBoundary),
      endsOn: addDays(yearStart, boundary - 1),
      averageWeight: slot.averageWeight ?? 1,
    });
    previousBoundary = boundary;
  }
  return { ok: true, periods };
}

/** Code d'une période issue d'un plan : `<TYPE>_<ordinal>` (ex. `TRIMESTER_1`) — dérivé de données, jamais d'un libellé. */
export function periodCodeFor(type: string, ordinal: number): string {
  return `${type}_${ordinal}`;
}

// ---------------------------------------------------------------------------
// Validation de placement (miroir applicatif de `academic_periods_guard` + EXCLUDE)
// ---------------------------------------------------------------------------

export type PeriodPlacementProblem =
  | "dates_invalid"
  | "outside_year"
  | "outside_parent"
  | "parent_other_year"
  | "too_deep"
  | "overlap"
  | "ordinal_taken"
  | "code_taken";

export function checkPeriodPlacement(input: {
  startsOn: IsoDate;
  endsOn: IsoDate;
  periodTypeCode: string;
  ordinal: number;
  code: string;
  year: DateRange & { id: string };
  parent: (Pick<AcademicPeriod, "id" | "academicYearId" | "parentPeriodId" | "startsOn" | "endsOn">) | null;
  /** Profondeur du parent (0 = période de premier niveau). */
  parentDepth?: number;
  siblings: ReadonlyArray<Pick<AcademicPeriod, "id" | "parentPeriodId" | "periodTypeCode" | "ordinal" | "startsOn" | "endsOn">>;
  yearCodes: ReadonlyArray<{ id: string; code: string }>;
  ignoreId?: string;
}): PeriodPlacementProblem | null {
  if (input.endsOn < input.startsOn) return "dates_invalid";
  if (input.startsOn < input.year.startsOn || input.endsOn > input.year.endsOn) return "outside_year";
  if (input.parent) {
    if (input.parent.academicYearId !== input.year.id) return "parent_other_year";
    if ((input.parentDepth ?? 0) >= 2) return "too_deep";
    if (input.startsOn < input.parent.startsOn || input.endsOn > input.parent.endsOn) return "outside_parent";
  }
  const parentId = input.parent?.id ?? null;
  for (const s of input.siblings) {
    if (s.id === input.ignoreId) continue;
    if ((s.parentPeriodId ?? null) !== parentId || s.periodTypeCode !== input.periodTypeCode) continue;
    if (s.ordinal === input.ordinal) return "ordinal_taken";
    if (rangesOverlap(input.startsOn, input.endsOn, s.startsOn, s.endsOn)) return "overlap";
  }
  if (input.yearCodes.some((c) => c.code === input.code && c.id !== input.ignoreId)) return "code_taken";
  return null;
}

// ---------------------------------------------------------------------------
// Résolution d'une période pour une date (AC1.5)
// ---------------------------------------------------------------------------

export type ResolvePeriodResult =
  | { kind: "none" }
  | { kind: "found"; period: AcademicPeriod }
  | { kind: "ambiguous"; candidates: AcademicPeriod[] };

/**
 * Période contenant `date` : avec un type, exactement 0 ou 1 (les sœurs de même type ne se chevauchent pas ; deux
 * parents différents sont disjoints car chacun tient dans la même année et leurs plages sont sœurs). Sans type, la
 * période LA PLUS PROFONDE qui contient la date ; si plusieurs de même profondeur (types qui se superposent),
 * le résultat est ambigu et l'appelant doit préciser le type.
 */
export function resolvePeriodForDate(periods: readonly AcademicPeriod[], date: IsoDate, typeCode?: string): ResolvePeriodResult {
  const byId = new Map(periods.map((p) => [p.id, p]));
  const depthOf = (p: AcademicPeriod): number => {
    let depth = 0;
    let cursor: AcademicPeriod | undefined = p;
    while (cursor?.parentPeriodId) {
      depth += 1;
      cursor = byId.get(cursor.parentPeriodId);
      if (depth > 4) break;
    }
    return depth;
  };
  const matching = periods.filter((p) => p.startsOn <= date && date <= p.endsOn && (typeCode === undefined || p.periodTypeCode === typeCode));
  if (matching.length === 0) return { kind: "none" };
  const deepest = Math.max(...matching.map(depthOf));
  const atDeepest = matching.filter((p) => depthOf(p) === deepest);
  if (atDeepest.length === 1) return { kind: "found", period: atDeepest[0] as AcademicPeriod };
  return { kind: "ambiguous", candidates: atDeepest };
}

/** Rang d'une période parmi ses sœurs de même type (1 = première) et nombre de sœurs : fait pour les RuleSets. */
export function periodRankInYear(period: AcademicPeriod, all: readonly AcademicPeriod[]): { rank: number; count: number; isLast: boolean } {
  const siblings = all
    .filter((p) => p.academicYearId === period.academicYearId && p.periodTypeCode === period.periodTypeCode && (p.parentPeriodId ?? null) === (period.parentPeriodId ?? null))
    .sort((a, b) => a.ordinal - b.ordinal);
  const index = siblings.findIndex((p) => p.id === period.id);
  return { rank: index + 1, count: siblings.length, isLast: index === siblings.length - 1 };
}
