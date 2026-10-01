/**
 * Numéro d'inscription (R23) : attribué UNE fois par (apprenant, programme, niveau), stable aux réinscriptions,
 * unique par établissement. Le MOTIF est une donnée d'établissement (`institution_settings`) ; le préfixe n'est
 * plus codé en dur (« IPAM » dans le legacy).
 *
 * Jetons : `{PREFIX}` `{PROGRAM}` `{LEVEL}` `{YEAR}` `{STUDENT_SEQ:n}` (n = largeur de remplissage, 1 à 9).
 * `{STUDENT_SEQ:n}` est OBLIGATOIRE : c'est lui qui garantit l'unicité entre apprenants.
 */
export interface RegistrationNumberTokens {
  prefix: string | null;
  programCode: string;
  gradeLevelCode: string;
  /** Année de début de l'année académique (4 chiffres). */
  year: string;
  /** Numéro d'ordre figé du dossier de l'apprenant (spec 008). */
  studentSeq: number;
}

const TOKEN_RE = /\{([A-Z_]+)(?::(\d))?\}/g;
const LITERAL_RE = /^[A-Za-z0-9._/-]*$/;
export const REGISTRATION_NUMBER_MAX_LENGTH = 80;

/** Nettoie un code pour un numéro (A-Z0-9). Vide -> `XXX` (comportement historique `cleanFiliereCode`). */
export function cleanCode(code: string): string {
  const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : "XXX";
}

const KNOWN_TOKENS = new Set(["PREFIX", "PROGRAM", "LEVEL", "YEAR", "STUDENT_SEQ"]);

/** Valide un motif ; renvoie la liste des problèmes (vide = valide). */
export function validateRegistrationPattern(pattern: string): string[] {
  const problems: string[] = [];
  if (pattern.length < 3 || pattern.length > REGISTRATION_NUMBER_MAX_LENGTH) problems.push("Le motif fait entre 3 et 80 caractères.");
  const literal = pattern.replace(TOKEN_RE, "");
  if (!LITERAL_RE.test(literal) || /[{}]/.test(literal)) problems.push("Le motif ne contient que des jetons valides et les caractères A-Z a-z 0-9 . _ / -.");
  let hasSeq = false;
  for (const m of pattern.matchAll(TOKEN_RE)) {
    const name = m[1] as string;
    if (!KNOWN_TOKENS.has(name)) {
      problems.push(`Jeton inconnu {${name}}.`);
      continue;
    }
    if (name === "STUDENT_SEQ") {
      hasSeq = true;
      if (m[2] === undefined || Number(m[2]) < 1) problems.push("{STUDENT_SEQ:n} exige une largeur n de 1 à 9.");
    } else if (m[2] !== undefined) {
      problems.push(`Le jeton {${name}} n'accepte pas de largeur.`);
    }
  }
  if (!hasSeq) problems.push("Le motif doit contenir {STUDENT_SEQ:n} : sans lui deux apprenants pourraient partager un numéro.");
  return problems;
}

export function patternUsesPrefix(pattern: string): boolean {
  return /\{PREFIX\}/.test(pattern);
}

/** Génère un numéro. Lève `RangeError` si le motif est invalide ou si le numéro d'ordre est absent. */
export function formatRegistrationNumber(pattern: string, tokens: RegistrationNumberTokens): string {
  const problems = validateRegistrationPattern(pattern);
  if (problems.length > 0) throw new RangeError(problems.join(" "));
  if (!Number.isInteger(tokens.studentSeq) || tokens.studentSeq < 0) throw new RangeError("Numéro d'ordre de l'apprenant invalide.");
  const result = pattern.replace(TOKEN_RE, (_all, name: string, width: string | undefined) => {
    switch (name) {
      case "PREFIX":
        if (!tokens.prefix) throw new RangeError("Le motif utilise {PREFIX} mais l'établissement n'a pas de préfixe.");
        return tokens.prefix;
      case "PROGRAM":
        return cleanCode(tokens.programCode);
      case "LEVEL":
        return cleanCode(tokens.gradeLevelCode);
      case "YEAR":
        return tokens.year;
      default:
        return String(tokens.studentSeq).padStart(Number(width), "0");
    }
  });
  if (result.length > REGISTRATION_NUMBER_MAX_LENGTH) throw new RangeError("Le numéro généré dépasse 80 caractères.");
  return result;
}
