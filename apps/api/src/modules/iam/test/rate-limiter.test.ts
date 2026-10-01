/**
 * Contrat du port RateLimiter, joué sur l'implémentation mémoire (toujours) et sur
 * Redis (si REDIS_URL est définie ; voir la procédure dans le README du module).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock } from "@ecoledigitale/kernel";
import type { RateLimiter } from "../application/ports";
import type { LockoutRule } from "../config";
import { MemoryRateLimiter } from "../infrastructure/rate-limiter.memory";
import { RedisRateLimiter, type RedisLike } from "../infrastructure/rate-limiter.redis";

const RULE: LockoutRule = { threshold: 3, failureWindowMs: 60_000, baseLockMs: 1000, maxLockMs: 8000, levelMemoryMs: 3_600_000 };

function contract(name: string, make: (clock: ManualClock) => Promise<{ limiter: RateLimiter; cleanup?: () => Promise<void> }>): void {
  describe(`RateLimiter — ${name}`, () => {
    let clock: ManualClock;
    let limiter: RateLimiter;
    let cleanup: (() => Promise<void>) | undefined;
    let key: string;

    beforeAll(async () => {
      clock = new ManualClock("2026-10-01T09:00:00.000Z");
      ({ limiter, cleanup } = await make(clock));
    });
    afterAll(async () => cleanup?.());
    const fresh = (): string => (key = `k-${randomBytes(6).toString("hex")}`);

    it("fenêtre fixe : autorise `limit` appels puis refuse jusqu'à la fin de la fenêtre", async () => {
      const k = fresh();
      const rule = { limit: 3, windowMs: 10_000 };
      for (let i = 1; i <= 3; i += 1) expect(await limiter.hit(k, rule)).toMatchObject({ allowed: true, count: i });
      const denied = await limiter.hit(k, rule);
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(10_000);
    });

    it("les clés sont indépendantes", async () => {
      const rule = { limit: 1, windowMs: 10_000 };
      const a = fresh();
      const b = fresh();
      expect((await limiter.hit(a, rule)).allowed).toBe(true);
      expect((await limiter.hit(a, rule)).allowed).toBe(false);
      expect((await limiter.hit(b, rule)).allowed).toBe(true);
    });

    it("verrouillage : rien avant le seuil, verrou au seuil, refus pendant le verrou", async () => {
      const k = fresh();
      expect(await limiter.lockStatus(k)).toEqual({ blocked: false, retryAfterMs: 0 });
      expect((await limiter.recordFailure(k, RULE)).blocked).toBe(false);
      expect((await limiter.recordFailure(k, RULE)).blocked).toBe(false);
      const third = await limiter.recordFailure(k, RULE);
      expect(third.blocked).toBe(true);
      expect(third.retryAfterMs).toBeGreaterThan(0);
      expect(third.retryAfterMs).toBeLessThanOrEqual(1000);
      expect((await limiter.lockStatus(k)).blocked).toBe(true);
    });

    it("le verrou expire, puis un nouveau verrou est DEUX fois plus long (progressif), plafonné", async () => {
      const k = fresh();
      const lockOnce = async (): Promise<number> => {
        let last = { blocked: false, retryAfterMs: 0 };
        for (let i = 0; i < RULE.threshold; i += 1) last = await limiter.recordFailure(k, RULE);
        expect(last.blocked).toBe(true);
        return last.retryAfterMs;
      };
      const d1 = await lockOnce();
      clock.advance(d1 + 1);
      expect((await limiter.lockStatus(k)).blocked).toBe(false);
      const d2 = await lockOnce();
      clock.advance(d2 + 1);
      const d3 = await lockOnce();
      clock.advance(d3 + 1);
      const d4 = await lockOnce();
      clock.advance(d4 + 1);
      const d5 = await lockOnce();
      expect(d1).toBeLessThanOrEqual(1000);
      expect(d2).toBeGreaterThan(1000);
      expect(d2).toBeLessThanOrEqual(2000);
      expect(d3).toBeGreaterThan(2000);
      expect(d3).toBeLessThanOrEqual(4000);
      expect(d4).toBeGreaterThan(4000);
      expect(d4).toBeLessThanOrEqual(8000);
      expect(d5).toBeLessThanOrEqual(8000); // plafond maxLockMs
    });

    it("les échecs isolés hors fenêtre ne s'additionnent pas", async () => {
      const k = fresh();
      await limiter.recordFailure(k, RULE);
      await limiter.recordFailure(k, RULE);
      clock.advance(RULE.failureWindowMs + 1);
      expect((await limiter.recordFailure(k, RULE)).blocked).toBe(false);
    });

    it("`clear` (succès) remet le compteur à zéro", async () => {
      const k = fresh();
      await limiter.recordFailure(k, RULE);
      await limiter.recordFailure(k, RULE);
      await limiter.clear(k);
      expect((await limiter.recordFailure(k, RULE)).blocked).toBe(false);
      expect((await limiter.recordFailure(k, RULE)).blocked).toBe(false);
    });

    it("pendant un verrou, un nouvel échec ne prolonge ni n'escalade le verrou", async () => {
      const k = fresh();
      let locked = { blocked: false, retryAfterMs: 0 };
      for (let i = 0; i < RULE.threshold; i += 1) locked = await limiter.recordFailure(k, RULE);
      const again = await limiter.recordFailure(k, RULE);
      expect(again.blocked).toBe(true);
      expect(again.retryAfterMs).toBeLessThanOrEqual(locked.retryAfterMs);
    });

    it("concurrence : 50 échecs simultanés ne perdent aucun comptage (verrou atteint)", async () => {
      const k = fresh();
      await Promise.all(Array.from({ length: 50 }, () => limiter.recordFailure(k, RULE)));
      expect((await limiter.lockStatus(k)).blocked).toBe(true);
      const rule = { limit: 20, windowMs: 10_000 };
      const results = await Promise.all(Array.from({ length: 50 }, () => limiter.hit(`${k}:w`, rule)));
      expect(results.filter((r) => r.allowed)).toHaveLength(20);
    });
  });
}

contract("mémoire", async (clock) => ({ limiter: new MemoryRateLimiter(clock) }));

const REDIS_URL = process.env.REDIS_URL;
if (REDIS_URL) {
  contract("Redis (ioredis)", async (clock) => {
    const { default: IORedis } = await import("ioredis");
    const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1 });
    const prefix = `ed:iam:test:${randomBytes(4).toString("hex")}:`;
    return {
      limiter: new RedisRateLimiter(redis as unknown as RedisLike, { clock, prefix }),
      cleanup: async () => {
        const keys = await redis.keys(`${prefix}*`);
        if (keys.length > 0) await redis.del(...keys);
        redis.disconnect();
      },
    };
  });
} else {
  describe.skip("RateLimiter — Redis (ioredis) : REDIS_URL absente", () => it("ignoré", () => undefined));
}

describe("RedisRateLimiter — panne de Redis", () => {
  const broken: RedisLike = {
    eval: async () => {
      throw new Error("ECONNREFUSED");
    },
    del: async () => {
      throw new Error("ECONNREFUSED");
    },
  };

  it("échec FERMÉ par défaut : l'erreur remonte (les connexions sont refusées plutôt que non limitées)", async () => {
    const l = new RedisRateLimiter(broken);
    await expect(l.hit("k", { limit: 1, windowMs: 1000 })).rejects.toThrow("ECONNREFUSED");
    await expect(l.lockStatus("k")).rejects.toThrow("ECONNREFUSED");
  });

  it("échec ouvert sur demande explicite", async () => {
    const l = new RedisRateLimiter(broken, { failOpen: true });
    expect((await l.hit("k", { limit: 1, windowMs: 1000 })).allowed).toBe(true);
    expect((await l.lockStatus("k")).blocked).toBe(false);
  });
});
