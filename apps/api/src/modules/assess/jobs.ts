/**
 * Jobs planifiés du module `assess` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `assess.purge-batch-receipts`  quotidien (04:20, `WORKER_TZ`) : supprime, tenant par tenant, les reçus de saisie en
 *    lot idempotente de plus de 14 jours (les clés d'idempotence n'ont de sens que durant une synchronisation hors ligne).
 *    Idempotent ; un tenant en échec n'arrête pas les autres, le job est alors signalé en échec.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createAssessDeps } from "./application/deps";
import { purgeAllTenants } from "./application/consumers";

export default [
  defineScheduledJob({
    name: "assess.purge-batch-receipts",
    cron: "20 4 * * *",
    lockTtlMs: 15 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createAssessDeps({ db: tenantDb, logger });
      const report = await purgeAllTenants(deps, systemDb);
      const purged = report.succeeded.reduce((n, s) => n + s.result, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, purged }, "assess : reçus de lots purgés");
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "assess : échec de la purge");
      }
      if (report.failed.length > 0) throw new Error(`assess.purge-batch-receipts : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
