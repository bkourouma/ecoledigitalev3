#!/usr/bin/env node
/**
 * Exploitation de la dead-letter queue.
 *
 *   pnpm --filter @ecoledigitale/worker dlq -- list [--kind relay|router|handler] [--limit 50]
 *   pnpm --filter @ecoledigitale/worker dlq -- replay <id>
 *   pnpm --filter @ecoledigitale/worker dlq -- replay --all [--kind handler]
 *   pnpm --filter @ecoledigitale/worker dlq -- remove <id>
 *
 * Variables : REDIS_URL, WORKER_QUEUE_PREFIX (défaut ed), WORKER_DATABASE_URL (rejeu des échecs « relay »).
 * Dans le conteneur : docker compose run --rm worker node dist/dlq.cjs list
 */
import { parseArgs } from "node:util";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import { noopLogger } from "@ecoledigitale/kernel";
import { createPool } from "../infra/db";
import { createRedis } from "../infra/redis";
import { DeadLetterAdmin } from "../events/dlq-admin";
import type { DeadLetterRecord } from "../events/publisher";

const USAGE = `Usage : dlq list [--kind relay|router|handler] [--limit N]
        dlq replay <id> | dlq replay --all [--kind K]
        dlq remove <id>`;

async function run(): Promise<number> {
  const argv = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: argv[0] === "--" ? argv.slice(1) : argv,
    allowPositionals: true,
    options: { kind: { type: "string" }, limit: { type: "string" }, all: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });
  const [command, id] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const kind = values.kind as DeadLetterRecord["kind"] | undefined;
  if (kind && !["relay", "router", "handler"].includes(kind)) {
    console.error(`--kind invalide : ${kind}`);
    return 2;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("REDIS_URL est obligatoire.");
    return 2;
  }
  const prefix = process.env.WORKER_QUEUE_PREFIX ?? "ed";
  const redis = createRedis(redisUrl, "blocking");
  const pool = process.env.WORKER_DATABASE_URL ? createPool({ url: process.env.WORKER_DATABASE_URL, max: 2 }) : null;
  const systemDb = pool ? new SystemDb(new TenantDb(pool), { logger: noopLogger }) : undefined;
  const admin = new DeadLetterAdmin(redis, prefix, systemDb);

  try {
    if (command === "list") {
      const entries = await admin.list(Number(values.limit ?? 50), kind);
      for (const { id: entryId, record } of entries) {
        console.log(
          JSON.stringify({
            id: entryId,
            kind: record.kind,
            subscriber: record.subscriber,
            eventId: record.event.id,
            eventType: record.event.type,
            tenantId: record.event.tenantId,
            attempts: record.attempts,
            failedAt: record.failedAt,
            error: record.error.slice(0, 300),
          }),
        );
      }
      console.error(`${entries.length} entrée(s) affichée(s) sur ${await admin.count()} dans la DLQ.`);
      return 0;
    }
    if (command === "replay") {
      if (values.all) {
        const r = await admin.replayAll(kind);
        console.log(`${r.replayed} rejouée(s), ${r.skipped} ignorée(s) (déjà traitées ou obsolètes).`);
        return 0;
      }
      if (!id) {
        console.error(USAGE);
        return 2;
      }
      const ok = await admin.replay(id);
      console.log(ok ? "rejouée" : "rien à rejouer (entrée absente ou obsolète)");
      return ok ? 0 : 1;
    }
    if (command === "remove") {
      if (!id) {
        console.error(USAGE);
        return 2;
      }
      const ok = await admin.remove(id);
      console.log(ok ? "supprimée" : "entrée absente");
      return ok ? 0 : 1;
    }
    console.error(USAGE);
    return 2;
  } finally {
    await admin.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await pool?.end().catch(() => undefined);
  }
}

run().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
