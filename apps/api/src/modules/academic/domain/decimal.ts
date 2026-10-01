/**
 * Décimaux exacts (coefficients, crédits, volumes horaires) : jamais de flottant (ADR-003).
 * Représentation = chaîne canonique (`"2"`, `"2.5"`, `"0.125"`), calculs en entiers `bigint` à l'échelle 3.
 */
const SCALE = 3;
const FACTOR = 10n ** BigInt(SCALE);
const DECIMAL_RE = /^\d{1,12}(\.\d{1,6})?$/;

/** Convertit une entrée (nombre ou chaîne) en chaîne décimale canonique, ou `null` si invalide. */
export function toDecimalString(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "number" ? numberToPlain(value) : value.trim();
  if (raw === null || !DECIMAL_RE.test(raw)) return null;
  return normalizeDecimal(raw);
}

function numberToPlain(n: number): string | null {
  if (!Number.isFinite(n) || n < 0) return null;
  const s = String(n);
  // Notation exponentielle (très petits/grands nombres) : refusée, la saisie reste lisible.
  return /e/i.test(s) ? null : s;
}

/** La valeur tient-elle dans un `numeric(precision, scale)` de la base ? (évite une erreur 22003 -> 500) */
export function fitsNumeric(value: string, precision: number, scale: number): boolean {
  const [intPart = "", fracPart = ""] = value.split(".");
  return fracPart.length <= scale && intPart.replace(/^0+(?=\d)/, "").length <= precision - scale;
}

/** `"2.500"` -> `"2.5"`, `"02"` -> `"2"`, `"0.000"` -> `"0"`. */
export function normalizeDecimal(raw: string): string {
  const [intPart = "0", fracPart = ""] = raw.split(".");
  const i = intPart.replace(/^0+(?=\d)/, "");
  const f = fracPart.replace(/0+$/, "");
  return f.length > 0 ? `${i}.${f}` : i;
}

/** Valeur exacte à l'échelle 3 (les décimales au-delà sont tronquées ; la base ne stocke que 3 au plus). */
export function toScaled(value: string): bigint {
  const [intPart = "0", fracPart = ""] = value.split(".");
  const frac = (fracPart + "0".repeat(SCALE)).slice(0, SCALE);
  return BigInt(intPart) * FACTOR + BigInt(frac);
}

export function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = abs / FACTOR;
  const frac = String(abs % FACTOR).padStart(SCALE, "0");
  const text = normalizeDecimal(`${intPart}.${frac}`);
  return negative && scaled !== 0n ? `-${text}` : text;
}

export function sumDecimals(values: ReadonlyArray<string | null | undefined>): string {
  let total = 0n;
  for (const v of values) if (v) total += toScaled(v);
  return fromScaled(total);
}

export function decimalsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return toScaled(a ?? "0") === toScaled(b ?? "0");
}
