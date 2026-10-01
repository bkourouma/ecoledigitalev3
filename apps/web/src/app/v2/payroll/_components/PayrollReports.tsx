"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useStaffOptions } from "@/platform/v2/lookups";
import { useAcademicYears } from "@/platform/v2/academic";
import { fetchPayrollCsv, useMyPayslipData, useMyPayslips, useOwnerMass, useOwnerValidate, usePayHistory, usePayPeriods, usePayrollSummary, usePayslips, type ReportQuery } from "@/platform/v2/payroll";
import { useFeature } from "@/platform/access";
import { Can, FeatureNotice } from "@/platform/ui/AccessGate";
import { downloadText } from "@/platform/ui/csv";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { PayslipDocument } from "./PayslipDocument";
import { PayslipStatusBadge, useRejectionHint } from "./shared";

const useTeacherOptions = (search: string, enabled: boolean) => useStaffOptions(search, enabled, { canTeach: true });
const PAGE = 25;

/** Bouton d'export CSV : le fichier est produit (et audité) par l'API ; le web ne fait que le télécharger. */
function CsvExport({ kind, query, filename }: { kind: "history" | "reports"; query: ReportQuery; filename: string }) {
  const t = useTranslations("v2Payroll.export");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    setState("loading");
    setMessage(null);
    try {
      const text = await fetchPayrollCsv(kind, query);
      // `Response.text()` retire le BOM UTF-8 : on le remet pour que le tableur lise correctement les accents.
      downloadText(filename, text.startsWith("﻿") ? text : `﻿${text}`);
      setState("idle");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : null);
    }
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className={buttonClass.secondary} onClick={() => void run()} disabled={state === "loading"}>
        {state === "loading" ? t("loading") : t("button")}
      </button>
      {state === "error" ? (
        <p role="alert" className="text-xs text-destructive">
          {message ?? t("error")}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique des paiements
// ---------------------------------------------------------------------------

export function HistoryScreen() {
  const t = useTranslations("v2Payroll.history");
  const tMethod = useTranslations("v2Payroll.method");
  const money = useMoney();
  const date = useDateFormat();
  const years = useAcademicYears();
  const periods = usePayPeriods({ limit: 100 });
  const [staff, setStaff] = useState<SelectOption | null>(null);
  // Changer d'année réinitialise la période (une période appartient à une année).
  const [filters, setFilters] = useState({ academicYearId: "", periodId: "" });
  const [page, setPage] = useState(1);
  const query = { staffId: staff?.value, academicYearId: filters.academicYearId || undefined, periodId: filters.periodId || undefined };
  const list = usePayHistory({ ...query, limit: PAGE, offset: (page - 1) * PAGE });
  const visiblePeriods = (periods.data?.items ?? []).filter((p) => !filters.academicYearId || p.academicYearId === filters.academicYearId);

  const columns: DataTableColumn<NonNullable<typeof list.data>["items"][number]>[] = [
    {
      id: "staff",
      header: t("columns.staff"),
      rowHeader: true,
      cell: (p) => (
        <Link href={`/v2/payroll/payslips/${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {p.staffName}
        </Link>
      ),
    },
    { id: "status", header: t("columns.status"), cell: (p) => <PayslipStatusBadge status={p.status} /> },
    { id: "approved", header: t("columns.approved"), cell: (p) => (p.approvedAt ? t("onBy", { date: date.instant(p.approvedAt), name: p.approvedByName ?? "—" }) : "—"), className: "hidden md:table-cell" },
    { id: "paid", header: t("columns.paid"), cell: (p) => (p.paidAt ? t("paidOnBy", { date: date.instant(p.paidAt), name: p.paidByName ?? "—", method: p.paymentMethod ? tMethod(p.paymentMethod) : "—" }) : "—"), className: "hidden lg:table-cell" },
    { id: "total", header: t("columns.total"), align: "right", cell: (p) => <span className="font-medium tabular-nums">{money.fmt(p.totalAmount, p.currency)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={<CsvExport kind="history" query={query} filename="historique-paie.csv" />} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.year")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={filters.academicYearId}
              onChange={(v) => {
                setFilters({ academicYearId: v, periodId: "" });
                setPage(1);
              }}
              placeholder={t("filters.allYears")}
              options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))}
            />
          )}
        </FormField>
        <FormField label={t("filters.period")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={filters.periodId}
              onChange={(v) => {
                setFilters((f) => ({ ...f, periodId: v }));
                setPage(1);
              }}
              placeholder={t("filters.allPeriods")}
              options={visiblePeriods.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
        </FormField>
        <FormField label={t("filters.staff")}>
          {(c) => (
            <SelectAsync
              {...c}
              value={staff}
              onChange={(o) => {
                setStaff(o);
                setPage(1);
              }}
              useOptions={useTeacherOptions}
              placeholder={t("filters.staffPlaceholder")}
            />
          )}
        </FormField>
      </div>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(p) => p.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={{ page, pageSize: PAGE, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rapports de paie
// ---------------------------------------------------------------------------

export function PayrollReportsScreen() {
  const t = useTranslations("v2Payroll.reports");
  const tSource = useTranslations("v2Payroll.source");
  const tScope = useTranslations("v2Payroll.scope");
  const money = useMoney();
  const years = useAcademicYears();
  const periods = usePayPeriods({ limit: 100 });
  const [filters, setFilters] = useState({ academicYearId: "", periodId: "", source: "ALL", from: "", to: "" });
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const query: ReportQuery = {
    ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
    ...(filters.periodId ? { periodId: filters.periodId } : {}),
    ...(filters.source !== "ALL" ? { source: filters.source as "SESSION" | "ATTENDANCE" } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(staff ? { staffId: staff.value } : {}),
  };
  const summary = usePayrollSummary(query);
  const set = (k: keyof typeof filters) => (v: string) => setFilters((f) => (k === "academicYearId" ? { ...f, academicYearId: v, periodId: "" } : { ...f, [k]: v }));
  const visiblePeriods = (periods.data?.items ?? []).filter((p) => !filters.academicYearId || p.academicYearId === filters.academicYearId);
  const tStatus = useTranslations("v2Payroll.status.payslip");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={<CsvExport kind="reports" query={query} filename="rapport-paie.csv" />} />
      <form noValidate onSubmit={(e) => e.preventDefault()} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("filters.label")}>
        <FormField label={t("filters.year")}>
          {(c) => <NativeSelect {...c} value={filters.academicYearId} onChange={set("academicYearId")} placeholder={t("filters.allYears")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
        </FormField>
        <FormField label={t("filters.period")}>
          {(c) => <NativeSelect {...c} value={filters.periodId} onChange={set("periodId")} placeholder={t("filters.allPeriods")} options={visiblePeriods.map((p) => ({ value: p.id, label: p.name }))} />}
        </FormField>
        <FormField label={t("filters.source")} hint={t("filters.sourceHint")}>
          {(c) => <NativeSelect {...c} value={filters.source} onChange={set("source")} options={(["ALL", "SESSION", "ATTENDANCE"] as const).map((s) => ({ value: s, label: tScope(s) }))} />}
        </FormField>
        <FormField label={t("filters.from")}>{(c) => <TextControl {...c} type="date" value={filters.from} onChange={set("from")} />}</FormField>
        <FormField label={t("filters.to")}>{(c) => <TextControl {...c} type="date" value={filters.to} onChange={set("to")} />}</FormField>
        <FormField label={t("filters.staff")}>{(c) => <SelectAsync {...c} value={staff} onChange={setStaff} useOptions={useTeacherOptions} placeholder={t("filters.staffPlaceholder")} />}</FormField>
      </form>
      {summary.isPending && summary.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : null}
      {summary.data ? (
        <>
          <DataTable
            caption={t("caption")}
            columns={[
              { id: "status", header: t("columns.status"), rowHeader: true, cell: (r) => tStatus(r.status) },
              { id: "payslips", header: t("columns.payslips"), align: "right", cell: (r) => r.payslips },
              { id: "attendance", header: t("columns.attendance"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.attendance)}</span>, className: "hidden md:table-cell" },
              { id: "session", header: t("columns.session"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.session)}</span>, className: "hidden md:table-cell" },
              { id: "outOfHours", header: t("columns.outOfHours"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.outOfHours)}</span>, className: "hidden lg:table-cell" },
              { id: "total", header: t("columns.total"), align: "right", cell: (r) => <span className="font-medium tabular-nums">{money.fmt(r.total)}</span> },
              { id: "filtered", header: t("columns.filtered"), align: "right", cell: (r) => <span className="tabular-nums">{money.fmt(r.filtered)}</span>, className: "hidden sm:table-cell" },
            ]}
            rows={summary.data.rows}
            getRowId={(r) => r.status}
            emptyTitle={t("empty")}
          />
          <p className="text-sm">
            {t("filteredTotal")} <strong className="tabular-nums">{money.fmt(summary.data.filteredTotal)}</strong>
          </p>
          {summary.data.sources.length > 0 ? (
            <DataTable
              caption={t("sourcesCaption")}
              columns={[
                { id: "kind", header: t("sources.kind"), rowHeader: true, cell: (s) => tSource(s.kind) },
                { id: "minutes", header: t("sources.minutes"), align: "right", cell: (s) => money.minutes(s.minutes) },
                { id: "amount", header: t("sources.amount"), align: "right", cell: (s) => <span className="font-medium tabular-nums">{money.fmt(s.amount)}</span> },
              ]}
              rows={summary.data.sources}
              getRowId={(s) => s.kind}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Masse salariale et validation du propriétaire
// ---------------------------------------------------------------------------

export function OwnerScreen() {
  const t = useTranslations("v2Payroll.owner");
  const tStatus = useTranslations("v2Payroll.status.payslip");
  const feature = useFeature("payroll.owner-validation");
  const money = useMoney();
  const date = useDateFormat();
  const mass = useOwnerMass();
  const [open, setOpen] = useState<string | null>(null);

  if (!feature.isLoading && !feature.allowed && !feature.isUnavailable) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <FeatureNotice>{t("featureOff")}</FeatureNotice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {mass.isPending && mass.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {mass.isError ? <ErrorBlock error={mass.error} onRetry={() => void mass.refetch()} /> : null}
      {mass.data ? (
        <>
          <section aria-labelledby="owner-total" className="rounded-lg border p-4">
            <h2 id="owner-total" className="text-lg font-semibold">
              {t("total")}
            </h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{money.fmt(mass.data.counted.total)}</p>
            <p className="text-sm text-muted-foreground">{t("totalNote", { count: mass.data.counted.payslips })}</p>
          </section>
          {mass.data.periods.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
          <ul className="space-y-4" aria-label={t("periods")}>
            {mass.data.periods.map((p) => (
              <li key={p.periodId} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold">
                    {p.periodName} <span className="text-sm font-normal text-muted-foreground">{t("range", { from: date.civil(p.startDate), to: date.civil(p.endDate) })}</span>
                  </h3>
                  <Can permission="payroll.payslip.approve">
                    <button type="button" className={buttonClass.secondary} aria-expanded={open === p.periodId} onClick={() => setOpen(open === p.periodId ? null : p.periodId)}>
                      {open === p.periodId ? t("hideToValidate") : t("showToValidate")}
                      <span className="sr-only"> — {p.periodName}</span>
                    </button>
                  </Can>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  {Object.entries(p.byStatus).map(([status, v]) => (
                    <div key={status}>
                      <dt className="text-muted-foreground">{tStatus(status)}</dt>
                      <dd className="tabular-nums">
                        {money.fmt(v.total)} <span className="text-xs text-muted-foreground">({v.payslips})</span>
                      </dd>
                    </div>
                  ))}
                  <div>
                    <dt className="font-medium">{t("counted")}</dt>
                    <dd className="font-semibold tabular-nums">{money.fmt(p.counted.total)}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {t("apart", { cancelled: money.fmt(p.apart.cancelled.total), cancelledCount: p.apart.cancelled.payslips, disputed: money.fmt(p.apart.disputed.total), disputedCount: p.apart.disputed.payslips })}
                </p>
                {open === p.periodId ? <ToValidate periodId={p.periodId} /> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function ToValidate({ periodId }: { periodId: string }) {
  const t = useTranslations("v2Payroll.owner.validate");
  const money = useMoney();
  const hint = useRejectionHint();
  const list = usePayslips({ periodId, status: "CALCULATED", limit: 200 });
  const validate = useOwnerValidate();
  const flash = useFlash();
  const [refusal, setRefusal] = useState<{ id: string; message: string; code: string } | null>(null);

  function run(id: string) {
    setRefusal(null);
    validate.mutate(
      { id },
      {
        onSuccess: (r) => {
          const rejected = r.rejected.find((x) => x.payslipId === id);
          if (rejected) setRefusal({ id, message: rejected.message, code: rejected.code });
          else flash.show(t("done"));
        },
      },
    );
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      {flash.node}
      {refusal ? (
        <Notice kind="warning">
          <p className="font-medium">{refusal.message}</p>
          {hint(refusal.code) ? <p className="mt-1 text-sm">{hint(refusal.code)}</p> : null}
        </Notice>
      ) : null}
      {validate.isError ? <ErrorBlock error={validate.error} /> : null}
      {list.isPending ? <LoadingBlock /> : null}
      {list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : null}
      {list.data && list.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="divide-y rounded-md border text-sm" aria-label={t("list")}>
        {(list.data?.items ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <Link href={`/v2/payroll/payslips/${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {p.staffName}
            </Link>
            <span className="flex items-center gap-3">
              <span className="font-semibold tabular-nums">{money.fmt(p.totalAmount, p.currency)}</span>
              <button type="button" className={buttonClass.primary} disabled={validate.isPending} onClick={() => run(p.id)}>
                {t("button")}
                <span className="sr-only"> — {p.staffName}</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Espace enseignant : mes bulletins
// ---------------------------------------------------------------------------

export function MyPayslipsScreen() {
  const t = useTranslations("v2Payroll.my");
  const money = useMoney();
  const date = useDateFormat();
  const [page, setPage] = useState(1);
  const list = useMyPayslips({ limit: PAGE, offset: (page - 1) * PAGE });

  const columns: DataTableColumn<NonNullable<typeof list.data>["items"][number]>[] = [
    {
      id: "date",
      header: t("columns.date"),
      rowHeader: true,
      cell: (p) => (
        <Link href={`/v2/payroll/my/${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {date.instant(p.approvedAt ?? p.calculatedAt)}
        </Link>
      ),
    },
    { id: "status", header: t("columns.status"), cell: (p) => <PayslipStatusBadge status={p.status} /> },
    { id: "bonus", header: t("columns.bonus"), align: "right", cell: (p) => <span className="tabular-nums">{money.fmt(p.bonusAmount, p.currency)}</span>, className: "hidden md:table-cell" },
    { id: "deduction", header: t("columns.deduction"), align: "right", cell: (p) => <span className="tabular-nums">{money.fmt(p.deductionAmount, p.currency)}</span>, className: "hidden md:table-cell" },
    { id: "total", header: t("columns.total"), align: "right", cell: (p) => <span className="font-medium tabular-nums">{money.fmt(p.totalAmount, p.currency)}</span> },
    { id: "paid", header: t("columns.paid"), cell: (p) => (p.paidAt ? date.instant(p.paidAt) : t("notPaid")), className: "hidden sm:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Notice kind="info">{t("visibility")}</Notice>
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(p) => p.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
        pagination={{ page, pageSize: PAGE, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
      {(list.data?.items ?? []).some((p) => p.status === "DISPUTED") ? <Notice kind="warning">{t("disputedNotice")}</Notice> : null}
    </div>
  );
}

export function MyPayslipScreen({ id }: { id: string }) {
  const t = useTranslations("v2Payroll.my.detail");
  const data = useMyPayslipData(id);
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} actions={<Link href="/v2/payroll/my" className={buttonClass.secondary}>{t("back")}</Link>} />
      {data.isPending && data.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {data.isError ? <ErrorBlock error={data.error} onRetry={() => void data.refetch()} /> : null}
      {data.data ? (
        <>
          {data.data.status === "DISPUTED" ? <Notice kind="warning">{t("disputed")}</Notice> : null}
          <PayslipDocument data={data.data} />
          <p className="text-sm text-muted-foreground">{t("contest")}</p>
        </>
      ) : null}
    </div>
  );
}
