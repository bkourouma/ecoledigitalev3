/**
 * Jobs planifiés du module `reportcards` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `reportcards.integrity-check`   quotidien (03:20, `WORKER_TZ`) : pour chaque tenant, recalcule le hash de chaque bulletin
 *    et revérifie la signature Ed25519 ; tout écart publie `reportcards.integrity.mismatch` (alerte d'exploitation, AC2.2) ;
 *  - `reportcards.sweep-renders`     toutes les 10 minutes : redemande le rendu des bulletins restés `PENDING` (événement
 *    perdu, worker arrêté) — filet de sécurité, idempotent ;
 *  - `reportcards.purge-verification-log`  le 1er de chaque mois (04:10) : purge du journal des vérifications de plus de 24 mois
 *    (seule suppression que la garde SQL autorise).
 * Un tenant en échec n'arrête pas les autres ; le job est alors signalé en échec.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createSystemContext } from "@ecoledigitale/kernel";
import { createReportcardsDeps } from "./application/deps";
import { checkIntegrity } from "./application/integrity";
import { sweepPendingOfficialDocuments } from "./application/official-documents";
import { sweepPendingRenders } from "./application/render";
import { purgeExpiredVerificationEvents } from "./infrastructure/cards-repository";

export default [
  defineScheduledJob({
    name: "reportcards.integrity-check",
    cron: "20 3 * * *",
    perTenant: true,
    lockTtlMs: 60 * 60_000,
    handler: async ({ tenant, tenantDb, logger }) => {
      const deps = createReportcardsDeps({ db: tenantDb, logger });
      const ctx = createSystemContext(tenant.id);
      let after: string | undefined;
      let checked = 0;
      let mismatches = 0;
      do {
        const result = await checkIntegrity(deps, ctx, { limit: 500, ...(after ? { afterId: after } : {}) });
        if (!result.ok) throw result.error;
        checked += result.value.checked;
        mismatches += result.value.mismatches.length;
        after = result.value.nextAfterId ?? undefined;
      } while (after);
      if (mismatches > 0) logger.error({ tenant: tenant.slug, checked, mismatches }, "reportcards : ÉCART D'INTÉGRITÉ détecté");
      else logger.info({ tenant: tenant.slug, checked }, "reportcards : intégrité vérifiée");
    },
  }),
  defineScheduledJob({
    name: "reportcards.sweep-renders",
    cron: "*/10 * * * *",
    perTenant: true,
    lockTtlMs: 9 * 60_000,
    handler: async ({ tenant, tenantDb, logger }) => {
      const deps = createReportcardsDeps({ db: tenantDb, logger });
      const result = await sweepPendingRenders(deps, createSystemContext(tenant.id), { olderThanMs: 10 * 60_000, limit: 200 });
      if (!result.ok) throw result.error;
      if (result.value.requested > 0) logger.info({ tenant: tenant.slug, requested: result.value.requested }, "reportcards : rendus en attente redemandés");
      const official = await sweepPendingOfficialDocuments(deps, createSystemContext(tenant.id), { olderThanMs: 10 * 60_000, limit: 200 });
      if (!official.ok) throw official.error;
      if (official.value.requested > 0) logger.info({ tenant: tenant.slug, requested: official.value.requested }, "reportcards : rendus de documents officiels redemandés");
    },
  }),
  defineScheduledJob({
    name: "reportcards.purge-verification-log",
    cron: "10 4 1 * *",
    perTenant: true,
    handler: async ({ tenant, db, logger }) => {
      const purged = await db.run((tx) => purgeExpiredVerificationEvents(tx));
      if (purged > 0) logger.info({ tenant: tenant.slug, purged }, "reportcards : journal de vérification purgé (24 mois)");
    },
  }),
];
