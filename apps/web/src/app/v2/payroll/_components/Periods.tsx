"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { payrollCreatePeriodBodySchema } from "@ecoledigitale/contracts/v2/payroll";
import { useFeature, usePermission } from "@/platform/access";
import { useAcademicYears } from "@/platform/v2/academic";
import { useCalculatePeriod, useCreatePayPeriod, usePayPeriod, usePayPeriods, usePayslips, usePendingPeriod, usePeriodRuns, useUpdatePayPeriod, useApprovePayslips, usePayPayslips, type PaymentMethod } from "@/platform/v2/payroll";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ModalDialog } from "@/platform/ui/ModalDialog";
import { useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader, StatusBadge } from "@/platform/ui/PageHeader";
import type { SelectOption } from "@/platform/ui/SelectAsync";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, compact, type FieldErrors } from "@/platform/ui/validation";
import { CalculationReport, type CalcReport } from "./CalculationReport";
import { PayslipStatusBadge, PeriodStatusBadge, StaffMultiPicker, useRejectionHint, useValidator } from "./shared";
import { PAYMENT_METHODS } from "./methods";

export function PeriodsScreen() {
  const t = useTranslations("v2Payroll.periods");
  const date = useDateFormat();
  const manage = usePermission("payroll.period.manage");
  const periods = usePayPeriods({ limit: 100 }, { enabled: manage.allowed });
  const pending = usePendingPeriod({ enabled: manage.allowed });
  const flash = useFlash();
  const [creating, setCreating] = useState(false);
  const blocked = Boolean(pending.data);

  const columns: DataTableColumn<NonNullable<typeof periods.data>["items"][number]>[] = [
    {
      id: "name",
      header: t("columns.name"),
      rowHeader: true,
      cell: (p) => (
        <Link href={`/v2/payroll/periods/${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {p.name}
        </Link>
      ),
    },
    { id: "dates", header: t("columns.dates"), cell: (p) => t("range", { from: date.civil(p.startDate), to: date.civil(p.endDate) }), className: "hidden sm:table-cell" },
    { id: "scope", header: t("columns.scope"), cell: (p) => (p.targeted ? t("targeted", { count: p.targetStaffIds.length }) : t("collective")), className: "hidden md:table-cell" },
    {
      id: "status",
      header: t("columns.status"),
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1">
          <PeriodStatusBadge status={p.status} />
          {p.awaitingCalculation ? <StatusBadge label={t("awaiting")} tone="warning" /> : null}
        </span>
      ),
    },
  ];

  if (!manage.isLoading && !manage.allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("title")} />
        <Notice kind="info">{t("noManage")}</Notice>
        <Link href="/v2/payroll/payslips" className={buttonClass.secondary}>
          {t("toPayslips")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="payroll.period.manage">
            <button type="button" className={buttonClass.primary} onClick={() => setCreating(true)} disabled={blocked}>
              {t("new")}
            </button>
          </Can>
        }
      />
      {pending.data ? (
        <Notice kind="warning">
          {t("pendingNotice", { name: pending.data.name })}{" "}
          <Link href={`/v2/payroll/periods/${pending.data.id}`} className="font-medium underline underline-offset-4">
            {t("pendingOpen")}
          </Link>
        </Notice>
      ) : null}
      {flash.node}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={periods.data?.items ?? []}
        getRowId={(p) => p.id}
        isLoading={periods.isPending && periods.fetchStatus !== "idle"}
        error={periods.error}
        onRetry={() => void periods.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {creating ? <CreatePeriodDialog onClose={() => setCreating(false)} onDone={(name) => flash.show(t("created", { name }))} /> : null}
    </div>
  );
}

function CreatePeriodDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const t = useTranslations("v2Payroll.periods.form");
  const validate = useValidator();
  const years = useAcademicYears();
  const create = useCreatePayPeriod();
  const [form, setForm] = useState({ name: "", description: "", startDate: "", endDate: "", academicYearId: "" });
  const [targets, setTargets] = useState<SelectOption[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(create.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    const body = { ...compact({ ...form, name: form.name.trim(), description: form.description.trim() }), ...(targets.length > 0 ? { staffIds: targets.map((o) => o.value) } : {}) };
    const parsed = validate(payrollCreatePeriodBodySchema, body);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    create.mutate(parsed.data as never, {
      onSuccess: (p) => {
        onDone(p.name);
        onClose();
      },
    });
  }

  return (
    <FormDialog wide open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={create.isPending} error={create.error && Object.keys(apiErrors).length === 0 ? create.error : undefined}>
      <FormField label={t("name")} required error={err("name")}>
        {(c) => <TextControl {...c} value={form.name} onChange={set("name")} maxLength={100} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("start")} required error={err("startDate")}>
          {(c) => <TextControl {...c} type="date" value={form.startDate} onChange={set("startDate")} />}
        </FormField>
        <FormField label={t("end")} required error={err("endDate")}>
          {(c) => <TextControl {...c} type="date" value={form.endDate} onChange={set("endDate")} />}
        </FormField>
      </div>
      <FormField label={t("year")} required error={err("academicYearId")}>
        {(c) => <NativeSelect {...c} value={form.academicYearId} onChange={set("academicYearId")} placeholder={t("chooseYear")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
      </FormField>
      <FormField label={t("descriptionLabel")} error={err("description")}>
        {(c) => <TextAreaControl {...c} value={form.description} onChange={set("description")} maxLength={500} />}
      </FormField>
      <StaffMultiPicker value={targets} onChange={setTargets} label={t("targets")} hint={t("targetsHint")} />
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// Fiche d'une période : calcul, bulletins, arrêt et versement
// ---------------------------------------------------------------------------

export function PeriodDetailScreen({ id }: { id: string }) {
  const t = useTranslations("v2Payroll.periodDetail");
  const date = useDateFormat();
  const period = usePayPeriod(id);
  const update = useUpdatePayPeriod();
  const flash = useFlash();
  const [statusTarget, setStatusTarget] = useState<"CLOSED" | "ARCHIVED" | "ACTIVE" | null>(null);

  if (period.isPending && period.fetchStatus !== "idle") return <LoadingBlock />;
  if (period.isError) return <ErrorBlock error={period.error} onRetry={() => void period.refetch()} />;
  if (!period.data) return null;
  const p = period.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title={p.name}
        description={t("subtitle", { from: date.civil(p.startDate), to: date.civil(p.endDate) })}
        actions={
          <>
            <Link href="/v2/payroll" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <Can permission="payroll.period.manage">
              {p.status === "DRAFT" ? (
                <button type="button" className={buttonClass.secondary} onClick={() => setStatusTarget("ACTIVE")}>
                  {t("activate")}
                </button>
              ) : null}
              {p.status === "ACTIVE" ? (
                <button type="button" className={buttonClass.secondary} onClick={() => setStatusTarget("CLOSED")}>
                  {t("close")}
                </button>
              ) : null}
              {p.status === "CLOSED" ? (
                <button type="button" className={buttonClass.secondary} onClick={() => setStatusTarget("ARCHIVED")}>
                  {t("archive")}
                </button>
              ) : null}
            </Can>
          </>
        }
      />
      {flash.node}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <PeriodStatusBadge status={p.status} />
        {p.awaitingCalculation ? <StatusBadge label={t("awaiting")} tone="warning" /> : null}
        <span className="text-muted-foreground">{p.targeted ? t("targeted", { count: p.targetStaffIds.length }) : t("collective")}</span>
        {p.description ? <span className="text-muted-foreground">— {p.description}</span> : null}
      </div>

      <Can permission="payroll.run.calculate">
        <CalculationPanel periodId={id} />
      </Can>
      <Can permission="payroll.payslip.read">
        <PeriodPayslips periodId={id} />
      </Can>
      <Can permission="payroll.run.calculate">
        <RunsHistory periodId={id} />
      </Can>

      {statusTarget ? (
        <ModalDialog open onOpenChange={(o) => !o && !update.isPending && (setStatusTarget(null), update.reset())} title={t(`statusDialog.${statusTarget}.title`)} description={t(`statusDialog.${statusTarget}.description`)}>
          {update.isError ? <ErrorBlock error={update.error} /> : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass.secondary} disabled={update.isPending} onClick={() => setStatusTarget(null)}>
              {t("statusDialog.cancel")}
            </button>
            <button
              type="button"
              className={buttonClass.primary}
              disabled={update.isPending}
              onClick={() => update.mutate({ id, patch: { status: statusTarget } }, { onSuccess: () => (setStatusTarget(null), flash.show(t("statusDone"))) })}
            >
              {t(`statusDialog.${statusTarget}.confirm`)}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

function CalculationPanel({ periodId }: { periodId: string }) {
  const t = useTranslations("v2Payroll.calc");
  const tScope = useTranslations("v2Payroll.scope");
  const calculate = useCalculatePeriod();
  const sessionSource = useFeature("payroll.session-source");
  const attendanceSource = useFeature("payroll.attendance-source");
  const [scope, setScope] = useState<"ALL" | "SESSION" | "ATTENDANCE">("ALL");
  const [recalculate, setRecalculate] = useState(false);
  const [staff, setStaff] = useState<SelectOption[]>([]);
  const [report, setReport] = useState<CalcReport | null>(null);
  const [confirming, setConfirming] = useState(false);
  const scopes = useMemo(() => ["ALL", ...(sessionSource.allowed ? ["SESSION"] : []), ...(attendanceSource.allowed ? ["ATTENDANCE"] : [])] as const, [sessionSource.allowed, attendanceSource.allowed]);

  function run(dryRun: boolean) {
    calculate.mutate(
      { id: periodId, scope, recalculate, dryRun, ...(staff.length > 0 ? { staffIds: staff.map((o) => o.value) } : {}) },
      { onSuccess: (r) => (setReport(r), setConfirming(false)) },
    );
  }

  return (
    <section aria-labelledby="calc-title" className="space-y-4 rounded-lg border p-4">
      <h2 id="calc-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <FormField label={t("scope")} hint={t("scopeHint")}>
            {(c) => <NativeSelect {...c} value={scope} onChange={(v) => setScope(v as typeof scope)} options={scopes.map((s) => ({ value: s, label: tScope(s) }))} />}
          </FormField>
          <CheckControl checked={recalculate} onChange={setRecalculate} label={t("recalculate")} hint={t("recalculateHint")} />
        </div>
        <StaffMultiPicker value={staff} onChange={setStaff} label={t("perimeter")} hint={t("perimeterHint")} canTeachOnly={false} />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className={buttonClass.secondary} onClick={() => run(true)} disabled={calculate.isPending}>
          {t("preview")}
        </button>
        <button type="button" className={buttonClass.primary} onClick={() => (recalculate ? setConfirming(true) : run(false))} disabled={calculate.isPending}>
          {recalculate ? t("runRecalculate") : t("run")}
        </button>
      </div>
      {calculate.isPending ? <LoadingBlock label={t("running")} /> : null}
      {calculate.isError ? <ErrorBlock error={calculate.error} /> : null}
      {report ? <CalculationReport report={report} /> : null}
      {confirming ? (
        <ModalDialog open onOpenChange={(o) => !o && !calculate.isPending && setConfirming(false)} title={t("confirm.title")} description={t("confirm.description")}>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass.secondary} disabled={calculate.isPending} onClick={() => setConfirming(false)}>
              {t("confirm.cancel")}
            </button>
            <button type="button" className={buttonClass.primary} disabled={calculate.isPending} onClick={() => run(false)}>
              {t("confirm.submit")}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </section>
  );
}

function PeriodPayslips({ periodId }: { periodId: string }) {
  const t = useTranslations("v2Payroll.periodPayslips");
  const tKind = useTranslations("v2Payroll.configType");
  const money = useMoney();
  const hint = useRejectionHint();
  const list = usePayslips({ periodId, limit: 200 });
  const approve = useApprovePayslips();
  const pay = usePayPayslips();
  const flash = useFlash();
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | { kind: "approve" | "pay"; all: boolean }>(null);
  const [result, setResult] = useState<{ done: string[]; unchanged: string[]; rejected: Array<{ payslipId: string; code: string; message: string }>; kind: "approve" | "pay" } | null>(null);
  const items = list.data?.items ?? [];
  const names = new Map(items.map((p) => [p.id, p.staffName]));
  const toggle = (id: string) => setSelected((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));

  const columns: DataTableColumn<(typeof items)[number]>[] = [
    {
      id: "select",
      header: <span className="sr-only">{t("columns.select")}</span>,
      cell: (p) => <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} aria-label={t("selectOne", { name: p.staffName })} className="h-4 w-4 accent-primary" />,
      className: "w-8",
    },
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
    { id: "kind", header: t("columns.kind"), cell: (p) => tKind(p.kind), className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (p) => <PayslipStatusBadge status={p.status} /> },
    { id: "total", header: t("columns.total"), align: "right", cell: (p) => <span className="font-medium tabular-nums">{money.fmt(p.totalAmount, p.currency)}</span> },
    { id: "reason", header: t("columns.reason"), cell: (p) => p.cancelReason ?? p.disputeReason ?? "—", className: "hidden lg:table-cell" },
  ];

  return (
    <section aria-labelledby="period-payslips" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="period-payslips" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Can permission="payroll.payslip.approve">
            <button type="button" className={buttonClass.secondary} disabled={selected.length === 0} onClick={() => (approve.reset(), setDialog({ kind: "approve", all: false }))}>
              {t("approveSelected", { count: selected.length })}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => (approve.reset(), setDialog({ kind: "approve", all: true }))}>
              {t("approveAll")}
            </button>
          </Can>
          <Can permission="payroll.payslip.pay">
            <button type="button" className={buttonClass.secondary} disabled={selected.length === 0} onClick={() => (pay.reset(), setDialog({ kind: "pay", all: false }))}>
              {t("paySelected", { count: selected.length })}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => (pay.reset(), setDialog({ kind: "pay", all: true }))}>
              {t("payAll")}
            </button>
          </Can>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("separationHint")}</p>
      {flash.node}
      {result ? (
        <div className="space-y-2 rounded-md border p-3 text-sm" role="status">
          <p className="font-medium">{t(`result.${result.kind}`, { done: result.done.length, unchanged: result.unchanged.length, rejected: result.rejected.length })}</p>
          {result.rejected.length > 0 ? (
            <ul className="space-y-1" aria-label={t("result.rejectedList")}>
              {result.rejected.map((r) => (
                <li key={r.payslipId} className="rounded border border-destructive/30 bg-destructive/5 p-2">
                  <span className="font-medium">{names.get(r.payslipId) ?? r.payslipId.slice(0, 8)}</span> — {r.message}
                  {hint(r.code) ? <span className="mt-1 block text-xs text-muted-foreground">{hint(r.code)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={items}
        getRowId={(p) => p.id}
        isLoading={list.isPending && list.fetchStatus !== "idle"}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle={t("empty")}
        emptyDescription={t("emptyHint")}
      />
      {(list.data?.total ?? 0) > items.length ? <Notice kind="info">{t("truncated", { shown: items.length, total: list.data?.total ?? 0 })}</Notice> : null}

      {dialog?.kind === "approve" ? (
        <ModalDialog open onOpenChange={(o) => !o && !approve.isPending && setDialog(null)} title={t("approveDialog.title")} description={dialog.all ? t("approveDialog.allDescription") : t("approveDialog.selectedDescription", { count: selected.length })}>
          {approve.isError ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{approve.error.message}</p> : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass.secondary} disabled={approve.isPending} onClick={() => setDialog(null)}>
              {t("dialogCancel")}
            </button>
            <button
              type="button"
              className={buttonClass.primary}
              disabled={approve.isPending}
              onClick={() =>
                approve.mutate(dialog.all ? { all: true, periodId } : { payslipIds: selected }, {
                  onSuccess: (r) => {
                    setResult({ ...r, kind: "approve" });
                    setSelected([]);
                    setDialog(null);
                    flash.show(t("approveDone"));
                  },
                })
              }
            >
              {t("approveDialog.confirm")}
            </button>
          </div>
        </ModalDialog>
      ) : null}
      {dialog?.kind === "pay" ? (
        <PayDialog
          pending={pay.isPending}
          error={pay.error}
          description={dialog.all ? t("payDialog.allDescription") : t("payDialog.selectedDescription", { count: selected.length })}
          onClose={() => setDialog(null)}
          onConfirm={(method, reference) =>
            pay.mutate(
              { selection: dialog.all ? { all: true, periodId } : { payslipIds: selected }, method, ...(reference ? { reference } : {}) },
              {
                onSuccess: (r) => {
                  setResult({ ...r, kind: "pay" });
                  setSelected([]);
                  setDialog(null);
                  flash.show(t("payDone"));
                },
              },
            )
          }
        />
      ) : null}
    </section>
  );
}

export function PayDialog({ pending, error, description, onClose, onConfirm }: { pending: boolean; error: unknown; description: string; onClose: () => void; onConfirm: (method: PaymentMethod, reference: string) => void }) {
  const t = useTranslations("v2Payroll.payDialog");
  const tMethod = useTranslations("v2Payroll.method");
  const [method, setMethod] = useState<PaymentMethod>("MOBILE_MONEY");
  const [reference, setReference] = useState("");
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={description} submitLabel={t("submit")} onSubmit={() => onConfirm(method, reference.trim())} isPending={pending} error={error}>
      <FormField label={t("method")} required>
        {(c) => <NativeSelect {...c} value={method} onChange={(v) => setMethod(v as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: tMethod(m) }))} />}
      </FormField>
      <FormField label={t("reference")} hint={t("referenceHint")}>
        {(c) => <TextControl {...c} value={reference} onChange={setReference} maxLength={120} />}
      </FormField>
    </FormDialog>
  );
}

function RunsHistory({ periodId }: { periodId: string }) {
  const t = useTranslations("v2Payroll.runs");
  const date = useDateFormat();
  const runs = usePeriodRuns(periodId);
  return (
    <section aria-labelledby="runs-title" className="space-y-2">
      <h2 id="runs-title" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {runs.isPending && runs.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {runs.isError ? <ErrorBlock error={runs.error} onRetry={() => void runs.refetch()} /> : null}
      {runs.data && runs.data.length === 0 ? <EmptyBlock title={t("empty")} /> : null}
      {runs.data && runs.data.length > 0 ? (
        <ul className="divide-y rounded-md border text-sm" aria-label={t("title")}>
          {runs.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <span className="font-medium">{date.instant(r.requestedAt)}</span>
              <span>{r.dryRun ? t("preview") : r.recalculate ? t("recalculation") : t("calculation")}</span>
              <span className="text-muted-foreground">{t("counts", { calculated: r.calculated, skipped: r.skipped, locked: r.locked, failed: r.failed })}</span>
              {r.error ? <span className="text-destructive">{r.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
