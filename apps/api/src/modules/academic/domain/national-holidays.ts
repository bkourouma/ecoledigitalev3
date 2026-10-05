/**
 * Calendrier national des jours fériés (O-10) : fêtes à date fixe étendues sur une plage de dates, activation par
 * établissement. Pur : aucune E/S. AUCUNE date n'est écrite ici : les fêtes viennent de la table globale
 * `academic.national_holidays` (données, marquées « à confirmer »), les fêtes mobiles n'ont pas de date.
 */

export type NationalHolidayRecurrence = "FIXED_DATE" | "MOVABLE";

export interface NationalHoliday {
  code: string;
  countryCode: string;
  label: string;
  recurrence: NationalHolidayRecurrence;
  /** Mois (1-12) et jour d'une fête à date fixe ; `null` pour une fête mobile. */
  month: number | null;
  day: number | null;
  sourceKind: "placeholder" | "regulation";
  sourceReference: string | null;
  needsConfirmation: boolean;
  note: string | null;
  active: boolean;
}

/** Un jour férié (national ou propre à l'établissement) ramené à une plage de dates civiles. */
export interface EffectiveHoliday {
  origin: "NATIONAL" | "INSTITUTION";
  /** Code national (`NEW_YEAR`…) ou identifiant du jour férié de l'établissement. */
  ref: string;
  label: string;
  kind: "HOLIDAY" | "BREAK" | "CLOSURE";
  startsOn: string;
  endsOn: string;
  blocksTeaching: boolean;
  /** National seulement : valeur de démonstration non encore rattachée à un texte officiel. */
  needsConfirmation: boolean;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `AAAA-MM-JJ` si la date existe (29 février d'une année non bissextile : `null`). */
export function civilDate(year: number, month: number, day: number): string | null {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Étend les fêtes nationales À DATE FIXE sur `[from, to]` (bornes incluses), en écartant celles qu'un établissement a
 * désactivées. Les fêtes mobiles ne produisent rien : leurs dates sont saisies par l'établissement.
 */
export function expandNationalHolidays(
  holidays: readonly NationalHoliday[],
  disabledCodes: ReadonlySet<string>,
  range: { from: string; to: string },
): EffectiveHoliday[] {
  const out: EffectiveHoliday[] = [];
  const firstYear = Number(range.from.slice(0, 4));
  const lastYear = Number(range.to.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const h of holidays) {
      if (!h.active || h.recurrence !== "FIXED_DATE" || h.month === null || h.day === null) continue;
      if (disabledCodes.has(h.code)) continue;
      const date = civilDate(year, h.month, h.day);
      if (!date || date < range.from || date > range.to) continue;
      out.push({ origin: "NATIONAL", ref: h.code, label: h.label, kind: "HOLIDAY", startsOn: date, endsOn: date, blocksTeaching: true, needsConfirmation: h.needsConfirmation });
    }
  }
  return out.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.ref.localeCompare(b.ref));
}

/** Fusionne fêtes nationales et jours de l'établissement, par date de début puis libellé. */
export function mergeHolidays(national: readonly EffectiveHoliday[], institution: readonly EffectiveHoliday[]): EffectiveHoliday[] {
  return [...national, ...institution].sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn) || a.label.localeCompare(b.label));
}
