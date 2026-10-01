/**
 * Conversions entre lignes `pg` et types du domaine.
 *
 * Rappel : `pg` livre les `bigint` en CHAÎNE (jamais en nombre → pas de perte de
 * précision) et les `date` en `Date` locale (piège de fuseau). Les requêtes castent donc
 * les montants `::text` et les dates `::text`, et ces helpers reconstruisent des `Money`.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";

export function money(value: unknown, currency: string): Money {
  return Money.fromString(String(value), currency as CurrencyCode);
}

export function moneyOrNull(value: unknown, currency: string): Money | null {
  return value === null || value === undefined ? null : money(value, currency);
}

export const toIso = (d: Date | string | null): string | null => (d === null ? null : d instanceof Date ? d.toISOString() : d);
