"use client";

import { useFormatter } from "next-intl";

/**
 * Dates et nombres : toujours via `useFormatter()` (fuseau `Africa/Abidjan`), jamais de formatage manuel.
 *
 * - une DATE CIVILE (`AAAA-MM-JJ`) n'a pas de fuseau : on la lit à midi UTC et on la formate en UTC pour
 *   qu'aucun décalage de fuseau ne change le jour affiché ;
 * - un INSTANT (ISO 8601 `…Z`) est formaté dans le fuseau configuré.
 */
export function useDateFormat() {
  const format = useFormatter();
  return {
    civil(value: string | null | undefined): string {
      if (!value) return "—";
      const d = new Date(`${value.slice(0, 10)}T12:00:00Z`);
      if (Number.isNaN(d.getTime())) return value;
      return format.dateTime(d, { dateStyle: "medium", timeZone: "UTC" });
    },
    instant(value: string | null | undefined): string {
      if (!value) return "—";
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
    },
    number(value: number | null | undefined): string {
      return value === null || value === undefined ? "—" : format.number(value);
    },
  };
}

/** Affiche un décimal exact (chaîne canonique de l'API) sans le passer par un flottant. */
export function showDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value.replace(".", ",");
}
