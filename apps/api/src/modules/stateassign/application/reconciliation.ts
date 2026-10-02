/**
 * Rapprochement d'un dossier avec la facturation et les versements de l'État (`finance`, par le port `FinancePort`).
 *
 *  1. Montants FACTURÉS lus chez `finance` : part de l'État (factures du financeur « État ») et part de la famille (factures du
 *     payeur « apprenant » : elles ne portent QUE la part parent, jamais celle de l'État) — nets d'avoirs ;
 *  2. écarts = facturé − déclaré, par part ; le STATUT (`BALANCED` / `DISCREPANCY`) est calculé par la BASE avec la tolérance de
 *     l'établissement : ce module n'écrit que les écarts et la date ;
 *  3. versements reçus de l'État (imputations nettes sur les factures du financeur) affectés aux échéances dans l'ordre : le montant
 *     reçu de chaque échéance est écrit, son statut est calculé par la base ; le surplus est « non affecté » ;
 *  4. un écart publie `stateassign.reconciliation.discrepancy` ; une échéance soldée publie `stateassign.receivable.received`.
 *
 * Aucune écriture dans `finance` : les créances, reçus et paiements restent ceux de `finance` (R-A6). Le rapprochement n'est jamais
 * une décision : il calcule, un humain tranche.
 */
import { err, ok, type AppError, type RequestContext, type Result, Money } from "@ecoledigitale/kernel";
import type { ReconcileAssignmentResult } from "@ecoledigitale/contracts/src/v2/stateassign";
import { StateassignCode, conflict, notFound } from "../domain/errors";
import { StateassignEvents } from "../domain/events";
import { allocateReceived, reconcile, sumMoney, zeroOf } from "../domain/reconciliation";
import type { AssignmentRecord, Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import * as recRepo from "../infrastructure/receivables-repository";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { createSystemContext } from "@ecoledigitale/kernel";
import { inTx, requireHuman, todayOf, EventBuffer, type StateassignDeps } from "./deps";
import type { StateFundingBilling } from "./ports";
import { assignmentDto, moneyDto, receivableDto } from "./presenters";
import { assignmentPayload, loadAssignmentInScope, namesOf, receivablePayload } from "./support";
import { abidjanDate } from "@ecoledigitale/kernel";

const RECONCILABLE = ["VERIFIED", "ACTIVE", "SUSPENDED", "ENDED", "TRANSFERRED"] as const;

const net = (m: Money, credited: Money): Money => m.subtract(credited);

/** Facturé net d'avoirs, par part. */
export function billedOf(billing: StateFundingBilling): { state: Money; parent: Money; statePaid: Money } {
  const cur = billing.currency;
  return {
    state: sumMoney(billing.stateInvoices.map((i) => net(i.total, i.credited)), cur),
    parent: sumMoney(billing.parentInvoices.map((i) => net(i.total, i.credited)), cur),
    statePaid: sumMoney(billing.stateInvoices.map((i) => i.paid), cur),
  };
}

export interface ReconcileOptions {
  /** `true` : écrit même si rien n'a changé depuis le dernier rapprochement du jour (action explicite d'un humain). */
  readonly force?: boolean;
}

/** Cœur du rapprochement, dans la transaction de l'appelant. `dossier` doit être verrouillé (FOR UPDATE). */
export async function reconcileInTx(
  deps: StateassignDeps,
  ctx: RequestContext,
  tx: Parameters<Parameters<typeof inTx>[2]>[0],
  a: AssignmentRecord,
  options: ReconcileOptions = {},
): Promise<Result<ReconcileAssignmentResult & { changed: boolean }, AppError>> {
  if (!(RECONCILABLE as readonly string[]).includes(a.status)) {
    return err(conflict(StateassignCode.TRANSITION_INVALID, `Un dossier ${a.status} ne se rapproche pas : il doit d'abord être vérifié (acte humain).`));
  }
  const settings = await repo.getSettings(tx, a.institutionId);
  const asOf = todayOf(deps);

  const billing = await deps.ports.finance.getStateFundingBilling(ctx, {
    studentId: a.studentId,
    enrollmentId: a.enrollmentId,
    academicYearId: a.academicYearId,
    scholarshipId: a.scholarshipId,
  });
  const warnings: string[] = [];
  const billed = billedOf(billing);
  const declared = { state: a.declaredState, parent: a.declaredParent };
  const outcome = reconcile(declared, { state: billed.state, parent: billed.parent }, settings.reconciliationTolerance);

  const scholarshipId = a.scholarshipId ?? (billing.scholarshipIds.length === 1 ? billing.scholarshipIds[0]! : null);
  if (!a.scholarshipId && billing.scholarshipIds.length > 1) warnings.push("Plusieurs bourses de l'État sont actives pour cet élève : aucun lien de bourse n'est posé.");
  const stateInvoiceId = billing.stateInvoices.length === 1 ? billing.stateInvoices[0]!.invoiceId : null;
  const parentInvoiceId = billing.parentInvoices.length === 1 ? billing.parentInvoices[0]!.invoiceId : null;
  if (billing.stateInvoices.length > 1) warnings.push("Plusieurs factures de l'État : le lien de facture n'est pas posé, les montants sont additionnés.");
  if (billing.parentInvoices.length > 1) warnings.push("Plusieurs factures de la famille : le lien de facture n'est pas posé, les montants sont additionnés.");
  if (billing.stateInvoices.length === 0) warnings.push("Aucune facture de l'État n'est liée : l'écart est le montant déclaré.");

  const sameLinks = a.scholarshipId === scholarshipId && a.stateInvoiceId === stateInvoiceId && a.parentInvoiceId === parentInvoiceId;
  const sameDeltas =
    a.stateDelta !== null && a.parentDelta !== null && a.stateDelta.amount === outcome.stateDelta.amount && a.parentDelta.amount === outcome.parentDelta.amount;
  const reconciledToday = a.lastReconciledAt !== null && abidjanDate(a.lastReconciledAt) === asOf;
  const skipWrite = options.force !== true && sameLinks && sameDeltas && reconciledToday;

  let updated = a;
  if (!skipWrite) {
    updated = await repo.writeReconciliation(tx, a.id, { stateDelta: outcome.stateDelta, parentDelta: outcome.parentDelta, scholarshipId, stateInvoiceId, parentInvoiceId, at: deps.clock.now() });
  }

  // Versements de l'État -> échéances, dans l'ordre.
  const rows = await recRepo.listReceivablesOfEnrollment(tx, a.enrollmentId);
  const schedule = rows.map((r) => ({ id: r.receivable.id, dueOn: r.receivable.dueOn, seq: r.receivable.seq, expected: r.receivable.expected, cancelled: r.receivable.status === "CANCELLED" }));
  const allocation = allocateReceived(schedule, billed.statePaid);
  const events = new EventBuffer(deps, ctx);
  let receivablesChanged = 0;
  for (const alloc of allocation.allocations) {
    const row = rows.find((r) => r.receivable.id === alloc.id)!;
    if (row.receivable.status === "CANCELLED") continue;
    if (alloc.received.amount === row.receivable.received.amount && row.receivable.lastReconciledAt !== null) continue;
    const wasSettled = row.receivable.status === "RECEIVED";
    await recRepo.applyReceived(tx, alloc.id, alloc.received, deps.clock.now());
    if (alloc.received.amount !== row.receivable.received.amount) receivablesChanged += 1;
    const fresh = (await recRepo.getReceivable(tx, alloc.id))!.receivable;
    if (!wasSettled && fresh.status === "RECEIVED") events.add(StateassignEvents.RECEIVABLE_RECEIVED, receivablePayload(fresh, 0), { type: "stateassign.receivable", id: fresh.id });
  }

  const changed = !skipWrite && (!sameDeltas || !sameLinks || updated.reconciliationStatus !== a.reconciliationStatus) ? true : receivablesChanged > 0;
  if (changed || options.force === true) {
    if (updated.reconciliationStatus === "DISCREPANCY" && (a.reconciliationStatus !== "DISCREPANCY" || !sameDeltas)) {
      events.add(
        StateassignEvents.RECONCILIATION_DISCREPANCY,
        { ...assignmentPayload(updated, null), status: "DISCREPANCY", stateDelta: moneyDto(outcome.stateDelta), parentDelta: moneyDto(outcome.parentDelta) },
        { type: "stateassign.assignment", id: a.id },
      );
    }
    events.audit({
      action: "stateassign.assignment.reconciled",
      resourceType: "assignment",
      resourceId: a.id,
      before: { status: a.reconciliationStatus, stateDelta: a.stateDelta?.amount ?? null, parentDelta: a.parentDelta?.amount ?? null },
      after: { status: updated.reconciliationStatus, stateDelta: outcome.stateDelta.amount, parentDelta: outcome.parentDelta.amount },
      metadata: { stateBilled: billed.state.amount, parentBilled: billed.parent.amount, statePaid: billed.statePaid.amount, receivablesChanged, byUser: ctx.actor === "user" },
    });
  }
  await events.flush(tx);

  const finalRows = await recRepo.listReceivablesOfEnrollment(tx, a.enrollmentId);
  const names = await namesOf(deps, ctx, [a.studentId]);
  const name = names.get(a.studentId) ?? null;
  const dto = (m: Money) => moneyDto(m);
  return ok({
    changed,
    assignment: assignmentDto(updated, name),
    billing: {
      currency: billing.currency,
      stateInvoices: billing.stateInvoices.map((i) => ({ invoiceId: i.invoiceId, number: i.number, status: i.status, total: dto(i.total), paid: dto(i.paid), credited: dto(i.credited), dueDate: i.dueDate, scholarshipId: i.scholarshipId })),
      parentInvoices: billing.parentInvoices.map((i) => ({ invoiceId: i.invoiceId, number: i.number, status: i.status, total: dto(i.total), paid: dto(i.paid), credited: dto(i.credited), dueDate: i.dueDate })),
      statePayments: billing.statePayments.map((p) => ({ paymentId: p.paymentId, receivedAt: p.receivedAt.toISOString(), amount: dto(p.amount), allocated: dto(p.allocated), reference: p.reference })),
      scholarshipIds: [...billing.scholarshipIds],
    },
    receivables: finalRows.map((r) => receivableDto(r.receivable, { asOf, graceDays: r.graceDays, studentName: name, assignmentReference: r.assignmentReference })),
    unallocated: moneyDto(allocation.unallocated),
    linkedScholarship: scholarshipId !== null,
    warnings,
  });
}

/** Rapprochement demandé (humain : `stateassign.reconcile`) ou lancé par un événement / job (contexte système). */
export async function reconcileAssignment(
  deps: StateassignDeps,
  ctx: RequestContext,
  id: Uuid,
  options: ReconcileOptions = {},
): Promise<Result<ReconcileAssignmentResult, AppError>> {
  const r = await inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssignmentInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    return reconcileInTx(deps, ctx, tx, loaded.value, options);
  });
  if (!r.ok) return r;
  const { changed: _changed, ...result } = r.value;
  return ok(result);
}

/** Rapproche le dossier d'une inscription par son identifiant d'inscription (abonné `finance.*`). `null` : aucun dossier à rapprocher. */
export async function reconcileEnrollment(deps: StateassignDeps, ctx: RequestContext, enrollmentId: Uuid): Promise<Result<{ reconciled: boolean }, AppError>> {
  return inTx<{ reconciled: boolean }>(deps, ctx, async (tx) => {
    const current = await repo.getCurrentAssignmentOfEnrollment(tx, enrollmentId);
    if (!current) return ok({ reconciled: false });
    const locked = await repo.getAssignment(tx, current.id, { forUpdate: true });
    if (!locked) return ok({ reconciled: false });
    const r = await reconcileInTx(deps, ctx, tx, locked);
    if (!r.ok) return r;
    return ok({ reconciled: true });
  });
}

/** Rapproche l'élève (abonné `finance.payment.completed` : la charge porte l'élève, pas l'inscription). */
export async function reconcileStudent(deps: StateassignDeps, ctx: RequestContext, studentId: Uuid): Promise<Result<{ reconciled: number }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const page = await repo.listAssignments(tx, { studentId, includeHistory: false, limit: 20, offset: 0 });
    let n = 0;
    for (const a of page.items) {
      if (!(RECONCILABLE as readonly string[]).includes(a.status)) continue;
      const locked = await repo.getAssignment(tx, a.id, { forUpdate: true });
      if (!locked) continue;
      const r = await reconcileInTx(deps, ctx, tx, locked);
      if (!r.ok) return r;
      n += 1;
    }
    return ok({ reconciled: n });
  });
}

export interface ReconcileTenantReport {
  readonly examined: number;
  readonly reconciled: number;
  readonly failed: number;
}

/** Job : rapproche, tenant par tenant, les dossiers à suivre (vérifiés ou après, ou une échéance encore ouverte). Un dossier en échec n'arrête pas les autres. */
export async function reconcileTenant(deps: StateassignDeps, ctx: RequestContext): Promise<ReconcileTenantReport> {
  let after: string | null = null;
  let examined = 0;
  let reconciled = 0;
  let failed = 0;
  for (;;) {
    const batch = await deps.db.run(ctx, (tx) => repo.listAssignmentsToReconcile(tx, deps.config.jobBatchSize, after), { readOnly: true });
    if (batch.length === 0) break;
    for (const a of batch) {
      examined += 1;
      try {
        const r = await reconcileAssignment(deps, ctx, a.id);
        if (r.ok) reconciled += 1;
        else {
          failed += 1;
          deps.logger.warn({ assignmentId: a.id, code: r.error.code }, "stateassign : rapprochement refusé");
        }
      } catch (e) {
        failed += 1;
        deps.logger.warn({ assignmentId: a.id, err: e instanceof Error ? e.message : String(e) }, "stateassign : rapprochement en échec");
      }
    }
    after = batch[batch.length - 1]!.id;
    if (batch.length < deps.config.jobBatchSize) break;
  }
  return { examined, reconciled, failed };
}

export function reconcileAllTenants(deps: StateassignDeps, systemDb: SystemDb): Promise<ForEachTenantReport<ReconcileTenantReport>> {
  return systemDb.forEachTenant("stateassign-reconcile", async (_tx, tenant) => reconcileTenant(deps, createSystemContext(tenant.id)));
}

export { requireHuman, notFound, zeroOf };
