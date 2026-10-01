/**
 * Dates CIVILES (`YYYY-MM-DD`) : arithmétique en UTC pure, indépendante du fuseau du serveur (D-24).
 * Aucune dérivation « pivot au 1er septembre » : l'année académique est une ligne de données.
 */
export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCFullYear() === Number(m[1]) && t.getUTCMonth() === Number(m[2]) - 1 && t.getUTCDate() === Number(m[3]);
}

function toUtcMs(date: IsoDate): number {
  const m = ISO_DATE_RE.exec(date);
  if (!m) throw new RangeError(`Date invalide : ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Nombre de jours calendaires de `from` à `to`, bornes incluses (`from == to` -> 1). */
export function inclusiveDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS) + 1;
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dateInRange(date: IsoDate, startsOn: IsoDate, endsOn: IsoDate): boolean {
  return date >= startsOn && date <= endsOn;
}

/** Les deux plages `[a1, a2]` et `[b1, b2]` (bornes incluses) se chevauchent-elles ? */
export function rangesOverlap(a1: IsoDate, a2: IsoDate, b1: IsoDate, b2: IsoDate): boolean {
  return a1 <= b2 && b1 <= a2;
}

/**
 * Fin « douze mois pleins » d'une année qui commence à `startsOn` : `startsOn` + 1 an − 1 jour.
 * Un début au 29 février donne le 28 février de l'année suivante (le 29 n'existe pas : la plage se termine la
 * veille du 1er mars, ce qui garde la contiguïté avec l'année suivante).
 */
export function defaultYearEnd(startsOn: IsoDate): IsoDate {
  const m = ISO_DATE_RE.exec(startsOn);
  if (!m) throw new RangeError(`Date invalide : ${startsOn}`);
  const nextYearSameDay = Date.UTC(Number(m[1]) + 1, Number(m[2]) - 1, Number(m[3]));
  return fromUtcMs(nextYearSameDay - DAY_MS);
}

/** Date civile (`YYYY-MM-DD`) d'un instant dans un fuseau IANA (défaut UTC). */
export function civilDateOf(instant: Date, timeZone?: string | null): IsoDate {
  if (!timeZone || timeZone === "UTC") return instant.toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}
