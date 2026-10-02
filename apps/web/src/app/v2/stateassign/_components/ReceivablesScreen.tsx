"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { RECEIVABLE_AGING_BUCKETS, RECEIVABLE_STATUSES, type ReceivableDto } from "@ecoledigitale/contracts/v2/stateassign";
import { useReceivables, useReceivablesAging } from "@/platform/v2/stateassign";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { useDateFormat } from "@/platform/ui/format";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useMoney } from "@/platform/ui/money";
import { PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { RECEIVABLE_TONE, ScopeFilters, scopeQuery, isIsoDate, type Scope } from "./stateassign-utils";

function Aging({ scope }: { scope: Scope }) {
  const t = useTranslations("v2Stateassign.receivablesScreen.aging");
  const tBucket = useTranslations("v2Stateassign.agingBucket");
  const money = useMoney();
  const date = useDateFormat();
  const aging = useReceivablesAging(scopeQuery(scope));
  if (aging.isPending) return <LoadingBlock />;
  if (aging.isError) return <ErrorBlock error={aging.error} onRetry={() => void aging.refetch()} />;
  const a = aging.data;
  return (
    <section aria-labelledby="aging-title" className="space-y-3 rounded-lg border p-4">
      <h2 id="aging-title" className="text-base font-semibold">{t("title")}</h2>
      <p className="text-xs text-muted-foreground">{t("asOf", { date: date.civil(a.asOf) })}</p>
      <dl className="grid gap-3 sm:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">{t("expected")}</dt><dd className="text-lg font-semibold">{money.of(a.totals.expected)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("received")}</dt><dd className="text-lg font-semibold">{money.of(a.totals.received)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("outstanding")}</dt><dd className="text-lg font-semibold">{money.of(a.totals.outstanding)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t("overdue", { count: a.totals.overdueReceivables })}</dt><dd className="text-lg font-semibold text-red-700">{money.of(a.totals.overdue)}</dd></div>
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-1 pr-3 font-medium">{t("bucket")}</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">{t("count")}</th>
              <th scope="col" className="py-1 text-right font-medium">{t("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {RECEIVABLE_AGING_BUCKETS.map((b) => {
              const row = a.buckets.find((x) => x.bucket === b);
              return (
                <tr key={b}>
                  <th scope="row" className="py-1 pr-3 text-left font-medium">{tBucket(b)}</th>
                  <td className="py-1 pr-3 text-right">{row?.count ?? 0}</td>
                  <td className="py-1 text-right">{money.of(row?.outstanding)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Créances sur l'État de tout l'établissement : échéances, reçu (rapproché des paiements de `finance`), retards et ancienneté. */
export function ReceivablesScreen() {
  const t = useTranslations("v2Stateassign.receivablesScreen");
  const tStatus = useTranslations("v2Stateassign.receivableStatus");
  const date = useDateFormat();
  const money = useMoney();
  const [scope, setScope] = useState<Scope>({ institutionId: "", academicYearId: "" });
  const [status, setStatus] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const query = useReceivables({ ...scopeQuery(scope), ...(status ? { status } : {}), overdueOnly, ...(isIsoDate(dueFrom) ? { dueFrom } : {}), ...(isIsoDate(dueTo) ? { dueTo } : {}), page, pageSize });

  const columns = useMemo<DataTableColumn<ReceivableDto>[]>(
    () => [
      {
        id: "student",
        header: t("columns.student"),
        rowHeader: true,
        cell: (r) => (
          <Link href={`/v2/stateassign/${r.assignmentId}`} className="font-medium underline-offset-2 hover:underline">
            {r.studentName ?? r.assignmentReference ?? t("unknown")}
          </Link>
        ),
      },
      { id: "reference", header: t("columns.reference"), className: "hidden md:table-cell", cell: (r) => r.assignmentReference ?? "—" },
      { id: "label", header: t("columns.label"), cell: (r) => `${r.seq}. ${r.label}` },
      { id: "due", header: t("columns.dueOn"), cell: (r) => date.civil(r.dueOn) },
      { id: "expected", header: t("columns.expected"), align: "right", cell: (r) => money.of(r.expected) },
      { id: "received", header: t("columns.received"), align: "right", className: "hidden md:table-cell", cell: (r) => money.of(r.received) },
      { id: "outstanding", header: t("columns.outstanding"), align: "right", cell: (r) => money.of(r.outstanding) },
      {
        id: "status",
        header: t("columns.status"),
        cell: (r) => (
          <span className="flex flex-wrap items-center gap-1">
            <StatusBadge label={tStatus(r.status)} tone={RECEIVABLE_TONE[r.status]} />
            {r.overdue ? <StatusBadge label={t("overdue", { days: r.daysOverdue })} tone="danger" /> : null}
          </span>
        ),
      },
    ],
    [t, tStatus, date, money],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("explain")}</Notice>
      <ScopeFilters value={scope} onChange={(s) => { setScope(s); setPage(1); }} />
      <Aging scope={scope} />
      <div className="grid gap-3 sm:grid-cols-4">
        <FormField label={t("filters.status")}>
          {(c) => <NativeSelect {...c} value={status} onChange={(v) => { setStatus(v); setPage(1); }} placeholder={t("filters.allStatuses")} options={RECEIVABLE_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("filters.dueFrom")}>{(c) => <TextControl {...c} type="date" value={dueFrom} onChange={(v) => { setDueFrom(v); setPage(1); }} />}</FormField>
        <FormField label={t("filters.dueTo")}>{(c) => <TextControl {...c} type="date" value={dueTo} onChange={(v) => { setDueTo(v); setPage(1); }} />}</FormField>
        <div className="flex items-end">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setPage(1); }} className="h-4 w-4" />
            {t("filters.overdueOnly")}
          </label>
        </div>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={query.data?.items ?? []}
        getRowId={(r) => r.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={{ page, pageSize, total: query.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (n) => { setPageSize(n); setPage(1); } }}
      />
    </div>
  );
}
