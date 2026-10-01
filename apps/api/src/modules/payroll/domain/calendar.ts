/**
 * Calendrier de la paie : TOUT se calcule sur des DATES (`AAAA-MM-JJ`), jamais sur des instants, donc
 * indépendamment du fuseau du serveur (le legacy utilisait `getDay()` en fuseau local, spec 032 §12).
 *
 *  - semaine = lundi-dimanche (clé : le lundi) ;
 *  - jour ouvré = lundi-vendredi (Q-27 : jours fériés non gérés) ;
 *  - mois = mois civil.
 */
import type { IsoDate } from "./types";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function assertIsoDate(value: string): void {
  if (!isIsoDate(value)) throw new RangeError(`Date invalide : « ${String(value)} » (AAAA-MM-JJ attendu).`);
}

/** Jour civil depuis l'époque (0 = 1970-01-01). */
export function toEpochDay(date: IsoDate): number {
  assertIsoDate(date);
  const m = DATE_RE.exec(date) as RegExpExecArray;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function fromEpochDay(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: IsoDate): number {
  const wd = new Date(toEpochDay(date) * DAY_MS).getUTCDay(); // 0 = dimanche
  return wd === 0 ? 7 : wd;
}

export function isWorkingDay(date: IsoDate): boolean {
  return isoWeekday(date) <= 5;
}

/** Lundi de la semaine de `date`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** Nombre de jours civils de `from` à `to` inclus (0 si `to < from`). */
export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  const n = toEpochDay(to) - toEpochDay(from) + 1;
  return n > 0 ? n : 0;
}

/** Jours ouvrés (lun-ven) de `from` à `to` inclus, en ordre croissant. */
export function workingDaysBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const end = toEpochDay(to);
  for (let d = toEpochDay(from); d <= end; d++) {
    const iso = fromEpochDay(d);
    if (isWorkingDay(iso)) out.push(iso);
  }
  return out;
}

export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

export function monthBounds(key: string): { first: IsoDate; last: IsoDate } {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return { first: `${key}-01`, last: `${key}-${String(daysInMonth(y, m)).padStart(2, "0")}` };
}

/** Jours ouvrés du mois civil `key` (`AAAA-MM`). */
export function workingDaysInMonth(key: string): number {
  const { first, last } = monthBounds(key);
  return workingDaysBetween(first, last).length;
}

/** Mois civils (`AAAA-MM`) touchés par `[from, to]`, en ordre croissant. */
export function monthsBetween(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = [];
  if (toEpochDay(to) < toEpochDay(from)) return out;
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ey, em] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Intersection de deux intervalles de dates inclus ; `null` si vide. */
export function intersect(a: { from: IsoDate; to: IsoDate }, b: { from: IsoDate; to: IsoDate }): { from: IsoDate; to: IsoDate } | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return to < from ? null : { from, to };
}

/** `HH:MM` → minutes depuis minuit ; `null` si mal formé. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (time == null) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
