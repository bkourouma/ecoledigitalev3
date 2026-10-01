/**
 * Horloge injectable + aides de fuseau.
 *
 * Règle (plan §3.4) : toutes les valeurs temporelles sont stockées en UTC ;
 * seule l'AFFICHAGE et le découpage « jour calendaire » utilisent
 * `Africa/Abidjan` (UTC+0 sans heure d'été, mais on passe par `Intl` pour ne pas
 * coder cette hypothèse en dur : si la règle change, le code suit la base tzdata).
 *
 * Aucun module métier n'appelle `new Date()` / `Date.now()` directement : il
 * reçoit un `Clock`.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = Object.freeze({
  now: () => new Date(),
});

/** Horloge de test : figée, avançable. */
export class ManualClock implements Clock {
  private current: number;

  constructor(initial: Date | string | number = "2026-01-01T00:00:00.000Z") {
    this.current = new Date(initial).getTime();
    if (Number.isNaN(this.current)) throw new TypeError("Date initiale invalide.");
  }

  now(): Date {
    return new Date(this.current);
  }

  set(value: Date | string | number): void {
    const t = new Date(value).getTime();
    if (Number.isNaN(t)) throw new TypeError("Date invalide.");
    this.current = t;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export const ABIDJAN_TZ = "Africa/Abidjan";

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

function assertValidDate(date: Date): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("Date invalide.");
  }
}

/** Composants calendaires de `date` dans le fuseau demandé. */
export function zonedParts(date: Date, timeZone: string = ABIDJAN_TZ): ZonedParts {
  assertValidDate(date);
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year as number,
    month: out.month as number,
    day: out.day as number,
    hour: out.hour as number,
    minute: out.minute as number,
    second: out.second as number,
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** `YYYY-MM-DD` du jour calendaire de `date` à Abidjan. */
export function abidjanDate(date: Date, timeZone: string = ABIDJAN_TZ): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** `YYYY-MM-DDTHH:mm:ss` en heure locale (sans suffixe de fuseau). */
export function abidjanDateTime(date: Date, timeZone: string = ABIDJAN_TZ): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/**
 * Instant UTC correspondant à `YYYY-MM-DD` 00:00:00 dans `timeZone`.
 * Algorithme à deux passes (convergent sauf dans le trou d'une transition,
 * sans objet à Abidjan mais correct pour les autres fuseaux).
 */
export function startOfDayInZone(isoDate: string, timeZone: string = ABIDJAN_TZ): Date {
  if (!isValidIsoDate(isoDate)) throw new TypeError(`Date ISO invalide : "${isoDate}".`);
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wallAsUtc - shown;
  }
  return new Date(guess);
}

export const startOfDayAbidjan = (isoDate: string): Date => startOfDayInZone(isoDate, ABIDJAN_TZ);

/** Instant du dernier milliseconde du jour calendaire à Abidjan. */
export function endOfDayAbidjan(isoDate: string): Date {
  if (!isValidIsoDate(isoDate)) throw new TypeError(`Date ISO invalide : "${isoDate}".`);
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextIso = `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
  return new Date(startOfDayInZone(nextIso, ABIDJAN_TZ).getTime() - 1);
}

/** Format long fr-CI, ex. « jeudi 1 octobre 2026 ». */
export function formatDateFr(date: Date, timeZone: string = ABIDJAN_TZ): string {
  assertValidDate(date);
  return new Intl.DateTimeFormat("fr-CI", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
