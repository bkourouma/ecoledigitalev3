/**
 * RateLimiter en mémoire : tests, développement, déploiement mono-process.
 * NE protège PAS plusieurs instances d'API (chacune aurait son propre compteur) :
 * en production multi-instance, utiliser `RedisRateLimiter`.
 *
 * Sémantique identique à l'implémentation Redis (mêmes tests de contrat).
 */
import type { Clock } from "@ecoledigitale/kernel";
import { systemClock } from "@ecoledigitale/kernel";
import type { LockoutRule, WindowRule } from "../config";
import type { LockStatus, RateLimiter, WindowDecision } from "../application/ports";

interface WindowEntry {
  count: number;
  resetAt: number;
}

interface LockEntry {
  failures: number;
  failuresExpireAt: number;
  level: number;
  levelExpireAt: number;
  lockedUntil: number;
}

const MAX_ENTRIES = 100_000;

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly locks = new Map<string, LockEntry>();

  constructor(private readonly clock: Clock = systemClock) {}

  async hit(key: string, rule: WindowRule): Promise<WindowDecision> {
    const now = this.clock.now().getTime();
    this.prune(now);
    let e = this.windows.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + rule.windowMs };
      this.windows.set(key, e);
    }
    e.count += 1;
    return { allowed: e.count <= rule.limit, count: e.count, retryAfterMs: Math.max(0, e.resetAt - now) };
  }

  async lockStatus(key: string): Promise<LockStatus> {
    const now = this.clock.now().getTime();
    const e = this.locks.get(key);
    if (e && e.lockedUntil > now) return { blocked: true, retryAfterMs: e.lockedUntil - now };
    return { blocked: false, retryAfterMs: 0 };
  }

  async recordFailure(key: string, rule: LockoutRule): Promise<LockStatus> {
    const now = this.clock.now().getTime();
    this.prune(now);
    const e = this.locks.get(key) ?? { failures: 0, failuresExpireAt: 0, level: 0, levelExpireAt: 0, lockedUntil: 0 };
    if (e.lockedUntil > now) return { blocked: true, retryAfterMs: e.lockedUntil - now };
    if (e.failuresExpireAt <= now) e.failures = 0;
    if (e.levelExpireAt <= now) e.level = 0;
    e.failures += 1;
    e.failuresExpireAt = now + rule.failureWindowMs;
    if (e.failures >= rule.threshold) {
      e.level += 1;
      const lock = Math.min(rule.baseLockMs * 2 ** (e.level - 1), rule.maxLockMs);
      e.lockedUntil = now + lock;
      e.failures = 0;
      e.levelExpireAt = e.lockedUntil + rule.levelMemoryMs;
    }
    this.locks.set(key, e);
    return e.lockedUntil > now ? { blocked: true, retryAfterMs: e.lockedUntil - now } : { blocked: false, retryAfterMs: 0 };
  }

  async clear(key: string): Promise<void> {
    this.locks.delete(key);
    this.windows.delete(key);
  }

  private prune(now: number): void {
    if (this.windows.size + this.locks.size < MAX_ENTRIES) return;
    for (const [k, v] of this.windows) if (v.resetAt <= now) this.windows.delete(k);
    for (const [k, v] of this.locks) if (Math.max(v.failuresExpireAt, v.levelExpireAt, v.lockedUntil) <= now) this.locks.delete(k);
  }
}
