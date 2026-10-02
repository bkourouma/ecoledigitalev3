/**
 * Reprise avec backoff exponentiel plafonné (remises échouées sur une panne de canal).
 *
 * `attempt` = nombre de tentatives DÉJÀ faites (1 après le premier échec). Délai = base × 2^(attempt-1), plafonné,
 * auquel on ajoute une gigue déterministe (`jitter` ∈ [0,1)) pour que des milliers de remises ne repartent pas ensemble.
 */
export const RETRY_BASE_MS = 60_000;
export const RETRY_CAP_MS = 3_600_000;

export function retryDelayMs(attempt: number, jitter = 0, baseMs = RETRY_BASE_MS, capMs = RETRY_CAP_MS): number {
  const exp = Math.min(Math.max(attempt, 1) - 1, 20);
  const raw = Math.min(baseMs * 2 ** exp, capMs);
  return Math.round(raw * (1 + 0.2 * Math.min(Math.max(jitter, 0), 0.9999)));
}

/** Les tentatives sont-elles épuisées ? */
export const attemptsExhausted = (attempts: number, maxAttempts: number): boolean => attempts >= maxAttempts;
