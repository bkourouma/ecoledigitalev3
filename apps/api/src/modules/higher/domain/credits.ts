/**
 * Crédits du registre : arithmétique exacte (centièmes entiers), validité dans le temps, choix d'une acquisition.
 * Aucune formule réglementaire : seulement de l'addition et des dates. La VALIDATION d'une UE est décidée par les
 * règles (module results) ; ce module ne fait que tenir le registre.
 */
import type { IsoDate, LedgerEntry } from "./types";

/** Arrondit à 2 décimales, sans dérive flottante (crédits à deux décimales). */
export const roundCredits = (value: number): number => Math.round(value * 100) / 100;

/** Somme exacte de crédits (additionne en centièmes entiers). */
export function sumCredits(values: Iterable<number>): number {
  let hundredths = 0;
  for (const v of values) hundredths += Math.round(v * 100);
  return hundredths / 100;
}

/** Convertit une colonne `numeric(8,2)` (chaîne) en nombre de crédits. */
export function parseCredits(raw: string | number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`Crédits invalides : ${String(raw)}`);
  return roundCredits(n);
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Date calendaire UTC d'un instant (`AAAA-MM-JJ`). */
export const isoDateOf = (date: Date): IsoDate => `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

/**
 * Fin de validité d'une UE capitalisée : `acquise + N mois` (jour du mois conservé, ramené au dernier jour du mois
 * d'arrivée s'il n'existe pas : 31 janvier + 1 mois = 28/29 février). `null` : sans limite.
 */
export function validUntilFor(acquiredOn: IsoDate, validityMonths: number | null): IsoDate | null {
  if (validityMonths === null) return null;
  if (!Number.isInteger(validityMonths) || validityMonths < 1) throw new RangeError("La durée de validité est un nombre entier de mois ≥ 1.");
  const [y, m, d] = acquiredOn.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + validityMonths;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${pad(ty, 4)}-${pad(tm)}-${pad(Math.min(d, lastDay))}`;
}

/** Une acquisition compte tant qu'elle est ACQUIRED et que sa date de fin de validité n'est pas dépassée. */
export function isCurrentlyValid(entry: Pick<LedgerEntry, "status" | "validUntil">, today: IsoDate): boolean {
  return entry.status === "ACQUIRED" && (entry.validUntil === null || entry.validUntil >= today);
}

/** Dernière acquisition d'un ensemble d'écritures (date d'obtention d'un diplôme / d'une attestation), ou `null`. */
export function lastAcquisitionDate(entries: ReadonlyArray<Pick<LedgerEntry, "acquiredAt">>): IsoDate | null {
  let best: Date | null = null;
  for (const e of entries) if (best === null || e.acquiredAt.getTime() > best.getTime()) best = e.acquiredAt;
  return best ? isoDateOf(best) : null;
}
