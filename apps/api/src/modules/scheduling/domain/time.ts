/**
 * Temps du module scheduling : dates calendaires, heures d'un jour, fuseau de l'établissement.
 *
 * Règles (conventions n° 5, spec 017 R10, AC2.7) :
 *  - les instants sont stockés en UTC ; la date civile d'une séance (`occurs_on`) est celle du fuseau
 *    de l'ÉTABLISSEMENT (jamais un fuseau codé en dur) ;
 *  - « lundi 08:00 » est une heure MURALE locale : on la convertit en instant UTC à la génération, ce
 *    qui reste correct dans un fuseau à heure d'été (fuseaux européens ou américains) ;
 *  - un horaire mural inexistant (saut de printemps) est avancé de la durée du saut ; un horaire mural
 *    ambigu (retour d'automne) prend sa PREMIÈRE occurrence.
 *
 * Aucune dépendance autre que le kernel (aides `zonedParts`, `isValidIsoDate`).
 */
import { isValidIsoDate, zonedParts } from "@ecoledigitale/kernel";

const DAY_MS = 86_400_000;
const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export const isIsoDate = isValidIsoDate;

export function assertIsoDate(value: string, label = "date"): void {
  if (!isValidIsoDate(value)) throw new RangeError(`${label} invalide : « ${value} » (AAAA-MM-JJ attendu).`);
}

function toUtcMs(isoDate: string): number {
  assertIsoDate(isoDate);
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  const dt = new Date(ms);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(isoDate: string, days: number): string {
  return fromUtcMs(toUtcMs(isoDate) + days * DAY_MS);
}

/** Nombre de jours de `a` à `b` (positif si b est après a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const maxDate = (a: string, b: string): string => (a >= b ? a : b);
export const minDate = (a: string, b: string): string => (a <= b ? a : b);

/** Jour ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(isoDate: string): number {
  const dow = new Date(toUtcMs(isoDate)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Lundi de la semaine ISO de `isoDate`. */
export function mondayOf(isoDate: string): string {
  return addDays(isoDate, 1 - isoWeekday(isoDate));
}

/** Première date >= `from` dont le jour ISO vaut `weekday`. */
export function firstWeekdayOnOrAfter(from: string, weekday: number): string {
  const delta = (weekday - isoWeekday(from) + 7) % 7;
  return addDays(from, delta);
}

/**
 * Libellé de la semaine d'alternance : la semaine du lundi `anchor` est la semaine A, la suivante B…
 * Fonctionne avant l'ancre (les semaines précédentes alternent B, A…) et à la frontière d'année
 * (le décompte est en jours, pas en numéro de semaine ISO — une année à 53 semaines n'y change rien).
 */
export function weekLabel(anchorMonday: string, isoDate: string): "A" | "B" {
  const weeks = Math.floor(daysBetween(anchorMonday, mondayOf(isoDate)) / 7);
  return ((weeks % 2) + 2) % 2 === 0 ? "A" : "B";
}

export function isMonday(isoDate: string): boolean {
  return isoWeekday(isoDate) === 1;
}

/** Itère les dates `[from, to]` (bornes incluses). */
export function* eachDate(from: string, to: string): Generator<string> {
  let cursor = from;
  while (cursor <= to) {
    yield cursor;
    cursor = addDays(cursor, 1);
  }
}

// ---------------------------------------------------------------------------
// Heures d'un jour
// ---------------------------------------------------------------------------

/** `HH:MM` ou `HH:MM:SS` → minutes depuis minuit. */
export function parseTimeOfDay(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (!m) throw new RangeError(`Heure invalide : « ${value} » (HH:MM attendu).`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatTimeOfDay(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new RangeError(`Minutes invalides : ${minutes}.`);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// ---------------------------------------------------------------------------
// Fuseau de l'établissement
// ---------------------------------------------------------------------------

/** Décalage UTC du fuseau à l'instant donné, en minutes (positif à l'est de Greenwich). */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  const real = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((shown - real) / 60_000);
}

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new RangeError(`Fuseau horaire inconnu : « ${timeZone} ».`);
  }
}

/** Date civile (AAAA-MM-JJ) de l'instant dans le fuseau. */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes depuis minuit de l'instant, heure murale du fuseau. */
export function localMinuteOf(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * Instant UTC correspondant à l'heure murale (`isoDate`, `minuteOfDay`) dans le fuseau.
 * `minuteOfDay` peut valoir 1440 (minuit de fin de journée = 00:00 du lendemain).
 */
export function localToInstant(isoDate: string, minuteOfDay: number, timeZone: string): Date {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1440) throw new RangeError(`Minutes invalides : ${minuteOfDay}.`);
  const wall = toUtcMs(isoDate) + minuteOfDay * 60_000;
  // Décalages en vigueur la veille et le lendemain : au plus un changement d'heure entre les deux.
  const before = offsetMinutesAt(new Date(wall - DAY_MS), timeZone);
  const after = offsetMinutesAt(new Date(wall + DAY_MS), timeZone);
  const fromBefore = wall - before * 60_000;
  const fromAfter = wall - after * 60_000;
  const matches = (candidate: number): boolean => offsetMinutesAt(new Date(candidate), timeZone) * 60_000 + candidate === wall;
  const okBefore = matches(fromBefore);
  const okAfter = matches(fromAfter);
  if (okBefore && okAfter) return new Date(Math.min(fromBefore, fromAfter)); // heure ambiguë : première occurrence
  if (okBefore) return new Date(fromBefore);
  if (okAfter) return new Date(fromAfter);
  // Heure inexistante (saut de printemps) : on applique le décalage d'AVANT le saut → l'heure est avancée.
  return new Date(fromBefore);
}

/** Instant du début de la journée locale. */
export function startOfLocalDay(isoDate: string, timeZone: string): Date {
  return localToInstant(isoDate, 0, timeZone);
}

export function minutesBetweenInstants(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function toSpan(start: Date, end: Date): { start: number; end: number } {
  return { start: start.getTime(), end: end.getTime() };
}

/** Deux plages semi-ouvertes `[)` se chevauchent-elles ? Bout à bout : non (critère du legacy conservé). */
export function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}
