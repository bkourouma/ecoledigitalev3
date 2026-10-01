/**
 * Arithmétique de dates calendaires (`YYYY-MM-DD`), en UTC pur : aucun fuseau,
 * aucun `Date.now()`. Le « jour courant » vient toujours d'un `Clock` injecté
 * (`abidjanDate(clock.now())` du kernel).
 */
import { isValidIsoDate } from "@ecoledigitale/kernel";
import type { IsoDate } from "./types";

const MS_PER_DAY = 86_400_000;

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export function assertIsoDate(value: string, field = "date"): IsoDate {
  if (typeof value !== "string" || !isValidIsoDate(value)) {
    throw new TypeError(`${field} : date ISO invalide ("${String(value)}").`);
  }
  return value;
}

export function toUtcMs(date: IsoDate): number {
  assertIsoDate(date);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new TypeError("addDays : nombre de jours entier requis.");
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Nombre de jours de `from` à `to` (positif si `to` est postérieur). */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

export function compareDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  // Les chaînes ISO de même format se comparent lexicographiquement.
  assertIsoDate(a);
  assertIsoDate(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function yearOf(date: IsoDate): number {
  assertIsoDate(date);
  return Number(date.slice(0, 4));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Première occurrence du jour `month/day` à la date `base` ou après.
 * Le 29 février est ramené au 28 les années non bissextiles.
 */
export function nextMonthDayOnOrAfter(base: IsoDate, month: number, day: number): IsoDate {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new TypeError("Mois invalide.");
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new TypeError("Jour invalide.");
  const baseYear = yearOf(base);
  for (const year of [baseYear, baseYear + 1]) {
    const d = Math.min(day, daysInMonth(year, month));
    const candidate = `${pad(year, 4)}-${pad(month)}-${pad(d)}`;
    if (candidate >= base) return candidate;
  }
  /* istanbul ignore next : inatteignable, l'année suivante est toujours ≥ base */
  throw new TypeError("nextMonthDayOnOrAfter : aucune occurrence trouvée.");
}
