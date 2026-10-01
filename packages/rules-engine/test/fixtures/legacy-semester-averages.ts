/**
 * Copie VERBATIM (types retirés) des fonctions de calcul historiques de
 * apps/api/src/routes/semester-averages.ts (lignes ~147-226 et 363-386, 1150-1154).
 * Elles y sont des fermetures non exportées : on les recopie ici comme ORACLE
 * des golden tests. Le fichier d'origine n'est pas modifié.
 */

export function computeCompetitionRanks(entries: { key: string; score: number | null }[]): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const entry of entries) {
    result[entry.key] = null;
  }

  const scored = entries
    .filter((entry): entry is { key: string; score: number } => entry.score != null && !Number.isNaN(entry.score))
    .sort((left, right) => right.score - left.score);

  let previousScore: number | null = null;
  let previousRank = 0;

  scored.forEach((entry, index) => {
    const isTie = previousScore != null && Math.abs(entry.score - previousScore) < 0.0001;
    const rank = isTie ? previousRank : index + 1;
    result[entry.key] = rank;
    previousScore = entry.score;
    previousRank = rank;
  });

  return result;
}

export function buildAverageMention(score: number | null): string {
  if (score == null) return 'En attente';
  if (score >= 16) return 'Excellent';
  if (score >= 14) return 'Très bien';
  if (score >= 12) return 'Bien';
  if (score >= 10) return 'Assez bien';
  if (score >= 8) return 'Passable';
  return 'Insuffisant';
}

export function buildCouncilDecision(score: number | null): string {
  if (score == null) return 'Notes incompletes';
  if (score >= 10) return 'Periode validee';
  if (score >= 8) return 'Renforcement recommande';
  return 'Periode non validee';
}

export function buildEndYearDecision(
  score: number | null,
  options?: { isSecondSemester?: boolean; isSecondYearBts?: boolean },
): string {
  if (score == null) return 'Décision en attente';
  if (options?.isSecondSemester && options?.isSecondYearBts) {
    return "Redouble en cas d'échec au BTS";
  }
  if (score >= 10) return 'Admis(e) en année supérieure';
  return 'Redoublement';
}

export function buildDistinctionSanctionsFromAverage(annual: number | null): string {
  if (annual == null) return '';
  if (annual >= 17) return "Tableau d'honneur + félicitations";
  if (annual >= 15) return "Tableau d'honneur + Encouragement";
  if (annual >= 12) return "Tableau d'honneur";
  return '';
}

export function computeWeightedAverage(scoresAndCoefs: { score: number | null; coef: number }[]): number | null {
  let weightedTotal = 0;
  let totalCoef = 0;
  for (const course of scoresAndCoefs) {
    const score = course.score;
    if (score == null || Number.isNaN(score)) {
      continue;
    }
    weightedTotal += score * course.coef;
    totalCoef += course.coef;
  }
  return totalCoef > 0 ? weightedTotal / totalCoef : null;
}

export function computeAnnualAverage(sem1: number | null, sem2: number | null, isSecondSemester: boolean): number | null {
  if (isSecondSemester && sem1 != null && sem2 != null) {
    return (sem1 + sem2 * 2) / 3;
  }
  return sem2;
}
