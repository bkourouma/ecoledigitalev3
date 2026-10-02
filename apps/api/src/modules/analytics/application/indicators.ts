/**
 * Indicateurs transverses de direction (spec v2/025, partie B) : entonnoir d'admission, vie scolaire AGRÉGÉE et comparaisons
 * entre périodes ou années. Lecture seule des read-models d'`analytics` (aucun SQL vers un autre module), mêmes `meta`
 * (`asOf`, `stale`, `gaps`) que les autres vues.
 *
 * Aucune donnée individuelle : l'entonnoir compte des dossiers par étape, la vie scolaire expose quatre comptages de
 * confidentialité STANDARD. Une comparaison dont l'un des côtés n'est pas mesuré rend `null` (jamais un zéro).
 */
import { ForbiddenError, ValidationError, err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { AnalyticsAdmissionsFunnelData, AnalyticsComparisonData, AnalyticsCompareQuery, AnalyticsSchoolLifeData } from "@ecoledigitale/contracts/src/v2/analytics";
import { ANALYTICS_ADMISSION_STATUSES, ANALYTICS_SCHOOLLIFE_INDICATORS } from "@ecoledigitale/contracts/src/v2/analytics";
import { rateBps } from "../domain/metrics";
import * as repo from "../infrastructure/read-repository";
import type { AnalyticsDeps } from "./ports";
import { financeKeys, MAX_WINDOW_DAYS, read, type Envelope } from "./queries";
import { resolveScope, type ResolvedScope } from "./scope";

const limitedToCampus = (): AppError =>
  new ForbiddenError("Cet indicateur est suivi par établissement : il n'est pas disponible pour un accès limité à un campus.", { code: "analytics.scope_forbidden" });

// ------------------------------------------------------------------------------------------------------------------
// Entonnoir d'admission
// ------------------------------------------------------------------------------------------------------------------

export function getAdmissionsFunnel(deps: AnalyticsDeps, ctx: RequestContext, query: { institutionId?: string | undefined; yearId?: string | undefined } = {}): Promise<Result<Envelope<AnalyticsAdmissionsFunnelData>, AppError>> {
  if (ctx.campusId && !ctx.institutionId) return Promise.resolve(err(limitedToCampus()));
  return read(deps, ctx, { institutionId: query.institutionId }, ["ADMISSIONS"], async (tx, p) => {
    const campaigns = await repo.admissionsFunnel(tx, { institutionId: p.scope.institutionId, yearId: query.yearId ?? null });
    const counts = new Map<string, number>(ANALYTICS_ADMISSION_STATUSES.map((s) => [s, 0]));
    for (const c of campaigns) for (const s of c.stages) if (counts.has(s.canonicalStatus)) counts.set(s.canonicalStatus, (counts.get(s.canonicalStatus) ?? 0) + s.applications);
    const get = (s: string): number => counts.get(s) ?? 0;
    const applications = [...counts.values()].reduce((a, b) => a + b, 0);
    const submitted = applications - get("DRAFT");
    const accepted = get("ACCEPTED") + get("ENROLLED");
    const seatValues = campaigns.map((c) => c.seats).filter((x): x is number => x !== null);
    const leftValues = campaigns.map((c) => c.seatsLeft).filter((x): x is number => x !== null);
    const data: AnalyticsAdmissionsFunnelData = {
      totals: {
        applications,
        submitted,
        accepted,
        enrolled: get("ENROLLED"),
        rejected: get("REJECTED"),
        waitlisted: get("WAITLISTED"),
        acceptanceRateBps: rateBps(accepted, submitted),
        enrollmentRateBps: rateBps(get("ENROLLED"), accepted),
        seats: seatValues.length > 0 ? seatValues.reduce((a, b) => a + b, 0) : null,
        seatsLeft: leftValues.length > 0 ? leftValues.reduce((a, b) => a + b, 0) : null,
      },
      byStatus: ANALYTICS_ADMISSION_STATUSES.map((status) => ({ status, count: get(status) })),
      campaigns: campaigns.map((c) => ({
        campaignId: c.campaignId,
        institutionId: c.institutionId,
        yearId: c.yearId,
        code: c.code,
        label: c.label,
        status: c.status,
        seats: c.seats,
        seatsLeft: c.seatsLeft,
        applications: c.applications,
        stages: c.stages.filter((s) => (ANALYTICS_ADMISSION_STATUSES as readonly string[]).includes(s.canonicalStatus)).map((s) => ({ ...s, canonicalStatus: s.canonicalStatus as (typeof ANALYTICS_ADMISSION_STATUSES)[number] })),
      })),
    };
    return { data };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Vie scolaire agrégée
// ------------------------------------------------------------------------------------------------------------------

export function getSchoolLife(deps: AnalyticsDeps, ctx: RequestContext, query: { institutionId?: string | undefined } = {}): Promise<Result<Envelope<AnalyticsSchoolLifeData>, AppError>> {
  if (ctx.campusId && !ctx.institutionId) return Promise.resolve(err(limitedToCampus()));
  return read(deps, ctx, { institutionId: query.institutionId }, ["SCHOOLLIFE"], async (tx, p) => {
    const values = await repo.schoolLifeValues(tx, p.scope.institutionId ?? "*");
    const data: AnalyticsSchoolLifeData = {
      scopeConfidentiality: "STANDARD",
      institutionId: p.scope.institutionId,
      indicators: ANALYTICS_SCHOOLLIFE_INDICATORS.map((indicator) => ({ indicator, value: values[indicator] ?? null, measured: values[indicator] !== undefined })),
    };
    return { data };
  });
}

// ------------------------------------------------------------------------------------------------------------------
// Comparaisons
// ------------------------------------------------------------------------------------------------------------------

type Metric = AnalyticsComparisonData["metrics"][number];

/** Écart absolu et variation relative (points de base) ; `null` dès qu'un côté n'est pas mesuré ou que la référence est nulle. */
function metric(key: string, unit: Metric["unit"], baseline: number | null, target: number | null): Metric {
  const delta = baseline === null || target === null ? null : Math.round((target - baseline) * 100) / 100;
  const changeBps = baseline === null || target === null || baseline === 0 ? null : Math.round(((target - baseline) * 10_000) / Math.abs(baseline));
  return { key, unit, baseline, target, delta, changeBps };
}

const invalid = (path: string, message: string, code: string): Result<never, AppError> => err(new ValidationError(message, [{ path: [path], message, code }]));

function requireYears(q: AnalyticsCompareQuery): Result<{ baseline: string; target: string }, AppError> {
  if (!q.baselineYearId) return invalid("baselineYearId", "L'année de référence est obligatoire.", "baseline_required");
  if (!q.targetYearId) return invalid("targetYearId", "L'année comparée est obligatoire.", "target_required");
  return ok({ baseline: q.baselineYearId, target: q.targetYearId });
}

type Dims = Parameters<typeof resolveScope>[2];

/** Périmètre d'un côté de la comparaison : bornes de l'utilisateur appliquées comme partout ailleurs. */
function sideScope(ctx: RequestContext, q: AnalyticsCompareQuery, extra: { yearId?: string; periodId?: string }, dims: Dims): Result<ResolvedScope, AppError> {
  return resolveScope(ctx, { institutionId: q.institutionId, campusId: q.campusId, ...extra }, dims);
}

export function compareEnrollment(deps: AnalyticsDeps, ctx: RequestContext, q: AnalyticsCompareQuery): Promise<Result<Envelope<AnalyticsComparisonData>, AppError>> {
  const years = requireYears(q);
  if (!years.ok) return Promise.resolve(years);
  return read(deps, ctx, { institutionId: q.institutionId, campusId: q.campusId, yearId: years.value.target }, ["ENROLLMENT", "CALENDAR"], async (tx, p) => {
    const base = sideScope(ctx, q, { yearId: years.value.baseline }, p.dims);
    if (!base.ok) return base;
    const b = await repo.enrollmentTotals(tx, base.value);
    const t = await repo.enrollmentTotals(tx, p.scope);
    const measured = (x: { total: number }): boolean => x.total > 0;
    const pick = (x: typeof b, v: number | null): number | null => (measured(x) ? v : null);
    const data: AnalyticsComparisonData = {
      domain: "enrollment",
      currency: null,
      baseline: { label: base.value.year?.label ?? "", yearId: base.value.yearId, periodId: null, from: null, to: null, demonstration: false },
      target: { label: p.scope.year?.label ?? "", yearId: p.scope.yearId, periodId: null, from: null, to: null, demonstration: false },
      metrics: [
        metric("inSchooling", "COUNT", pick(b, b.inSchooling), pick(t, t.inSchooling)),
        metric("total", "COUNT", pick(b, b.total), pick(t, t.total)),
        metric("repeaters", "COUNT", pick(b, b.repeaters), pick(t, t.repeaters)),
        metric("repeaterRateBps", "BPS", pick(b, b.repeaterRateBps), pick(t, t.repeaterRateBps)),
      ],
    };
    return { data };
  });
}

export function compareAttendance(deps: AnalyticsDeps, ctx: RequestContext, q: AnalyticsCompareQuery): Promise<Result<Envelope<AnalyticsComparisonData>, AppError>> {
  const { baselineFrom, baselineTo, targetFrom, targetTo } = q;
  if (!baselineFrom || !baselineTo) return Promise.resolve(invalid("baselineFrom", "La fenêtre de référence est obligatoire.", "baseline_required"));
  if (!targetFrom || !targetTo) return Promise.resolve(invalid("targetFrom", "La fenêtre comparée est obligatoire.", "target_required"));
  const span = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  for (const [from, to, path] of [[baselineFrom, baselineTo, "baselineTo"], [targetFrom, targetTo, "targetTo"]] as const) {
    if (from > to) return Promise.resolve(invalid(path, "La fin de période précède le début.", "range_inverted"));
    if (span(from, to) > MAX_WINDOW_DAYS) return Promise.resolve(invalid(path, `Période trop longue (${MAX_WINDOW_DAYS} jours au plus).`, "range_too_long"));
  }
  return read(deps, ctx, { institutionId: q.institutionId, campusId: q.campusId, from: targetFrom, to: targetTo }, ["ATTENDANCE", "CALENDAR"], async (tx, p) => {
    const scope = { ...p.scope, classroomId: null };
    const b = (await repo.attendanceBreakdown(tx, scope, { from: baselineFrom, to: baselineTo })).totals;
    const t = (await repo.attendanceBreakdown(tx, scope, { from: targetFrom, to: targetTo })).totals;
    const v = (x: typeof b, value: number): number | null => (x.recordsCount > 0 ? value : null);
    const data: AnalyticsComparisonData = {
      domain: "attendance",
      currency: null,
      baseline: { label: `${baselineFrom}..${baselineTo}`, yearId: null, periodId: null, from: baselineFrom, to: baselineTo, demonstration: false },
      target: { label: `${targetFrom}..${targetTo}`, yearId: null, periodId: null, from: targetFrom, to: targetTo, demonstration: false },
      metrics: [
        metric("rateBps", "BPS", b.rateBps, t.rateBps),
        metric("recordsCount", "COUNT", v(b, b.recordsCount), v(t, t.recordsCount)),
        metric("absentCount", "COUNT", v(b, b.absentCount), v(t, t.absentCount)),
        metric("lateCount", "COUNT", v(b, b.lateCount), v(t, t.lateCount)),
        metric("absentMinutes", "COUNT", v(b, b.absentMinutes), v(t, t.absentMinutes)),
      ],
    };
    return { data, scope: { from: targetFrom, to: targetTo } };
  });
}

export function compareResults(deps: AnalyticsDeps, ctx: RequestContext, q: AnalyticsCompareQuery): Promise<Result<Envelope<AnalyticsComparisonData>, AppError>> {
  if (!q.baselinePeriodId) return Promise.resolve(invalid("baselinePeriodId", "La période de référence est obligatoire.", "baseline_required"));
  if (!q.targetPeriodId) return Promise.resolve(invalid("targetPeriodId", "La période comparée est obligatoire.", "target_required"));
  const baselinePeriodId = q.baselinePeriodId;
  const targetPeriodId = q.targetPeriodId;
  return read(deps, ctx, { institutionId: q.institutionId, campusId: q.campusId }, ["RESULTS", "CALENDAR"], async (tx, p) => {
    // Chaque côté se résout sur SA période (et l'année de cette période) : on compare des périodes, pas des années.
    const basePeriod = p.dims.periods.find((x) => x.id === baselinePeriodId);
    if (!basePeriod) return invalid("baselinePeriodId", "Période inconnue.", "unknown_period");
    const base = sideScope(ctx, q, { yearId: basePeriod.yearId, periodId: baselinePeriodId }, p.dims);
    if (!base.ok) return base;
    const tPeriod = p.dims.periods.find((x) => x.id === targetPeriodId);
    if (!tPeriod) return invalid("targetPeriodId", "Période inconnue.", "unknown_period");
    const target = sideScope(ctx, q, { yearId: tPeriod.yearId, periodId: targetPeriodId }, p.dims);
    if (!target.ok) return target;
    const targetScope = target.value;
    const [b, t] = [await repo.resultsTotals(tx, base.value), await repo.resultsTotals(tx, targetScope)];
    const [bs, ts] = [await repo.rulesSourceSummary(tx, base.value), await repo.rulesSourceSummary(tx, targetScope)];
    const v = (x: typeof b, value: number | null): number | null => (x.count > 0 ? value : null);
    const data: AnalyticsComparisonData = {
      domain: "results",
      currency: null,
      baseline: { label: basePeriod.label, yearId: basePeriod.yearId, periodId: basePeriod.id, from: null, to: null, demonstration: bs.demonstration },
      target: { label: tPeriod.label, yearId: tPeriod.yearId, periodId: tPeriod.id, from: null, to: null, demonstration: ts.demonstration },
      metrics: [
        metric("count", "COUNT", v(b, b.count), v(t, t.count)),
        metric("average", "DECIMAL", v(b, b.average), v(t, t.average)),
        metric("validatedCount", "COUNT", v(b, b.validatedCount), v(t, t.validatedCount)),
        metric("validationRateBps", "BPS", v(b, b.validationRateBps), v(t, t.validationRateBps)),
      ],
    };
    return { data, scope: { periodId: tPeriod.id, yearId: tPeriod.yearId } };
  });
}

export function compareFinance(deps: AnalyticsDeps, ctx: RequestContext, q: AnalyticsCompareQuery): Promise<Result<Envelope<AnalyticsComparisonData>, AppError>> {
  const years = requireYears(q);
  if (!years.ok) return Promise.resolve(years);
  return read(deps, ctx, { institutionId: q.institutionId, campusId: q.campusId, yearId: years.value.target }, ["FINANCE", "CALENDAR"], async (tx, p) => {
    const base = sideScope(ctx, q, { yearId: years.value.baseline }, p.dims);
    if (!base.ok) return base;
    const [bk, tk] = [await financeKeys(tx, base.value), await financeKeys(tx, p.scope)];
    if (!bk.ok) return bk;
    if (!tk.ok) return tk;
    const [b, t] = [await repo.financeSummaryRow(tx, bk.value), await repo.financeSummaryRow(tx, tk.value)];
    const sameCurrency = !b || !t || b.currency === t.currency;
    const amount = (row: Record<string, any> | null, field: string): number | null => (row && sameCurrency ? Number(row[field]) : null);
    const rate = (row: Record<string, any> | null): number | null => (row && row.collection_rate_bps !== null ? Number(row.collection_rate_bps) : null);
    const data: AnalyticsComparisonData = {
      domain: "finance",
      currency: sameCurrency ? (t?.currency ?? b?.currency ?? null) : null,
      baseline: { label: base.value.year?.label ?? "", yearId: base.value.yearId, periodId: null, from: null, to: null, demonstration: false },
      target: { label: p.scope.year?.label ?? "", yearId: p.scope.yearId, periodId: null, from: null, to: null, demonstration: false },
      metrics: [
        metric("netBilled", "AMOUNT", amount(b, "net_billed"), amount(t, "net_billed")),
        metric("collected", "AMOUNT", amount(b, "collected"), amount(t, "collected")),
        metric("outstanding", "AMOUNT", amount(b, "outstanding"), amount(t, "outstanding")),
        metric("overdue", "AMOUNT", amount(b, "overdue"), amount(t, "overdue")),
        metric("collectionRateBps", "BPS", rate(b), rate(t)),
      ],
    };
    return { data };
  });
}
