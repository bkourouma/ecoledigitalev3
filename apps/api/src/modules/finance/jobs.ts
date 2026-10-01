/**
 * Jobs planifiés du module `finance` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `finance.mark-overdue-invoices`  quotidien (01:15, `WORKER_TZ`) : passe en OVERDUE les factures dont une
 *    échéance est échue, tenant par tenant (`markOverdueForAllTenants`), et publie `finance.invoice.overdue`
 *    UNE fois par transition (idempotent : sans changement de situation, un second passage ne publie rien).
 *    Un tenant en échec n'arrête pas les autres ; le job est alors signalé en échec.
 *
 * Aucun fournisseur de paiement ni port d'audit n'est nécessaire ici (le passage en retard n'audite pas) :
 * `createFinanceDeps` prend les valeurs par défaut sûres (environnement `production`, audit no-op).
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createFinanceDeps } from "./application/deps";
import { markOverdueForAllTenants } from "./application/jobs";

export default [
  defineScheduledJob({
    name: "finance.mark-overdue-invoices",
    cron: "15 1 * * *",
    lockTtlMs: 15 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createFinanceDeps({ db: tenantDb, logger });
      const report = await markOverdueForAllTenants(deps, systemDb);
      const processed = report.succeeded.reduce((n, s) => n + s.result.processed, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, invoicesMarkedOverdue: processed }, "finance : factures échues traitées");
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "finance : échec du passage en retard");
      }
      if (report.failed.length > 0) throw new Error(`finance.mark-overdue-invoices : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
