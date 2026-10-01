/**
 * Jobs planifiés du module `academic` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `academic.expire-holds`        chaque minute : les réservations de place `PENDING` échues passent en `CANCELLED`
 *    (motif `hold_expired`), la place est libérée et `academic.enrollment_course.expired` est republié (finance annule
 *    la ligne). Un tenant en échec n'arrête pas les autres ; le job est alors signalé en échec.
 *  - `academic.finalize-offerings`  quotidien (01:00, `WORKER_TZ`) : les offres `OPEN`/`FULL`/`IN_PROGRESS` dont la
 *    date de fin est passée (date civile de l'établissement) passent en `COMPLETED`. JAMAIS dans un `GET`, jamais les
 *    offres `DRAFT` ni `CANCELLED`.
 *
 * La reconduction annuelle (`rolloverAcademicYear`) est lancée à la demande par la direction (route
 * `POST /years/:id/rollover`), par lots d'une transaction.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createAcademicDeps } from "./application/deps";
import { expireHoldsForAllTenants, finalizeOfferingsForAllTenants } from "./application/jobs";

export default [
  defineScheduledJob({
    name: "academic.expire-holds",
    cron: "* * * * *",
    lockTtlMs: 5 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createAcademicDeps({ db: tenantDb, logger });
      const report = await expireHoldsForAllTenants(deps, systemDb);
      const expired = report.succeeded.reduce((n, s) => n + s.result.expired, 0);
      if (expired > 0) logger.info({ tenants: report.succeeded.length, expired }, "academic : réservations expirées");
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "academic : échec de l'expiration des réservations");
      }
      if (report.failed.length > 0) throw new Error(`academic.expire-holds : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "academic.finalize-offerings",
    cron: "0 1 * * *",
    lockTtlMs: 15 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createAcademicDeps({ db: tenantDb, logger });
      const report = await finalizeOfferingsForAllTenants(deps, systemDb);
      const finalized = report.succeeded.reduce((n, s) => n + s.result.finalized, 0);
      logger.info({ tenants: report.succeeded.length, finalized }, "academic : offres échues terminées");
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "academic : échec de la finalisation des offres");
      }
      if (report.failed.length > 0) throw new Error(`academic.finalize-offerings : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
