/**
 * RateLimiter adossé à Redis (ioredis). Chaque opération est UN script Lua :
 * atomique et sans aller-retour intermédiaire, donc correct même avec N
 * instances d'API qui se disputent la même clé.
 *
 * Le temps vient de l'appelant (`Clock`) et non de `redis.call('TIME')` pour
 * rester déterministe en test ; l'écart d'horloge entre instances d'API (NTP,
 * quelques ms) est négligeable devant des verrous de plusieurs secondes.
 *
 * Panne de Redis : `failOpen` (défaut `false`). Fermé = les connexions sont
 * refusées si le limiteur est injoignable (sûr, mais une panne Redis coupe le
 * login) ; ouvert = on laisse passer en journalisant (disponibilité). Le choix
 * est explicite et documenté dans l'ADR-008.
 */
import type { Clock, Logger } from "@ecoledigitale/kernel";
import { noopLogger, systemClock } from "@ecoledigitale/kernel";
import type { LockoutRule, WindowRule } from "../config";
import type { LockStatus, RateLimiter, WindowDecision } from "../application/ports";

/** Sous-ensemble d'ioredis utilisé (`Redis` de `ioredis` le satisfait). */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

const STATUS_SCRIPT = `
local u = tonumber(redis.call('HGET', KEYS[1], 'until') or '0')
local now = tonumber(ARGV[1])
if u > now then return {1, u - now} end
return {0, 0}
`;

const FAILURE_SCRIPT = `
local now = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local fwin = tonumber(ARGV[3])
local base = tonumber(ARGV[4])
local maxlock = tonumber(ARGV[5])
local lmem = tonumber(ARGV[6])
local d = redis.call('HMGET', KEYS[1], 'f', 'fexp', 'lvl', 'lexp', 'until')
local f = tonumber(d[1]) or 0
local fexp = tonumber(d[2]) or 0
local lvl = tonumber(d[3]) or 0
local lexp = tonumber(d[4]) or 0
local untilT = tonumber(d[5]) or 0
if untilT > now then return {1, untilT - now} end
if fexp <= now then f = 0 end
if lexp <= now then lvl = 0 end
f = f + 1
fexp = now + fwin
if f >= threshold then
  lvl = lvl + 1
  local lock = math.floor(base * (2 ^ (lvl - 1)))
  if lock > maxlock then lock = maxlock end
  untilT = now + lock
  f = 0
  lexp = untilT + lmem
end
redis.call('HSET', KEYS[1], 'f', string.format('%d', f), 'fexp', string.format('%d', fexp), 'lvl', string.format('%d', lvl), 'lexp', string.format('%d', lexp), 'until', string.format('%d', untilT))
local top = math.max(fexp, lexp, untilT)
redis.call('PEXPIRE', KEYS[1], top - now)
if untilT > now then return {1, untilT - now} end
return {0, 0}
`;

export interface RedisRateLimiterOptions {
  prefix?: string;
  clock?: Clock;
  failOpen?: boolean;
  logger?: Logger;
}

function asPair(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new Error("Réponse Redis inattendue.");
  return [Number(value[0]), Number(value[1])];
}

export class RedisRateLimiter implements RateLimiter {
  private readonly prefix: string;
  private readonly clock: Clock;
  private readonly failOpen: boolean;
  private readonly logger: Logger;

  constructor(private readonly redis: RedisLike, options: RedisRateLimiterOptions = {}) {
    this.prefix = options.prefix ?? "ed:iam:rl:";
    this.clock = options.clock ?? systemClock;
    this.failOpen = options.failOpen ?? false;
    this.logger = options.logger ?? noopLogger;
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  private onError<T>(op: string, error: unknown, open: T): T {
    this.logger.error({ event: "iam_rate_limiter_error", op, error: error instanceof Error ? error.message : String(error), failOpen: this.failOpen }, "RateLimiter Redis indisponible");
    if (this.failOpen) return open;
    throw error;
  }

  async hit(key: string, rule: WindowRule): Promise<WindowDecision> {
    try {
      const [count, ttl] = asPair(await this.redis.eval(HIT_SCRIPT, 1, this.k(`w:${key}`), rule.windowMs));
      return { allowed: count <= rule.limit, count, retryAfterMs: Math.max(0, ttl) };
    } catch (e) {
      return this.onError("hit", e, { allowed: true, count: 0, retryAfterMs: 0 });
    }
  }

  async lockStatus(key: string): Promise<LockStatus> {
    try {
      const [blocked, retry] = asPair(await this.redis.eval(STATUS_SCRIPT, 1, this.k(`l:${key}`), this.clock.now().getTime()));
      return { blocked: blocked === 1, retryAfterMs: retry };
    } catch (e) {
      return this.onError("lockStatus", e, { blocked: false, retryAfterMs: 0 });
    }
  }

  async recordFailure(key: string, rule: LockoutRule): Promise<LockStatus> {
    try {
      const [blocked, retry] = asPair(
        await this.redis.eval(
          FAILURE_SCRIPT,
          1,
          this.k(`l:${key}`),
          this.clock.now().getTime(),
          rule.threshold,
          rule.failureWindowMs,
          rule.baseLockMs,
          rule.maxLockMs,
          rule.levelMemoryMs,
        ),
      );
      return { blocked: blocked === 1, retryAfterMs: retry };
    } catch (e) {
      return this.onError("recordFailure", e, { blocked: false, retryAfterMs: 0 });
    }
  }

  async clear(key: string): Promise<void> {
    try {
      await this.redis.del(this.k(`l:${key}`), this.k(`w:${key}`));
    } catch (e) {
      this.onError("clear", e, undefined);
    }
  }
}
