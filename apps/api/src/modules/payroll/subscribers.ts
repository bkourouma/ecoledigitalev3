/**
 * Abonnés du module `payroll` pour `apps/worker` (`modules/<key>/subscribers.ts`, découverts automatiquement).
 *
 *  - `payroll.seed-settings`              `tenancy.tenant.provisioned` → réglages de paie du tenant (valeurs par défaut).
 *  - `payroll.flag-claim-source-changed.*` `scheduling.occurrence.cancelled|unvalidated|rescheduled|paid_minutes_changed`
 *                                         → si la séance est portée par un bulletin : alerte `payroll.claim.source_changed`
 *                                         (jamais de réécriture d'un bulletin arrêté).
 *  - `payroll.close-periods-on-year-closed` `academic.year.closed` → périodes actives de l'année clôturées.
 *
 * Idempotence par CONSTRUCTION (voir `application/consumers.ts`) : un rejeu ne change rien. Un échec est relancé par
 * le worker (reprises puis dead-letter). ⚠ Les noms et charges des événements des autres modules sont des hypothèses
 * de travail (`occurrenceId`, `academicYearId`).
 */
import { defineSubscriber } from "@ecoledigitale/worker/sdk";
import type { AppError, Result } from "@ecoledigitale/kernel";
import { onSessionSourceChanged, onTenantProvisioned, onYearClosed, type ConsumeReport } from "./application/consumers";
import { createPayrollDeps } from "./application/deps";
import { ConsumedEvents } from "./domain/events";

function report(result: Result<ConsumeReport, AppError>, log: { info: (o: Record<string, unknown>, m?: string) => void }, eventType: string): void {
  if (!result.ok) throw result.error;
  if (result.value.ignored) log.info({ eventType, reason: result.value.ignored }, "payroll : événement ignoré");
  else log.info({ eventType, affected: result.value.affected }, "payroll : événement traité");
}

const retry = { attempts: 6, backoffMs: 1_000, maxBackoffMs: 120_000 } as const;

const sourceChange = (name: string, pattern: string) =>
  defineSubscriber({
    name,
    pattern,
    retry,
    concurrency: 4,
    handler: async (event, ctx) => {
      const deps = createPayrollDeps({ db: ctx.tenantDb, logger: ctx.logger });
      report(await onSessionSourceChanged(deps, ctx.tenantId, event.id, event.type, event.payload), ctx.logger, event.type);
    },
  });

export default [
  defineSubscriber({
    name: "payroll.seed-settings",
    pattern: ConsumedEvents.tenantProvisioned,
    retry,
    concurrency: 4,
    handler: async (event, ctx) => {
      const deps = createPayrollDeps({ db: ctx.tenantDb, logger: ctx.logger });
      report(await onTenantProvisioned(deps, ctx.tenantId), ctx.logger, event.type);
    },
  }),
  sourceChange("payroll.flag-claim-source-changed.cancelled", ConsumedEvents.occurrenceCancelled),
  sourceChange("payroll.flag-claim-source-changed.unvalidated", ConsumedEvents.occurrenceUnvalidated),
  sourceChange("payroll.flag-claim-source-changed.rescheduled", ConsumedEvents.occurrenceRescheduled),
  sourceChange("payroll.flag-claim-source-changed.paid-minutes", ConsumedEvents.occurrencePaidMinutesChanged),
  defineSubscriber({
    name: "payroll.close-periods-on-year-closed",
    pattern: ConsumedEvents.yearClosed,
    retry,
    concurrency: 2,
    handler: async (event, ctx) => {
      const deps = createPayrollDeps({ db: ctx.tenantDb, logger: ctx.logger });
      report(await onYearClosed(deps, ctx.tenantId, event.payload), ctx.logger, event.type);
    },
  }),
];
