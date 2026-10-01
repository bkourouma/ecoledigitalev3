/**
 * Jobs planifiés du module `results` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `results.process-recomputes`  toutes les 10 s : exécute, tenant par tenant, les demandes de recalcul ÉCHUES
 *    (une par classe × période, SKIP LOCKED ; une période clôturée est BLOQUÉE et signalée). Idempotent, reprenable après un
 *    crash (une demande RUNNING depuis plus de 10 minutes redevient PENDING). Un tenant en échec n'arrête pas les autres.
 *  - `results.purge`  quotidien (04:40) : demandes terminées > 30 j, brouillons remplacés > 90 j. Jamais un résultat FINAL,
 *    une clôture, une surcharge ou une décision (valeur probante, durée de vie du tenant).
 *
 * Le rejeu de reproductibilité des résultats FINAL (échantillon nocturne) est confié au module `rules` : `results` branche sa source
 * de rejeu et de simulation (`bindResultsRulesSources`, application/replay.ts) dans les registres du processus, au démarrage de l'API
 * (`setup`) et à chaque exécution des jobs du worker. Les ports `assess` et `rules` sont construits sur leur API publique ;
 * `curriculum` et `roster` (academic) se branchent par `setResultsWorkerPorts` (voir README).
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createResultsDeps } from "./application/deps";
import { bindResultsRulesSources } from "./application/replay";
import { createWorkerResultsDeps } from "./application/worker-ports";
import { processAllTenants, purgeAllTenants } from "./application/recompute";

export default [
  defineScheduledJob({
    name: "results.process-recomputes",
    cron: "*/10 * * * * *",
    lockTtlMs: 5 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createWorkerResultsDeps({ db: tenantDb, systemDb, logger });
      bindResultsRulesSources(deps);
      const report = await processAllTenants(deps, systemDb);
      const done = report.succeeded.reduce((n, s) => n + s.result.done, 0);
      const blocked = report.succeeded.reduce((n, s) => n + s.result.blocked, 0);
      if (done + blocked > 0 || report.failed.length > 0) logger.info({ tenants: report.succeeded.length, failed: report.failed.length, done, blocked }, "results : recalculs traités");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "results : échec du traitement des recalculs");
      if (report.failed.length > 0) throw new Error(`results.process-recomputes : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "results.purge",
    cron: "40 4 * * *",
    lockTtlMs: 15 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createResultsDeps({ db: tenantDb, logger });
      const report = await purgeAllTenants(deps, systemDb);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length }, "results : purge effectuée");
      if (report.failed.length > 0) throw new Error(`results.purge : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
