"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { PAYROLL_PAYSLIP_STATUSES, payrollAdjustBodySchema } from "@ecoledigitale/contracts/v2/payroll";
import { useStaffOptions } from "@/platform/v2/lookups";
import {
  useAdjustPayslip,
  useApprovePayslips,
  useCancelPayslip,
  useDisputePayslip,
  useNotifyPayslip,
  usePayPayslips,
  usePayPeriods,
  usePayslip,
  usePayslipData,
  usePayslips,
} from "@/platform/v2/payroll";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { LinesTable } from "./CalculationReport";
import { PayDialog } from "./Periods";
import { MoneyField, PayslipStatusBadge, useAmountErrors, useRejectionHint, useValidator } from "./shared";
import { PayslipDocument } from "./PayslipDocument";

const PAGE = 25;

export function PayslipsScreen() {
  const t = useTranslations("v2Payroll.payslips");
  const tStatus = useTranslations("v2Payroll.status.payslip");
  const tKind = useTranslations("v2Payroll.configType");
  const money = useMoney();
  const date = useDateFormat();
  const periods = usePayPeriods({ limit: 100 });
  const [staff, setStaff] = useState<SelectOption | null>(null);
  const [filters, setFilters] = useState({ periodId: "", status: "" });
  const [page, setPage] = useState(1);
  const list = usePayslips({ staffId: staff?.value, periodId: filters.periodId || undefined, status: filters.status || undefined, limit: PAGE, offset: (page - 1) * PAGE });
  const periodName = new Map((periods.data?.items ?? []).map((p) => [p.id, p.name]));
  const useOptions = (search: string, enabled: boolean) => useStaffOptions(search, enabled);

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
    { id: "period", header: t("columns.period"), cell: (p) => periodName.get(p.periodId) ?? p.periodId.slice(0, 8), className: "hidden sm:table-cell" },
    { id: "kind", header: t("columns.kind"), cell: (p) => tKind(p.kind), className: "hidden lg:table-cell" },
    { id: "status", header: t("columns.status"), cell: (p) => <PayslipStatusBadge status={p.status} /> },
    { id: "total", header: t("columns.total"), align: "right", cell: (p) => <span className="font-medium tabular-nums">{money.fmt(p.totalAmount, p.currency)}</span> },
    { id: "calculated", header: t("columns.calculated"), cell: (p) => date.instant(p.calculatedAt), className: "hidden md:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label={t("filters.staff")}>
          {(c) => (
            <SelectAsync
              {...c}
              value={staff}
              onChange={(o) => {
                setStaff(o);
                setPage(1);
              }}
              useOptions={useOptions}
              placeholder={t("filters.staffPlaceholder")}
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
              options={(periods.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
        </FormField>
        <FormField label={t("filters.status")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={filters.status}
              onChange={(v) => {
                setFilters((f) => ({ ...f, status: v }));
                setPage(1);
              }}
              placeholder={t("filters.allStatuses")}
              options={PAYROLL_PAYSLIP_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))}
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
// Fiche d'un bulletin
// ---------------------------------------------------------------------------

export function PayslipDetailScreen({ id }: { id: string }) {
  const t = useTranslations("v2Payroll.payslipDetail");
  const tKind = useTranslations("v2Payroll.configType");
  const tMethod = useTranslations("v2Payroll.method");
  const money = useMoney();
  const date = useDateFormat();
  const hint = useRejectionHint();
  const detail = usePayslip(id);
  const status = detail.data?.payslip.status;
  const data = usePayslipData(id, status === "APPROVED" || status === "PAID" || status === "DISPUTED");
  const approve = useApprovePayslips();
  const pay = usePayPayslips();
  const cancel = useCancelPayslip();
  const dispute = useDisputePayslip();
  const notify = useNotifyPayslip();
  const flash = useFlash();
  const [dialog, setDialog] = useState<"pay" | "cancel" | "dispute" | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; code: string } | null>(null);

  if (detail.isPending && detail.fetchStatus !== "idle") return <LoadingBlock />;
  if (detail.isError) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return null;
  const { payslip: p, lines, adjustments, events } = detail.data;
  const cur = p.currency;

  function afterBatch(r: { done: string[]; rejected: Array<{ payslipId: string; code: string; message: string }> }, okMessage: string) {
    const rejected = r.rejected.find((x) => x.payslipId === id);
    if (rejected) setRefusal({ message: rejected.message, code: rejected.code });
    else {
      setRefusal(null);
      flash.show(okMessage);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title", { name: p.staffName })}
        description={t("subtitle", { kind: tKind(p.kind) })}
        actions={
          <>
            <Link href="/v2/payroll/payslips" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            {p.status === "CALCULATED" ? (
              <Can permission="payroll.payslip.approve">
                <button type="button" className={buttonClass.primary} disabled={approve.isPending} onClick={() => (setRefusal(null), approve.mutate({ payslipIds: [id] }, { onSuccess: (r) => afterBatch(r, t("approved")) }))}>
                  {t("approve")}
                </button>
              </Can>
            ) : null}
            {p.status === "APPROVED" ? (
              <Can permission="payroll.payslip.pay">
                <button type="button" className={buttonClass.primary} onClick={() => (pay.reset(), setDialog("pay"))}>
                  {t("pay")}
                </button>
              </Can>
            ) : null}
            {p.status === "APPROVED" ? (
              <Can permission="payroll.payslip.approve">
                <button type="button" className={buttonClass.secondary} onClick={() => (dispute.reset(), setDialog("dispute"))}>
                  {t("dispute")}
                </button>
              </Can>
            ) : null}
            {p.status === "CALCULATED" || p.status === "APPROVED" || p.status === "DISPUTED" ? (
              <Can permission="payroll.payslip.cancel">
                <button type="button" className={buttonClass.danger} onClick={() => (cancel.reset(), setDialog("cancel"))}>
                  {t("cancel")}
                </button>
              </Can>
            ) : null}
            {p.status === "APPROVED" || p.status === "PAID" ? (
              <Can permission="payroll.payslip.notify">
                <button type="button" className={buttonClass.secondary} disabled={notify.isPending} onClick={() => notify.mutate({ id }, { onSuccess: () => flash.show(t("notified")) })}>
                  {t("notify")}
                </button>
              </Can>
            ) : null}
          </>
        }
      />
      {flash.node}
      {refusal ? (
        <Notice kind="warning">
          <p className="font-medium">{refusal.message}</p>
          {hint(refusal.code) ? <p className="mt-1 text-sm">{hint(refusal.code)}</p> : null}
        </Notice>
      ) : null}
      {approve.isError ? <ErrorBlock error={approve.error} /> : null}
      {notify.isError ? <ErrorBlock error={notify.error} /> : null}
      {p.status === "DISPUTED" ? <Notice kind="warning">{t("disputedNotice", { reason: p.disputeReason ?? "—" })}</Notice> : null}
      {p.status === "CANCELLED" ? <Notice kind="warning">{t("cancelledNotice", { reason: p.cancelReason ?? "—" })}</Notice> : null}

      <section aria-labelledby="slip-summary" className="rounded-lg border p-4">
        <h2 id="slip-summary" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("summary")} <PayslipStatusBadge status={p.status} />
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["salary", p.salaryAmount],
              ["base", p.baseAmount],
              ["overtime", p.overtimeAmount],
              ["bonus", p.bonusAmount],
              ["deduction", p.deductionAmount],
              ["total", p.totalAmount],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-muted-foreground">{t(`amounts.${k}`)}</dt>
              <dd className={k === "total" ? "text-lg font-semibold tabular-nums" : "tabular-nums"}>{money.fmt(v, cur)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">{t("regularMinutes")}</dt>
            <dd>{money.minutes(p.regularMinutes)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("overtimeMinutes")}</dt>
            <dd>{money.minutes(p.overtimeMinutes)}</dd>
          </div>
        </dl>
        <dl className="mt-4 grid gap-x-6 gap-y-2 border-t pt-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("calculatedBy")}</dt>
            <dd>{t("byOn", { name: p.calculatedByName, date: date.instant(p.calculatedAt) })}</dd>
          </div>
          {p.approvedAt ? (
            <div>
              <dt className="text-muted-foreground">{t("approvedBy")}</dt>
              <dd>{t("byOn", { name: p.approvedByName ?? "—", date: date.instant(p.approvedAt) })}</dd>
            </div>
          ) : null}
          {p.paidAt ? (
            <div>
              <dt className="text-muted-foreground">{t("paidBy")}</dt>
              <dd>
                {t("byOn", { name: p.paidByName ?? "—", date: date.instant(p.paidAt) })}
                {p.paymentMethod ? ` · ${tMethod(p.paymentMethod)}` : ""}
                {p.paymentReference ? ` · ${p.paymentReference}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="slip-lines" className="space-y-2">
        <h2 id="slip-lines" className="text-lg font-semibold">
          {t("lines")}
        </h2>
        {lines.length === 0 ? <p className="text-sm text-muted-foreground">{t("noLines")}</p> : <LinesTable lines={lines} caption={t("linesCaption")} />}
      </section>

      <Adjustments payslipId={id} status={p.status} adjustments={adjustments} currency={cur} />

      {data.data ? <PayslipDocument data={data.data} /> : null}
      {data.isError ? <Notice kind="info">{t("documentUnavailable")}</Notice> : null}

      <section aria-labelledby="slip-events" className="space-y-2">
        <h2 id="slip-events" className="text-lg font-semibold">
          {t("history")}
        </h2>
        <ol className="space-y-2 border-l pl-4 text-sm" aria-label={t("history")}>
          {events.map((e) => (
            <li key={e.id}>
              <p className="font-medium">{e.action}</p>
              <p className="text-muted-foreground">
                {t("byOn", { name: e.actorName, date: date.instant(e.occurredAt) })}
                {e.reason ? ` — ${e.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {dialog === "pay" ? (
        <PayDialog
          pending={pay.isPending}
          error={pay.error}
          description={t("payDialogDescription", { amount: money.fmt(p.totalAmount, cur) })}
          onClose={() => setDialog(null)}
          onConfirm={(method, reference) =>
            pay.mutate(
              { selection: { payslipIds: [id] }, method, ...(reference ? { reference } : {}) },
              {
                onSuccess: (r) => {
                  setDialog(null);
                  afterBatch(r, t("paid"));
                },
              },
            )
          }
        />
      ) : null}
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("cancelDialog.title")}
        description={t("cancelDialog.description")}
        reasonLabel={t("cancelDialog.reason")}
        confirmLabel={t("cancelDialog.confirm")}
        minLength={3}
        destructive
        isPending={cancel.isPending}
        error={cancel.error}
        onConfirm={(reason) => cancel.mutate({ id, reason }, { onSuccess: () => (setDialog(null), flash.show(t("cancelled"))) })}
      />
      <ReasonDialog
        open={dialog === "dispute"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("disputeDialog.title")}
        description={t("disputeDialog.description")}
        reasonLabel={t("disputeDialog.reason")}
        confirmLabel={t("disputeDialog.confirm")}
        minLength={3}
        isPending={dispute.isPending}
        error={dispute.error}
        onConfirm={(reason) => dispute.mutate({ id, reason }, { onSuccess: () => (setDialog(null), flash.show(t("disputed"))) })}
      />
    </div>
  );
}

function Adjustments({ payslipId, status, adjustments, currency }: { payslipId: string; status: string; adjustments: ReadonlyArray<{ id: string; kind: "BONUS" | "DEDUCTION"; amount: number; label: string; reason: string | null; createdByName: string; createdAt: string }>; currency: string }) {
  const t = useTranslations("v2Payroll.adjustments");
  const tKind = useTranslations("v2Payroll.adjustmentKind");
  const money = useMoney();
  const date = useDateFormat();
  const adjust = useAdjustPayslip();
  const flash = useFlash();
  const [adding, setAdding] = useState(false);
  const editable = status === "CALCULATED";

  return (
    <section aria-labelledby="slip-adjustments" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="slip-adjustments" className="text-lg font-semibold">
          {t("title")}
        </h2>
        {editable ? (
          <Can permission="payroll.payslip.adjust">
            <button type="button" className={buttonClass.secondary} onClick={() => (adjust.reset(), setAdding(true))}>
              {t("add")}
            </button>
          </Can>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{editable ? t("hint") : t("locked")}</p>
      {flash.node}
      {adjust.isError && !adding ? <ErrorBlock error={adjust.error} /> : null}
      {adjustments.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="divide-y rounded-md border text-sm" aria-label={t("title")}>
        {adjustments.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">
                {tKind(a.kind)} — {a.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("by", { name: a.createdByName, date: date.instant(a.createdAt) })}
                {a.reason ? ` — ${a.reason}` : ""}
              </p>
            </div>
            <span className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">{(a.kind === "DEDUCTION" ? "− " : "+ ") + money.fmt(a.amount, currency)}</span>
              {editable ? (
                <Can permission="payroll.payslip.adjust">
                  <button type="button" className={buttonClass.ghost} disabled={adjust.isPending} onClick={() => adjust.mutate({ id: payslipId, body: { remove: [a.id] } }, { onSuccess: () => flash.show(t("removed")) })}>
                    {t("remove")}
                    <span className="sr-only"> — {a.label}</span>
                  </button>
                </Can>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {adding ? <AdjustmentDialog payslipId={payslipId} onClose={() => setAdding(false)} onDone={() => flash.show(t("added"))} /> : null}
    </section>
  );
}

function AdjustmentDialog({ payslipId, onClose, onDone }: { payslipId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Payroll.adjustments.dialog");
  const tKind = useTranslations("v2Payroll.adjustmentKind");
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const adjust = useAdjustPayslip();
  const [form, setForm] = useState({ kind: "BONUS", amount: "", label: "", reason: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(adjust.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];

  function submit() {
    const amount = parseAmountInput(form.amount);
    if (!amount.ok) return setErrors({ "add.0.amount": describeAmount(amount) ?? "" });
    const entry = { kind: form.kind, amount: amount.amount, label: form.label.trim(), ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) };
    const parsed = validate(payrollAdjustBodySchema, { add: [entry] });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    adjust.mutate(
      { id: payslipId, body: { add: [entry as { kind: "BONUS" | "DEDUCTION"; amount: number; label: string; reason?: string }] } },
      {
        onSuccess: () => {
          onDone();
          onClose();
        },
      },
    );
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={submit} isPending={adjust.isPending} error={adjust.error && Object.keys(apiErrors).length === 0 ? adjust.error : undefined}>
      <FormField label={t("kind")} required>
        {(c) => (
          <NativeSelect
            {...c}
            value={form.kind}
            onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
            options={[
              { value: "BONUS", label: tKind("BONUS") },
              { value: "DEDUCTION", label: tKind("DEDUCTION") },
            ]}
          />
        )}
      </FormField>
      <MoneyField label={t("amount")} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} required error={err("add.0.amount")} />
      <FormField label={t("label")} required error={err("add.0.label")}>
        {(c) => <TextControl {...c} value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} maxLength={160} />}
      </FormField>
      <FormField label={t("reason")} error={err("add.0.reason")}>
        {(c) => <TextControl {...c} value={form.reason} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

