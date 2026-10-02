/** Numéro de candidature : motif `{YEAR}-{SEQ:5}` (paramètre de l'établissement) ; `{SEQ:n}` = compteur sans trou sur `n` chiffres. */
export function formatApplicationNumber(pattern: string, input: { year: number; seq: number }): string {
  return pattern
    .replace(/\{YEAR\}/g, String(input.year))
    .replace(/\{SEQ(?::(\d{1,2}))?\}/g, (_m, width: string | undefined) => String(input.seq).padStart(width ? Number(width) : 1, "0"));
}

/** Motif acceptable : contient `{SEQ}` (sinon deux dossiers recevraient le même numéro) et aucune espace ni séparateur de chemin. */
export function isValidNumberPattern(pattern: string): boolean {
  const literal = pattern.replace(/\{(YEAR|SEQ(?::\d{1,2})?)\}/g, "");
  return /\{SEQ(?::\d{1,2})?\}/.test(pattern) && !/[\s/\\{}]/.test(literal);
}
