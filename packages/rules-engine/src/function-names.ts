/**
 * Noms de la bibliothèque de fonctions (liste blanche). Fichier séparé pour
 * éviter une dépendance circulaire avec le schéma ; un test garantit que le
 * registre des fonctions expose exactement ces noms.
 */
export const BUILTIN_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  'avg',
  'wavg',
  'sum',
  'min',
  'max',
  'count',
  'clamp',
  'abs',
  'round_half_up',
  'round_half_even',
  'floor',
  'ceil',
  'if',
  'coalesce',
  'is_null',
  'rank',
  'len',
  // itérations bornées par les données : la lambda `x => …` n'est admise qu'en 2e argument
  'map',
  'filter',
  'any',
  'all',
]);

/** Fonctions dont le 2e argument est une lambda `x => expression`. */
export const LAMBDA_FUNCTION_NAMES: ReadonlySet<string> = new Set(['map', 'filter', 'any', 'all']);
