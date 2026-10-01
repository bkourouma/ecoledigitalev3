/**
 * Configuration i18n — mode SANS préfixe d'URL.
 *
 * Aujourd'hui une seule locale (`fr-CI`) ; ajouter une langue = ajouter son code ci-dessous, créer
 * `messages/<code>.json` et l'enregistrer dans `messages.ts`. Voir apps/web/docs/i18n.md.
 */

export const LOCALES = ["fr-CI"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr-CI";
export const DEFAULT_TIME_ZONE = "Africa/Abidjan";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Locale de la requête. Fixe pour l'instant ; c'est le SEUL point à modifier le jour où elle dépendra
 * d'une préférence utilisateur ou tenant (cookie, profil de tenant…) — jamais de préfixe d'URL.
 */
export function resolveLocale(preferred?: string | null): Locale {
  return isLocale(preferred) ? preferred : DEFAULT_LOCALE;
}
