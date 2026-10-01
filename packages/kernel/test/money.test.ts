import { describe, expect, it } from "vitest";
import { Money, MoneyError, divideRounded, type RoundingMode } from "../src/money";

const sum = (ms: Money[]) => ms.reduce((a, m) => a + m.amount, 0);

describe("Money — construction", () => {
  it("XOF par défaut, entier, sans sous-unité", () => {
    const m = Money.of(1500);
    expect(m.amount).toBe(1500);
    expect(m.currency).toBe("XOF");
    expect(m.toDecimalString()).toBe("1500");
  });

  it.each([1.5, NaN, Infinity, -Infinity, 0.1])("refuse le montant non entier %s", (v) => {
    expect(() => Money.of(v)).toThrowError(MoneyError);
    try {
      Money.of(v);
    } catch (e) {
      expect((e as MoneyError).code).toBe("MONEY_INVALID_AMOUNT");
    }
  });

  it("refuse un entier hors des limites sûres (overflow)", () => {
    expect(() => Money.of(Number.MAX_SAFE_INTEGER + 1)).toThrowError(/hors limites/);
    expect(() => Money.of(2n ** 60n)).toThrowError(/hors limites/);
    expect(Money.of(Number.MAX_SAFE_INTEGER).amount).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("normalise -0 en 0", () => {
    expect(Object.is(Money.of(-0).amount, 0)).toBe(true);
    expect(Object.is(Money.of(5).multiply(0).negate().amount, 0)).toBe(true);
  });

  it("refuse une devise inconnue", () => {
    expect(() => Money.of(1, "ABC" as never)).toThrowError(/Devise inconnue/);
  });

  it("fromString lit un bigint pg et refuse le reste", () => {
    expect(Money.fromString("-250").amount).toBe(-250);
    expect(() => Money.fromString("12.5")).toThrowError(MoneyError);
    expect(() => Money.fromString("")).toThrowError(MoneyError);
    expect(() => Money.fromString("9007199254740993")).toThrowError(/hors limites/);
  });

  it("fromJSON / toJSON font l'aller-retour", () => {
    const m = Money.of(4200);
    expect(Money.fromJSON(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(Money.fromJSON({ amount: "4200", currency: "XOF" }).equals(m)).toBe(true);
  });

  it("est immuable", () => {
    const m = Money.of(10);
    expect(() => {
      (m as unknown as { amount: number }).amount = 11;
    }).toThrow();
  });
});

describe("Money — arithmétique sûre", () => {
  it("additionne, soustrait, nie", () => {
    expect(Money.of(100).add(Money.of(50)).amount).toBe(150);
    expect(Money.of(100).subtract(Money.of(150)).amount).toBe(-50);
    expect(Money.of(100).negate().amount).toBe(-100);
    expect(Money.of(-100).abs().amount).toBe(100);
  });

  it("refuse de mélanger les devises", () => {
    expect(() => Money.of(1, "XOF").add(Money.of(1, "EUR"))).toThrowError(/Devises différentes/);
    expect(() => Money.of(1, "XOF").compare(Money.of(1, "EUR"))).toThrowError(MoneyError);
    expect(Money.of(1, "XOF").equals(Money.of(1, "EUR"))).toBe(false);
  });

  it("détecte le débordement à l'addition, soustraction et multiplication", () => {
    const max = Money.of(Number.MAX_SAFE_INTEGER);
    expect(() => max.add(Money.of(1))).toThrowError(/hors limites/);
    expect(() => max.negate().subtract(Money.of(1))).toThrowError(/hors limites/);
    expect(() => max.multiply(2)).toThrowError(/hors limites/);
    expect(() => Money.of(2 ** 30).multiply(2 ** 30)).toThrowError(/hors limites/);
    expect(max.subtract(Money.of(1)).add(Money.of(1)).amount).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("multiply exige un entier", () => {
    expect(Money.of(1000).multiply(3).amount).toBe(3000);
    expect(() => Money.of(1000).multiply(1.5)).toThrowError(/entier/);
    expect(() => Money.of(1000).multiply(NaN)).toThrowError(MoneyError);
  });

  it("multiplyRatio : produit intermédiaire exact au-delà de 2^53", () => {
    const big = Money.of(Number.MAX_SAFE_INTEGER);
    expect(big.multiplyRatio(3, 3, "HALF_UP").amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(big.multiplyRatio(1_000_000, 1_000_000, "DOWN").amount).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => big.multiplyRatio(2, 1, "DOWN")).toThrowError(/hors limites/);
  });

  it("applyBasisPoints : 18 % de TVA avec arrondis explicites", () => {
    // 1 003 × 18 % = 180,54
    expect(Money.of(1003).applyBasisPoints(1800, "HALF_UP").amount).toBe(181);
    expect(Money.of(1003).applyBasisPoints(1800, "DOWN").amount).toBe(180);
    expect(Money.of(1003).applyBasisPoints(1800, "CEILING").amount).toBe(181);
    // 25 × 10 % = 2,5 : égalité
    expect(Money.of(25).applyBasisPoints(1000, "HALF_UP").amount).toBe(3);
    expect(Money.of(25).applyBasisPoints(1000, "HALF_DOWN").amount).toBe(2);
    expect(Money.of(25).applyBasisPoints(1000, "HALF_EVEN").amount).toBe(2);
    expect(Money.of(35).applyBasisPoints(1000, "HALF_EVEN").amount).toBe(4);
  });

  it("refuse une division par zéro et des opérandes non entiers", () => {
    expect(() => Money.of(10).divide(0, "DOWN")).toThrowError(/zéro/);
    expect(() => Money.of(10).multiplyRatio(1.5, 2, "DOWN")).toThrowError(MoneyError);
  });
});

describe("divideRounded — table complète des modes", () => {
  // [n, d, mode, attendu]
  const cases: Array<[number, number, RoundingMode, number]> = [
    // 7/2 = 3,5
    [7, 2, "UP", 4],
    [7, 2, "DOWN", 3],
    [7, 2, "CEILING", 4],
    [7, 2, "FLOOR", 3],
    [7, 2, "HALF_UP", 4],
    [7, 2, "HALF_DOWN", 3],
    [7, 2, "HALF_EVEN", 4],
    // -7/2 = -3,5
    [-7, 2, "UP", -4],
    [-7, 2, "DOWN", -3],
    [-7, 2, "CEILING", -3],
    [-7, 2, "FLOOR", -4],
    [-7, 2, "HALF_UP", -4],
    [-7, 2, "HALF_DOWN", -3],
    [-7, 2, "HALF_EVEN", -4],
    // 5/2 = 2,5 (pair = 2)
    [5, 2, "HALF_EVEN", 2],
    [-5, 2, "HALF_EVEN", -2],
    // 10/3 = 3,33…
    [10, 3, "HALF_UP", 3],
    [10, 3, "UP", 4],
    [10, 3, "FLOOR", 3],
    // 11/3 = 3,66…
    [11, 3, "HALF_DOWN", 4],
    [11, 3, "DOWN", 3],
    [-11, 3, "HALF_UP", -4],
    [-10, 3, "CEILING", -3],
    // diviseur négatif
    [7, -2, "HALF_UP", -4],
    [-7, -2, "HALF_UP", 4],
    // exact
    [9, 3, "UP", 3],
    [0, 5, "UP", 0],
  ];
  it.each(cases)("%i / %i en %s = %i", (n, d, mode, expected) => {
    expect(Number(divideRounded(BigInt(n), BigInt(d), mode))).toBe(expected);
  });
});

describe("Money — répartition sans perte", () => {
  it("split en parts égales : l'excédent va aux premières parts", () => {
    expect(Money.of(100).split(3).map((m) => m.amount)).toEqual([34, 33, 33]);
    expect(Money.of(10).split(4).map((m) => m.amount)).toEqual([3, 3, 2, 2]);
    expect(Money.of(2).split(5).map((m) => m.amount)).toEqual([1, 1, 0, 0, 0]);
    expect(Money.of(0).split(3).map((m) => m.amount)).toEqual([0, 0, 0]);
    expect(Money.of(7).split(1).map((m) => m.amount)).toEqual([7]);
  });

  it("split de montants négatifs : symétrique, somme exacte", () => {
    expect(Money.of(-100).split(3).map((m) => m.amount)).toEqual([-34, -33, -33]);
    expect(sum(Money.of(-101).split(7))).toBe(-101);
  });

  it("allocate proportionnel par plus fort reste", () => {
    // 100 × [1,1,1] = 33,33,33 + 1 → 34,33,33
    expect(Money.of(100).allocate([1, 1, 1]).map((m) => m.amount)).toEqual([34, 33, 33]);
    // 1000 × [70, 20, 10] = exact
    expect(Money.of(1000).allocate([70, 20, 10]).map((m) => m.amount)).toEqual([700, 200, 100]);
    // 5 × [3, 7] : 1,5 / 3,5 → floors 1,3 ; restes .5/.5 ; reste 1 → indice 0
    expect(Money.of(5).allocate([3, 7]).map((m) => m.amount)).toEqual([2, 3]);
    // plus fort reste d'abord, pas l'indice : 10 × [1, 2, 7] → 1 / 2 / 7 exacts
    expect(Money.of(10).allocate([1, 2, 7]).map((m) => m.amount)).toEqual([1, 2, 7]);
    // 3 × [1, 1, 2]: floors 0,0,1 ; restes 3/4,3/4,2/4 ; reste 2 → indices 0 et 1
    expect(Money.of(3).allocate([1, 1, 2]).map((m) => m.amount)).toEqual([1, 1, 1]);
  });

  it("un poids nul ne reçoit rien, même avec du reste à distribuer", () => {
    expect(Money.of(10).allocate([0, 1, 1, 0]).map((m) => m.amount)).toEqual([0, 5, 5, 0]);
    expect(Money.of(1).allocate([0, 1, 1]).map((m) => m.amount)).toEqual([0, 1, 0]);
  });

  it("refuse les poids invalides", () => {
    expect(() => Money.of(10).allocate([])).toThrowError(MoneyError);
    expect(() => Money.of(10).allocate([0, 0])).toThrowError(/nulle/);
    expect(() => Money.of(10).allocate([1, -1])).toThrowError(/négatif/);
    expect(() => Money.of(10).allocate([1, 0.5])).toThrowError(MoneyError);
    expect(() => Money.of(10).split(0)).toThrowError(MoneyError);
    expect(() => Money.of(10).split(2.5)).toThrowError(MoneyError);
  });

  it("propriété : somme exacte et écart < 1 unité pour des milliers de cas pseudo-aléatoires", () => {
    // PRNG déterministe (mulberry32) pour des échecs reproductibles
    let seed = 0xc0ffee;
    const rnd = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 3000; i++) {
      const amount = Math.floor((rnd() - 0.3) * 5_000_000);
      const n = 1 + Math.floor(rnd() * 12);
      const weights: number[] = Array.from({ length: n }, () => Math.floor(rnd() * 100));
      if (!weights.some((w) => w !== 0)) weights[0] = 1;
      const total = weights.reduce((a, b) => a + b, 0);
      const parts = Money.of(amount).allocate(weights);

      expect(sum(parts)).toBe(amount);
      parts.forEach((p, k) => {
        const ideal = (amount * (weights[k] as number)) / total;
        expect(Math.abs(p.amount - ideal)).toBeLessThan(1);
        if (weights[k] === 0) expect(p.amount).toBe(0);
        // même signe que le montant (ou zéro)
        if (amount >= 0) expect(p.amount).toBeGreaterThanOrEqual(0);
        else expect(p.amount).toBeLessThanOrEqual(0);
      });
    }
  });

  it("répartit un montant proche de la limite sans déborder", () => {
    const parts = Money.of(Number.MAX_SAFE_INTEGER).split(7);
    expect(parts.reduce((a, m) => a + BigInt(m.amount), 0n)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    const weighted = Money.of(Number.MAX_SAFE_INTEGER).allocate([Number.MAX_SAFE_INTEGER, 1]);
    expect(weighted.reduce((a, m) => a + BigInt(m.amount), 0n)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
  });

  it("scénario réel : 1 000 000 F de frais en 3 tranches 50/30/20 et en 7 mensualités", () => {
    expect(Money.of(1_000_000).allocate([50, 30, 20]).map((m) => m.amount)).toEqual([500_000, 300_000, 200_000]);
    const monthly = Money.of(1_000_000).split(7);
    expect(monthly.map((m) => m.amount)).toEqual([142_858, 142_857, 142_857, 142_857, 142_857, 142_857, 142_857]);
  });
});

describe("Money — comparaison et agrégats", () => {
  it("compare", () => {
    const a = Money.of(5);
    const b = Money.of(9);
    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(Money.of(5))).toBe(0);
    expect(a.lt(b) && a.lte(b) && b.gt(a) && b.gte(a)).toBe(true);
    expect(Money.zero().isZero()).toBe(true);
    expect(Money.of(-1).isNegative()).toBe(true);
    expect(Money.of(1).isPositive()).toBe(true);
  });

  it("sum / min / max", () => {
    expect(Money.sum([Money.of(1), Money.of(2), Money.of(3)]).amount).toBe(6);
    expect(Money.sum([]).amount).toBe(0);
    expect(Money.sum([], "EUR").currency).toBe("EUR");
    expect(Money.min(Money.of(4), Money.of(2), Money.of(9)).amount).toBe(2);
    expect(Money.max(Money.of(4), Money.of(2), Money.of(9)).amount).toBe(9);
    expect(() => Money.sum([Money.of(1), Money.of(1, "EUR")])).toThrowError(MoneyError);
  });
});

describe("Money — affichage", () => {
  it("toDecimalString respecte l'exposant", () => {
    expect(Money.of(1505, "EUR").toDecimalString()).toBe("15.05");
    expect(Money.of(5, "EUR").toDecimalString()).toBe("0.05");
    expect(Money.of(-5, "EUR").toDecimalString()).toBe("-0.05");
    expect(Money.of(1500, "XOF").toDecimalString()).toBe("1500");
  });

  it("format fr-CI contient le montant et pas de décimales pour XOF", () => {
    const text = Money.of(1500).format().replace(/\s/g, " ");
    expect(text).toMatch(/1.?500/);
    expect(text).not.toMatch(/[,.]\d{2}\b/);
    expect(Money.of(1500).toString()).toBe("1500 XOF");
  });
});
