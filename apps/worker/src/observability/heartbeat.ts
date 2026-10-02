/**
 * Battement de cœur du worker : `ZADD <préfixe>:obs:workers <epoch ms> <instance>` toutes les 10 s. L'API (sonde `worker` de
 * `/ready`) compte les instances dont le dernier battement a moins de 30 s. Un arrêt gracieux retire l'instance
 * immédiatement ; un crash laisse l'entrée expirer d'elle-même.
 */
import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TTL_MS, heartbeatKey } from "../../../api/src/platform/observability/core/health";

export interface Heartbeat {
  readonly instance: string;
  stop(): Promise<void>;
}

export function startHeartbeat(
  redis: Redis,
  prefix: string,
  options: { intervalMs?: number; onBeat?: (epochSeconds: number) => void; onError?: (err: unknown) => void; now?: () => number } = {},
): Heartbeat {
  const instance = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const key = heartbeatKey(prefix);
  const now = options.now ?? Date.now;
  let stopped = false;

  const beat = async (): Promise<void> => {
    if (stopped) return;
    try {
      const t = now();
      await redis.zadd(key, t, instance);
      // Nettoyage des instances disparues (plus de 5 TTL) : l'ensemble ne grossit pas.
      await redis.zremrangebyscore(key, "-inf", t - HEARTBEAT_TTL_MS * 5);
      options.onBeat?.(t / 1000);
    } catch (err) {
      options.onError?.(err);
    }
  };

  void beat();
  const timer = setInterval(() => void beat(), options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return {
    instance,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await redis.zrem(key, instance).catch(() => undefined);
    },
  };
}
