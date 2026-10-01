/**
 * Charge d'enseignement : le PRÉVU (heures affectées) et le CONTRACTUEL (volume des contrats actifs) — spec 009 AC4.1.
 * Aucun seuil, aucune alerte. Les heures planifiées / réalisées viennent de `scheduling.getStaffWeeklyLoad` (spec 017) ;
 * le rapprochement des trois chiffres est fait par l'écran et par 025, jamais ici.
 */

export interface LoadAssignment {
  readonly classroomId: string;
  readonly periodId: string | null;
  readonly plannedHours: number | null;
}

export interface LoadContract {
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly committedHours: number | null;
  readonly committedHoursUnit: "PER_WEEK" | "PER_YEAR" | null;
  readonly status: "DRAFT" | "ACTIVE" | "ENDED" | "CANCELLED";
}

/** Arrondi à 2 décimales (les heures sont `numeric(7,2)`). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function summarizePlannedHours(assignments: readonly LoadAssignment[]): {
  total: number;
  byClassroom: Array<{ classroomId: string; plannedHours: number }>;
  byPeriod: Array<{ periodId: string | null; plannedHours: number }>;
} {
  const byClassroom = new Map<string, number>();
  const byPeriod = new Map<string | null, number>();
  let total = 0;
  for (const a of assignments) {
    const h = a.plannedHours ?? 0;
    total += h;
    byClassroom.set(a.classroomId, (byClassroom.get(a.classroomId) ?? 0) + h);
    byPeriod.set(a.periodId, (byPeriod.get(a.periodId) ?? 0) + h);
  }
  return {
    total: round2(total),
    byClassroom: [...byClassroom].map(([classroomId, h]) => ({ classroomId, plannedHours: round2(h) })).sort((x, y) => x.classroomId.localeCompare(y.classroomId)),
    byPeriod: [...byPeriod].map(([periodId, h]) => ({ periodId, plannedHours: round2(h) })).sort((x, y) => String(x.periodId).localeCompare(String(y.periodId))),
  };
}

/**
 * Volume contractuel des contrats ACTIFS à `onDate`, additionné par unité. `PER_WEEK` n'est converti en année que si
 * l'appelant fournit `weeksPerYear` (aucun nombre de semaines n'est codé : il dépend du calendrier de l'établissement).
 */
export function contractualHours(
  contracts: readonly LoadContract[],
  onDate: string,
  weeksPerYear?: number,
): { perWeek: number | null; perYear: number | null; weeksPerYearUsed: number | null } {
  let perWeek: number | null = null;
  let perYear: number | null = null;
  for (const c of contracts) {
    if (c.status !== "ACTIVE" || c.committedHours === null || c.committedHoursUnit === null) continue;
    if (c.startsOn > onDate || (c.endsOn !== null && c.endsOn < onDate)) continue;
    if (c.committedHoursUnit === "PER_WEEK") perWeek = (perWeek ?? 0) + c.committedHours;
    else perYear = (perYear ?? 0) + c.committedHours;
  }
  let yearTotal = perYear;
  if (perWeek !== null && weeksPerYear !== undefined) yearTotal = (yearTotal ?? 0) + perWeek * weeksPerYear;
  return {
    perWeek: perWeek === null ? null : round2(perWeek),
    perYear: yearTotal === null ? null : round2(yearTotal),
    weeksPerYearUsed: perWeek !== null && weeksPerYear !== undefined ? weeksPerYear : null,
  };
}
