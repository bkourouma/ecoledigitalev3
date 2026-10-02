/**
 * Jobs planifiés du module `stateassign` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement ; fuseau `WORKER_TZ`).
 *
 *  - `stateassign.reconcile`           nocturne (01:40) : rapproche, tenant par tenant, les dossiers à suivre (écarts facturé −
 *    déclaré, statut calculé par la base, versements de l'État affectés aux échéances). Un dossier en échec n'arrête pas les autres.
 *  - `stateassign.flag-overdue`        quotidien (07:20) : signale UNE fois chaque échéance passée en retard (`stateassign.receivable.overdue`).
 *  - `stateassign.plan-controls`       quotidien (06:20) : planifie les contrôles exigés par les réglages de l'établissement (RIEN par
 *    défaut) ; l'application planifie, un humain réalise.
 *  - `stateassign.notify-due-controls` quotidien (07:25) : publie UNE fois `stateassign.control.due` par contrôle arrivé à échéance.
 *
 * Tous idempotents, rejouables. Les ports viennent de `setStateassignWorkerPorts` (branché par `installWorkerAdapters`) ; un port absent
 * fait échouer FERMÉ le job concerné (le planificateur le signale), jamais d'hypothèse.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import type { Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { audit, configureAuditFromEnv } from "../audit";
import { createStateassignDeps, type StateassignDeps } from "./application/deps";
import { stateassignWorkerPorts } from "./application/port-registry";
import { notifyDueControlsAllTenants, planControlsAllTenants } from "./application/controls";
import { reconcileAllTenants } from "./application/reconciliation";
import { flagOverdueAllTenants } from "./application/receivables";
import { stateassignAuditAdapter } from "./infrastructure/audit-adapter";

let auditConfigured = false;

function depsOf(tenantDb: TenantDb, logger: Logger): StateassignDeps {
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger });
    auditConfigured = true;
  }
  return createStateassignDeps({
    db: tenantDb,
    logger,
    portsProvider: stateassignWorkerPorts,
    audit: stateassignAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) }),
  });
}

function summarize<T>(name: string, logger: Logger, report: { succeeded: ReadonlyArray<{ result: T }>; failed: ReadonlyArray<{ tenantId: string; error: unknown }> }): void {
  for (const f of report.failed) logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, `${name} : échec`);
  if (report.failed.length > 0) throw new Error(`${name} : ${report.failed.length} tenant(s) en échec.`);
}

export default [
  defineScheduledJob({
    name: "stateassign.reconcile",
    cron: "40 1 * * *",
    lockTtlMs: 60 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await reconcileAllTenants(depsOf(tenantDb, logger), systemDb);
      const sum = (pick: (r: (typeof report.succeeded)[number]["result"]) => number): number => report.succeeded.reduce((n, s) => n + pick(s.result), 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, examined: sum((r) => r.examined), reconciled: sum((r) => r.reconciled), skipped: sum((r) => r.failed) }, "stateassign : rapprochement nocturne");
      summarize("stateassign.reconcile", logger, report);
    },
  }),
  defineScheduledJob({
    name: "stateassign.flag-overdue",
    cron: "20 7 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await flagOverdueAllTenants(depsOf(tenantDb, logger), systemDb);
      logger.info({ tenants: report.succeeded.length, flagged: report.succeeded.reduce((n, s) => n + s.result.flagged, 0) }, "stateassign : créances en retard signalées");
      summarize("stateassign.flag-overdue", logger, report);
    },
  }),
  defineScheduledJob({
    name: "stateassign.plan-controls",
    cron: "20 6 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await planControlsAllTenants(depsOf(tenantDb, logger), systemDb);
      logger.info({ tenants: report.succeeded.length, planned: report.succeeded.reduce((n, s) => n + s.result.planned, 0) }, "stateassign : contrôles planifiés");
      summarize("stateassign.plan-controls", logger, report);
    },
  }),
  defineScheduledJob({
    name: "stateassign.notify-due-controls",
    cron: "25 7 * * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const report = await notifyDueControlsAllTenants(depsOf(tenantDb, logger), systemDb);
      logger.info({ tenants: report.succeeded.length, notified: report.succeeded.reduce((n, s) => n + s.result.notified, 0) }, "stateassign : contrôles à échéance signalés");
      summarize("stateassign.notify-due-controls", logger, report);
    },
  }),
];
