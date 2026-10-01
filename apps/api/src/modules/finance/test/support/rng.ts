/**
 * PRNG déterministe (mulberry32) pour les tests de propriétés : mêmes graines, mêmes
 * cas, donc un échec est reproductible (la graine est affichée dans le message).
 */
export class Rng {
  private state: number;
  constructor(public readonly seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [min, max] inclus. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }
}

/** Exécute `fn` pour `runs` graines consécutives ; en cas d'échec, indique la graine. */
export function forAll(runs: number, fn: (rng: Rng, seed: number) => void, baseSeed = 1): void {
  for (let i = 0; i < runs; i++) {
    const seed = baseSeed + i;
    try {
      fn(new Rng(seed), seed);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      err.message = `[graine ${seed}] ${err.message}`;
      throw err;
    }
  }
}
