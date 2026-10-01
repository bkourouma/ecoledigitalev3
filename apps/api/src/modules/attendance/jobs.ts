/**
 * Jobs planifiés du module `attendance` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `attendance.recompute-summaries`  quotidien (02:50, `WORKER_TZ`) : rafraîchit, tenant par tenant, les récapitulatifs
 *    dérivés dont un pointage ou une séance a changé depuis leur dernier calcul. FILET DE SÉCURITÉ : le recalcul normal est
 *    synchrone (dans la transaction qui modifie les pointages) ; ce job rattrape ce qu'un chemin d'écriture exceptionnel
 *    aurait laissé périmé et évalue les règles d'alerte sur ce qui change. Idempotent : sans changement, aucun événement.
 *    Un tenant en échec n'arrête pas les autres ; le job est alors signalé en échec.
 *
 * Aucun port d'un autre module n'est nécessaire (fenêtres de période mémorisées dans `period_summaries`).
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createAttendanceDeps } from "./application/deps";
import { recomputeAllTenants } from "./application/consumers";

export default [
  defineScheduledJob({
    name: "attendance.recompute-summaries",
    cron: "50 2 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createAttendanceDeps({ db: tenantDb, logger });
      const report = await recomputeAllTenants(deps, systemDb);
      const refreshed = report.succeeded.reduce((n, s) => n + s.result.refreshed, 0);
      const changed = report.succeeded.reduce((n, s) => n + s.result.changed, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, refreshed, changed }, "attendance : récapitulatifs rafraîchis");
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "attendance : échec du rafraîchissement");
      }
      if (report.failed.length > 0) throw new Error(`attendance.recompute-summaries : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
