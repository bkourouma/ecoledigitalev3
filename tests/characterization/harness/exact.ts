/**
 * Arithmétique rationnelle EXACTE (BigInt) servant d'ORACLE au harnais.
 *
 * Le legacy calcule en flottants binaires ; pour dire où il se trompe, il faut une référence qui ne se
 * trompe pas. Les notes sont des décimaux courts (2 décimales, parfois plus) : on les lit depuis leur
 * représentation décimale la plus courte (`9.99` -> 999/100), jamais depuis la valeur binaire.
 *
 * Aucune dépendance : ce fichier est volontairement indépendant du Rules Engine (decimal.js), pour que
 * l'oracle ne partage aucun code avec ce qu'il servira à vérifier en Phase 2.
 */

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

export class Rat {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    if (d === 0n) throw new Error("Division par zéro");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }

  static of(x: number | string | bigint | Rat): Rat {
    if (x instanceof Rat) return x;
    if (typeof x === "bigint") return new Rat(x, 1n);
    const s = typeof x === "number" ? shortestDecimal(x) : x.trim();
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new Error(`Décimal invalide : ${s}`);
    const frac = m[3] ?? "";
    const n = BigInt(m[2] + frac) * (m[1] ? -1n : 1n);
    return new Rat(n, 10n ** BigInt(frac.length));
  }

  add(o: Rat | number | string): Rat {
    const r = Rat.of(o);
    return new Rat(this.n * r.d + r.n * this.d, this.d * r.d);
  }
  sub(o: Rat | number | string): Rat {
    const r = Rat.of(o);
    return new Rat(this.n * r.d - r.n * this.d, this.d * r.d);
  }
  mul(o: Rat | number | string): Rat {
    const r = Rat.of(o);
    return new Rat(this.n * r.n, this.d * r.d);
  }
  div(o: Rat | number | string): Rat {
    const r = Rat.of(o);
    return new Rat(this.n * r.d, this.d * r.n);
  }
  cmp(o: Rat | number | string): -1 | 0 | 1 {
    const r = Rat.of(o);
    const l = this.n * r.d;
    const rr = r.n * this.d;
    return l < rr ? -1 : l > rr ? 1 : 0;
  }
  lt(o: Rat | number | string): boolean {
    return this.cmp(o) < 0;
  }
  gte(o: Rat | number | string): boolean {
    return this.cmp(o) >= 0;
  }
  eq(o: Rat | number | string): boolean {
    return this.cmp(o) === 0;
  }

  /** Arrondi demi-supérieur à `places` décimales, rendu en chaîne décimale (`"10.00"`). */
  toFixedHalfUp(places: number): string {
    const scale = 10n ** BigInt(places);
    const neg = this.n < 0n;
    const absN = neg ? -this.n : this.n;
    let q = (absN * scale * 2n + this.d) / (this.d * 2n); // floor((absN*scale)/d + 1/2)
    const sign = neg && q !== 0n ? "-" : "";
    const s = q.toString().padStart(places + 1, "0");
    return places === 0 ? `${sign}${s}` : `${sign}${s.slice(0, -places)}.${s.slice(-places)}`;
  }

  /** Valeur décimale exacte si elle se termine, sinon approximation à 12 décimales. */
  toString(): string {
    return this.toFixedHalfUp(12).replace(/0+$/, "").replace(/\.$/, "");
  }

  toNumber(): number {
    return Number(this.n) / Number(this.d);
  }
}

/** Représentation décimale la plus courte d'un double (`0.1+0.2` -> "0.30000000000000004"). */
export function shortestDecimal(x: number): string {
  if (!Number.isFinite(x)) throw new Error("Nombre non fini");
  let s = String(x);
  if (/e/i.test(s)) {
    // notation scientifique : repasser par toFixed avec assez de décimales
    s = x.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

export const ZERO = Rat.of(0);

/** Moyenne pondérée exacte ; `null` si le poids total est nul. */
export function weightedMean(items: { value: Rat; weight: number | string | Rat }[]): Rat | null {
  let sum = ZERO;
  let total = ZERO;
  for (const it of items) {
    const w = Rat.of(it.weight);
    sum = sum.add(it.value.mul(w));
    total = total.add(w);
  }
  return total.eq(0) ? null : sum.div(total);
}
