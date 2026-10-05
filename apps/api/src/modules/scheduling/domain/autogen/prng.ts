/**
 * Générateur pseudo-aléatoire DÉTERMINISTE (mulberry32) pour le générateur d'emploi du temps. Aucune dépendance à
 * `Math.random` : la même graine produit toujours la même suite (reproductibilité, tests).
 */

/** Condense une graine (nombre ou texte) en entier non signé de 32 bits (FNV-1a). */
export function hashSeed(seed: string | number): number {
  const text = typeof seed === "number" ? `n:${seed}` : `s:${seed}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface Rng {
  /** Flottant dans [0, 1). */
  next(): number;
  /** Entier dans [0, n). */
  int(n: number): number;
}

export function createRng(seed: string | number): Rng {
  let a = hashSeed(seed) || 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => (n <= 1 ? 0 : Math.floor(next() * n)) };
}
