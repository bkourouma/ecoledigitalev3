/**
 * Arithmétique décimale minimale pour les notes et barèmes (3 décimales au plus, `numeric(8,3)`).
 * Les valeurs vivent en CHAÎNES ; la comparaison se fait en millièmes entiers (aucun flottant). Jamais d'arrondi.
 */

const DECIMAL_RE = /^\d{1,5}(\.\d{1,3})?$/;

export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/** Millièmes entiers (`"12.5"` → 12500). Lève sur une valeur mal formée : l'appelant valide avant. */
export function toMilli(value: string): number {
  if (!DECIMAL_RE.test(value)) throw new RangeError(`Valeur décimale invalide : « ${value} ».`);
  const [int = "0", frac = ""] = value.split(".");
  return Number(int) * 1000 + Number(frac.padEnd(3, "0"));
}

/** Millièmes → chaîne canonique à 3 décimales (`12500` → `"12.500"`), telle que renvoyée par Postgres `numeric(8,3)`. */
export function fromMilli(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, "0")}`;
}

/** Forme canonique d'une chaîne décimale (`"12.5"` et `"12.500"` désignent la même note). */
export function canonical(value: string): string {
  return fromMilli(toMilli(value));
}

export function equalDecimal(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return toMilli(a) === toMilli(b);
}

export function compareDecimal(a: string, b: string): number {
  return toMilli(a) - toMilli(b);
}

/** Nombre de décimales significatives (zéros terminaux ignorés) : `"12.50"` → 1. */
export function significantDecimals(value: string): number {
  const frac = value.split(".")[1] ?? "";
  return frac.replace(/0+$/, "").length;
}
