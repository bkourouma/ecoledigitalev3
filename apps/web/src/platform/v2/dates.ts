/**
 * Calendrier d'AFFICHAGE (navigation semaine / jour, bornes de fenêtre). Dates civiles `AAAA-MM-JJ` manipulées en UTC
 * à midi pour qu'aucun fuseau ne décale le jour. Ce n'est PAS de la règle métier : l'API reste seule juge de ce qui est
 * ouvrable, bloqué ou valide.
 */
import { DEFAULT_TIME_ZONE } from "@/platform/i18n/config";

const MS_DAY = 86_400_000;

function toDate(civil: string): Date {
  return new Date(`${civil}T12:00:00Z`);
}

function toCivil(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Date civile d'aujourd'hui dans le fuseau de l'établissement (par défaut Africa/Abidjan). */
export function todayCivil(now: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(civil: string, days: number): string {
  return toCivil(new Date(toDate(civil).getTime() + days * MS_DAY));
}

/** Jour ISO : 1 (lundi) à 7 (dimanche). */
export function isoWeekday(civil: string): number {
  const d = toDate(civil).getUTCDay();
  return d === 0 ? 7 : d;
}

export function mondayOf(civil: string): string {
  return addDays(civil, 1 - isoWeekday(civil));
}

/** Les 7 jours de la semaine (lundi -> dimanche) qui contient `civil`. */
export function weekDays(civil: string): string[] {
  const monday = mondayOf(civil);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = toDate(value);
  // `Invalid Date` (mois 13…) ferait lever `toISOString()` : une date de l'URL ne doit jamais faire échouer la page.
  return !Number.isNaN(d.getTime()) && toCivil(d) === value;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
