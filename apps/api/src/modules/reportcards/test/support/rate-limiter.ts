/** Limiteur de débit à fenêtre fixe, en mémoire (tests HTTP) — même contrat que `RateLimiter.hit` du module iam. */
export class InMemoryRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  async hit(key: string, rule: { limit: number; windowMs: number }): Promise<{ allowed: boolean; count: number; retryAfterMs: number }> {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= rule.windowMs) {
      this.windows.set(key, { start: t, count: 1 });
      return { allowed: true, count: 1, retryAfterMs: rule.windowMs };
    }
    w.count += 1;
    return { allowed: w.count <= rule.limit, count: w.count, retryAfterMs: Math.max(0, rule.windowMs - (t - w.start)) };
  }
}
