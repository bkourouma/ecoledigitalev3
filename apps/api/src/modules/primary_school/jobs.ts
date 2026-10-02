/**
 * Jobs planifiés du module `primary_school` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `primary_school.purge-draft-reviews`  quotidien (04:35, `WORKER_TZ`) : supprime, tenant par tenant, les BROUILLONS de bilan annuel
 *    intacts depuis plus de 90 jours (jamais un bilan scellé ou remplacé : déclencheur SQL). Idempotent ; un tenant en échec
 *    n'arrête pas les autres, le job est alors signalé en échec.
 *
 * La préparation en masse des bilans (> 500) reste une requête de l'API (`POST /annual-reviews/prepare`, une classe à la fois) :
 * aucun job n'est nécessaire à l'échelle d'une classe.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createPrimarySchoolDeps } from "./application/deps";
import { purgeStaleDraftReviews } from "./application/reviews";

export default [
  defineScheduledJob({
    name: "primary_school.purge-draft-reviews",
    cron: "35 4 * * *",
    perTenant: true,
    lockTtlMs: 15 * 60_000,
    handler: async ({ tenant, tenantDb, db, logger }) => {
      const deps = createPrimarySchoolDeps({ db: tenantDb, logger });
      const r = await purgeStaleDraftReviews(deps, db.ctx);
      if (!r.ok) throw r.error;
      logger.info({ tenantId: tenant.id, purged: r.value.purged }, "primary_school : brouillons de bilan périmés purgés");
    },
  }),
];
