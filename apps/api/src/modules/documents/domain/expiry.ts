/**
 * Expiration et alertes — FONCTIONS PURES (spec 024 §6). Les jours sont calendaires (UTC) ; l'échéance est INCLUSE : un document
 * qui expire le 10 est encore valable le 10 et expiré le 11.
 */
import type { DocumentExpiryState } from "@ecoledigitale/contracts/src/v2/documents";

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` (UTC) d'un instant. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Jours entiers de `from` à `to` (négatif si `to` précède `from`). Dates `YYYY-MM-DD` valides. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export const addDays = (day: string, n: number): string => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));

/** Date calendaire valide (rejette le 31 février, que le motif du contrat laisserait passer). */
export function isValidCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && isoDay(new Date(t)) === day;
}

/** Seuils effectifs : document, sinon catégorie, sinon établissement ; dédoublonnés, décroissants. */
export function effectiveAlertDays(doc: readonly number[] | null, category: readonly number[] | null, settings: readonly number[]): number[] {
  const chosen = doc && doc.length > 0 ? doc : category && category.length > 0 ? category : settings;
  return [...new Set(chosen)].sort((a, b) => b - a);
}

export interface ExpiryStatus {
  readonly state: DocumentExpiryState;
  /** Jours restants (négatif = échu depuis N jours) ; `null` sans échéance. */
  readonly daysToExpiry: number | null;
}

export function expiryStatus(expiresOn: string | null, today: string, thresholds: readonly number[]): ExpiryStatus {
  if (!expiresOn) return { state: "NONE", daysToExpiry: null };
  const days = daysBetween(today, expiresOn);
  if (days < 0) return { state: "EXPIRED", daysToExpiry: days };
  const widest = thresholds.length > 0 ? Math.max(...thresholds) : 0;
  return { state: days <= widest ? "EXPIRING" : "VALID", daysToExpiry: days };
}

export interface DueAlert {
  /** Seuil le plus précis franchi et non encore émis ; `null` : rien à émettre. */
  readonly emit: number | null;
  /** Tous les seuils franchis (à enregistrer comme émis : un job arrêté plusieurs jours ne rejoue pas l'historique). */
  readonly mark: readonly number[];
}

/** Seuils franchis (`jours restants <= seuil`) et non encore émis ; on n'émet qu'UNE alerte, pour le plus petit seuil franchi. */
export function dueAlert(daysLeft: number, thresholds: readonly number[], alreadySent: readonly number[]): DueAlert {
  if (daysLeft < 0) return { emit: null, mark: [] };
  const crossed = thresholds.filter((t) => daysLeft <= t && !alreadySent.includes(t));
  if (crossed.length === 0) return { emit: null, mark: [] };
  return { emit: Math.min(...crossed), mark: crossed };
}
