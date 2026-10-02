/**
 * Jobs planifiés du module `finance` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `finance.mark-overdue-invoices`  quotidien (01:15, `WORKER_TZ`) : passe en OVERDUE les factures dont une
 *    échéance est échue, tenant par tenant (`markOverdueForAllTenants`), et publie `finance.invoice.overdue`
 *    UNE fois par transition (idempotent : sans changement de situation, un second passage ne publie rien).
 *    Un tenant en échec n'arrête pas les autres ; le job est alors signalé en échec.
 *    Aucun fournisseur de paiement ni port d'audit n'est nécessaire (le passage en retard n'audite pas).
 *
 *  - `finance.reconcile-pending-payments`  toutes les 2 minutes : RAPPROCHEMENT des paiements restés `PENDING` (webhook
 *    perdu, session abandonnée) et des remboursements `REFUND_PENDING` (réponse du fournisseur perdue) — voir
 *    `application/reconciliation.ts`. Il interroge le fournisseur (registre + coffre des secrets assemblés comme dans l'API
 *    par `createFinanceProviderRuntime`), après un délai configurable (`FINANCE_RECONCILIATION_*`), confirme / échoue selon
 *    la réponse avec les mêmes contrôles que le webhook, plafonne les tentatives et SIGNALE
 *    `finance.payment.reconciliation_needed` ce qui reste indéterminé. Idempotent, audité (même clé HMAC que l'API :
 *    `AUDIT_HMAC_KEY`), plusieurs instances sans doublon (bail en base), tenant par tenant.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { systemClock, type Logger } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { audit, configureAuditFromEnv } from "../audit";
import { createFinanceDeps, type FinanceDeps } from "./application/deps";
import { markOverdueForAllTenants } from "./application/jobs";
import { reconcileAllTenants } from "./application/reconciliation";
import { getFinanceWorkerResources } from "./application/worker-resources";
import { financeAuditAdapter } from "./infrastructure/audit-adapter";
import { createFinanceProviderRuntime, financeEnvironmentOf, reconciliationConfigFromEnv } from "./infrastructure/runtime";

let auditConfigured = false;
let cached: { db: TenantDb; resources: unknown; deps: FinanceDeps } | null = null;

/**
 * Dépendances du rapprochement : registre + coffre + configuration par tenant (assemblage de l'API), audit direct dans la
 * transaction du cas d'usage, alertes et compteurs branchés par la plateforme (facultatifs). Construites une fois par processus.
 */
function reconciliationDeps(tenantDb: TenantDb, logger: Logger): FinanceDeps {
  const resources = getFinanceWorkerResources();
  if (cached && cached.db === tenantDb && cached.resources === resources) return cached.deps;
  if (!auditConfigured) {
    configureAuditFromEnv(audit, process.env, { logger });
    auditConfigured = true;
  }
  const auditPort = financeAuditAdapter({ record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]) });
  const runtime = createFinanceProviderRuntime({ db: tenantDb, clock: systemClock, logger, env: process.env, audit: auditPort });
  const deps = createFinanceDeps({
    db: tenantDb,
    clock: systemClock,
    logger,
    audit: auditPort,
    providers: resources.providers ?? runtime.providers,
    secrets: runtime.secrets,
    ...(resources.alerts ? { alerts: resources.alerts } : {}),
    ...(resources.metrics ? { metrics: resources.metrics } : {}),
    config: { environment: financeEnvironmentOf(process.env), reconciliation: reconciliationConfigFromEnv(process.env) },
  });
  cached = { db: tenantDb, resources, deps };
  return deps;
}

export default [
  defineScheduledJob({
    name: "finance.mark-overdue-invoices",
    cron: "15 1 * * *",
    lockTtlMs: 15 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = createFinanceDeps({ db: tenantDb, logger });
      const report = await markOverdueForAllTenants(deps, systemDb);
      const processed = report.succeeded.reduce((n, s) => n + s.result.processed, 0);
      logger.info({ tenants: report.succeeded.length, failed: report.failed.length, invoicesMarkedOverdue: processed }, "finance : factures échues traitées");
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "finance : échec du passage en retard");
      }
      if (report.failed.length > 0) throw new Error(`finance.mark-overdue-invoices : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
  defineScheduledJob({
    name: "finance.reconcile-pending-payments",
    cron: "*/2 * * * *",
    lockTtlMs: 10 * 60_000,
    handler: async ({ systemDb, tenantDb, logger }) => {
      const deps = reconciliationDeps(tenantDb, logger);
      const report = await reconcileAllTenants(deps, systemDb);
      const settled = report.payments.confirmed + report.payments.failed + report.refunds.confirmed + report.refunds.failed;
      // Trace seulement quand il s'est passé quelque chose (le job tourne toutes les 2 minutes).
      if (report.payments.examined + report.refunds.examined > 0 || report.failed.length > 0) {
        logger.info(
          { tenants: report.tenants, payments: report.payments, refunds: report.refunds, concluded: settled, failedTenants: report.failed.length },
          "finance : rapprochement des paiements en attente",
        );
      }
      for (const f of report.failed) {
        logger.error({ tenantId: f.tenantId, err: f.error instanceof Error ? f.error.message : String(f.error) }, "finance : échec du rapprochement d'un tenant");
      }
      if (report.failed.length > 0) throw new Error(`finance.reconcile-pending-payments : ${report.failed.length} tenant(s) en échec.`);
    },
  }),
];
