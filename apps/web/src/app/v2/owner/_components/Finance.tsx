"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ANALYTICS_AGING_BUCKETS } from "@ecoledigitale/contracts/v2/analytics";
import { useAnalyticsAged, useAnalyticsCash, useAnalyticsCollections, useAnalyticsFinanceSummary, useAnalyticsReceivables } from "@/platform/v2/analytics";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { DataTable } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { BarChart, ColumnChart } from "./charts";
import { ExportButton, FeatureGuard, FreshnessBar, KpiCard, KpiGrid, ScopeFilters, scopeFilters, Section, useScopeState, type ScopeField } from "./kit";

const FIELDS: readonly ScopeField[] = ["institution", "campus", "year"];
const PAGE = 25;

/**
 * Scolarité : facturé, avoirs, encaissé, restant dû, en retard et taux de recouvrement par année et campus, créances par classe et
 * par apprenant. Les montants et les taux sont ceux du reporting de `finance` (entiers, points de base) lus dans les read-models.
 */
export function TuitionScreen() {
  return (
    <FeatureGuard>
      <Tuition />
    </FeatureGuard>
  );
}

function Tuition() {
  const t = useTranslations("v2Owner.tuition");
  const money = useMoney();
  const date = useDateFormat();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  const summary = useAnalyticsFinanceSummary(filters);
  const [by, setBy] = useState<"class" | "learner">("class");
  const [onlyOutstanding, setOnlyOutstanding] = useState(true);
  const [page, setPage] = useState(1);
  const receivables = useAnalyticsReceivables({ ...filters, by, onlyOutstanding, limit: PAGE, offset: (page - 1) * PAGE });
  const data = summary.data?.data;
  const s = data?.summary ?? null;
  const currency = data?.currency ?? "XOF";
  const rows = receivables.data?.data.rows ?? [];

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <ScopeFilters
        value={scope}
        onChange={(v) => {
          setScope(v);
          setPage(1);
        }}
        fields={FIELDS}
      />
      {summary.isPending && summary.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : null}
      {data ? (
        <>
          <FreshnessBar meta={summary.data?.meta} />
          <KpiGrid label={t("kpiLabel")}>
            <KpiCard label={t("kpi.rate")} value={money.bps(s?.collectionRateBps ?? null)} detail={s ? t("kpi.rateDetail", { date: date.civil(data.asOfDate) }) : undefined} status={s?.status} measured={s !== null && s.collectionRateBps !== null} />
            <KpiCard label={t("kpi.billed")} value={money.fmt(s?.billed, currency)} detail={s ? t("kpi.billedDetail", { count: s.invoiceCount }) : undefined} measured={s !== null} />
            <KpiCard label={t("kpi.credited")} value={money.fmt(s?.credited, currency)} measured={s !== null} />
            <KpiCard label={t("kpi.collected")} value={money.fmt(s?.collected, currency)} measured={s !== null} />
            <KpiCard label={t("kpi.outstanding")} value={money.fmt(s?.outstanding, currency)} measured={s !== null} />
            <KpiCard label={t("kpi.overdue")} value={money.fmt(s?.overdue, currency)} detail={s ? t("kpi.overdueDetail", { count: s.overdueInvoiceCount }) : undefined} measured={s !== null} />
            <KpiCard label={t("kpi.unallocated")} value={money.fmt(s?.unallocated, currency)} detail={t("kpi.unallocatedDetail")} measured={s !== null} />
          </KpiGrid>
          <BarChart
            title={t("byClassroom.chart")}
            rows={data.byClassroom.map((g) => ({ key: g.groupKey, label: g.label ?? t("byClassroom.noGroup"), value: g.collectionRateBps ?? 0, display: money.bps(g.collectionRateBps), note: t("byClassroom.note", { outstanding: money.fmt(g.outstanding, currency) }) }))}
            valueHeader={t("byClassroom.rate")}
            noteHeader={t("byClassroom.outstanding")}
            empty={t("empty")}
          />
        </>
      ) : null}

      <Section id="tui-receivables" title={t("receivables.title")} actions={<ExportButton dataset={by === "learner" ? "receivables-by-learner" : "receivables-by-classroom"} query={filters as Record<string, string>} />}>
        <div className="flex flex-wrap items-end gap-4">
          <FormField label={t("receivables.by")}>
            {(c) => (
              <NativeSelect
                {...c}
                value={by}
                onChange={(v) => {
                  setBy(v === "learner" ? "learner" : "class");
                  setPage(1);
                }}
                options={[
                  { value: "class", label: t("receivables.byClass") },
                  { value: "learner", label: t("receivables.byLearner") },
                ]}
              />
            )}
          </FormField>
          <CheckControl
            checked={onlyOutstanding}
            onChange={(v) => {
              setOnlyOutstanding(v);
              setPage(1);
            }}
            label={t("receivables.onlyOutstanding")}
          />
        </div>
        <DataTable
          caption={by === "learner" ? t("receivables.captionLearner") : t("receivables.captionClass")}
          columns={[
            { id: "label", header: by === "learner" ? t("receivables.learner") : t("receivables.classroom"), rowHeader: true, cell: (r) => r.label ?? t("receivables.unknown") },
            ...(by === "learner" ? [{ id: "group", header: t("receivables.classroom"), cell: (r: (typeof rows)[number]) => r.groupLabel ?? "—", className: "hidden sm:table-cell" }] : [{ id: "learners", header: t("receivables.learners"), align: "right" as const, cell: (r: (typeof rows)[number]) => r.learnerCount, className: "hidden md:table-cell" }]),
            { id: "billed", header: t("receivables.billed"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.billed, receivables.data?.data.currency ?? currency)}</span>, className: "hidden md:table-cell" },
            { id: "collected", header: t("receivables.collected"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.collected, receivables.data?.data.currency ?? currency)}</span>, className: "hidden md:table-cell" },
            { id: "outstanding", header: t("receivables.outstanding"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.fmt(r.outstanding, receivables.data?.data.currency ?? currency)}</span> },
            { id: "overdue", header: t("receivables.overdue"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.overdue, receivables.data?.data.currency ?? currency)}</span>, className: "hidden sm:table-cell" },
            { id: "rate", header: t("receivables.rate"), align: "right", cell: (r) => money.bps(r.collectionRateBps) },
            ...(by === "learner" ? [{ id: "oldest", header: t("receivables.oldest"), cell: (r: (typeof rows)[number]) => date.civil(r.oldestOverdueDate), className: "hidden lg:table-cell" }] : []),
          ]}
          rows={rows}
          getRowId={(r) => r.id}
          isLoading={receivables.isPending && receivables.fetchStatus !== "idle"}
          error={receivables.error}
          onRetry={() => void receivables.refetch()}
          emptyTitle={t("receivables.empty")}
          pagination={{ page, pageSize: PAGE, total: receivables.data?.data.total ?? 0, onPageChange: setPage }}
        />
      </Section>
    </div>
  );
}

/**
 * Trésorerie : courbe d'encaissements nets des remboursements, créances âgées et principaux débiteurs, écarts de caisse
 * (compté − attendu, calculés par `finance` à la clôture de chaque session).
 */
export function TreasuryScreen() {
  return (
    <FeatureGuard>
      <Treasury />
    </FeatureGuard>
  );
}

function Treasury() {
  const t = useTranslations("v2Owner.treasury");
  const money = useMoney();
  const date = useDateFormat();
  const [scope, setScope] = useScopeState();
  const filters = scopeFilters(scope, FIELDS);
  const [range, setRange] = useState({ from: "", to: "", granularity: "month" as "day" | "week" | "month" });
  const collections = useAnalyticsCollections({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}), granularity: range.granularity });
  const aged = useAnalyticsAged(filters);
  const cash = useAnalyticsCash({});
  const c = collections.data?.data;
  const a = aged.data?.data;
  const k = cash.data?.data;
  const currency = c?.currency ?? a?.currency ?? k?.currency ?? "XOF";
  const bucketLabel = (b: string) => t(`aged.buckets.${(ANALYTICS_AGING_BUCKETS as readonly string[]).includes(b) ? b : "NOT_DUE"}`);

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <ScopeFilters value={scope} onChange={setScope} fields={FIELDS} />

      <Section id="tre-collections" title={t("collections.title")} actions={<ExportButton dataset="collections" query={{ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}), granularity: range.granularity }} />}>
        <form className="grid gap-3 sm:grid-cols-3" noValidate onSubmit={(e) => e.preventDefault()} aria-label={t("collections.filters")}>
          <FormField label={t("collections.from")} hint={t("collections.hint")}>
            {(ctl) => <TextControl {...ctl} type="date" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />}
          </FormField>
          <FormField label={t("collections.to")}>{(ctl) => <TextControl {...ctl} type="date" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />}</FormField>
          <FormField label={t("collections.granularity")}>
            {(ctl) => (
              <NativeSelect
                {...ctl}
                value={range.granularity}
                onChange={(v) => setRange((r) => ({ ...r, granularity: v === "day" || v === "week" ? v : "month" }))}
                options={[
                  { value: "day", label: t("collections.day") },
                  { value: "week", label: t("collections.week") },
                  { value: "month", label: t("collections.month") },
                ]}
              />
            )}
          </FormField>
        </form>
        {collections.isPending && collections.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {collections.isError ? <ErrorBlock error={collections.error} onRetry={() => void collections.refetch()} /> : null}
        {c ? (
          <>
            <FreshnessBar meta={collections.data?.meta} />
            <KpiGrid label={t("collections.kpiLabel")}>
              <KpiCard label={t("collections.collected")} value={money.fmt(c.totals.collected, currency)} detail={t("collections.range", { from: date.civil(c.range.from), to: date.civil(c.range.to) })} measured={c.currency !== null} />
              <KpiCard label={t("collections.refunded")} value={money.fmt(c.totals.refunded, currency)} measured={c.currency !== null} />
              <KpiCard label={t("collections.net")} value={money.fmt(c.totals.net, currency)} measured={c.currency !== null} />
              <KpiCard label={t("collections.payments")} value={date.number(c.totals.paymentCount)} measured={c.currency !== null} />
            </KpiGrid>
            <ColumnChart
              title={t("collections.chart")}
              summary={t("collections.summary", { count: c.points.length })}
              rows={c.points.map((p) => ({ key: p.bucket, label: p.bucket.slice(c.granularity === "month" ? 2 : 5, c.granularity === "month" ? 7 : 10), value: Math.max(0, p.net), display: money.fmt(p.net, currency), note: String(p.paymentCount) }))}
              valueHeader={t("collections.net")}
              noteHeader={t("collections.payments")}
              empty={t("empty")}
            />
          </>
        ) : null}
      </Section>

      <Section id="tre-aged" title={t("aged.title")} actions={<ExportButton dataset="aged-balance" query={filters as Record<string, string>} />}>
        {aged.isPending && aged.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {aged.isError ? <ErrorBlock error={aged.error} onRetry={() => void aged.refetch()} /> : null}
        {a ? (
          <>
            <FreshnessBar meta={aged.data?.meta} />
            <BarChart
              title={t("aged.chart", { total: money.fmt(a.total, currency) })}
              rows={a.buckets.map((b) => ({ key: b.bucket, label: bucketLabel(b.bucket), value: Math.max(0, b.amount), display: money.fmt(b.amount, currency), note: t("aged.invoices", { count: b.invoiceCount }) }))}
              valueHeader={t("aged.amount")}
              noteHeader={t("aged.invoicesHeader")}
              empty={t("empty")}
            />
            <DataTable
              caption={t("aged.caption")}
              columns={[
                { id: "learner", header: t("aged.learner"), rowHeader: true, cell: (r) => r.learnerName ?? t("aged.unknown") },
                { id: "d1", header: t("aged.buckets.D1_30"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.d1_30, currency)}</span>, className: "hidden md:table-cell" },
                { id: "d31", header: t("aged.buckets.D31_60"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.d31_60, currency)}</span>, className: "hidden md:table-cell" },
                { id: "d61", header: t("aged.buckets.D61_90"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.d61_90, currency)}</span>, className: "hidden lg:table-cell" },
                { id: "d91", header: t("aged.buckets.D91_PLUS"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.d91_plus, currency)}</span>, className: "hidden lg:table-cell" },
                { id: "total", header: t("aged.total"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.fmt(r.total, currency)}</span> },
              ]}
              rows={a.learners}
              getRowId={(r) => r.learnerId}
              emptyTitle={t("aged.empty")}
            />
          </>
        ) : null}
      </Section>

      <Section id="tre-cash" title={t("cash.title")} actions={<ExportButton dataset="cash-sessions" />}>
        {cash.isPending && cash.fetchStatus !== "idle" ? <LoadingBlock /> : null}
        {cash.isError ? <ErrorBlock error={cash.error} onRetry={() => void cash.refetch()} /> : null}
        {k ? (
          <>
            <FreshnessBar meta={cash.data?.meta} />
            <KpiGrid label={t("cash.kpiLabel")}>
              <KpiCard label={t("cash.closed")} value={date.number(k.totals.closed)} detail={t("cash.closedDetail", { sessions: k.totals.sessions })} />
              <KpiCard label={t("cash.withVariance")} value={date.number(k.totals.withVariance)} />
              <KpiCard label={t("cash.netVariance")} value={money.fmt(k.totals.netVariance, currency)} detail={varianceText(t, k.totals.netVariance, money.fmt(Math.abs(k.totals.netVariance), currency))} />
              <KpiCard label={t("cash.absoluteVariance")} value={money.fmt(k.totals.absoluteVariance, currency)} />
            </KpiGrid>
            <DataTable
              caption={t("cash.caption")}
              columns={[
                { id: "closedAt", header: t("cash.closedAt"), rowHeader: true, cell: (r) => (r.closedAt ? date.instant(r.closedAt) : t("cash.stillOpen")) },
                { id: "expected", header: t("cash.expected"), align: "right", cell: (r) => <span className="tabular-nums">{r.expected === null ? "—" : money.fmt(r.expected, currency)}</span>, className: "hidden sm:table-cell" },
                { id: "counted", header: t("cash.counted"), align: "right", cell: (r) => <span className="tabular-nums">{r.counted === null ? "—" : money.fmt(r.counted, currency)}</span>, className: "hidden sm:table-cell" },
                { id: "variance", header: t("cash.variance"), align: "right", cell: (r) => (r.variance === null ? "—" : <span className="font-medium tabular-nums">{varianceText(t, r.variance, money.fmt(Math.abs(r.variance), currency))}</span>) },
              ]}
              rows={k.sessions}
              getRowId={(r) => r.sessionId}
              emptyTitle={t("cash.empty")}
            />
          </>
        ) : null}
      </Section>
    </div>
  );
}

/** Le signe d'un écart se dit en toutes lettres (jamais la couleur seule) : manque, excédent, juste. */
function varianceText(t: ReturnType<typeof useTranslations>, variance: number, absolute: string): string {
  if (variance === 0) return t("cash.balanced");
  return variance < 0 ? t("cash.short", { amount: absolute }) : t("cash.over", { amount: absolute });
}
