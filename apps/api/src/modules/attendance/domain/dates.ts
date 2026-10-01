/** Aides de dates calendaires `AAAA-MM-JJ` (comparaison lexicographique = comparaison chronologique). */
import type { IsoDate } from "./types";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

const toUtc = (d: IsoDate): number => {
  const m = ISO_DATE_RE.exec(d) as RegExpExecArray;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** Nombre de jours CALENDAIRES entre deux dates, bornes incluses (>= 1 si `to >= from`). */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return Math.floor((toUtc(to) - toUtc(from)) / 86_400_000) + 1;
}

/** Nombre de jours de `[aFrom, aTo]` qui tombent dans `[bFrom, bTo]` (bornes incluses). */
export function overlapDays(aFrom: IsoDate, aTo: IsoDate, bFrom: IsoDate, bTo: IsoDate): number {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return to < from ? 0 : daysInclusive(from, to);
}

export const maxDate = (a: IsoDate, b: IsoDate): IsoDate => (a > b ? a : b);
export const minDate = (a: IsoDate, b: IsoDate): IsoDate => (a < b ? a : b);
export const within = (date: IsoDate, from: IsoDate, to: IsoDate): boolean => date >= from && date <= to;
