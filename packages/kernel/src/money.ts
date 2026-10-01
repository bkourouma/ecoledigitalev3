/**
 * Money : montants ENTIERS, sans flottant.
 *
 * - Le montant est stocké en UNITÉS MINEURES de la devise. Pour XOF (franc CFA
 *   BCEAO) l'exposant est 0 : l'unité mineure EST le franc. `Money.of(1500)` =
 *   1 500 F CFA.
 * - Toute opération vérifie que le résultat reste un entier sûr JS
 *   (|x| <= 2^53 - 1 ≈ 9 × 10^15) et lève `MoneyError('MONEY_OVERFLOW')` sinon.
 *   Jamais de dépassement silencieux, jamais de NaN/Infinity.
 * - Les produits/quotients intermédiaires passent par `bigint` : `multiplyRatio`
 *   ne perd rien même si le produit intermédiaire dépasse 2^53.
 * - Les arrondis sont toujours EXPLICITES (`RoundingMode`) ; aucune opération
 *   n'arrondit implicitement.
 * - `allocate`/`split` répartissent un montant SANS PERTE : la somme des parts
 *   est exactement le montant d'origine (méthode du plus fort reste).
 */

export type CurrencyCode = "XOF" | "XAF" | "EUR" | "USD";

export interface Currency {
  readonly code: CurrencyCode;
  /** Nombre de décimales de l'unité majeure (0 pour XOF/XAF). */
  readonly exponent: number;
}

export const CURRENCIES: Readonly<Record<CurrencyCode, Currency>> = Object.freeze({
  XOF: Object.freeze({ code: "XOF", exponent: 0 }),
  XAF: Object.freeze({ code: "XAF", exponent: 0 }),
  EUR: Object.freeze({ code: "EUR", exponent: 2 }),
  USD: Object.freeze({ code: "USD", exponent: 2 }),
});

export const DEFAULT_CURRENCY: CurrencyCode = "XOF";

export type MoneyErrorCode =
  | "MONEY_OVERFLOW"
  | "MONEY_INVALID_AMOUNT"
  | "MONEY_CURRENCY_MISMATCH"
  | "MONEY_UNKNOWN_CURRENCY"
  | "MONEY_INVALID_OPERAND";

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

/**
 * Modes d'arrondi (sémantique `java.math.RoundingMode`) :
 *  - UP        : s'éloigne de zéro ;
 *  - DOWN      : tronque vers zéro ;
 *  - CEILING   : vers +∞ ;
 *  - FLOOR     : vers −∞ ;
 *  - HALF_UP   : au plus proche, égalité → s'éloigne de zéro (arrondi commercial) ;
 *  - HALF_DOWN : au plus proche, égalité → vers zéro ;
 *  - HALF_EVEN : au plus proche, égalité → vers le pair (arrondi du banquier).
 */
export type RoundingMode = "UP" | "DOWN" | "CEILING" | "FLOOR" | "HALF_UP" | "HALF_DOWN" | "HALF_EVEN";

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = -MAX;

/** Division entière `n / d` arrondie selon `mode`. `d` ne doit pas être nul. */
export function divideRounded(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === 0n) throw new MoneyError("MONEY_INVALID_OPERAND", "Division par zéro.");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const q = n / d; // tronque vers zéro
  const r = n % d; // signe de n
  if (r === 0n) return q;
  const sign = n < 0n ? -1n : 1n;
  const twice = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case "DOWN":
      return q;
    case "UP":
      return q + sign;
    case "CEILING":
      return sign > 0n ? q + 1n : q;
    case "FLOOR":
      return sign < 0n ? q - 1n : q;
    case "HALF_UP":
    case "HALF_DOWN":
    case "HALF_EVEN": {
      if (twice > d) return q + sign;
      if (twice < d) return q;
      if (mode === "HALF_UP") return q + sign;
      if (mode === "HALF_DOWN") return q;
      return q % 2n === 0n ? q : q + sign;
    }
    default: {
      const never: never = mode;
      throw new MoneyError("MONEY_INVALID_OPERAND", `Mode d'arrondi inconnu : ${String(never)}`);
    }
  }
}

function toBigIntOperand(value: number | bigint, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError("MONEY_INVALID_OPERAND", `${label} doit être un entier sûr (reçu ${String(value)}).`);
  }
  return BigInt(value);
}

function fromBigInt(value: bigint): number {
  if (value > MAX || value < MIN) {
    throw new MoneyError("MONEY_OVERFLOW", `Montant hors limites : ${value.toString()}.`);
  }
  return Number(value);
}

function currencyOf(code: string): Currency {
  const c = (CURRENCIES as Record<string, Currency | undefined>)[code];
  if (!c) throw new MoneyError("MONEY_UNKNOWN_CURRENCY", `Devise inconnue : "${code}".`);
  return c;
}

export class Money {
  /** Montant en unités mineures (entier sûr, jamais -0). */
  readonly amount: number;
  readonly currency: CurrencyCode;

  private constructor(amount: number, currency: CurrencyCode) {
    this.amount = amount === 0 ? 0 : amount; // normalise -0
    this.currency = currency;
    Object.freeze(this);
  }

  // ---- construction -------------------------------------------------------

  /** `amount` en unités mineures (pour XOF : des francs). Doit être un entier sûr. */
  static of(amount: number | bigint, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    currencyOf(currency);
    if (typeof amount === "bigint") return new Money(fromBigInt(amount), currency);
    if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount)) {
      throw new MoneyError("MONEY_INVALID_AMOUNT", `Montant non entier : ${String(amount)}.`);
    }
    if (!Number.isSafeInteger(amount)) {
      throw new MoneyError("MONEY_OVERFLOW", `Montant hors limites : ${String(amount)}.`);
    }
    return new Money(amount, currency);
  }

  static zero(currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return Money.of(0, currency);
  }

  /** Texte entier signé, p. ex. un `bigint` renvoyé par `pg` (qui le livre en chaîne). */
  static fromString(text: string, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    if (typeof text !== "string" || !/^-?\d+$/.test(text.trim())) {
      throw new MoneyError("MONEY_INVALID_AMOUNT", `Montant illisible : "${String(text)}".`);
    }
    return Money.of(BigInt(text.trim()), currency);
  }

  static fromJSON(json: { amount: number | string; currency?: CurrencyCode }): Money {
    const currency = json.currency ?? DEFAULT_CURRENCY;
    return typeof json.amount === "string"
      ? Money.fromString(json.amount, currency)
      : Money.of(json.amount, currency);
  }

  // ---- arithmétique -------------------------------------------------------

  private assertSame(other: Money): void {
    if (!(other instanceof Money)) {
      throw new MoneyError("MONEY_INVALID_OPERAND", "L'opérande n'est pas un Money.");
    }
    if (other.currency !== this.currency) {
      throw new MoneyError(
        "MONEY_CURRENCY_MISMATCH",
        `Devises différentes : ${this.currency} et ${other.currency}.`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSame(other);
    return new Money(fromBigInt(BigInt(this.amount) + BigInt(other.amount)), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSame(other);
    return new Money(fromBigInt(BigInt(this.amount) - BigInt(other.amount)), this.currency);
  }

  negate(): Money {
    return new Money(-this.amount, this.currency);
  }

  abs(): Money {
    return this.amount < 0 ? this.negate() : this;
  }

  /** Multiplication par un ENTIER (quantité). Pour un taux, utiliser `multiplyRatio`/`applyBasisPoints`. */
  multiply(factor: number | bigint): Money {
    const f = toBigIntOperand(factor, "Le facteur");
    return new Money(fromBigInt(BigInt(this.amount) * f), this.currency);
  }

  /** `this × numerator / denominator`, produit intermédiaire exact, arrondi explicite. */
  multiplyRatio(
    numerator: number | bigint,
    denominator: number | bigint,
    mode: RoundingMode,
  ): Money {
    const n = toBigIntOperand(numerator, "Le numérateur");
    const d = toBigIntOperand(denominator, "Le dénominateur");
    return new Money(fromBigInt(divideRounded(BigInt(this.amount) * n, d, mode)), this.currency);
  }

  /** Applique un taux en points de base (1 % = 100 bps ; 18 % = 1800 bps). */
  applyBasisPoints(bps: number | bigint, mode: RoundingMode): Money {
    return this.multiplyRatio(bps, 10_000, mode);
  }

  /** Division par un entier avec arrondi explicite (⚠ pour répartir sans perte, utiliser `split`). */
  divide(divisor: number | bigint, mode: RoundingMode): Money {
    return this.multiplyRatio(1, divisor, mode);
  }

  // ---- répartition sans perte --------------------------------------------

  /**
   * Répartit le montant selon des poids entiers positifs ou nuls (méthode du plus
   * fort reste). Garanties :
   *  - la somme des parts vaut EXACTEMENT le montant ;
   *  - chaque part est à moins d'une unité mineure de sa part théorique ;
   *  - un poids nul reçoit 0 ; à reste égal, l'indice le plus petit est servi d'abord ;
   *  - le résultat est déterministe et sans erreur d'arrondi cumulée.
   */
  allocate(weights: ReadonlyArray<number | bigint>): Money[] {
    if (weights.length === 0) {
      throw new MoneyError("MONEY_INVALID_OPERAND", "allocate : au moins un poids est requis.");
    }
    const w = weights.map((x, i) => {
      const b = toBigIntOperand(x, `Le poids #${i}`);
      if (b < 0n) throw new MoneyError("MONEY_INVALID_OPERAND", `Le poids #${i} est négatif.`);
      return b;
    });
    const total = w.reduce((a, b) => a + b, 0n);
    if (total === 0n) {
      throw new MoneyError("MONEY_INVALID_OPERAND", "allocate : la somme des poids est nulle.");
    }

    const negative = this.amount < 0;
    const abs = BigInt(negative ? -this.amount : this.amount);

    const shares = w.map((wi) => (abs * wi) / total);
    const remainders = w.map((wi, index) => ({ index, rest: (abs * wi) % total }));
    let leftover = abs - shares.reduce((a, b) => a + b, 0n);

    remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
    for (const { index, rest } of remainders) {
      if (leftover === 0n) break;
      if (rest === 0n) break; // un poids nul (ou un reste nul) ne reçoit rien
      shares[index] = (shares[index] as bigint) + 1n;
      leftover -= 1n;
    }
    // Invariant : leftover === 0n (somme des restes / total est un entier < nb de restes non nuls).

    return shares.map((s) => new Money(Number(negative ? -s : s), this.currency));
  }

  /** Répartition en `parts` parts égales (l'excédent va une unité à la fois aux premières parts). */
  split(parts: number): Money[] {
    if (!Number.isSafeInteger(parts) || parts < 1) {
      throw new MoneyError("MONEY_INVALID_OPERAND", "split : le nombre de parts doit être un entier ≥ 1.");
    }
    return this.allocate(new Array<number>(parts).fill(1));
  }

  // ---- comparaison --------------------------------------------------------

  compare(other: Money): -1 | 0 | 1 {
    this.assertSame(other);
    return this.amount < other.amount ? -1 : this.amount > other.amount ? 1 : 0;
  }
  equals(other: Money): boolean {
    return other instanceof Money && other.currency === this.currency && other.amount === this.amount;
  }
  lt(other: Money): boolean {
    return this.compare(other) < 0;
  }
  lte(other: Money): boolean {
    return this.compare(other) <= 0;
  }
  gt(other: Money): boolean {
    return this.compare(other) > 0;
  }
  gte(other: Money): boolean {
    return this.compare(other) >= 0;
  }
  isZero(): boolean {
    return this.amount === 0;
  }
  isPositive(): boolean {
    return this.amount > 0;
  }
  isNegative(): boolean {
    return this.amount < 0;
  }

  static sum(values: ReadonlyArray<Money>, currency: CurrencyCode = DEFAULT_CURRENCY): Money {
    return values.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }
  static min(first: Money, ...rest: Money[]): Money {
    return rest.reduce((a, b) => (b.lt(a) ? b : a), first);
  }
  static max(first: Money, ...rest: Money[]): Money {
    return rest.reduce((a, b) => (b.gt(a) ? b : a), first);
  }

  // ---- sérialisation ------------------------------------------------------

  toNumber(): number {
    return this.amount;
  }
  toBigInt(): bigint {
    return BigInt(this.amount);
  }

  /** Décimal exact de l'unité majeure : XOF → "1500", EUR → "15.05". */
  toDecimalString(): string {
    const { exponent } = currencyOf(this.currency);
    if (exponent === 0) return String(this.amount);
    const negative = this.amount < 0;
    const digits = String(negative ? -this.amount : this.amount).padStart(exponent + 1, "0");
    const int = digits.slice(0, digits.length - exponent);
    const frac = digits.slice(digits.length - exponent);
    return `${negative ? "-" : ""}${int}.${frac}`;
  }

  /** Affichage localisé (présentation uniquement, jamais pour du calcul). */
  format(locale = "fr-CI"): string {
    const { exponent } = currencyOf(this.currency);
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: this.currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(this.amount / 10 ** exponent);
  }

  toJSON(): { amount: number; currency: CurrencyCode } {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.amount} ${this.currency}`;
  }
}
