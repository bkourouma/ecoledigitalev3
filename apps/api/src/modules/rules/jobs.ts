/**
 * Jobs planifiés du module `rules` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `rules.replay-reproducibility`  quotidien (02:50, `WORKER_TZ`) : prouve en continu qu'un bulletin peut être reconstruit à
 *    l'identique (AC4.3).
 *      1. recalcule le hash de définition de toutes les versions figées (catalogue national et variantes de chaque
 *         établissement) : une altération faite hors application est signalée ;
 *      2. pour chaque établissement actif, rejoue un échantillon (`replay_sample_percent`, défaut 1 %) fourni par les sources de
 *         rejeu branchées par les modules consommateurs (résultats FINAL et résultats de bulletins contestés) et compare les
 *         `outputs_hash`. Tout écart émet `rules.replay.mismatch` (sévérité haute) ; le job est alors signalé en échec.
 *    Tant qu'aucun consommateur n'a branché de source, seule l'étape 1 s'exécute.
 *  - `rules.purge-evaluation-failures`  quotidien (04:30) : purge à 90 jours du journal des échecs d'évaluation.
 */
import { createSystemContext, systemClock } from "@ecoledigitale/kernel";
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { audit } from "../audit";
import { createRulesDeps } from "./application/deps";
import { replaySampleForTenant, verifyCatalogHashes } from "./application/replay";
import { readSettings } from "./infrastructure/settings-repository";
import { purgeEvaluationFailures } from "./infrastructure/failures-repository";

const RETENTION_DAYS = 90;

export default [
  defineScheduledJob({
    name: "rules.replay-reproducibility",
    cron: "50 2 * * *",
    lockTtlMs: 60 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createRulesDeps({
        db: tenantDb,
        systemDb,
        logger,
        audit: { record: (tx, entry) => audit.record(tx, entry as never), recordPlatform: (tx, entry) => audit.recordPlatform(tx, entry as never) },
      });
      const issues = await verifyCatalogHashes(deps);
      const percent = (await systemDb.run("rules-replay-settings", (tx) => readSettings(tx), { readOnly: true })).replaySamplePercent;

      let checked = 0;
      let mismatches = 0;
      let failedTenants = 0;
      if (deps.replaySources.size > 0) {
        const tenants = await systemDb.run("rules-replay-tenants", (tx) => tx.many<{ id: string }>("SELECT id FROM kernel.tenants WHERE status = 'active' ORDER BY id"), { readOnly: true });
        for (const tenant of tenants) {
          try {
            const result = await replaySampleForTenant(deps, createSystemContext(tenant.id), percent);
            if (result.ok) {
              checked += result.value.checked;
              mismatches += result.value.mismatches.length;
            } else {
              failedTenants += 1;
              logger.error({ tenantId: tenant.id, err: result.error.message }, "rules : rejeu en échec pour ce tenant");
            }
          } catch (e) {
            failedTenants += 1;
            logger.error({ tenantId: tenant.id, err: e instanceof Error ? e.message : String(e) }, "rules : rejeu en échec pour ce tenant");
          }
        }
      }
      logger.info({ hashIssues: issues.length, checked, mismatches, failedTenants, samplePercent: percent }, "rules : rejeu de reproductibilité terminé");
      if (issues.length > 0 || mismatches > 0 || failedTenants > 0) {
        throw new Error(`rules.replay-reproducibility : ${issues.length} empreinte(s) divergente(s), ${mismatches} écart(s) de rejeu, ${failedTenants} tenant(s) en échec.`);
      }
    },
  }),
  defineScheduledJob({
    name: "rules.purge-evaluation-failures",
    cron: "30 4 * * *",
    lockTtlMs: 15 * 60_000,
    handler: async ({ systemDb, logger }) => {
      const cutoff = new Date(systemClock.now().getTime() - RETENTION_DAYS * 24 * 3_600_000);
      const report = await systemDb.forEachTenant("rules-purge-evaluation-failures", (tx) => purgeEvaluationFailures(tx, cutoff));
      const purged = report.succeeded.reduce((n, s) => n + s.result, 0);
      logger.info({ purged, tenants: report.succeeded.length, failed: report.failed.length }, "rules : journal des échecs d'évaluation purgé (90 jours)");
      if (report.failed.length > 0) throw new Error(`rules.purge-evaluation-failures : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
