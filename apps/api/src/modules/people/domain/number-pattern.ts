/**
 * Motif de numérotation du matricule élève et du numéro de personnel (fonctions PURES).
 *
 * Jetons : `{SEQ:n}` (compteur gapless, rempli de zéros sur `n` chiffres MINIMUM, jamais tronqué), `{YYYY}`, `{YY}`
 * (année UTC de l'horloge injectée), `{PREFIX}` (préfixe du tenant, `settings.number_prefix`). Le motif est une DONNÉE
 * du tenant ; le numéro produit est immuable (déclencheur) et n'est jamais recalculé.
 */
import { PeopleErrors } from "./errors";
import type { AppError } from "@ecoledigitale/kernel";

export const DEFAULT_STUDENT_PATTERN = "{SEQ:5}";
export const DEFAULT_STAFF_PATTERN = "P{SEQ:4}";

const TOKEN_RE = /\{(SEQ:([1-9])|YYYY|YY|PREFIX)\}/g;
const ALLOWED_LITERAL_RE = /^[A-Za-z0-9_\-./]*$/;
const MAX_LENGTH = 40;

export interface NumberContext {
  readonly seq: number;
  readonly year: number;
  readonly prefix: string | null;
}

/** Lève une `AppError` si le motif est inutilisable (aucun jeton `{SEQ:n}`, caractères interdits, jeton inconnu). */
export function validatePattern(pattern: string): AppError | null {
  const seqTokens = [...pattern.matchAll(/\{SEQ:[1-9]\}/g)];
  if (seqTokens.length !== 1) return PeopleErrors.numberPatternInvalid("Le motif doit contenir exactement un jeton {SEQ:n} (n de 1 à 9).");
  const literal = pattern.replace(TOKEN_RE, "");
  if (literal.includes("{") || literal.includes("}")) return PeopleErrors.numberPatternInvalid("Jeton inconnu : seuls {SEQ:n}, {YYYY}, {YY} et {PREFIX} existent.");
  if (!ALLOWED_LITERAL_RE.test(literal)) return PeopleErrors.numberPatternInvalid("Le motif ne peut contenir que lettres, chiffres et _ - . /.");
  if (pattern.length > 80) return PeopleErrors.numberPatternInvalid("Motif trop long.");
  return null;
}

/** Applique le motif ; `{PREFIX}` sans préfixe configuré est une erreur (jamais une chaîne vide silencieuse). */
export function formatNumber(pattern: string, ctx: NumberContext): string {
  if (!Number.isInteger(ctx.seq) || ctx.seq < 1) throw new RangeError("Le compteur doit être un entier ≥ 1.");
  const out = pattern.replace(TOKEN_RE, (_m, token: string, width?: string) => {
    if (token.startsWith("SEQ:")) return String(ctx.seq).padStart(Number(width), "0");
    if (token === "YYYY") return String(ctx.year).padStart(4, "0");
    if (token === "YY") return String(ctx.year % 100).padStart(2, "0");
    if (ctx.prefix === null || ctx.prefix === "") throw new RangeError("Le motif utilise {PREFIX} mais aucun préfixe n'est configuré.");
    return ctx.prefix;
  });
  if (out.length > MAX_LENGTH) throw new RangeError("Numéro trop long.");
  return out;
}
