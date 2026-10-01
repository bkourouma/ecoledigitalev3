/**
 * Backoff exponentiel plafonné, avec jitter « soustractif » (le délai ne dépasse
 * jamais le plafond). Partagé par le relais d'outbox et par les abonnés.
 */
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Multiplicateur (défaut 2). */
  factor?: number;
  /** Fraction du délai pouvant être retirée aléatoirement, 0..1 (défaut 0.2). */
  jitter?: number;
}

/**
 * @param attempt nombre d'échecs déjà subis, ≥ 1 (1 => délai de base).
 * @param rng     source aléatoire dans [0,1) (injectable pour les tests).
 */
export function computeBackoff(attempt: number, options: BackoffOptions, rng: () => number = Math.random): number {
  const factor = options.factor ?? 2;
  const jitter = Math.min(Math.max(options.jitter ?? 0.2, 0), 1);
  const n = Math.max(1, Math.floor(attempt));
  // Le plafond est appliqué sur le résultat avant jitter : évite l'overflow pour de grands `n`.
  const raw = Math.min(options.maxMs, options.baseMs * Math.pow(factor, n - 1));
  const delay = raw * (1 - jitter * rng());
  return Math.max(0, Math.round(delay));
}
