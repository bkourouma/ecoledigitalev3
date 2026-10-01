/**
 * Réactions du module payroll aux événements des autres modules (abonnés du worker) et tâches périodiques.
 * Tous sont IDEMPOTENTS par construction : un rejeu ne change rien (réglages déjà là, alerte à identifiant
 * déterministe, période déjà clôturée). ⚠ Les noms et charges des événements des autres modules sont des
 * hypothèses de travail (`occurrenceId`, `academicYearId`/`yearId`), comme dans scheduling.
 */
import { createHash } from "node:crypto";
import { createDomainEvent, createSystemContext, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { PgOutboxWriter } from "@ecoledigitale/database";
import { PayrollEvents } from "../domain/events";
import * as repo from "../infrastructure/payslip-repo";
import * as setup from "../infrastructure/setup-repo";
import { inTx, type PayrollDeps } from "./deps";

export interface ConsumeReport {
  readonly affected: number;
  readonly ignored?: string;
}

const ignored = (reason: string): Result<ConsumeReport, AppError> => ok({ affected: 0, ignored: reason });

/** Identifiant déterministe (forme UUID) dérivé d'un identifiant d'événement : un rejeu ne duplique pas l'alerte. */
export function derivedEventId(sourceEventId: string, purpose: string): string {
  const h = createHash("sha1").update(`${sourceEventId}:${purpose}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** `tenancy.tenant.provisioned` : crée les réglages de paie (valeurs par défaut de la migration). */
export async function onTenantProvisioned(deps: PayrollDeps, tenantId: string): Promise<Result<ConsumeReport, AppError>> {
  const ctx = createSystemContext(tenantId);
  return inTx(deps, ctx, async (tx) => {
    await setup.ensureSettings(tx, tenantId);
    return ok({ affected: 1 });
  });
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * `scheduling.occurrence.cancelled|unvalidated|rescheduled|paid_minutes_changed` : si la séance est PORTÉE par un
 * bulletin, la paie ne réécrit rien (le bulletin arrêté est opposable) mais ALERTE la gestion par
 * `payroll.claim.source_changed`. Une séance non réclamée ne concerne pas la paie (elle sera lue au prochain calcul).
 */
export async function onSessionSourceChanged(deps: PayrollDeps, tenantId: string, eventId: string, eventType: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const occurrenceId = str((payload as { occurrenceId?: unknown } | null)?.occurrenceId);
  if (!occurrenceId) return ignored("charge sans occurrenceId");
  const ctx = createSystemContext(tenantId);
  return inTx(deps, ctx, async (tx) => {
    const claims = await tx.many<{ payslip_id: string; staff_id: string; status: string }>(
      `SELECT c.payslip_id, c.staff_id, p.status FROM payroll.hour_claims c JOIN payroll.payslips p ON p.id = c.payslip_id AND p.tenant_id = c.tenant_id
        WHERE c.source_kind = 'SESSION' AND c.source_ref_id = $1`,
      [occurrenceId],
    );
    if (claims.length === 0) return ok({ affected: 0, ignored: "séance non réclamée" });
    const event = createDomainEvent({
      id: derivedEventId(eventId, "payroll.claim.source_changed"),
      type: PayrollEvents.claimSourceChanged,
      ctx,
      clock: deps.clock,
      aggregateType: "payslip",
      aggregateId: claims[0]?.payslip_id as string,
      payload: {
        v: 1,
        sourceKind: "SESSION",
        sourceRefId: occurrenceId,
        sourceEvent: eventType,
        payslips: claims.map((c) => ({ payslipId: c.payslip_id, staffId: c.staff_id, status: c.status })),
      },
    });
    // idempotence : l'identifiant déterministe est la clé primaire de l'outbox
    const exists = await tx.queryOne("SELECT 1 AS x FROM kernel.domain_events WHERE id = $1", [event.id]);
    if (!exists) await new PgOutboxWriter(tx).append([event]);
    return ok({ affected: exists ? 0 : claims.length });
  });
}

/** `academic.year.closed` : clôt les périodes ACTIVES de l'année (plus de nouveau calcul ; les bulletins restent). */
export async function onYearClosed(deps: PayrollDeps, tenantId: string, payload: unknown): Promise<Result<ConsumeReport, AppError>> {
  const p = payload as { academicYearId?: unknown; yearId?: unknown } | null;
  const yearId = str(p?.academicYearId) ?? str(p?.yearId);
  if (!yearId) return ignored("charge sans identifiant d'année");
  const ctx = createSystemContext(tenantId);
  return inTx(deps, ctx, async (tx) => {
    const { items } = await setup.listPeriods(tx, { academicYearId: yearId, status: "ACTIVE", limit: 500, offset: 0 });
    const now = deps.clock.now();
    for (const period of items) {
      await setup.updatePeriod(tx, period.id, { status: "CLOSED" }, now);
      await new PgOutboxWriter(tx).append([
        createDomainEvent({ type: PayrollEvents.periodClosed, ctx, clock: deps.clock, id: deps.newId(), aggregateType: "pay_period", aggregateId: period.id, payload: { v: 1, periodId: period.id, reason: "academic_year_closed" } }),
      ]);
    }
    return ok({ affected: items.length });
  });
}

/** Tâche périodique : abandonne les calculs « morts » (processus interrompu) pour libérer leur verrou fonctionnel. */
export async function failStaleRunsForTenant(deps: PayrollDeps, tenantId: string, olderThanMs: number): Promise<Result<ConsumeReport, AppError>> {
  const ctx = createSystemContext(tenantId);
  return inTx(deps, ctx, async (tx) => {
    const now = deps.clock.now();
    const rows = await tx.many<{ period_id: string }>("SELECT DISTINCT period_id FROM payroll.calculation_runs WHERE status = 'RUNNING' AND NOT dry_run");
    let affected = 0;
    for (const r of rows) affected += await repo.failStaleRuns(tx, r.period_id, new Date(now.getTime() - olderThanMs), now);
    return ok({ affected });
  });
}
