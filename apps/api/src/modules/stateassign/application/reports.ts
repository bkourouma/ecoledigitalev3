/**
 * États pour la direction, l'économe et l'administration : tableau de bord, état de rapprochement, exports CSV (formats en
 * données) et passerelle (future, `NotConfigured` : aucun appel externe en V1).
 *
 * Les exports sont des LECTURES : un jeu de lignes cohérent (une requête), borné par `exportMaxRows` (au-delà : tronqué ET signalé),
 * des colonnes choisies par le format de l'établissement (ou le format neutre intégré), cellules texte neutralisées contre
 * l'injection de formule. Chaque export est audité.
 */
import { Money, err, ok, type AppError, type CurrencyCode, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type {
  CreateExportFormatBody,
  ExportCatalogResponse,
  ExportColumn,
  ExportDataset,
  ExportFormatDto,
  ExportMeta,
  ReconciliationReportResponse,
  StateGatewayStatusDto,
  StateassignSummaryResponse,
} from "@ecoledigitale/contracts/src/v2/stateassign";
import { billedFrom } from "../domain/assignment";
import { controlOverdue } from "../domain/controls";
import { StateassignCode, conflict, notFound, validation } from "../domain/errors";
import { EXPORT_CATALOG, toCsv, validateColumns, type ExportRow } from "../domain/export";
import { viewReceivable } from "../domain/reconciliation";
import type { Uuid } from "../domain/types";
import * as repo from "../infrastructure/repository";
import * as recRepo from "../infrastructure/receivables-repository";
import * as rep from "../infrastructure/reports-repository";
import { EventBuffer, inTx, requireHuman, todayOf, type StateassignDeps } from "./deps";
import { assignmentDto, exportFormatDto, moneyDto } from "./presenters";
import { inScope, namesOf } from "./support";

export async function getSummary(deps: StateassignDeps, ctx: RequestContext, query: { institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined }): Promise<Result<StateassignSummaryResponse, AppError>> {
  const today = todayOf(deps);
  const institutionId = ctx.institutionId ?? query.institutionId;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await rep.summary(tx, { institutionId, academicYearId: query.academicYearId, today });
      const a = await recRepo.aging(tx, { institutionId, academicYearId: query.academicYearId, asOf: today });
      const cur = (s.currency ?? a.currency) as CurrencyCode;
      const m = (n: number) => moneyDto(Money.of(n, cur));
      return ok({
        asOf: today,
        currency: cur,
        assignmentsByStatus: s.assignmentsByStatus,
        declaredState: m(s.declaredState),
        declaredParent: m(s.declaredParent),
        receivables: { expected: m(a.totals.expected), received: m(a.totals.received), outstanding: m(a.totals.outstanding), overdue: m(a.totals.overdue) },
        controls: s.controls,
        reconciliation: s.reconciliation,
      });
    },
    { readOnly: true },
  );
}

export async function getReconciliationReport(
  deps: StateassignDeps,
  ctx: RequestContext,
  query: { institutionId?: Uuid | undefined; academicYearId?: Uuid | undefined; reconciliationStatus?: "NEVER" | "BALANCED" | "DISCREPANCY" | undefined; page: number; pageSize: number },
): Promise<Result<ReconciliationReportResponse, AppError>> {
  const institutionId = ctx.institutionId ?? query.institutionId;
  const r = await inTx(
    deps,
    ctx,
    async (tx) => {
      const page = await repo.listAssignments(tx, {
        institutionId,
        academicYearId: query.academicYearId,
        status: undefined,
        reconciliationStatus: query.reconciliationStatus ?? "DISCREPANCY",
        includeHistory: false,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      const counts = await rep.reconciliationCounts(tx, { institutionId, academicYearId: query.academicYearId });
      return ok({ page, counts });
    },
    { readOnly: true },
  );
  if (!r.ok) return r;
  const names = await namesOf(deps, ctx, r.value.page.items.map((a) => a.studentId));
  return ok({
    items: r.value.page.items.map((a) => assignmentDto(a, names.get(a.studentId) ?? null)),
    total: r.value.page.total,
    page: query.page,
    pageSize: query.pageSize,
    counts: r.value.counts,
  });
}

// ---------------------------------------------------------------------------
// Formats d'export (données de l'établissement)
// ---------------------------------------------------------------------------

export function getExportCatalog(): ExportCatalogResponse {
  return {
    datasets: Object.values(EXPORT_CATALOG).map((d) => ({
      dataset: d.dataset,
      label: d.label,
      columns: d.columns.map((c) => ({ key: c.key, label: c.label })),
      standardColumns: d.standardColumns.map((c) => ({ key: c.key, header: c.header })),
    })),
  };
}

export async function listFormats(deps: StateassignDeps, ctx: RequestContext, query: { institutionId?: Uuid | undefined; dataset?: ExportDataset | undefined }): Promise<Result<{ items: ExportFormatDto[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => ok({ items: (await rep.listExportFormats(tx, { institutionId: ctx.institutionId ?? query.institutionId, dataset: query.dataset })).map(exportFormatDto) }), { readOnly: true });
}

export async function createFormat(deps: StateassignDeps, ctx: RequestContext, body: CreateExportFormatBody): Promise<Result<ExportFormatDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  if (!inScope(ctx, body.institutionId)) return err(notFound(StateassignCode.INSTITUTION_NOT_FOUND, "Établissement", body.institutionId));
  let columns: ExportColumn[];
  try {
    columns = validateColumns(body.dataset, body.columns);
  } catch (e) {
    return err(e as AppError);
  }
  return inTx(deps, ctx, async (tx) => {
    const created = await rep.insertExportFormat(tx, ctx.tenantId, { id: deps.newId(), institutionId: body.institutionId, code: body.code, label: body.label, dataset: body.dataset, columns, delimiter: body.delimiter, includeBom: body.includeBom });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "stateassign.export_format.created", resourceType: "export_format", resourceId: created.id, after: { code: created.code, dataset: created.dataset, columns: columns.map((c) => c.key) } });
    await events.flush(tx);
    return ok(exportFormatDto(created));
  });
}

export async function updateFormat(
  deps: StateassignDeps,
  ctx: RequestContext,
  id: Uuid,
  body: { label?: string | undefined; columns?: ExportColumn[] | undefined; delimiter?: ";" | "," | "\t" | undefined; includeBom?: boolean | undefined; active?: boolean | undefined },
): Promise<Result<ExportFormatDto, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  return inTx(deps, ctx, async (tx) => {
    const cur = await rep.getExportFormat(tx, id);
    if (!cur || !inScope(ctx, cur.institutionId)) return err(notFound(StateassignCode.EXPORT_FORMAT_NOT_FOUND, "Format d'export", id));
    let columns: ExportColumn[] | undefined;
    if (body.columns) {
      try {
        columns = validateColumns(cur.dataset, body.columns);
      } catch (e) {
        return err(e as AppError);
      }
    }
    const updated = await rep.patchExportFormat(tx, id, { ...(body.label !== undefined ? { label: body.label } : {}), ...(columns ? { columns } : {}), ...(body.delimiter ? { delimiter: body.delimiter } : {}), ...(body.includeBom !== undefined ? { includeBom: body.includeBom } : {}), ...(body.active !== undefined ? { active: body.active } : {}) });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "stateassign.export_format.updated", resourceType: "export_format", resourceId: id, after: { active: updated!.active, columns: updated!.columns.map((c) => c.key) } });
    await events.flush(tx);
    return ok(exportFormatDto(updated!));
  });
}

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

export interface CsvExport {
  readonly filename: string;
  readonly body: string;
  readonly meta: ExportMeta;
}

export interface ExportInput {
  readonly dataset: ExportDataset;
  readonly formatId?: Uuid | undefined;
  readonly institutionId?: Uuid | undefined;
  readonly academicYearId?: Uuid | undefined;
  readonly status?: string | undefined;
}

export async function exportCsv(deps: StateassignDeps, ctx: RequestContext, input: ExportInput): Promise<Result<CsvExport, AppError>> {
  const today = todayOf(deps);
  const max = deps.config.exportMaxRows;
  const institutionId = ctx.institutionId ?? input.institutionId;
  if (ctx.institutionId && input.institutionId && input.institutionId !== ctx.institutionId) return err(notFound(StateassignCode.INSTITUTION_NOT_FOUND, "Établissement", input.institutionId));

  const gathered = await inTx(
    deps,
    ctx,
    async (tx) => {
      let format = null as Awaited<ReturnType<typeof rep.getExportFormat>>;
      if (input.formatId) {
        format = await rep.getExportFormat(tx, input.formatId);
        if (!format || !inScope(ctx, format.institutionId) || !format.active) return err(notFound(StateassignCode.EXPORT_FORMAT_NOT_FOUND, "Format d'export", input.formatId));
        if (format.dataset !== input.dataset) return err(validation(StateassignCode.INVALID_INPUT, "Ce format ne correspond pas au jeu de données demandé.", "formatId"));
      }
      let rows: ExportRow[] = [];
      let total = 0;
      let studentIds: string[] = [];
      if (input.dataset === "ASSIGNMENTS") {
        const page = await repo.listAssignments(tx, { institutionId, academicYearId: input.academicYearId, status: input.status as never, includeHistory: false, limit: max, offset: 0 });
        total = page.total;
        studentIds = page.items.map((a) => a.studentId);
        rows = page.items.map((a) => ({
          reference: a.reference,
          studentId: a.studentId,
          enrollmentId: a.enrollmentId,
          institutionId: a.institutionId,
          academicYearId: a.academicYearId,
          version: a.version,
          status: a.status,
          issuedOn: a.issuedOn,
          issuingAuthority: a.issuingAuthority,
          source: a.source,
          declaredStateAmount: a.declaredState?.amount ?? null,
          declaredParentAmount: a.declaredParent?.amount ?? null,
          currency: a.currency,
          stateBilledAmount: billedFrom(a.declaredState, a.stateDelta, a.currency)?.amount ?? null,
          parentBilledAmount: billedFrom(a.declaredParent, a.parentDelta, a.currency)?.amount ?? null,
          stateDelta: a.stateDelta?.amount ?? null,
          parentDelta: a.parentDelta?.amount ?? null,
          reconciliationStatus: a.reconciliationStatus,
          lastReconciledAt: a.lastReconciledAt ? a.lastReconciledAt.toISOString() : null,
          verifiedAt: a.verifiedAt ? a.verifiedAt.toISOString() : null,
          endedOn: a.endedOn,
        }));
      } else if (input.dataset === "RECEIVABLES") {
        const page = await recRepo.listReceivables(tx, { institutionId, academicYearId: input.academicYearId, status: input.status as never, asOf: today, limit: max, offset: 0 });
        total = page.total;
        studentIds = page.items.map((r) => r.receivable.studentId);
        rows = page.items.map((r) => {
          const v = viewReceivable(r.receivable, today, r.graceDays);
          return {
            assignmentReference: r.assignmentReference,
            studentId: r.receivable.studentId,
            seq: r.receivable.seq,
            label: r.receivable.label,
            dueOn: r.receivable.dueOn,
            expectedAmount: r.receivable.expected.amount,
            receivedAmount: r.receivable.received.amount,
            outstandingAmount: v.outstanding.amount,
            currency: r.receivable.expected.currency,
            status: r.receivable.status,
            daysOverdue: v.daysOverdue,
            agingBucket: v.agingBucket,
          };
        });
      } else {
        const page = await rep.controlsReport(tx, { institutionId, academicYearId: input.academicYearId, status: input.status as never, today, limit: max, offset: 0 });
        total = page.total;
        studentIds = page.items.map((c) => c.studentId);
        rows = page.items.map((c) => ({
          assignmentReference: c.assignmentReference,
          studentId: c.studentId,
          kind: c.control.kind,
          dueOn: c.control.dueOn,
          status: c.control.status,
          performedAt: c.control.performedAt ? c.control.performedAt.toISOString() : null,
          findings: c.control.findings,
          anomalyResolution: c.control.anomalyResolution,
          overdue: controlOverdue(c.control, today),
        }));
      }
      const events = new EventBuffer(deps, ctx);
      events.audit({
        action: "stateassign.export.generated",
        resourceType: "export",
        resourceId: deps.newId(),
        sensitive: true,
        metadata: { dataset: input.dataset, rows: rows.length, total, formatId: input.formatId ?? null, institutionId: institutionId ?? null, academicYearId: input.academicYearId ?? null },
      });
      await events.flush(tx);
      return ok({ format, rows, total, studentIds });
    },
    { readOnly: false },
  );
  if (!gathered.ok) return gathered;
  const { format, rows, total, studentIds } = gathered.value;
  const names = await namesOf(deps, ctx, studentIds);
  const withNames = rows.map((r) => ({ ...r, studentName: names.get(String(r.studentId)) ?? null }));
  const catalog = EXPORT_CATALOG[input.dataset];
  const columns = format ? format.columns : catalog.standardColumns;
  const body = toCsv(columns, withNames, { delimiter: format?.delimiter ?? ";", includeBom: format?.includeBom ?? true });
  return ok({
    filename: `stateassign-${input.dataset.toLowerCase()}-${today}.csv`,
    body,
    meta: { dataset: input.dataset, rowCount: rows.length, totalCount: total, truncated: total > rows.length, maxRows: max },
  });
}

// ---------------------------------------------------------------------------
// Passerelle (future)
// ---------------------------------------------------------------------------

export function getGatewayStatus(deps: StateassignDeps): StateGatewayStatusDto {
  const s = deps.ports.gateway.status();
  return { configured: s.configured, adapter: deps.ports.gateway.adapter, message: s.message };
}

/** Récupérer une affectation à la passerelle : en V1, refus explicite `stateassign.gateway_not_configured` (aucun appel externe). */
export async function fetchFromGateway(deps: StateassignDeps, ctx: RequestContext, reference: string): Promise<Result<{ externalRef: string; reference: string }, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const r = await deps.ports.gateway.fetchAssignment(ctx, reference);
  if (!r.ok) return err(conflict(StateassignCode.GATEWAY_NOT_CONFIGURED, r.error.message, { adapter: deps.ports.gateway.adapter }));
  return ok({ externalRef: r.value.externalRef, reference: r.value.reference });
}

export async function pushCertificateToGateway(deps: StateassignDeps, ctx: RequestContext, input: { assignmentId: Uuid; documentRef: Uuid }): Promise<Result<{ externalRef: string }, AppError>> {
  const h = requireHuman(ctx);
  if (!h.ok) return h;
  const r = await deps.ports.gateway.pushAttendanceCertificate(ctx, input);
  if (!r.ok) return err(conflict(StateassignCode.GATEWAY_NOT_CONFIGURED, r.error.message, { adapter: deps.ports.gateway.adapter }));
  return ok(r.value);
}
