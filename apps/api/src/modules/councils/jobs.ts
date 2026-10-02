/**
 * Jobs planifiés du module `councils` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement). Fuseau : `WORKER_TZ`.
 *
 *  - `councils.apply-effects`            toutes les 30 secondes, par tenant : rejoue les effets `PENDING` / `FAILED` des décisions (jamais
 *    celui d'un humain : l'exclusion reste `AWAITING_HUMAN`), tentatives bornées. Idempotent (un effet vivant est unique par décision et
 *    nature) ; un effet est rejoué au nom de l'humain qui a ENREGISTRÉ la décision (les écritures en aval exigent un utilisateur).
 *  - `councils.expire-unlock-requests`   quotidien (05:40), par tenant : une demande de déverrouillage restée ouverte (ou approuvée sans
 *    réouverture) au-delà du délai paramétré passe `EXPIRED`.
 *
 * En production le worker EMBARQUE les modules dans son bundle : reconstruisez-le après modification
 * (pnpm --filter @ecoledigitale/worker build).
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { audit, configureAuditFromEnv } from "../audit";
import { createCouncilsDeps } from "./application/deps";
import { councilsWorkerPorts } from "./application/port-registry";
import { processRunnableEffects } from "./application/effects";
import { expireUnlockRequests } from "./application/unlock";
import { councilsAuditAdapter } from "./infrastructure/audit-adapter";
import { bundledTemplatePort } from "./templates";

let auditConfigured = false;

export default [
  defineScheduledJob({
    name: "councils.apply-effects",
    cron: "*/30 * * * * *",
    perTenant: true,
    lockTtlMs: 5 * 60_000,
    handler: async ({ tenant, tenantDb, db, logger }) => {
      if (!auditConfigured) {
        configureAuditFromEnv(audit, process.env, { logger });
        auditConfigured = true;
      }
      const deps = createCouncilsDeps({
        db: tenantDb,
        logger,
        portsProvider: () => ({ templates: bundledTemplatePort, ...councilsWorkerPorts() }),
        audit: councilsAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
      });
      const r = await processRunnableEffects(deps, db.ctx);
      if (!r.ok) throw r.error;
      if (r.value.attempted > 0) logger.info({ tenantId: tenant.id, ...r.value }, "councils : effets rejoués");
    },
  }),
  defineScheduledJob({
    name: "councils.expire-unlock-requests",
    cron: "40 5 * * *",
    perTenant: true,
    lockTtlMs: 15 * 60_000,
    handler: async ({ tenant, tenantDb, db, logger }) => {
      if (!auditConfigured) {
        configureAuditFromEnv(audit, process.env, { logger });
        auditConfigured = true;
      }
      const deps = createCouncilsDeps({ db: tenantDb, logger, audit: councilsAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }) });
      const r = await expireUnlockRequests(deps, db.ctx);
      if (!r.ok) throw r.error;
      if (r.value.expired > 0) logger.info({ tenantId: tenant.id, expired: r.value.expired }, "councils : demandes de déverrouillage expirées");
    },
  }),
];
