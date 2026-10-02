/**
 * Alertes intelligentes : décisions PURES (les données viennent des ports ; aucune formule de calcul de notes ici).
 *
 *  - baisse de résultats : on compare deux résultats FINAL consécutifs déjà calculés par `results` (jamais recalculés) ;
 *  - charge d'enseignement : heures planifiées lues d'`people`, comparées au seuil de la règle ;
 *  - retard de paiement : jours de retard lus de `finance`, comparés au seuil de la règle.
 * Les valeurs numériques arrivent sous forme de chaînes décimales ou de nombres (le module `results` livre des décimaux).
 */

/** Convertit un décimal (`"14.50"`, `14.5`, `null`) en nombre fini, sinon `null`. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface GradeDrop {
  readonly previous: number;
  readonly current: number;
  /** Écart positif (previous - current), arrondi à 2 décimales. */
  readonly drop: number;
}

/** Baisse entre deux résultats FINAL ; `null` s'il n'y a pas de baisse atteignant `minDrop` (ou si une valeur manque). */
export function detectGradeDrop(previous: unknown, current: unknown, minDrop: number): GradeDrop | null {
  const p = toNumber(previous);
  const c = toNumber(current);
  if (p === null || c === null) return null;
  const drop = Math.round((p - c) * 100) / 100;
  return drop >= minDrop && drop > 0 ? { previous: p, current: c, drop } : null;
}

export const isOverloaded = (plannedHours: number, maxHours: number): boolean => Number.isFinite(plannedHours) && plannedHours > maxHours;

/** Mois civil d'une date ISO (`2026-10`) : la charge d'un enseignant n'est signalée qu'une fois par mois. */
export const monthKey = (iso: string): string => iso.slice(0, 7);
