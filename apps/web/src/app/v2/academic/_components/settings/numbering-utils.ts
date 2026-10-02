/**
 * Lecture de FORME d'un motif de numérotation (`{PREFIX}-{YEAR}-{STUDENT_SEQ:5}`) : découpe en texte fixe et en jetons, et
 * repère les jetons inconnus. Ce n'est JAMAIS un calcul de numéro : les numéros réels sont attribués par le serveur
 * (séquences transactionnelles). L'aperçu sert seulement à voir, avant l'envoi, quels jetons le motif contient.
 */

export interface TokenSpec {
  /** Nom stable du jeton (clé de traduction de son explication). */
  name: string;
  /** Contenu du jeton entre accolades ; le premier groupe capturé, s'il existe, est le nombre de chiffres. */
  test: RegExp;
}

export type PatternPart = { kind: "text"; text: string; invalid: boolean } | { kind: "token"; raw: string; known: boolean; name: string | null; digits: number | null };

/** Jetons du numéro d'inscription (réglage de l'établissement, module académique). */
export const REGISTRATION_TOKENS: ReadonlyArray<TokenSpec> = [
  { name: "PREFIX", test: /^PREFIX$/ },
  { name: "PROGRAM", test: /^PROGRAM$/ },
  { name: "LEVEL", test: /^LEVEL$/ },
  { name: "YEAR", test: /^YEAR$/ },
  { name: "STUDENT_SEQ", test: /^STUDENT_SEQ:([1-9])$/ },
];

/** Jetons des matricules élève et personnel (réglage des personnes). */
export const PEOPLE_TOKENS: ReadonlyArray<TokenSpec> = [
  { name: "PREFIX", test: /^PREFIX$/ },
  { name: "YYYY", test: /^YYYY$/ },
  { name: "YY", test: /^YY$/ },
  { name: "SEQ", test: /^SEQ:([1-9])$/ },
];

export function parsePattern(pattern: string, specs: ReadonlyArray<TokenSpec>): PatternPart[] {
  const parts: PatternPart[] = [];
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  const pushText = (text: string) => {
    if (text !== "") parts.push({ kind: "text", text, invalid: /[{}]/.test(text) });
  };
  for (let m = re.exec(pattern); m !== null; m = re.exec(pattern)) {
    pushText(pattern.slice(last, m.index));
    const inner = m[1] ?? "";
    let found: { name: string; digits: number | null } | null = null;
    for (const spec of specs) {
      const hit = spec.test.exec(inner);
      if (hit) {
        found = { name: spec.name, digits: hit[1] !== undefined ? Number(hit[1]) : null };
        break;
      }
    }
    parts.push({ kind: "token", raw: m[0], known: found !== null, name: found?.name ?? null, digits: found?.digits ?? null });
    last = m.index + m[0].length;
  }
  pushText(pattern.slice(last));
  return parts;
}

/** Vrai si le motif contient au moins un jeton de ce nom. */
export function hasToken(parts: ReadonlyArray<PatternPart>, name: string): boolean {
  return parts.some((p) => p.kind === "token" && p.name === name);
}

/** Vrai si un jeton est inconnu ou si une accolade est isolée. */
export function hasProblem(parts: ReadonlyArray<PatternPart>): boolean {
  return parts.some((p) => (p.kind === "token" ? !p.known : p.invalid));
}
