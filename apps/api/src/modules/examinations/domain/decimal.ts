/**
 * Décimaux exacts sous forme de CHAÎNES (jamais de flottant pour une note, un coefficient ou une moyenne).
 * Postgres renvoie `numeric(6,2)` comme `"20.00"` : la forme canonique retire les zéros inutiles (`"20"`, `"14.5"`), c'est
 * celle qu'attend le moteur de règles et celle qui entre dans les empreintes d'entrées (reproductibilité).
 */
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function isDecimal(value: string): boolean {
  return DECIMAL.test(value);
}

/** `"20.00"` -> `"20"`, `"014.50"` -> `"14.5"`, `"-0.0"` -> `"0"`. Lève si ce n'est pas un décimal. */
export function normalizeDecimal(value: string): string {
  if (!DECIMAL.test(value)) throw new TypeError(`Décimal invalide : « ${value} ».`);
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [intPartRaw = "0", fracRaw = ""] = body.split(".");
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "");
  const frac = fracRaw.replace(/0+$/, "");
  const out = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  return negative && out !== "0" ? `-${out}` : out;
}

/** Comparaison exacte de deux décimaux : -1, 0, 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const na = normalizeDecimal(a);
  const nb = normalizeDecimal(b);
  if (na === nb) return 0;
  const negA = na.startsWith("-");
  const negB = nb.startsWith("-");
  if (negA !== negB) return negA ? -1 : 1;
  const [ia = "0", fa = ""] = (negA ? na.slice(1) : na).split(".");
  const [ib = "0", fb = ""] = (negB ? nb.slice(1) : nb).split(".");
  let cmp: -1 | 0 | 1;
  if (ia.length !== ib.length) cmp = ia.length > ib.length ? 1 : -1;
  else if (ia !== ib) cmp = ia > ib ? 1 : -1;
  else {
    const width = Math.max(fa.length, fb.length);
    const x = fa.padEnd(width, "0");
    const y = fb.padEnd(width, "0");
    cmp = x === y ? 0 : x > y ? 1 : -1;
  }
  return (negA ? -cmp : cmp) as -1 | 0 | 1;
}

export const decimalEquals = (a: string, b: string): boolean => compareDecimal(a, b) === 0;
