/**
 * Jobs planifiés du module `imports` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `imports.resume-stalled`  toutes les 30 secondes : filet de reprise. Republie l'événement d'un import dont l'exécutant
 *    est mort (bail expiré) ou dont la demande n'a jamais été prise en charge. Idempotent (le bail désigne un seul
 *    exécutant) ; un tenant en échec n'arrête pas les autres.
 *  - `imports.purge`           quotidien (04:25, `WORKER_TZ`) : annule les brouillons abandonnés (libère le quota), purge les
 *    lignes brutes (données personnelles) et le fichier des imports plus anciens que la rétention du tenant.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { purgeExpiredImports, resumeStalledImports } from "./application/consumers";
import { createImportsDeps } from "./application/deps";
import { importsWorkerPorts } from "./application/port-registry";

export default [
  defineScheduledJob({
    name: "imports.resume-stalled",
    cron: "*/30 * * * * *",
    lockTtlMs: 5 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createImportsDeps({ db: tenantDb, logger, portsProvider: importsWorkerPorts });
      const report = await resumeStalledImports(deps, systemDb);
      const republished = report.succeeded.reduce((n, s) => n + s.result.republished, 0);
      if (republished > 0) logger.info({ tenants: report.succeeded.length, republished }, "imports : imports interrompus relancés");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "imports : échec de la reprise");
      if (report.failed.length > 0) throw new Error(`imports.resume-stalled : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "imports.purge",
    cron: "25 4 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createImportsDeps({ db: tenantDb, logger, portsProvider: importsWorkerPorts });
      const report = await purgeExpiredImports(deps, systemDb);
      const cancelled = report.succeeded.reduce((n, s) => n + s.result.cancelledDrafts, 0);
      const purged = report.succeeded.reduce((n, s) => n + s.result.purged, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, cancelledDrafts: cancelled, purged }, "imports : purge effectuée");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "imports : échec de la purge");
      if (report.failed.length > 0) throw new Error(`imports.purge : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
