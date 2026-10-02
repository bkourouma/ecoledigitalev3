/**
 * Jobs planifiés du module `admissions` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement). Fuseau des
 * expressions : `WORKER_TZ`. Tous IDEMPOTENTS ; un tenant en échec n'arrête pas les autres (le job est alors signalé en échec).
 *
 *  - `admissions.expire-offers`       toutes les 15 min : offres `PENDING` échues -> `EXPIRED`, dossier clos « offre expirée »
 *    (décision système), place libérée (promotion automatique si l'établissement l'a choisie).
 *  - `admissions.payment-deadline`    toutes les heures : délai de paiement des frais d'inscription (`payment_deadline_days`, VIDE
 *    par défaut : aucune annulation) -> inscription en attente annulée (`academic`), facture annulée (`finance`), dossier clos,
 *    place libérée ; aucun numéro réutilisé, aucun élève supprimé.
 *  - `admissions.purge-public-form`   quotidien (03:20) : jetons de formulaire expirés et tentatives de plus de 30 jours.
 *  - `admissions.anonymize-expired`   quotidien (04:10) : dossiers clos sans inscription dont la conservation est échue
 *    (`rejected_retention_months`, VIDE par défaut : inactif).
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import type { Logger } from "@ecoledigitale/kernel";
import type { ForEachTenantReport } from "@ecoledigitale/database";
import { anonymizeExpiredAllTenants, enforcePaymentDeadlineAllTenants, expireOffersAllTenants, purgePublicFormDataAllTenants } from "./application/jobs";
import { workerDeps } from "./worker";

function conclude<R>(name: string, logger: Logger, report: ForEachTenantReport<R>, summarize: (r: R) => object): void {
  logger.info({ tenants: report.succeeded.length, failed: report.failed.length, ...report.succeeded.reduce<Record<string, number>>((acc, s) => {
    for (const [k, v] of Object.entries(summarize(s.result))) acc[k] = (acc[k] ?? 0) + Number(v);
    return acc;
  }, {}) }, `${name} : traité`);
  for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, `${name} : échec pour un tenant`);
  if (report.failed.length > 0) throw new Error(`${name} : ${report.failed.length} tenant(s) en échec.`);
}

export default [
  defineScheduledJob({
    name: "admissions.expire-offers",
    cron: "*/15 * * * *",
    lockTtlMs: 10 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      conclude("admissions.expire-offers", logger, await expireOffersAllTenants(workerDeps({ tenantDb, systemDb, logger }), systemDb), (r) => ({ expired: r.expired, failed: r.failed }));
    },
  }),
  defineScheduledJob({
    name: "admissions.payment-deadline",
    cron: "5 * * * *",
    lockTtlMs: 20 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      conclude("admissions.payment-deadline", logger, await enforcePaymentDeadlineAllTenants(workerDeps({ tenantDb, systemDb, logger }), systemDb), (r) => ({ cancelled: r.cancelled, skipped: r.skipped }));
    },
  }),
  defineScheduledJob({
    name: "admissions.purge-public-form",
    cron: "20 3 * * *",
    lockTtlMs: 20 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      conclude("admissions.purge-public-form", logger, await purgePublicFormDataAllTenants(workerDeps({ tenantDb, systemDb, logger }), systemDb), (r) => ({ sessions: r.sessions, attempts: r.attempts }));
    },
  }),
  defineScheduledJob({
    name: "admissions.anonymize-expired",
    cron: "10 4 * * *",
    lockTtlMs: 60 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      conclude("admissions.anonymize-expired", logger, await anonymizeExpiredAllTenants(workerDeps({ tenantDb, systemDb, logger }), systemDb), (r) => ({ anonymized: r.anonymized, failed: r.failed }));
    },
  }),
];
