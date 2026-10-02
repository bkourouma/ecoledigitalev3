/**
 * Date et heure LOCALES d'un instant dans le fuseau de l'établissement (un cours annulé est annoncé à l'heure du lieu).
 */
import { isValidTimeZone } from "./consent";

export function localDateTime(at: Date | string, timeZone: string): { date: string; time: string } {
  const d = typeof at === "string" ? new Date(at) : at;
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Jour calendaire (`YYYY-MM-DD`) d'un instant dans un fuseau. */
export const localDay = (at: Date, timeZone: string): string => localDateTime(at, timeZone).date;
