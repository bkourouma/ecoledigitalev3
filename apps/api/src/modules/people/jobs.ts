/**
 * Jobs planifiés du module `people` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `people.emit-expiring-qualifications`  quotidien (06:30, `WORKER_TZ`), tenant par tenant : publie
 *    `people.staff_qualification.expiring` UNE fois par franchissement de seuil (idempotent : un second passage sans
 *    changement ne publie rien). Le préavis est la donnée `settings.expiry_alert_days` du tenant ; sans préavis configuré, aucune
 *    alerte. Un tenant en échec n'arrête pas les autres.
 */
import { createSystemContext } from "@ecoledigitale/kernel";
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createPeopleDeps } from "./application/deps";
import { emitExpiringQualifications } from "./application/staff";

export default [
  defineScheduledJob({
    name: "people.emit-expiring-qualifications",
    cron: "30 6 * * *",
    perTenant: true,
    lockTtlMs: 10 * 60_000,
    handler: async ({ tenant, tenantDb, logger }) => {
      const deps = createPeopleDeps({ db: tenantDb, logger });
      const res = await emitExpiringQualifications(deps, createSystemContext(tenant.id));
      if (!res.ok) throw res.error;
      logger.info({ tenantId: tenant.id, emitted: res.value.emitted }, "people : alertes de qualifications publiées");
    },
  }),
];
