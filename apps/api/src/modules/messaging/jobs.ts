/**
 * Jobs planifiés du module `messaging` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `messaging.publish-scheduled-announcements`  chaque minute : publie les annonces PROGRAMMÉES dont l'échéance est atteinte
 *    (destinataires figés à la programmation : aucun port requis), notifie, émet `messaging.announcement.published`.
 *    Idempotent (verrou de ligne `FOR UPDATE SKIP LOCKED`). Un tenant en échec n'arrête pas les autres.
 *  - `messaging.housekeeping`                     quotidien (04:50, `WORKER_TZ`) : purge les notifications LUES plus anciennes que la
 *    rétention du tenant et les pièces jointes déposées mais jamais liées (24 h) — objets de stockage compris.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createMessagingDeps } from "./application/deps";
import { housekeepingAllTenants, publishDueAllTenants } from "./application/consumers";
import { messagingWorkerPorts } from "./application/port-registry";

export default [
  defineScheduledJob({
    name: "messaging.publish-scheduled-announcements",
    cron: "* * * * *",
    lockTtlMs: 5 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createMessagingDeps({ db: tenantDb, logger, portsProvider: messagingWorkerPorts });
      const report = await publishDueAllTenants(deps, systemDb);
      const published = report.succeeded.reduce((n, s) => n + s.result, 0);
      if (published > 0) logger.info({ tenants: report.succeeded.length, published }, "messaging : annonces programmées publiées");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "messaging : échec de publication programmée");
      if (report.failed.length > 0) throw new Error(`messaging.publish-scheduled-announcements : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "messaging.housekeeping",
    cron: "50 4 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createMessagingDeps({ db: tenantDb, logger, portsProvider: messagingWorkerPorts });
      const report = await housekeepingAllTenants(deps, systemDb);
      const notifications = report.succeeded.reduce((n, s) => n + s.result.notifications, 0);
      const attachments = report.succeeded.reduce((n, s) => n + s.result.attachments, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, notifications, attachments }, "messaging : purge effectuée");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "messaging : échec de la purge");
      if (report.failed.length > 0) throw new Error(`messaging.housekeeping : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
