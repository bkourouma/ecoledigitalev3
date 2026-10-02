/**
 * Coercions de cellules (pures) : une cellule est TOUJOURS du texte à ce stade ; le type d'une colonne décide de sa
 * lecture. Aucune coercion ne lève : elle renvoie `{ ok: false, code, message }` (messages en français, codes stables).
 *
 * Choix de sûreté : l'ambiguïté se REFUSE (jamais de devinette qui pourrait multiplier un montant par 1 000 ou inverser
 * jour et mois) :
 *  - dates : `AAAA-MM-JJ`, `JJ/MM/AAAA` (séparateurs `/`, `-`, `.`) ou numéro de série Excel ; jamais d'année à deux chiffres ;
 *  - montants entiers : séparateurs de milliers admis (espace, apostrophe) ; `1500,5` ou `1.500` sont REFUSÉS (décimale
 *    possible) ; `1500,00` est accepté (zéro décimale) ;
 *  - décimaux (notes, coefficients) : `,` ou `.` ; renvoyés en chaîne canonique (`12.5`), jamais en flottant.
 */
import type { ImportColumnType } from "@ecoledigitale/contracts/src/v2/imports";
import { clip } from "./text";

export type Coerced<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const ok = <T>(value: T): Coerced<T> => ({ ok: true, value });
const fail = (code: string, message: string): Coerced<never> => ({ ok: false, code, message });

const pad = (n: number): string => String(n).padStart(2, "0");

function validIsoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Numéro de série Excel (système 1900, avec le faux 29/02/1900) -> `AAAA-MM-JJ`. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const whole = Math.floor(serial);
  const adjusted = whole > 59 ? whole - 1 : whole; // 1900-02-29 n'existe pas
  const ms = Date.UTC(1899, 11, 31) + adjusted * 86_400_000;
  const d = new Date(ms);
  return validIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function parseDate(raw: string): Coerced<string> {
  const s = raw.trim();
  const bad = fail("imports.invalid_date", `« ${clip(s)} » n'est pas une date valide (attendu JJ/MM/AAAA ou AAAA-MM-JJ).`);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const iso = validIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? ok(iso) : bad;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const iso = validIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
    return iso ? ok(iso) : bad;
  }
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const iso = excelSerialToIso(Number(s));
    return iso ? ok(iso) : bad;
  }
  return bad;
}

/** Entier relatif ; `amountCode` choisit le code d'erreur d'une décimale (`imports.amount_not_integer` pour un montant). */
export function parseInteger(raw: string, options: { amount?: boolean; allowNegative?: boolean } = {}): Coerced<number> {
  const s = raw.trim().replace(/[ '’]/g, "");
  const code = options.amount ? "imports.amount_invalid" : "imports.invalid_value";
  const invalid = fail(code, `« ${clip(raw.trim())} » n'est pas un nombre entier valide.`);
  const m = /^([+-]?)(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return invalid;
  const decimals = m[3];
  if (decimals !== undefined) {
    if (/[1-9]/.test(decimals)) {
      const notInteger = options.amount ? "imports.amount_not_integer" : "imports.invalid_value";
      const hint = options.amount ? " Les montants s'expriment en francs entiers, sans décimale." : "";
      return fail(notInteger, `« ${clip(raw.trim())} » comporte une partie décimale.${hint}`);
    }
  }
  if (m[2]!.length > 15) return invalid;
  const value = Number(m[2]);
  if (!Number.isSafeInteger(value)) return invalid;
  const negative = m[1] === "-" && value !== 0;
  if (negative && !options.allowNegative) return fail(code, `« ${clip(raw.trim())} » ne peut pas être négatif.`);
  return ok(negative ? -value : value);
}

/** Décimal en chaîne canonique (`12.5`), au plus `maxDecimals` décimales, aucune notation scientifique. */
export function parseDecimal(raw: string, options: { maxDecimals?: number; allowNegative?: boolean } = {}): Coerced<string> {
  const maxDecimals = options.maxDecimals ?? 4;
  const s = raw.trim().replace(/[ '’]/g, "").replace(",", ".");
  const m = /^([+-]?)(\d{1,12})(?:\.(\d{1,12}))?$/.exec(s);
  if (!m) return fail("imports.invalid_value", `« ${clip(raw.trim())} » n'est pas un nombre valide.`);
  const intPart = m[2]!.replace(/^0+(?=\d)/, "");
  let dec = (m[3] ?? "").replace(/0+$/, "");
  if (dec.length > maxDecimals) {
    if (/[1-9]/.test(dec.slice(maxDecimals))) return fail("imports.invalid_value", `« ${clip(raw.trim())} » a trop de décimales (${maxDecimals} au plus).`);
    dec = dec.slice(0, maxDecimals).replace(/0+$/, "");
  }
  const negative = m[1] === "-" && (intPart !== "0" || dec !== "");
  if (negative && !options.allowNegative) return fail("imports.invalid_value", `« ${clip(raw.trim())} » ne peut pas être négatif.`);
  return ok(`${negative ? "-" : ""}${intPart}${dec ? `.${dec}` : ""}`);
}

const TRUE_WORDS = new Set(["oui", "o", "yes", "y", "true", "vrai", "1", "x"]);
const FALSE_WORDS = new Set(["non", "n", "no", "false", "faux", "0"]);

export function parseBoolean(raw: string): Coerced<boolean> {
  const s = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(s)) return ok(true);
  if (FALSE_WORDS.has(s)) return ok(false);
  return fail("imports.invalid_value", `« ${clip(raw.trim())} » n'est pas une valeur oui / non.`);
}

export function parseEmail(raw: string): Coerced<string> {
  const s = raw.trim().toLowerCase();
  if (s.length > 320 || !/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(s)) {
    return fail("imports.invalid_email", `« ${clip(raw.trim())} » n'est pas une adresse e-mail valide.`);
  }
  return ok(s);
}

/** Téléphone : séparateurs retirés, `+` initial conservé, 6 à 15 chiffres. */
export function parsePhone(raw: string): Coerced<string> {
  const s = raw.trim();
  const digits = s.replace(/\D+/g, "");
  const plus = s.startsWith("+") || s.startsWith("00");
  const normalized = plus ? `+${digits.replace(/^00/, "")}` : digits;
  const len = normalized.replace(/\D/g, "").length;
  if (!/^[+\d\s().-]+$/.test(s) || len < 6 || len > 15) return fail("imports.invalid_phone", `« ${clip(s)} » n'est pas un numéro de téléphone valide.`);
  return ok(normalized);
}

/** Code métier : majuscules, chiffres, `_`, `.`, `-` ; espaces internes -> `_`. */
export function parseCode(raw: string): Coerced<string> {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9][A-Z0-9_.-]{0,59}$/.test(s)) return fail("imports.invalid_value", `« ${clip(raw.trim())} » n'est pas un code valide (lettres, chiffres, « _ », « . », « - »).`);
  return ok(s);
}

export function parseText(raw: string): Coerced<string> {
  const s = raw.trim();
  return ok(s);
}

/** Coercion par type de colonne. `amount` : la colonne d'entier est un montant (message dédié aux décimales). */
export function coerceByType(type: ImportColumnType, raw: string, hints: { amount?: boolean } = {}): Coerced<unknown> {
  switch (type) {
    case "date":
      return parseDate(raw);
    case "integer":
      return parseInteger(raw, hints);
    case "decimal":
      return parseDecimal(raw);
    case "boolean":
      return parseBoolean(raw);
    case "email":
      return parseEmail(raw);
    case "phone":
      return parsePhone(raw);
    case "code":
      return parseCode(raw);
    case "text":
      return parseText(raw);
  }
}
