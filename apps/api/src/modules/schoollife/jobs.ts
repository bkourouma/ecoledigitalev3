/**
 * Jobs planifiés du module "schoollife" pour apps/worker (découverts automatiquement : modules/<key>/jobs.ts).
 * Fuseau des expressions cron : WORKER_TZ. En production le worker EMBARQUE les modules dans son bundle : reconstruisez-le
 * après modification (pnpm --filter @ecoledigitale/worker build).
 *
 *  - `schoollife.remind-convocations`  toutes les heures : rappel aux tuteurs d'une convocation ENVOYÉE dont l'échéance tombe dans
 *    la fenêtre `convocation_reminder_hours` de l'établissement (réglage VIDE par défaut : aucun rappel).
 *  - `schoollife.exclusion-boundaries` quotidien (06:15) : avis neutre aux tuteurs au début et à la fin d'une exclusion temporaire
 *    en vigueur, si l'établissement l'a activé (`exclusion_boundary_notices`, éteint par défaut). Ne décide rien, ne change aucun
 *    statut d'élève et ne qualifie aucune absence (question métier Q6-19 ouverte).
 * Tous deux IDEMPOTENTS (registre `schoollife.job_notifications`) ; un tenant en échec n'arrête pas les autres (le job est alors
 * signalé en échec).
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import type { Logger } from "@ecoledigitale/kernel";
import type { ForEachTenantReport } from "@ecoledigitale/database";
import { notifyExclusionBoundariesAllTenants, remindConvocationsAllTenants, type JobReport } from "./application/jobs";
import { workerDeps } from "./worker";

function conclude(name: string, logger: Logger, report: ForEachTenantReport<JobReport>): void {
  const totals = report.succeeded.reduce((acc, s) => ({ examined: acc.examined + s.result.examined, sent: acc.sent + s.result.sent, failed: acc.failed + s.result.failed }), { examined: 0, sent: 0, failed: 0 });
  logger.info({ tenants: report.succeeded.length, failedTenants: report.failed.length, ...totals }, `${name} : traité`);
  for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, `${name} : échec pour un tenant`);
  if (report.failed.length > 0) throw new Error(`${name} : ${report.failed.length} tenant(s) en échec.`);
}

export default [
  defineScheduledJob({
    name: "schoollife.remind-convocations",
    cron: "10 * * * *",
    lockTtlMs: 20 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      conclude("schoollife.remind-convocations", logger, await remindConvocationsAllTenants(workerDeps({ tenantDb, systemDb, logger }), systemDb));
    },
  }),
  defineScheduledJob({
    name: "schoollife.exclusion-boundaries",
    cron: "15 6 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      conclude("schoollife.exclusion-boundaries", logger, await notifyExclusionBoundariesAllTenants(workerDeps({ tenantDb, systemDb, logger }), systemDb));
    },
  }),
];
