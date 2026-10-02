/**
 * Points de conduite : règles PURES de lecture d'un barème PARAMÉTRÉ. Aucune valeur de barème n'existe dans le code ; la note
 * de conduite du bulletin n'est JAMAIS calculée ici (saisie humaine dans `assess`).
 */
export interface ScaleFacts {
  readonly id: string;
  readonly institutionId: string;
  readonly gradeLevelId: string | null;
  readonly initialPoints: number;
  readonly minPoints: number | null;
  readonly maxPoints: number | null;
  readonly resetScope: "PERIOD" | "YEAR" | "NEVER";
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: "DRAFT" | "ACTIVE" | "RETIRED";
}

export interface MovementFacts {
  readonly delta: number;
  readonly academicYearId: string;
  readonly academicPeriodId: string | null;
}

/** Miroir de `schoollife.conduct_balance` (parité testée contre la base). */
export function conductBalance(scale: ScaleFacts, movements: readonly MovementFacts[], scope: { academicYearId: string; periodId?: string | null }): number {
  const period = scope.periodId ?? null;
  const sum = movements
    .filter((m) => {
      switch (scale.resetScope) {
        case "PERIOD":
          return m.academicPeriodId === period && m.academicYearId === scope.academicYearId;
        case "YEAR":
          return m.academicYearId === scope.academicYearId;
        default:
          return true;
      }
    })
    .reduce((acc, m) => acc + m.delta, 0);
  const raw = scale.initialPoints + sum;
  const floor = scale.minPoints ?? Number.MIN_SAFE_INTEGER;
  const ceil = scale.maxPoints ?? Number.MAX_SAFE_INTEGER;
  return Math.min(ceil, Math.max(floor, raw));
}

/**
 * Barème applicable à une inscription à une date : actif, de l'établissement, couvrant la date, du niveau de l'élève ou
 * « tous niveaux » ; le barème propre au niveau l'emporte. `null` = aucun barème (aucun mouvement n'est produit).
 */
export function pickScale(scales: readonly ScaleFacts[], q: { institutionId: string; gradeLevelId: string | null; on: string }): ScaleFacts | null {
  const live = scales.filter(
    (s) => s.status === "ACTIVE" && s.institutionId === q.institutionId && s.effectiveFrom <= q.on && (s.effectiveTo === null || q.on <= s.effectiveTo),
  );
  const specific = q.gradeLevelId ? live.find((s) => s.gradeLevelId === q.gradeLevelId) : undefined;
  return specific ?? live.find((s) => s.gradeLevelId === null) ?? null;
}

export interface PeriodFacts {
  readonly periodId: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

/** Période la plus étroite qui couvre la date (un trimestre plutôt que le semestre qui le contient). */
export function narrowestPeriod(periods: readonly PeriodFacts[], on: string): PeriodFacts | null {
  const covering = periods.filter((p) => p.startsOn <= on && on <= p.endsOn);
  if (covering.length === 0) return null;
  const span = (p: PeriodFacts): number => Date.parse(`${p.endsOn}T00:00:00Z`) - Date.parse(`${p.startsOn}T00:00:00Z`);
  return [...covering].sort((a, b) => span(a) - span(b) || a.periodId.localeCompare(b.periodId))[0] ?? null;
}
