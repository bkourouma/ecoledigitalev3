"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FINANCE_AGING_BUCKETS, type FinanceSummaryDto } from "@ecoledigitale/contracts/v2/finance";
import { usePermission } from "@/platform/access";
import { useAgedBalance, useCollectionsTrend, useFinanceSummary, useProviderAccountsReport, useReceivablesByGroup, useReceivablesByLearner } from "@/platform/v2/finance";
import { Can } from "@/platform/ui/AccessGate";
import { downloadText, toCsv, type CsvCell } from "@/platform/ui/csv";
import { DataTable } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import { AcademicYearField, LearnerName, useLearnerLabels } from "./shared";

/** Bouton d'export CSV : sérialise les lignes DÉJÀ calculées par l'API (aucun total recalculé ici). */
function ExportButton({ filename, header, rows, disabled }: { filename: string; header: readonly string[]; rows: ReadonlyArray<ReadonlyArray<CsvCell>>; disabled?: boolean }) {
  const t = useTranslations("v2Finance.reports");
  return (
    <button type="button" className={buttonClass.secondary} disabled={disabled || rows.length === 0} onClick={() => downloadText(filename, toCsv(header, rows))}>
      {t("export")}
    </button>
  );
}

export function SummaryCards({ summary }: { summary: FinanceSummaryDto }) {
  const t = useTranslations("v2Finance.reports.summary");
  const money = useMoney();
  const date = useDateFormat();
  const cards: Array<[string, string, string?]> = [
    ["billed", money.of(summary.billed)],
    ["credited", money.of(summary.credited)],
    ["netBilled", money.of(summary.netBilled)],
    ["collected", money.of(summary.collected)],
    ["outstanding", money.of(summary.outstanding)],
    ["overdue", money.of(summary.overdue), t("overdueCount", { count: summary.overdueInvoiceCount })],
    ["unallocated", money.of(summary.unallocatedPayments)],
    ["rate", summary.collectionRateBps === null ? t("rateNone") : money.bps(summary.collectionRateBps)],
  ];
  return (
    <section aria-labelledby="fin-summary" className="space-y-3">
      <h2 id="fin-summary" className="text-lg font-semibold">
        {t("title")} <span className="text-sm font-normal text-muted-foreground">{t("asOf", { date: date.civil(summary.asOf), count: summary.invoiceCount })}</span>
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([key, value, note]) => (
          <div key={key} className="rounded-lg border p-4">
            <dt className="text-sm text-muted-foreground">{t(`cards.${key}`)}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
            {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Vue d'ensemble : indicateurs de l'année en cours et raccourcis (chacun masqué sans la permission correspondante). */
export function FinanceOverviewScreen() {
  const t = useTranslations("v2Finance.overview");
  const canReport = usePermission("finance.report.read");
  const summary = useFinanceSummary({}, { enabled: canReport.allowed });
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {canReport.allowed && summary.isPending && summary.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : null}
      {summary.data ? <SummaryCards summary={summary.data} /> : null}
      <section aria-labelledby="fin-shortcuts" className="space-y-3">
        <h2 id="fin-shortcuts" className="text-lg font-semibold">
          {t("shortcuts")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["finance.payment.create", "/v2/finance/payments/new", "collect"],
              ["finance.invoice.create", "/v2/finance/invoices/new", "invoice"],
              ["finance.cashregister.open", "/v2/finance/cash", "cash"],
              ["finance.report.read", "/v2/finance/reports", "reports"],
              ["finance.invoice.read", "/v2/finance/invoices?status=OVERDUE", "overdue"],
              ["finance.payment.refund", "/v2/finance/refunds", "refunds"],
            ] as const
          ).map(([permission, href, key]) => (
            <Can key={key} permission={permission}>
              <li>
                <Link href={href} className="block rounded-lg border p-4 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block font-medium">{t(`links.${key}.title`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`links.${key}.hint`)}</span>
                </Link>
              </li>
            </Can>
          ))}
        </ul>
      </section>
    </div>
  );
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function ReportsScreen() {
  const t = useTranslations("v2Finance.reports");
  const [filters, setFilters] = useState({ academicYear: "", asOf: "", groupKey: "" });
  const query = useMemo(
    () => ({
      ...(filters.academicYear ? { academicYear: filters.academicYear } : {}),
      ...(filters.asOf ? { asOf: filters.asOf } : {}),
      ...(filters.groupKey.trim() ? { groupKey: filters.groupKey.trim() } : {}),
    }),
    [filters],
  );
  const summary = useFinanceSummary(query);

  return (
    <div className="space-y-8">
      <PageHeader title={t("title")} description={t("description")} />
      <form className="grid gap-3 sm:grid-cols-3" noValidate onSubmit={(e) => e.preventDefault()} aria-label={t("filters.label")}>
        <AcademicYearField label={t("filters.year")} value={filters.academicYear} onChange={(v) => setFilters((f) => ({ ...f, academicYear: v }))} allowEmpty />
        <FormField label={t("filters.asOf")} hint={t("filters.asOfHint")}>
          {(c) => <TextControl {...c} type="date" value={filters.asOf} onChange={(v) => setFilters((f) => ({ ...f, asOf: v }))} />}
        </FormField>
        <FormField label={t("filters.group")} hint={t("filters.groupHint")}>
          {(c) => <TextControl {...c} value={filters.groupKey} onChange={(v) => setFilters((f) => ({ ...f, groupKey: v }))} />}
        </FormField>
      </form>
      <nav aria-label={t("anchors.label")} className="flex flex-wrap gap-3 text-sm">
        {(["groups", "learners", "aged", "trend", "accounts"] as const).map((k) => (
          <a key={k} href={`#rep-${k}`} className="text-primary underline-offset-4 hover:underline">
            {t(`anchors.${k}`)}
          </a>
        ))}
      </nav>
      {summary.isPending && summary.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : null}
      {summary.data ? <SummaryCards summary={summary.data} /> : null}
      <GroupsReport query={query} />
      <LearnersReport query={query} />
      <AgedReport query={query} />
      <TrendReport />
      <AccountsReport />
    </div>
  );
}

type ReportQuery = { academicYear?: string; asOf?: string; groupKey?: string };

function GroupsReport({ query }: { query: ReportQuery }) {
  const t = useTranslations("v2Finance.reports.groups");
  const money = useMoney();
  const groups = useReceivablesByGroup(query);
  const rows = groups.data ?? [];
  return (
    <section id="rep-groups" aria-labelledby="rep-groups-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rep-groups-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <ExportButton
          filename="creances-par-classe.csv"
          header={[t("columns.group"), t("columns.learners"), t("columns.billed"), t("columns.collected"), t("columns.outstanding"), t("columns.overdue"), t("columns.rate")]}
          rows={rows.map((r) => [r.label ?? r.key ?? "", r.learnerCount, r.billed.amount, r.collected.amount, r.outstanding.amount, r.overdue.amount, r.collectionRateBps === null ? "" : r.collectionRateBps])}
        />
      </div>
      <DataTable
        caption={t("caption")}
        columns={[
          {
            id: "group",
            header: t("columns.group"),
            rowHeader: true,
            cell: (r) =>
              r.key ? (
                <Link href={`/v2/finance/invoices?groupKey=${encodeURIComponent(r.key)}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {r.label ?? r.key}
                </Link>
              ) : (
                t("noGroup")
              ),
          },
          { id: "learners", header: t("columns.learners"), align: "right", cell: (r) => r.learnerCount, className: "hidden md:table-cell" },
          { id: "billed", header: t("columns.billed"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.billed)}</span>, className: "hidden sm:table-cell" },
          { id: "collected", header: t("columns.collected"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.collected)}</span>, className: "hidden md:table-cell" },
          { id: "outstanding", header: t("columns.outstanding"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.of(r.outstanding)}</span> },
          { id: "overdue", header: t("columns.overdue"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.overdue)}</span>, className: "hidden lg:table-cell" },
          { id: "rate", header: t("columns.rate"), align: "right", cell: (r) => (r.collectionRateBps === null ? "—" : money.bps(r.collectionRateBps)) },
        ]}
        rows={rows}
        getRowId={(r) => r.key ?? "none"}
        isLoading={groups.isPending && groups.fetchStatus !== "idle"}
        error={groups.error}
        onRetry={() => void groups.refetch()}
        emptyTitle={t("empty")}
      />
    </section>
  );
}

const PAGE = 25;

function LearnersReport({ query }: { query: ReportQuery }) {
  const t = useTranslations("v2Finance.reports.learners");
  const money = useMoney();
  const date = useDateFormat();
  const [page, setPage] = useState(1);
  const [onlyOutstanding, setOnlyOutstanding] = useState(true);
  const list = useReceivablesByLearner({ ...query, onlyOutstanding, limit: PAGE, offset: (page - 1) * PAGE });
  const labels = useLearnerLabels(list.data?.items.map((r) => r.learnerId) ?? []);
  const rows = list.data?.items ?? [];
  return (
    <section id="rep-learners" aria-labelledby="rep-learners-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rep-learners-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <ExportButton
          filename="creances-par-apprenant.csv"
          header={[t("columns.learner"), t("columns.billed"), t("columns.collected"), t("columns.outstanding"), t("columns.overdue"), t("columns.rate"), t("columns.oldest")]}
          rows={rows.map((r) => [labels.get(r.learnerId) ?? r.learnerId, r.billed.amount, r.collected.amount, r.outstanding.amount, r.overdue.amount, r.collectionRateBps === null ? "" : r.collectionRateBps, r.oldestOverdueDate ?? ""])}
        />
      </div>
      <CheckControl
        checked={onlyOutstanding}
        onChange={(v) => {
          setOnlyOutstanding(v);
          setPage(1);
        }}
        label={t("onlyOutstanding")}
      />
      <DataTable
        caption={t("caption")}
        columns={[
          {
            id: "learner",
            header: t("columns.learner"),
            rowHeader: true,
            cell: (r) => (
              <Link href={`/v2/finance/invoices?learnerId=${r.learnerId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                <LearnerName id={r.learnerId} labels={labels} />
              </Link>
            ),
          },
          { id: "billed", header: t("columns.billed"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.billed)}</span>, className: "hidden md:table-cell" },
          { id: "collected", header: t("columns.collected"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.collected)}</span>, className: "hidden md:table-cell" },
          { id: "outstanding", header: t("columns.outstanding"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.of(r.outstanding)}</span> },
          { id: "overdue", header: t("columns.overdue"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.overdue)}</span>, className: "hidden sm:table-cell" },
          { id: "oldest", header: t("columns.oldest"), cell: (r) => date.civil(r.oldestOverdueDate), className: "hidden lg:table-cell" },
        ]}
        rows={rows}
        getRowId={(r) => r.learnerId}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        pagination={{ page, pageSize: PAGE, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
    </section>
  );
}

/** Q-PAY-30 : paiements en ligne de l'établissement par fournisseur et par compte (propre / plateforme), jamais mêlés à d'autres écoles. */
function AccountsReport() {
  const t = useTranslations("v2Finance.reports.accounts");
  const money = useMoney();
  const report = useProviderAccountsReport();
  const rows = report.data?.items ?? [];
  return (
    <section id="rep-accounts" aria-labelledby="rep-accounts-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rep-accounts-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <ExportButton
          filename="paiements-par-compte.csv"
          header={[t("columns.provider"), t("columns.account"), t("columns.confirmed"), t("columns.pending"), t("columns.flagged"), t("columns.failed")]}
          rows={rows.map((r) => [r.provider, t(`account.${r.account}`), r.confirmed.amount, r.pending.amount, r.flaggedCount, r.failedCount])}
        />
      </div>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <DataTable
        caption={t("caption")}
        columns={[
          { id: "provider", header: t("columns.provider"), rowHeader: true, cell: (r) => r.provider },
          { id: "account", header: t("columns.account"), cell: (r) => t(`account.${r.account}`) },
          { id: "confirmed", header: t("columns.confirmed"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.of(r.confirmed)}</span> },
          { id: "pending", header: t("columns.pending"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.pending)}</span>, className: "hidden sm:table-cell" },
          { id: "flagged", header: t("columns.flagged"), align: "right", cell: (r) => r.flaggedCount, className: "hidden md:table-cell" },
          { id: "failed", header: t("columns.failed"), align: "right", cell: (r) => r.failedCount, className: "hidden md:table-cell" },
        ]}
        rows={rows}
        getRowId={(r) => `${r.provider}:${r.account}`}
        isLoading={report.isPending && report.fetchStatus !== "idle"}
        error={report.error}
        onRetry={() => void report.refetch()}
        emptyTitle={t("empty")}
      />
    </section>
  );
}

function AgedReport({ query }: { query: ReportQuery }) {
  const t = useTranslations("v2Finance.reports.aged");
  const tAging = useTranslations("v2Finance.aging");
  const money = useMoney();
  const aged = useAgedBalance({ ...query, byLearner: 10 });
  const labels = useLearnerLabels(aged.data?.learners.map((l) => l.learnerId) ?? []);
  const data = aged.data;
  return (
    <section id="rep-aged" aria-labelledby="rep-aged-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rep-aged-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <ExportButton
          filename="balance-agee.csv"
          header={[t("columns.bucket"), t("columns.amount"), t("columns.invoices")]}
          rows={data ? FINANCE_AGING_BUCKETS.map((b) => [tAging(b), data.buckets[b]?.amount.amount ?? 0, data.buckets[b]?.invoiceCount ?? 0]) : []}
        />
      </div>
      {aged.isPending && aged.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {aged.isError ? <ErrorBlock error={aged.error} onRetry={() => void aged.refetch()} /> : null}
      {data ? (
        <>
          <DataTable
            caption={t("caption")}
            columns={[
              { id: "bucket", header: t("columns.bucket"), rowHeader: true, cell: (b: (typeof FINANCE_AGING_BUCKETS)[number]) => tAging(b) },
              { id: "amount", header: t("columns.amount"), align: "right", cell: (b) => <span className="font-medium tabular-nums">{money.of(data.buckets[b]?.amount)}</span> },
              { id: "invoices", header: t("columns.invoices"), align: "right", cell: (b) => data.buckets[b]?.invoiceCount ?? 0 },
            ]}
            rows={[...FINANCE_AGING_BUCKETS]}
            getRowId={(b) => b}
          />
          <p className="text-sm">
            {t("total")} <strong className="tabular-nums">{money.of(data.total)}</strong>
          </p>
          {data.learners.length > 0 ? (
            <>
              <h3 className="text-base font-semibold">{t("topLearners")}</h3>
              <DataTable
                caption={t("learnersCaption")}
                columns={[
                  { id: "learner", header: t("columns.learner"), rowHeader: true, cell: (l: (typeof data.learners)[number]) => <LearnerName id={l.learnerId} labels={labels} /> },
                  ...FINANCE_AGING_BUCKETS.map((b) => ({ id: b, header: tAging(b), align: "right" as const, className: "hidden md:table-cell", cell: (l: (typeof data.learners)[number]) => <span className="tabular-nums">{money.of(l.buckets[b])}</span> })),
                  { id: "total", header: t("columns.total"), align: "right" as const, cell: (l: (typeof data.learners)[number]) => <span className="font-medium tabular-nums">{money.of(l.total)}</span> },
                ]}
                rows={data.learners}
                getRowId={(l) => l.learnerId}
              />
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function TrendReport() {
  const t = useTranslations("v2Finance.reports.trend");
  const tGran = useTranslations("v2Finance.reports.trend.granularity");
  const money = useMoney();
  const date = useDateFormat();
  const today = new Date();
  const [range, setRange] = useState({ from: isoDay(new Date(today.getTime() - 89 * 86_400_000)), to: isoDay(today), granularity: "week" as "day" | "week" | "month" });
  const valid = range.from !== "" && range.to !== "" && range.from <= range.to;
  const trend = useCollectionsTrend({ from: range.from, to: range.to, granularity: range.granularity }, { enabled: valid });
  const rows = valid ? (trend.data ?? []) : [];
  // Largeur des barres : mise en forme (proportion de la plus grande valeur affichée), jamais un chiffre financier.
  const max = rows.reduce((m, r) => Math.max(m, r.collected.amount), 0);
  return (
    <section id="rep-trend" aria-labelledby="rep-trend-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rep-trend-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <ExportButton filename="evolution-encaissements.csv" header={[t("columns.bucket"), t("columns.collected"), t("columns.refunded"), t("columns.net"), t("columns.count")]} rows={rows.map((r) => [r.bucket, r.collected.amount, r.refunded.amount, r.net.amount, r.paymentCount])} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("from")}>{(c) => <TextControl {...c} type="date" value={range.from} onChange={(v) => setRange((r) => ({ ...r, from: v }))} />}</FormField>
        <FormField label={t("to")}>{(c) => <TextControl {...c} type="date" value={range.to} onChange={(v) => setRange((r) => ({ ...r, to: v }))} />}</FormField>
        <FormField label={t("granularityLabel")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={range.granularity}
              onChange={(v) => setRange((r) => ({ ...r, granularity: v as "day" | "week" | "month" }))}
              options={(["day", "week", "month"] as const).map((g) => ({ value: g, label: tGran(g) }))}
            />
          )}
        </FormField>
      </div>
      {!valid ? <p role="alert" className="text-sm text-destructive">{t("invalidRange")}</p> : null}
      <DataTable
        caption={t("caption")}
        columns={[
          { id: "bucket", header: t("columns.bucket"), rowHeader: true, cell: (r) => date.civil(r.bucket) },
          {
            id: "collected",
            header: t("columns.collected"),
            align: "right",
            cell: (r) => (
              <div className="flex items-center justify-end gap-2">
                <span aria-hidden="true" className="hidden h-2 rounded bg-primary/60 sm:block" style={{ width: max > 0 ? `${Math.round((r.collected.amount / max) * 100)}px` : 0 }} />
                <span className="font-medium tabular-nums">{money.of(r.collected)}</span>
              </div>
            ),
          },
          { id: "refunded", header: t("columns.refunded"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.refunded)}</span>, className: "hidden sm:table-cell" },
          { id: "net", header: t("columns.net"), align: "right", cell: (r) => <span className="tabular-nums">{money.of(r.net)}</span>, className: "hidden md:table-cell" },
          { id: "count", header: t("columns.count"), align: "right", cell: (r) => r.paymentCount, className: "hidden md:table-cell" },
        ]}
        rows={rows}
        getRowId={(r) => r.bucket}
        isLoading={valid && trend.isPending && trend.fetchStatus !== "idle"}
        error={valid ? trend.error : undefined}
        onRetry={() => void trend.refetch()}
        emptyTitle={t("empty")}
      />
    </section>
  );
}
