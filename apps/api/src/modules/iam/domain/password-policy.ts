/**
 * Politique de mots de passe (configurable, pure).
 *
 * Approche NIST SP 800-63B : la LONGUEUR prime sur la composition. Par défaut :
 * 12 caractères minimum, 128 maximum, aucune règle de classes ; on refuse en
 * revanche les mots de passe courants/fuités (liste intégrée + liste du tenant),
 * les répétitions et suites triviales, et tout mot de passe dérivé de l'e-mail
 * (identique, ou contenant la partie locale).
 *
 * La liste intégrée est volontairement courte (les plus fréquents, en français
 * et en anglais, dans l'esprit du public cible) ; elle se complète par
 * `extraBlocklist` ou, plus tard, par une vérification de type « k-anonymity »
 * côté infrastructure.
 */
import type { PasswordPolicyOptions } from "../config";

export type PasswordIssueCode =
  | "too_short"
  | "too_long"
  | "common"
  | "equals_email"
  | "contains_email"
  | "repetitive"
  | "sequence"
  | "character_classes";

export interface PasswordIssue {
  code: PasswordIssueCode;
  message: string;
}

const COMMON = [
  "password", "passw0rd", "p@ssw0rd", "p@ssword", "motdepasse", "motdepasse1", "mot2passe", "azerty", "azertyuiop", "azerty123",
  "qwerty", "qwertyuiop", "qwerty123", "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "0123456789",
  "111111", "000000", "123123", "654321", "abc123", "abcd1234", "iloveyou", "jetaime", "bonjour", "bonjour123", "salut123",
  "admin", "admin123", "administrator", "root", "toor", "welcome", "welcome1", "letmein", "changeme", "monkey", "dragon",
  "football", "master", "sunshine", "princess", "azertyazerty", "ecole", "ecole123", "ecoledigitale", "school123", "student",
  "student123", "teacher", "teacher123", "parent123", "bienvenue", "abidjan", "abidjan225", "cotedivoire", "ivoire225", "cotedivoire225",
  "motdepasse123", "passer123", "passer", "test1234", "testtest", "azerty1234", "1q2w3e4r", "1qaz2wsx", "qazwsx", "zaq12wsx",
  "iloveyou1", "trustno1", "superman", "batman", "soleil", "doudou", "chocolat", "marseille", "psgpsg", "123456a", "a123456",
  "password1", "password12", "password123", "password1234", "motdepasse1234", "123456789a", "azertyuiop123",
];

const LEET: Record<string, string> = { "@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t" };

/** Minuscules, accents retirés, « leet » défait, séparateurs ôtés. */
export function canonicalize(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  let out = "";
  for (const ch of base) out += LEET[ch] ?? ch;
  return out.replace(/[^a-z0-9]/g, "");
}

const COMMON_CANON = new Set(COMMON.map(canonicalize));

function charClasses(p: string): number {
  let n = 0;
  if (/[a-z]/.test(p)) n += 1;
  if (/[A-Z]/.test(p)) n += 1;
  if (/\d/.test(p)) n += 1;
  if (/[^A-Za-z0-9]/.test(p)) n += 1;
  return n;
}

function isRepetitive(p: string): boolean {
  const chars = [...p.toLowerCase()];
  if (new Set(chars).size <= 2) return true;
  // motif répété (« abcabcabcabc »)
  for (let size = 1; size <= 4; size += 1) {
    if (chars.length % size === 0 && chars.length / size >= 3) {
      const unit = chars.slice(0, size).join("");
      if (unit.repeat(chars.length / size) === chars.join("")) return true;
    }
  }
  return false;
}

function isSequence(p: string): boolean {
  const s = p.toLowerCase();
  if (s.length < 8) return false;
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < s.length; i += 1) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d === 1) asc += 1;
    if (d === -1) desc += 1;
  }
  return asc >= s.length - 2 || desc >= s.length - 2;
}

export interface PasswordPolicyContext {
  /** E-mail de l'identité (interdit comme mot de passe, ou contenu dans celui-ci). */
  email?: string;
  /** Autres termes à refuser (nom de l'établissement, prénom…). */
  forbiddenTerms?: readonly string[];
}

export class PasswordPolicy {
  private readonly extra: ReadonlySet<string>;

  constructor(private readonly options: PasswordPolicyOptions) {
    this.extra = new Set(options.extraBlocklist.map(canonicalize));
  }

  /** Liste des violations (vide = mot de passe accepté). Messages en français. */
  evaluate(password: string, context: PasswordPolicyContext = {}): PasswordIssue[] {
    const issues: PasswordIssue[] = [];
    const length = [...password].length;
    const { minLength, maxLength, minCharacterClasses } = this.options;

    if (length < minLength) issues.push({ code: "too_short", message: `Le mot de passe doit contenir au moins ${minLength} caractères.` });
    if (length > maxLength) issues.push({ code: "too_long", message: `Le mot de passe ne doit pas dépasser ${maxLength} caractères.` });

    const canon = canonicalize(password);
    if (canon.length > 0 && (COMMON_CANON.has(canon) || this.extra.has(canon))) {
      issues.push({ code: "common", message: "Ce mot de passe est trop courant. Choisissez une phrase de passe plus originale." });
    }

    if (context.email) {
      const email = context.email.trim().toLowerCase();
      const local = email.split("@")[0] ?? "";
      const pw = password.trim().toLowerCase();
      if (pw === email || canon === canonicalize(email)) {
        issues.push({ code: "equals_email", message: "Le mot de passe ne doit pas être votre adresse e-mail." });
      } else if (local.length >= 4 && canon.includes(canonicalize(local))) {
        issues.push({ code: "contains_email", message: "Le mot de passe ne doit pas contenir votre identifiant e-mail." });
      }
    }
    for (const term of context.forbiddenTerms ?? []) {
      const t = canonicalize(term);
      if (t.length >= 4 && canon.includes(t)) {
        issues.push({ code: "contains_email", message: "Le mot de passe ne doit pas contenir de terme personnel ou le nom de l'établissement." });
        break;
      }
    }

    if (length >= 4 && isRepetitive(password)) issues.push({ code: "repetitive", message: "Le mot de passe est trop répétitif." });
    if (isSequence(password)) issues.push({ code: "sequence", message: "Le mot de passe ne doit pas être une suite de caractères consécutifs." });

    if (minCharacterClasses > 0 && charClasses(password) < minCharacterClasses) {
      issues.push({ code: "character_classes", message: `Utilisez au moins ${minCharacterClasses} types de caractères (minuscules, majuscules, chiffres, symboles).` });
    }
    return issues;
  }

  isAcceptable(password: string, context?: PasswordPolicyContext): boolean {
    return this.evaluate(password, context).length === 0;
  }
}
