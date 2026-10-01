/**
 * Jobs planifiés du module `payroll` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `payroll.fail-stale-runs`  toutes les 10 minutes, PAR TENANT : abandonne les calculs de paie « morts »
 *    (processus interrompu, RUNNING depuis plus de 15 minutes) pour libérer leur verrou fonctionnel. Idempotent.
 *
 * Le calcul de la paie lui-même est une action de gestion (`POST /periods/:id/calculate`) : il n'est jamais lancé
 * automatiquement.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { failStaleRunsForTenant } from "./application/consumers";
import { createPayrollDeps } from "./application/deps";
import { STALE_RUN_MS } from "./application/calculate";

export default [
  defineScheduledJob({
    name: "payroll.fail-stale-runs",
    cron: "*/10 * * * *",
    lockTtlMs: 5 * 60_000,
    perTenant: true,
    handler: async ({ tenant, tenantDb, logger }) => {
      const deps = createPayrollDeps({ db: tenantDb, logger });
      const result = await failStaleRunsForTenant(deps, tenant.id, STALE_RUN_MS);
      if (!result.ok) throw result.error;
      if (result.value.affected > 0) logger.warn({ tenant: tenant.slug, runs: result.value.affected }, "payroll : calculs interrompus abandonnés");
    },
  }),
];
