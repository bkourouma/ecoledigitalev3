/**
 * Jobs planifiés du module `notifications` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 * Fuseau des expressions cron : `WORKER_TZ`.
 *
 *  - `notifications.dispatch`          toutes les 15 s : envoie les remises dues (réclamation `SKIP LOCKED`, bail, plafonds
 *    journaliers, reprise avec backoff). L'envoi réseau se fait HORS transaction. Un établissement en échec n'arrête pas les autres.
 *  - `notifications.run-dunning`       07:00 : relances d'impayés par paliers (J+7 / J+21 / J+45 configurables), jamais deux fois
 *    le même palier, arrêt dès paiement.
 *  - `notifications.evaluate-alerts`   07:30 : alertes (retard de paiement prolongé, baisse de résultats, charge d'enseignement).
 *  - `notifications.housekeeping`      04:15 : purge du journal au-delà de la rétention, abonnements push expirés.
 * Tous idempotents (clés de remise, registre des paliers) : un job rejoué ou lancé deux fois ne double rien.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { alertsAllTenants, dispatchAllTenants, dunningAllTenants, housekeepingAllTenants } from "./application/runners";
import { workerDeps } from "./worker-deps";

const errorOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default [
  defineScheduledJob({
    name: "notifications.dispatch",
    cron: "*/15 * * * * *",
    lockTtlMs: 5 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = workerDeps({ db: tenantDb, logger });
      const report = await dispatchAllTenants(deps, systemDb);
      const t = report.totals;
      if (t.claimed > 0 || report.failed.length > 0) {
        logger.info({ tenants: report.tenants, claimed: t.claimed, sent: t.sent, simulated: t.simulated, retried: t.retried, failed: t.failed, bounced: t.bounced, skipped: t.skipped, cancelled: t.cancelled, deferred: t.deferred }, "notifications : envoi");
      }
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error }, "notifications : échec de l'envoi pour un établissement");
      if (report.failed.length > 0) throw new Error(`notifications.dispatch : ${report.failed.length} établissement(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "notifications.run-dunning",
    cron: "0 7 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await dunningAllTenants(workerDeps({ db: tenantDb, logger }), systemDb);
      const notified = report.succeeded.reduce((n, s) => n + s.result.notified, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, notified }, "notifications : relances d'impayés");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: errorOf(f.error) }, "notifications : échec des relances");
      if (report.failed.length > 0) throw new Error(`notifications.run-dunning : ${report.failed.length} établissement(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "notifications.evaluate-alerts",
    cron: "30 7 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await alertsAllTenants(workerDeps({ db: tenantDb, logger }), systemDb);
      const problems = report.succeeded.flatMap((s) => s.result.errors.map((e) => `${s.slug} : ${e}`));
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, alertErrors: problems.length }, "notifications : alertes évaluées");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: errorOf(f.error) }, "notifications : échec de l'évaluation des alertes");
      for (const p of problems) logger.error({ err: p }, "notifications : alerte non évaluée");
      if (report.failed.length > 0 || problems.length > 0) throw new Error(`notifications.evaluate-alerts : ${report.failed.length} établissement(s) en échec, ${problems.length} alerte(s) non évaluée(s).`);
    },
  }),
  defineScheduledJob({
    name: "notifications.housekeeping",
    cron: "15 4 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await housekeepingAllTenants(workerDeps({ db: tenantDb, logger }), systemDb);
      const deliveries = report.succeeded.reduce((n, s) => n + s.result.deliveries, 0);
      const push = report.succeeded.reduce((n, s) => n + s.result.pushSubscriptions, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, deliveries, pushSubscriptions: push }, "notifications : entretien effectué");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: errorOf(f.error) }, "notifications : échec de l'entretien");
      if (report.failed.length > 0) throw new Error(`notifications.housekeeping : ${report.failed.length} établissement(s) en échec.`);
    },
  }),
];
