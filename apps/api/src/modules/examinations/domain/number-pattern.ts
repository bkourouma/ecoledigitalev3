/**
 * Motif de numéro de candidat : jetons `{TYPE}`, `{YEAR}`, `{SEQ:n}` (n chiffres, complétés par des zéros) ou `{SEQ}`.
 *
 * Le numéro est FORMATÉ PAR LA BASE à l'inscription (`examinations.format_number`, déclencheur `candidates_guard`) ; cette
 * fonction en est la copie TypeScript, utilisée pour l'aperçu d'un motif à l'écran et pour la validation d'un motif saisi.
 * Un test de parité exécute les deux sur les mêmes cas (`test/integration/number-parity.integration.test.ts`).
 *
 * Le compteur est obligatoire : sans lui, deux candidats auraient le même numéro. Un numéro n'est jamais tronqué : un compteur
 * plus long que la largeur demandée s'affiche en entier.
 */
const SEQ_TOKEN = /\{SEQ(?::([0-9]{1,2}))?\}/;

export function formatCandidateNumber(pattern: string, typeCode: string, year: number, seq: number | bigint | string): string {
  const seqText = String(seq);
  let out = pattern.split("{TYPE}").join(typeCode).split("{YEAR}").join(String(year));
  const width = /\{SEQ:([0-9]{1,2})\}/.exec(out);
  if (width) {
    const w = Number(width[1]);
    out = out.replace(/\{SEQ:[0-9]{1,2}\}/, seqText.length >= w ? seqText : seqText.padStart(w, "0"));
  } else {
    out = out.split("{SEQ}").join(seqText);
  }
  return out;
}

/** `null` si le motif est valide, sinon la raison (français). */
export function validateNumberPattern(pattern: string): string | null {
  if (pattern.length < 3 || pattern.length > 60) return "Le motif doit compter entre 3 et 60 caractères.";
  if (!SEQ_TOKEN.test(pattern)) return "Le motif doit contenir le compteur {SEQ} ou {SEQ:n}.";
  const stripped = pattern.replace(/\{TYPE\}|\{YEAR\}|\{SEQ(?::[0-9]{1,2})?\}/g, "");
  if (/[{}]/.test(stripped)) return "Jeton inconnu : seuls {TYPE}, {YEAR} et {SEQ:n} sont admis.";
  if ((pattern.match(/\{SEQ/g) ?? []).length > 1) return "Le compteur ne peut apparaître qu'une fois.";
  return null;
}
