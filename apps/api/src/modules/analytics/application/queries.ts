/**
 * Cas d'usage de LECTURE : chaque fonction `(deps, ctx, query) => Result<{ meta, data }>` lit les read-models dans une
 * transaction en lecture seule, borne le périmètre à celui de l'utilisateur et déclare la fraîcheur (`meta.asOf`) et les
 * manques (`meta.gaps`). Les permissions sont contrôlées par le plugin HTTP (`requirePermission`), jamais ici.
 *
 * Aucune formule de résultat scolaire : moyennes, rangs, décisions et validations viennent des résultats FINAL de
 * `results` (déjà calculés par `rules`) ; ici on compte, on regroupe et on présente.
 */
import { ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  AnalyticsAgedData,
  AnalyticsAttendanceData,
  AnalyticsCashData,
  AnalyticsChargesData,
  AnalyticsCollectionsData,
  AnalyticsEnrollmentData,
  AnalyticsFinanceSummaryData,
  AnalyticsFreshnessData,
  AnalyticsMeta,
  AnalyticsOverviewData,
  AnalyticsPayrollData,
  AnalyticsReceivablesData,
  AnalyticsResultsData,
  AnalyticsScopesData,
  AnalyticsTeachingLoadData,
} from "@ecoledigitale/contracts/src/v2/analytics";
import { addDays } from "../domain/refresh-plan";
import { readingStatus, rateBps, presentDecimal } from "../domain/metrics";
import type { RefreshKind } from "../domain/types";
import { selectClassrooms, selectScopes } from "../infrastructure/dims-repository";
import * as repo from "../infrastructure/read-repository";
import { countByStatus, listStates } from "../infrastructure/requests-repository";
import { inTx } from "./deps";
import type { AnalyticsDeps } from "./ports";
import { buildMetaFromStates, loadDims, loadThresholds, resolveScope, type ResolvedScope, type ScopeQueryInput } from "./scope";

export interface Envelope<T> {
  meta: AnalyticsMeta;
  data: T;
}

const DEFAULT_ATTENDANCE_WINDOW_DAYS = 30;
const DEFAULT_COLLECTIONS_WINDOW_DAYS = 365;
const DEFAULT_SCALE_MAX = 20;
const DEFAULT_BIN_WIDTH = 2;
const MAX_WINDOW_DAYS = 800;

const today = (deps: AnalyticsDeps): string => deps.clock.now().toISOString().slice(0, 10);

interface Prepared {
  scope: ResolvedScope;
  thresholds: Awaited<ReturnType<typeof loadThresholds>>;
  dims: Awaited<ReturnType<typeof loadDims>>;
}

/** Transaction de lecture commune : périmètre résolu, seuils d'affichage, méta construite sur les genres lus. */
async function read<T>(
  deps: AnalyticsDeps,
  ctx: RequestContext,
  query: ScopeQueryInput,
  kinds: readonly RefreshKind[],
  body: (tx: Tx, p: Prepared) => Promise<Result<T, AppError> | { data: T; extraGaps?: AnalyticsMeta["gaps"]; scope?: Partial<ResolvedScope> }>,
): Promise<Result<Envelope<T>, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const dims = await loadDims(tx);
      const scope = resolveScope(ctx, query, dims);
      if (!scope.ok) return scope;
      const thresholds = await loadThresholds(tx);
      const out = await body(tx, { scope: scope.value, thresholds, dims });
      if ("ok" in out) {
        if (!out.ok) return out;
        return ok({ meta: buildMetaFromStates(await listStates(tx), kinds, scope.value, thresholds, deps.clock.now()), data: out.value });
      }
      const effective = { ...scope.value, ...(out.scope ?? {}) };
      return ok({ meta: buildMetaFromStates(await listStates(tx), kinds, effective, thresholds, deps.clock.now(), out.extraGaps ?? []), data: out.data });
    },
    { readOnly: true },
  );
}

// ------------------------------------------------------------------------------------------------------------------
// Référentiel des filtres
// ------------------------------------------------------------------------------------------------------------------

export function getScopes(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsScopesData>, AppError>> {
  return read(deps, ctx, query, ["CALENDAR"], async (tx, p) => {
    const scopes = await selectScopes(tx);
    const classrooms = await selectClassrooms(tx);
    const inScope = <T extends { institutionId?: string; campusId?: string | null }>(x: T): boolean => (!ctx.institutionId || x.institutionId === ctx.institutionId) && (!ctx.campusId || x.campusId === ctx.campusId);
    const years = p.dims.years.filter((y) => !ctx.institutionId || y.institutionId === ctx.institutionId);
    const data: AnalyticsScopesData = {
      institutions: scopes.filter((s) => s.kind === "INSTITUTION" && (!ctx.institutionId || s.id === ctx.institutionId)).map((s) => ({ id: s.id, label: s.label })),
      campuses: scopes.filter((s) => s.kind === "CAMPUS" && (!ctx.institutionId || s.parentId === ctx.institutionId) && (!ctx.campusId || s.id === ctx.campusId)).map((s) => ({ id: s.id, institutionId: s.parentId, label: s.label })),
      years: years.map((y) => ({ id: y.id, institutionId: y.institutionId, code: y.code, label: y.label, startsOn: y.startsOn, endsOn: y.endsOn, status: y.status, isCurrent: y.isCurrent })),
      periods: p.dims.periods.filter((pe) => years.some((y) => y.id === pe.yearId)).map((pe) => ({ id: pe.id, yearId: pe.yearId, code: pe.code, label: pe.label, ordinal: pe.ordinal, startsOn: pe.startsOn, endsOn: pe.endsOn, status: pe.status })),
      classrooms: classrooms.filter(inScope).map((c) => ({ id: c.id, yearId: c.yearId, institutionId: c.institutionId, campusId: c.campusId, name: c.name, gradeLevelCode: c.gradeLevelCode, gradeLevelLabel: c.gradeLevelLabel })),
      defaultYearId: p.scope.yearId,
    };
    return { data };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Vue d'ensemble
// ------------------------------------------------------------------------------------------------------------------

export function getOverview(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsOverviewData>, AppError>> {
  return read(deps, ctx, query, ["ENROLLMENT", "ATTENDANCE", "RESULTS", "STAFF_PRESENCE"], async (tx, p) => {
    const day = today(deps);
    const headcount = await repo.headcountOverview(tx, p.scope);
    const att = await repo.attendanceOfDay(tx, p.scope, day);
    const latest = p.scope.periodId ? { periodId: p.scope.periodId, label: p.scope.period?.label ?? p.scope.periodId } : await repo.latestFinalPeriod(tx, p.scope.yearId);
    const stats = latest ? await repo.resultsTotals(tx, { ...p.scope, periodId: latest.periodId }) : null;
    const staff = await repo.staffOfDay(tx, day);
    const data: AnalyticsOverviewData = {
      headcount,
      attendanceToday: {
        day,
        recordsCount: att.recordsCount,
        presentCount: att.presentCount,
        absentCount: att.absentCount,
        lateCount: att.lateCount,
        rateBps: att.rateBps,
        status: readingStatus(att.rateBps, { goodBps: p.thresholds.attendanceGoodBps, warningBps: p.thresholds.attendanceWarningBps }),
        measured: att.measured,
      },
      results: {
        periodId: latest?.periodId ?? null,
        periodLabel: latest?.label ?? null,
        generalAverage: stats?.average ?? null,
        cohortSize: stats?.count ?? 0,
        validatedCount: stats?.validatedCount ?? 0,
        validationRateBps: stats?.validationRateBps ?? null,
        measured: stats !== null && stats.count > 0,
      },
      staffToday: { day, present: staff.present, absent: staff.absent, onLeave: staff.onLeave, measured: staff.measured },
    };
    return { data, scope: { periodId: latest?.periodId ?? null } };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Effectifs
// ------------------------------------------------------------------------------------------------------------------

export function getEnrollment(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsEnrollmentData>, AppError>> {
  return read(deps, ctx, query, ["ENROLLMENT", "CALENDAR"], async (tx, p) => ({ data: (await repo.enrollmentBreakdown(tx, p.scope)) satisfies AnalyticsEnrollmentData }));
}

// ------------------------------------------------------------------------------------------------------------------
// Présences
// ------------------------------------------------------------------------------------------------------------------

function windowOf(query: ScopeQueryInput, fallbackDays: number, now: string): Result<{ from: string; to: string }, AppError> {
  const to = query.to ?? now;
  const from = query.from ?? addDays(to, -(fallbackDays - 1));
  if (from > to) return err(new ValidationError("La fin de période précède le début.", [{ path: ["to"], message: "Fin avant début.", code: "range_inverted" }]));
  const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (span > MAX_WINDOW_DAYS) return err(new ValidationError(`Période trop longue (${MAX_WINDOW_DAYS} jours au plus).`, [{ path: ["from"], message: "Période trop longue.", code: "range_too_long" }]));
  return ok({ from, to });
}

export function getAttendance(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsAttendanceData>, AppError>> {
  const range = windowOf(query, DEFAULT_ATTENDANCE_WINDOW_DAYS, today(deps));
  if (!range.ok) return Promise.resolve(range);
  return read(deps, ctx, query, ["ATTENDANCE", "STAFF_PRESENCE", "CALENDAR"], async (tx, p) => {
    const b = await repo.attendanceBreakdown(tx, p.scope, range.value);
    const staff = await repo.staffPresenceByDay(tx, range.value);
    const status = (bps: number | null) => readingStatus(bps, { goodBps: p.thresholds.attendanceGoodBps, warningBps: p.thresholds.attendanceWarningBps });
    const data: AnalyticsAttendanceData = {
      range: range.value,
      totals: { ...b.totals, status: status(b.totals.rateBps) },
      byDay: b.byDay,
      byClassroom: b.byClassroom.map((c) => ({ ...c, status: status(c.rateBps) })),
      staff: { byDay: staff, measured: staff.length > 0 },
    };
    return { data, scope: { from: range.value.from, to: range.value.to } };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Résultats
// ------------------------------------------------------------------------------------------------------------------

export function getResults(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput & { scaleMax?: number | undefined; binWidth?: number | undefined } = {}): Promise<Result<Envelope<AnalyticsResultsData>, AppError>> {
  return read(deps, ctx, query, ["RESULTS", "CALENDAR"], async (tx, p) => {
    const scaleMax = query.scaleMax ?? DEFAULT_SCALE_MAX;
    const binWidth = query.binWidth ?? DEFAULT_BIN_WIDTH;
    // Période par défaut : la dernière de l'année qui a des résultats FINAL (jamais un mélange de périodes sans le dire).
    const latest = p.scope.periodId ? null : await repo.latestFinalPeriod(tx, p.scope.yearId);
    const scope = { ...p.scope, periodId: p.scope.periodId ?? latest?.periodId ?? null };
    const b = await repo.resultsBreakdown(tx, scope, { scaleMax, binWidth });
    const data: AnalyticsResultsData = b;
    return { data, scope: { periodId: scope.periodId } };
  });
}

export function getTeachingLoad(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsTeachingLoadData>, AppError>> {
  return read(deps, ctx, query, ["TEACHING_LOAD"], async (tx, p) => {
    const rows = await repo.teachingLoad(tx, p.scope.yearId);
    const data: AnalyticsTeachingLoadData = {
      yearId: p.scope.yearId,
      rows,
      totals: { staffCount: rows.length, plannedHours: Math.round(rows.reduce((s, r) => s + r.plannedHours, 0) * 100) / 100 },
    };
    return { data };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Finance
// ------------------------------------------------------------------------------------------------------------------

/**
 * Clés des tables `finance_*` pour un périmètre : année (code) et campus. Un établissement SANS campus choisi n'a pas de clé
 * propre dans finance : s'il n'a qu'un campus c'est celui-là, sinon l'utilisateur doit en choisir un.
 */
async function financeKeys(tx: Tx, scope: ResolvedScope): Promise<Result<repo.FinanceKeys, AppError>> {
  let campusKey = scope.campusId ?? "*";
  if (!scope.campusId && scope.institutionId) {
    const campuses = (await selectScopes(tx)).filter((s) => s.kind === "CAMPUS" && s.parentId === scope.institutionId);
    if (campuses.length === 1) campusKey = (campuses[0] as { id: string }).id;
    else if (campuses.length > 1) return err(new ValidationError("Sélectionnez un campus : la facturation est suivie par campus.", [{ path: ["campusId"], message: "Campus requis.", code: "campus_required" }]));
  }
  return ok({ yearKey: scope.year?.code ?? "*", campusKey });
}

export function getFinanceSummary(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsFinanceSummaryData>, AppError>> {
  return read(deps, ctx, query, ["FINANCE"], async (tx, p) => {
    const keys = await financeKeys(tx, p.scope);
    if (!keys.ok) return keys;
    const row = await repo.financeSummaryRow(tx, keys.value);
    const groups = await repo.receivablesByGroup(tx, keys.value, { onlyOutstanding: false, limit: 500, offset: 0 });
    const rate = row ? (row.collection_rate_bps as number | null) : null;
    const data: AnalyticsFinanceSummaryData = {
      currency: row?.currency ?? null,
      asOfDate: row?.as_of ?? null,
      summary: row
        ? {
            invoiceCount: Number(row.invoice_count),
            billed: Number(row.billed),
            credited: Number(row.credited),
            netBilled: Number(row.net_billed),
            collected: Number(row.collected),
            outstanding: Number(row.outstanding),
            overdue: Number(row.overdue),
            overdueInvoiceCount: Number(row.overdue_invoice_count),
            unallocated: Number(row.unallocated),
            collectionRateBps: rate,
            status: readingStatus(rate, { goodBps: p.thresholds.collectionGoodBps, warningBps: p.thresholds.collectionWarningBps }),
          }
        : null,
      byClassroom: groups.rows.map((g) => ({ groupKey: g.id, label: g.label, learnerCount: g.learnerCount, invoiceCount: g.invoiceCount, billed: g.billed, credited: g.credited, collected: g.collected, outstanding: g.outstanding, overdue: g.overdue, collectionRateBps: g.collectionRateBps })),
    };
    return { data };
  });
}

export function getReceivables(
  deps: AnalyticsDeps,
  ctx: RequestContext,
  query: ScopeQueryInput & { by?: "class" | "learner" | undefined; onlyOutstanding?: boolean | undefined; limit?: number | undefined; offset?: number | undefined },
): Promise<Result<Envelope<AnalyticsReceivablesData>, AppError>> {
  const by = query.by ?? "class";
  return read(deps, ctx, query, ["FINANCE"], async (tx, p) => {
    const keys = await financeKeys(tx, p.scope);
    if (!keys.ok) return keys;
    const input = { onlyOutstanding: query.onlyOutstanding ?? true, limit: Math.min(500, Math.max(1, query.limit ?? 50)), offset: Math.max(0, query.offset ?? 0) };
    const r = by === "learner" ? await repo.receivablesByLearner(tx, keys.value, input) : await repo.receivablesByGroup(tx, keys.value, input);
    const data: AnalyticsReceivablesData = { by, currency: r.currency, total: r.total, rows: r.rows };
    return { data };
  });
}

export function getCollections(
  deps: AnalyticsDeps,
  ctx: RequestContext,
  query: { from?: string | undefined; to?: string | undefined; granularity?: "day" | "week" | "month" | undefined },
): Promise<Result<Envelope<AnalyticsCollectionsData>, AppError>> {
  const range = windowOf(query, DEFAULT_COLLECTIONS_WINDOW_DAYS, today(deps));
  if (!range.ok) return Promise.resolve(range);
  const granularity = query.granularity ?? "month";
  return read(deps, ctx, { from: range.value.from, to: range.value.to }, ["COLLECTIONS"], async (tx) => {
    const s = await repo.collectionsSeries(tx, { ...range.value, granularity });
    const totals = s.points.reduce((t, x) => ({ collected: t.collected + x.collected, refunded: t.refunded + x.refunded, net: t.net + x.net, paymentCount: t.paymentCount + x.paymentCount }), { collected: 0, refunded: 0, net: 0, paymentCount: 0 });
    const data: AnalyticsCollectionsData = { currency: s.currency, granularity, range: range.value, points: s.points, totals };
    return { data };
  });
}

export function getAged(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput & { learners?: number | undefined } = {}): Promise<Result<Envelope<AnalyticsAgedData>, AppError>> {
  return read(deps, ctx, query, ["FINANCE"], async (tx, p) => {
    const keys = await financeKeys(tx, p.scope);
    if (!keys.ok) return keys;
    const r = await repo.agedRows(tx, keys.value, Math.min(200, Math.max(0, query.learners ?? 20)));
    const data: AnalyticsAgedData = {
      currency: r.currency,
      asOfDate: r.asOf,
      buckets: r.buckets as AnalyticsAgedData["buckets"],
      total: r.buckets.reduce((s, b) => s + b.amount, 0),
      learners: r.learners,
    };
    return { data };
  });
}

export function getCash(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsCashData>, AppError>> {
  return read(deps, ctx, query, ["CASH"], async (tx) => {
    const r = await repo.cashSessions(tx, { from: query.from ?? null, to: query.to ?? null, limit: 200 });
    const data: AnalyticsCashData = { currency: r.currency, totals: r.totals, sessions: r.sessions };
    return { data };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Paie et charges
// ------------------------------------------------------------------------------------------------------------------

const COUNTED_STATUSES = ["CALCULATED", "APPROVED", "PAID"] as const;

export function getPayroll(deps: AnalyticsDeps, ctx: RequestContext, query: ScopeQueryInput = {}): Promise<Result<Envelope<AnalyticsPayrollData>, AppError>> {
  return read(deps, ctx, query, ["PAYROLL"], async (tx, p) => {
    const rows = await repo.payrollFacts(tx, { yearId: p.scope.yearId, periodId: p.scope.periodId });
    const periods = new Map<string, AnalyticsPayrollData["periods"][number]>();
    const zero = { payslips: 0, total: 0 };
    for (const r of rows) {
      let per = periods.get(r.periodId);
      if (!per) {
        per = { periodId: r.periodId, name: r.periodName, startsOn: r.startsOn, endsOn: r.endsOn, yearId: r.yearId, byStatus: {}, counted: { ...zero }, cancelled: { ...zero }, disputed: { ...zero } };
        periods.set(r.periodId, per);
      }
      per.byStatus[r.status] = { payslips: r.payslipCount, total: r.total };
      // Comptés : calculés + arrêtés + payés ; annulés et contestés sont EXCLUS du total mais montrés à part (même lecture que `payroll.ownerMass`).
      if ((COUNTED_STATUSES as readonly string[]).includes(r.status)) per.counted = { payslips: per.counted.payslips + r.payslipCount, total: per.counted.total + r.total };
      if (r.status === "CANCELLED") per.cancelled = { payslips: r.payslipCount, total: r.total };
      if (r.status === "DISPUTED") per.disputed = { payslips: r.payslipCount, total: r.total };
    }
    const list = [...periods.values()];
    const data: AnalyticsPayrollData = {
      currency: rows[0]?.currency ?? null,
      periods: list,
      counted: list.reduce((t, x) => ({ payslips: t.payslips + x.counted.payslips, total: t.total + x.counted.total }), { ...zero }),
    };
    return { data };
  });
}

/** Le module de charges (dépenses) n'existe pas encore en v2 : le manque est DÉCLARÉ, jamais rempli par un zéro. */
export function getCharges(deps: AnalyticsDeps, ctx: RequestContext): Promise<Result<Envelope<AnalyticsChargesData>, AppError>> {
  return read(deps, ctx, {}, [], async () => {
    const data: AnalyticsChargesData = {
      available: false,
      reason: "MODULE_MISSING",
      message: "Aucun module de charges ou de comptabilité n'est encore disponible dans la plateforme : les charges, le compte de résultat et les marges ne sont pas mesurés.",
    };
    return { data, extraGaps: [{ source: "CHARGES", reason: "MODULE_MISSING", message: "Module de charges et de résultat absent (spec 014/015 non livrées)." }] };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Fraîcheur
// ------------------------------------------------------------------------------------------------------------------

export function getFreshness(deps: AnalyticsDeps, ctx: RequestContext): Promise<Result<Envelope<AnalyticsFreshnessData>, AppError>> {
  return read(deps, ctx, {}, [], async (tx, p) => {
    const states = await listStates(tx);
    const data: AnalyticsFreshnessData = {
      states: states.map((s) => ({
        kind: s.kind,
        scopeKey: s.scopeKey,
        lastSuccessAt: s.lastSuccessAt ? s.lastSuccessAt.toISOString() : null,
        lastAttemptAt: s.lastAttemptAt ? s.lastAttemptAt.toISOString() : null,
        lastStatus: s.lastStatus,
        rowsWritten: s.rowsWritten,
        durationMs: s.durationMs,
        lastError: s.lastError,
      })),
      queue: await countByStatus(tx),
      staleAfterSeconds: p.thresholds.staleAfterSeconds,
    };
    return { data };
  });
}

export { rateBps, presentDecimal };
