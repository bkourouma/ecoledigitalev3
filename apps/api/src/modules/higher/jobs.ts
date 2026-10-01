/**
 * Jobs planifiés du module `higher` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `higher.expire-credits`  quotidien (03:20, `WORKER_TZ`) : passe `EXPIRED` les acquisitions de crédits dont la durée de
 *    validité (réglage de l'établissement, NULL = sans limite) est dépassée, tenant par tenant. Épargne celles sur lesquelles
 *    s'appuie un diplôme octroyé. Idempotent. Un tenant en échec n'arrête pas les autres ; le job est alors signalé en échec.
 *
 * Aucun port d'un autre module n'est nécessaire.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createHigherDeps } from "./application/deps";
import { expireAllTenants } from "./application/consumers";

export default [
  defineScheduledJob({
    name: "higher.expire-credits",
    cron: "20 3 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createHigherDeps({ db: tenantDb, logger });
      const report = await expireAllTenants(deps, systemDb);
      const expired = report.succeeded.reduce((n, s) => n + s.result.expired, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, expired }, "higher : acquisitions périmées balayées");
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "higher : échec du balayage");
      }
      if (report.failed.length > 0) throw new Error(`higher.expire-credits : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
