/**
 * Connexions Redis. BullMQ a deux besoins opposés :
 *  - les `Worker` (commandes bloquantes) exigent `maxRetriesPerRequest: null` ;
 *  - les `Queue` utilisées depuis une transaction SQL (relais) doivent ÉCHOUER VITE :
 *    une commande qui se met en attente pendant une panne Redis garderait des verrous
 *    Postgres ouverts.
 */
import { Redis } from "ioredis";
import type { Logger } from "../logger";

export type RedisKind = "blocking" | "failfast";

export function createRedis(url: string, kind: RedisKind, logger?: Logger): Redis {
  const redis =
    kind === "blocking"
      ? new Redis(url, { maxRetriesPerRequest: null, connectionName: "ed-worker-blocking" })
      : new Redis(url, {
          maxRetriesPerRequest: 1,
          commandTimeout: 5_000,
          connectTimeout: 5_000,
          enableOfflineQueue: false,
          connectionName: "ed-worker-failfast",
        });
  let lastLogged = 0;
  redis.on("error", (err: Error) => {
    // Une panne Redis produit une erreur par tentative de reconnexion : on limite à 1 ligne / 10 s.
    const now = Date.now();
    if (now - lastLogged > 10_000) {
      lastLogged = now;
      logger?.error({ err: err.message, kind }, "Redis : erreur de connexion");
    }
  });
  return redis;
}

/** Attend l'état « ready » d'une connexion en cours d'ouverture (la file hors ligne des connexions « fail fast » est désactivée). */
async function waitUntilReady(redis: Redis, timeoutMs = 5_000): Promise<void> {
  if (redis.status === "ready") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      redis.off("ready", onReady);
      reject(new Error(`Redis : connexion non prête après ${timeoutMs} ms`));
    }, timeoutMs);
    const onReady = (): void => {
      clearTimeout(timer);
      resolve();
    };
    redis.once("ready", onReady);
    if (redis.status === "ready") onReady();
  });
}

export async function pingRedis(redis: Redis): Promise<void> {
  if (redis.status === "connecting" || redis.status === "connect") await waitUntilReady(redis);
  const reply = await redis.ping();
  if (reply !== "PONG") throw new Error(`Réponse Redis inattendue : ${reply}`);
}
