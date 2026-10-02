/**
 * Créances sur l'État : le CALENDRIER ATTENDU des versements (échéances) et son suivi — retards, ancienneté, historique.
 *
 * `finance` reste le grand livre (factures de l'État, paiements reçus) ; ici on ne stocke que ce que l'État DOIT verser et quand.
 * Le montant REÇU de chaque échéance est écrit par le rapprochement (`reconciliation.ts`) ; le STATUT est calculé par la base ;
 * le retard est dérivé à la date de lecture (échéance + jours de grâce de l'établissement). Planifier, reporter, annuler une
 * échéance sont des actes HUMAINS ; la somme des échéances ne dépasse jamais le montant déclaré à la charge de l'État.
 */
import { Money, err, ok, createSystemContext, type AppError, type RequestContext, type Result, type CurrencyCode } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import type {
  ReceivableDto,
  ReceivableListResponse,
  ReceivablesAgingResponse,
  ScheduleReceivableBody,
} from "@ecoledigitale/contracts/src/v2/stateassign";
import { StateassignCode, conflict, notFound, validation } from "../domain/errors";
import { StateassignEvents } from "../domain/events";
import { RECEIVABLE_AGING_BUCKETS } from "@ecoledigitale/contracts/src/v2/stateassign";
import { daysOverdue as daysOverdueOf } from "../domain/reconciliation";
import { isOperationalAssignment } from "../domain/assignment";
import type { Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import * as recRepo from "../infrastructure/receivables-repository";
import { EventBuffer, inTx, requireHuman, todayOf, type StateassignDeps } from "./deps";
import { moneyDto, receivableDto, receivableEventDto } from "./presenters";
import { inScope, loadAssignmentInScope, namesOf, receivablePayload, reasonOf, reasonRequired, versionConflict } from "./support";

async function loadReceivableInScope(tx: Parameters<typeof repo.getSettings>[0], ctx: RequestContext, id: Uuid, forUpdate = false): Promise<Result<recRepo.ReceivableRow, AppError>> {
  const row = await recRepo.getReceivable(tx, id, { forUpdate });
  if (!row || !inScope(ctx, row.receivable.institutionId)) return err(notFound(StateassignCode.RECEIVABLE_NOT_FOUND, "Échéance", id));
  return ok(row);
}

export async function scheduleReceivable(deps: StateassignDeps, ctx: RequestContext, assignmentId: Uuid, body: ScheduleReceivableBody): Promise<Result<ReceivableDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const asOf = todayOf(deps);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssignmentInScope(tx, ctx, assignmentId, true);
    if (!loaded.ok) return loaded;
    const a = loaded.value;
    if (!isOperationalAssignment(a.status)) {
      return err(conflict(StateassignCode.RECEIVABLE_STATE, `Une échéance se planifie sur un dossier vérifié, actif ou suspendu (dossier ${a.status}).`));
    }
    const created = await recRepo.insertReceivable(tx, ctx.tenantId, {
      id: deps.newId(),
      assignmentId: a.id,
      institutionId: a.institutionId,
      academicYearId: a.academicYearId,
      enrollmentId: a.enrollmentId,
      studentId: a.studentId,
      label: body.label.trim(),
      dueOn: body.dueOn,
      expected: Money.of(body.expectedAmount, a.currency as CurrencyCode),
      createdBy: h.value,
    });
    const events = new EventBuffer(deps, ctx);
    events.add(StateassignEvents.RECEIVABLE_SCHEDULED, receivablePayload(created, 0), { type: "stateassign.receivable", id: created.id });
    events.audit({
      action: "stateassign.receivable.scheduled",
      resourceType: "receivable",
      resourceId: created.id,
      after: { seq: created.seq, dueOn: created.dueOn, expected: created.expected.amount },
      metadata: { assignmentId: a.id, enrollmentId: a.enrollmentId },
    });
    await events.flush(tx);
    const row = (await recRepo.getReceivable(tx, created.id))!;
    return ok(receivableDto(row.receivable, { asOf, graceDays: row.graceDays, studentName: null, assignmentReference: row.assignmentReference }));
  });
}

export async function updateReceivable(
  deps: StateassignDeps,
  ctx: RequestContext,
  id: Uuid,
  body: { label?: string | undefined; dueOn?: string | undefined; expectedAmount?: number | undefined; rowVersion: number },
): Promise<Result<ReceivableDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const asOf = todayOf(deps);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadReceivableInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    const cur = loaded.value.receivable;
    if (cur.status === "CANCELLED") return err(conflict(StateassignCode.RECEIVABLE_STATE, "L'échéance est annulée : elle ne se modifie plus."));
    const ok1 = await recRepo.patchReceivable(
      tx,
      id,
      {
        ...(body.label !== undefined ? { label: body.label.trim() } : {}),
        ...(body.dueOn !== undefined ? { dueOn: body.dueOn } : {}),
        ...(body.expectedAmount !== undefined ? { expected: Money.of(body.expectedAmount, cur.expected.currency) } : {}),
      },
      body.rowVersion,
    );
    if (!ok1) return err(versionConflict());
    const row = (await recRepo.getReceivable(tx, id))!;
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "stateassign.receivable.updated",
      resourceType: "receivable",
      resourceId: id,
      before: { dueOn: cur.dueOn, expected: cur.expected.amount, label: cur.label },
      after: { dueOn: row.receivable.dueOn, expected: row.receivable.expected.amount, label: row.receivable.label },
    });
    await events.flush(tx);
    return ok(receivableDto(row.receivable, { asOf, graceDays: row.graceDays, studentName: null, assignmentReference: row.assignmentReference }));
  });
}

export async function cancelReceivable(deps: StateassignDeps, ctx: RequestContext, id: Uuid, body: { reason: string; rowVersion: number }): Promise<Result<ReceivableDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const reason = reasonOf(body.reason);
  if (!reason) return err(reasonRequired());
  const asOf = todayOf(deps);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadReceivableInScope(tx, ctx, id, true);
    if (!loaded.ok) return loaded;
    if (loaded.value.receivable.status === "CANCELLED") return err(conflict(StateassignCode.RECEIVABLE_STATE, "L'échéance est déjà annulée."));
    const done = await recRepo.cancelReceivable(tx, id, reason, body.rowVersion);
    if (!done) return err(versionConflict());
    const row = (await recRepo.getReceivable(tx, id))!;
    const events = new EventBuffer(deps, ctx);
    events.add(StateassignEvents.RECEIVABLE_CANCELLED, receivablePayload(row.receivable, 0), { type: "stateassign.receivable", id });
    events.audit({ action: "stateassign.receivable.cancelled", resourceType: "receivable", resourceId: id, sensitive: true, reason, after: { status: "CANCELLED" } });
    await events.flush(tx);
    return ok(receivableDto(row.receivable, { asOf, graceDays: row.graceDays, studentName: null, assignmentReference: row.assignmentReference }));
  });
}

export async function listReceivablePage(
  deps: StateassignDeps,
  ctx: RequestContext,
  query: {
    institutionId?: Uuid | undefined;
    academicYearId?: Uuid | undefined;
    studentId?: Uuid | undefined;
    assignmentId?: Uuid | undefined;
    status?: "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED" | undefined;
    overdueOnly?: "true" | "false" | undefined;
    dueFrom?: string | undefined;
    dueTo?: string | undefined;
    page: number;
    pageSize: number;
  },
): Promise<Result<ReceivableListResponse, AppError>> {
  const asOf = todayOf(deps);
  if (ctx.institutionId && query.institutionId && query.institutionId !== ctx.institutionId) return ok({ items: [], total: 0, page: query.page, pageSize: query.pageSize, asOf });
  const r = await inTx(
    deps,
    ctx,
    async (tx) =>
      ok(
        await recRepo.listReceivables(tx, {
          institutionId: ctx.institutionId ?? query.institutionId,
          academicYearId: query.academicYearId,
          studentId: query.studentId,
          assignmentId: query.assignmentId,
          status: query.status,
          overdueOnly: query.overdueOnly === "true",
          dueFrom: query.dueFrom,
          dueTo: query.dueTo,
          asOf,
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        }),
      ),
    { readOnly: true },
  );
  if (!r.ok) return r;
  const names = await namesOf(deps, ctx, r.value.items.map((x) => x.receivable.studentId));
  return ok({
    items: r.value.items.map((x) => receivableDto(x.receivable, { asOf, graceDays: x.graceDays, studentName: names.get(x.receivable.studentId) ?? null, assignmentReference: x.assignmentReference })),
    total: r.value.total,
    page: query.page,
    pageSize: query.pageSize,
    asOf,
  });
}

export async function getReceivableHistory(deps: StateassignDeps, ctx: RequestContext, id: Uuid) {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const loaded = await loadReceivableInScope(tx, ctx, id);
      if (!loaded.ok) return loaded;
      const events = await recRepo.listReceivableEvents(tx, [id], loaded.value.receivable.expected.currency);
      return ok({ items: events.map(receivableEventDto) });
    },
    { readOnly: true },
  );
}

export async function getReceivablesAging(deps: StateassignDeps, ctx: RequestContext, query: { institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined }): Promise<Result<ReceivablesAgingResponse, AppError>> {
  const asOf = todayOf(deps);
  if (ctx.institutionId && query.institutionId && query.institutionId !== ctx.institutionId) {
    const z = moneyDto(Money.zero());
    return ok({ asOf, currency: "XOF", buckets: RECEIVABLE_AGING_BUCKETS.map((bucket) => ({ bucket, count: 0, outstanding: z })), totals: { expected: z, received: z, outstanding: z, overdue: z, receivables: 0, overdueReceivables: 0 } });
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await recRepo.aging(tx, { institutionId: ctx.institutionId ?? query.institutionId, academicYearId: query.academicYearId, asOf });
      const cur = a.currency as CurrencyCode;
      const m = (n: number) => moneyDto(Money.of(n, cur));
      return ok({
        asOf,
        currency: a.currency,
        buckets: RECEIVABLE_AGING_BUCKETS.map((bucket) => {
          const row = a.rows.find((r) => r.bucket === bucket);
          return { bucket, count: row?.count ?? 0, outstanding: m(row?.outstanding ?? 0) };
        }),
        totals: { expected: m(a.totals.expected), received: m(a.totals.received), outstanding: m(a.totals.outstanding), overdue: m(a.totals.overdue), receivables: a.totals.receivables, overdueReceivables: a.totals.overdueReceivables },
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Job : alertes de retard
// ---------------------------------------------------------------------------

export interface OverdueSweepReport {
  readonly flagged: number;
}

/** Signale UNE fois chaque échéance passée en retard (`stateassign.receivable.overdue`) ; idempotent, rejouable. */
export async function flagOverdueReceivables(deps: StateassignDeps, ctx: RequestContext): Promise<OverdueSweepReport> {
  const asOf = todayOf(deps);
  let flagged = 0;
  for (;;) {
    const r = await inTx(deps, ctx, async (tx) => {
      const rows = await recRepo.listOverdueUnflagged(tx, asOf, deps.config.jobBatchSize);
      const events = new EventBuffer(deps, ctx);
      let n = 0;
      for (const row of rows) {
        if (!(await recRepo.flagOverdue(tx, row.receivable.id, deps.clock.now()))) continue;
        n += 1;
        events.add(StateassignEvents.RECEIVABLE_OVERDUE, receivablePayload(row.receivable, daysOverdueOf(row.receivable.dueOn, asOf, row.graceDays)), { type: "stateassign.receivable", id: row.receivable.id });
      }
      await events.flush(tx);
      return ok({ n, size: rows.length });
    });
    if (!r.ok) throw r.error;
    flagged += r.value.n;
    if (r.value.size < deps.config.jobBatchSize || r.value.n === 0) break;
  }
  return { flagged };
}

export function flagOverdueAllTenants(deps: StateassignDeps, systemDb: SystemDb): Promise<ForEachTenantReport<OverdueSweepReport>> {
  return systemDb.forEachTenant("stateassign-overdue", async (_tx, tenant) => flagOverdueReceivables(deps, createSystemContext(tenant.id)));
}

export { validation };
