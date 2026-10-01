/**
 * Verrou d'unicité Redis : `SET key token NX PX ttl`, renouvelé (heartbeat) tant que le
 * job tourne, libéré par comparaison de jeton (on ne libère jamais le verrou d'un autre).
 * Si le processus meurt, le verrou expire seul après `ttlMs`.
 */
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export interface Lease {
  readonly key: string;
  release(): Promise<void>;
  /** `false` si le verrou a été perdu (expiré faute de renouvellement) pendant l'exécution. */
  readonly held: boolean;
}

export async function acquireLease(redis: Redis, key: string, ttlMs: number, onLost?: () => void): Promise<Lease | null> {
  const token = randomUUID();
  const ok = await redis.set(key, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return null;

  let held = true;
  const timer = setInterval(() => {
    redis
      .eval(RENEW, 1, key, token, String(ttlMs))
      .then((r) => {
        if (r !== 1 && held) {
          held = false;
          onLost?.();
        }
      })
      .catch(() => undefined); // Redis injoignable : on réessaiera au prochain battement
  }, Math.max(250, Math.floor(ttlMs / 3)));
  timer.unref();

  return {
    key,
    get held() {
      return held;
    },
    async release() {
      clearInterval(timer);
      held = false;
      await redis.eval(RELEASE, 1, key, token).catch(() => undefined);
    },
  };
}
