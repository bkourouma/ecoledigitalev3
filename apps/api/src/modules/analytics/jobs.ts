/**
 * Jobs planifiés du module `analytics` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `analytics.process-refreshes`  toutes les 30 s : exécute, tenant par tenant, les demandes de rafraîchissement ÉCHUES
 *    (une par genre × périmètre, SKIP LOCKED ; reprise avec délai exponentiel, jusqu'à 5 tentatives). Une source non branchée
 *    marque la demande `UNAVAILABLE` (jamais une erreur). Un tenant en échec n'arrête pas les autres.
 *  - `analytics.nightly-rebuild`  quotidien (03:10) : RECONSTRUIT chaque tenant depuis les sources (rattrapage des
 *    événements perdus, historique antérieur à `analytics`). Idempotent : mêmes sources = mêmes read-models.
 *
 * Les ports sources (lecture des autres modules) sont branchés par `installWorkerAdapters` (`platform/adapters`) dans le
 * registre PAR PROCESSUS `analyticsWorkerPorts` ; sans eux, chaque genre déclare `UNAVAILABLE`.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createAnalyticsDeps } from "./application/deps";
import { analyticsWorkerPorts } from "./application/port-registry";
import { rebuildAllTenants } from "./application/rebuild";
import { processAllTenants } from "./application/requests";

export default [
  defineScheduledJob({
    name: "analytics.process-refreshes",
    cron: "*/30 * * * * *",
    lockTtlMs: 10 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createAnalyticsDeps({ db: tenantDb, logger, portsProvider: analyticsWorkerPorts });
      const report = await processAllTenants(deps, systemDb);
      const sum = (pick: (r: (typeof report.succeeded)[number]["result"]) => number): number => report.succeeded.reduce((n, s) => n + pick(s.result), 0);
      const leased = sum((r) => r.leased);
      if (leased > 0 || report.failed.length > 0) {
        logger.info({ tenants: report.succeeded.length, failed: report.failed.length, leased, ok: sum((r) => r.ok), unavailable: sum((r) => r.unavailable), retried: sum((r) => r.retried), failedRequests: sum((r) => r.failed) }, "analytics : rafraîchissements traités");
      }
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "analytics : échec du traitement des rafraîchissements");
      if (report.failed.length > 0) throw new Error(`analytics.process-refreshes : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "analytics.nightly-rebuild",
    cron: "10 3 * * *",
    lockTtlMs: 60 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createAnalyticsDeps({ db: tenantDb, logger, portsProvider: analyticsWorkerPorts });
      const report = await rebuildAllTenants(deps, systemDb);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, changed: report.succeeded.reduce((n, s) => n + s.result.changed, 0) }, "analytics : reconstruction nocturne terminée");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "analytics : échec de la reconstruction");
      if (report.failed.length > 0) throw new Error(`analytics.nightly-rebuild : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
