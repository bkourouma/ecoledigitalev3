/**
 * Jobs planifiés du module `documents` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `documents.expiry-sweep`   quotidien (06:10, `WORKER_TZ`) : pour chaque tenant, publie UNE fois `documents.document.expiring`
 *    par seuil franchi (30, 7, 1 jours par défaut, ou seuils du document / de la catégorie) puis `documents.document.expired` ;
 *    les seuils émis sont mémorisés dans la même transaction que l'événement : idempotent, rejouable. Consommé par le chantier
 *    notifications.
 *  - `documents.housekeeping`   quotidien (03:40, `WORKER_TZ`) : purge de rétention des documents ARCHIVÉS échus (objets supprimés
 *    D'ABORD, contenu descriptif effacé, historique conservé) et destruction des fichiers de quarantaine non traités échus.
 *
 * Un tenant en échec n'arrête pas les autres ; le job échoue (et le planificateur le signale) si au moins un tenant a échoué.
 * Les ports (stockage) viennent de `setDocumentsWorkerPorts`, branché par `installWorkerAdapters` ; sans stockage la purge
 * échoue FERMÉ (elle ne marque jamais une ligne purgée sans avoir supprimé l'objet).
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import type { Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { audit, configureAuditFromEnv } from "../audit";
import { housekeepingAllTenants, sweepExpirationsAllTenants } from "./application/housekeeping";
import { createDocumentsDeps, type DocumentsDeps } from "./application/deps";
import { documentsWorkerPorts } from "./application/port-registry";
import { documentsAuditAdapter } from "./infrastructure/audit-adapter";

let auditConfigured = false;

/** Dépendances d'un job : ports du worker (stockage) et audit branché (même clé HMAC que l'API). */
function depsOf(tenantDb: TenantDb, logger: Logger): DocumentsDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger });
    auditConfigured = true;
  }
  return createDocumentsDeps({
    db: tenantDb,
    logger,
    portsProvider: documentsWorkerPorts,
    audit: documentsAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}

export default [
  defineScheduledJob({
    name: "documents.expiry-sweep",
    cron: "10 6 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await sweepExpirationsAllTenants(depsOf(tenantDb, logger), systemDb);
      const alerted = report.succeeded.reduce((n, s) => n + s.result.alerted, 0);
      const expired = report.succeeded.reduce((n, s) => n + s.result.expired, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, alerted, expired }, "documents : alertes d'expiration traitées");
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "documents : échec du balayage des expirations");
      if (report.failed.length > 0) throw new Error(`documents.expiry-sweep : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "documents.housekeeping",
    cron: "40 3 * * *",
    lockTtlMs: 60 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await housekeepingAllTenants(depsOf(tenantDb, logger), systemDb);
      const sum = (pick: (r: (typeof report.succeeded)[number]["result"]) => number): number => report.succeeded.reduce((n, s) => n + pick(s.result), 0);
      logger.info(
        { tenants: report.succeeded.length, failed: report.failed.length, documentsPurged: sum((r) => r.documentsPurged), versionsPurged: sum((r) => r.versionsPurged), quarantineDeleted: sum((r) => r.quarantineDeleted), skipped: sum((r) => r.failures) },
        "documents : entretien effectué",
      );
      for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "documents : échec de l'entretien");
      if (report.failed.length > 0) throw new Error(`documents.housekeeping : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
