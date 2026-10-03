/**
 * Libellés de la coque quand la clé i18n n'existe pas : un module ou un rôle inconnu de la table s'affiche avec sa clé rendue
 * lisible (`primary_school` -> « Primary school »), jamais avec une clé brute de traduction.
 */

export function humanizeKey(key: string): string {
  const spaced = key.replace(/[_.-]+/g, " ").trim();
  return spaced === "" ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type Translator = { (key: never): string; has: (key: never) => boolean };

function labelFrom(t: unknown, key: string): string {
  const tr = t as Translator;
  return tr.has(key as never) ? tr(key as never) : humanizeKey(key);
}

export const moduleLabel = (t: unknown, key: string): string => labelFrom(t, key);
export const roleLabel = (t: unknown, key: string): string => labelFrom(t, key.toLowerCase());
