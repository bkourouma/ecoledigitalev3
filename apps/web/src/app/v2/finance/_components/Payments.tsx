"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FINANCE_PAYMENT_METHODS, FINANCE_PAYMENT_STATUSES, financeRequestRefundBodySchema, type FinancePaymentDto } from "@ecoledigitale/contracts/v2/finance";
import { useFeature } from "@/platform/access";
import { useAllocatePayment, usePayment, usePayments, useRefunds, useRequestRefund } from "@/platform/v2/finance";
import { useStudentOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { toCsv, downloadText } from "@/platform/ui/csv";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useIdempotentRunner } from "@/platform/ui/idempotency";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { AllocationEditor, buildAllocation, EMPTY_ALLOCATION, type AllocationState } from "./AllocationEditor";
import { PaymentStatusBadge, RefundStatusBadge } from "./labels";
import { PaymentTracker } from "./PaymentTracker";
import { LearnerName, MoneyField, useAmountErrors, useLearnerLabels, useValidator } from "./shared";

const PAGE_SIZE = 25;

export function PaymentsScreen() {
  const t = useTranslations("v2Finance.payments");
  const tMethod = useTranslations("v2Finance.method");
  const tStatus = useTranslations("v2Finance.status.payment");
  const money = useMoney();
  const date = useDateFormat();
  const online = useFeature("finance.online-payment");
  const [learner, setLearner] = useState<SelectOption | null>(null);
  const [filters, setFilters] = useState({ status: "", method: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const setFilter = (k: keyof typeof filters) => (v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  // Fuseau de l'établissement : Africa/Abidjan = UTC+0, un jour civil commence à 00:00Z.
  const list = usePayments({
    learnerId: learner?.value,
    status: filters.status || undefined,
    method: filters.method || undefined,
    from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
    to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const labels = useLearnerLabels(list.data?.items.map((p) => p.learnerId) ?? []);

  function exportCsv() {
    const rows = (list.data?.items ?? []).map((p) => [p.receivedAt, labels.get(p.learnerId) ?? p.learnerId, tMethod(p.method), tStatus(p.status), p.amount.amount, p.allocated.amount, p.unallocated.amount, p.refunded.amount, p.reference ?? ""]);
    downloadText("encaissements.csv", toCsv([t("csv.date"), t("csv.learner"), t("csv.method"), t("csv.status"), t("csv.amount"), t("csv.allocated"), t("csv.unallocated"), t("csv.refunded"), t("csv.reference")], rows));
  }

  const columns: DataTableColumn<FinancePaymentDto>[] = [
    {
      id: "date",
      header: t("columns.date"),
      rowHeader: true,
      cell: (p) => (
        <Link href={`/v2/finance/payments/${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {date.instant(p.receivedAt)}
        </Link>
      ),
    },
    { id: "learner", header: t("columns.learner"), cell: (p) => <LearnerName id={p.learnerId} labels={labels} /> },
    { id: "method", header: t("columns.method"), cell: (p) => tMethod(p.method), className: "hidden md:table-cell" },
    { id: "status", header: t("columns.status"), cell: (p) => <PaymentStatusBadge status={p.status} /> },
    { id: "amount", header: t("columns.amount"), align: "right", cell: (p) => <span className="font-medium tabular-nums">{money.of(p.amount)}</span> },
    { id: "unallocated", header: t("columns.unallocated"), align: "right", cell: (p) => <span className="tabular-nums">{money.of(p.unallocated)}</span>, className: "hidden lg:table-cell" },
    { id: "reference", header: t("columns.reference"), cell: (p) => p.reference ?? "—", className: "hidden xl:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Can permission="finance.payment.create">
              <Link href="/v2/finance/payments/new" className={buttonClass.primary}>
                {t("new")}
              </Link>
              {online.allowed ? (
                <Link href="/v2/finance/payments/online" className={buttonClass.secondary}>
                  {t("online")}
                </Link>
              ) : null}
            </Can>
            <button type="button" className={buttonClass.secondary} onClick={exportCsv} disabled={(list.data?.items.length ?? 0) === 0}>
              {t("export")}
            </button>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <FormField label={t("filters.learner")} className="lg:col-span-2">
          {(c) => (
            <SelectAsync
              {...c}
              value={learner}
              onChange={(o) => {
                setLearner(o);
                setPage(1);
              }}
              useOptions={useStudentOptions}
              placeholder={t("filters.learnerPlaceholder")}
            />
          )}
        </FormField>
        <FormField label={t("filters.status")}>
          {(c) => <NativeSelect {...c} value={filters.status} onChange={setFilter("status")} placeholder={t("filters.all")} options={FINANCE_PAYMENT_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("filters.method")}>
          {(c) => <NativeSelect {...c} value={filters.method} onChange={setFilter("method")} placeholder={t("filters.all")} options={FINANCE_PAYMENT_METHODS.map((m) => ({ value: m, label: tMethod(m) }))} />}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("filters.from")}>{(c) => <TextControl {...c} type="date" value={filters.from} onChange={setFilter("from")} />}</FormField>
          <FormField label={t("filters.to")}>{(c) => <TextControl {...c} type="date" value={filters.to} onChange={setFilter("to")} />}</FormField>
        </div>
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
        pagination={{ page, pageSize: PAGE_SIZE, total: list.data?.total ?? 0, onPageChange: setPage }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiche d'un paiement
// ---------------------------------------------------------------------------

export function PaymentDetailScreen({ id }: { id: string }) {
  const t = useTranslations("v2Finance.paymentDetail");
  const tMethod = useTranslations("v2Finance.method");
  const money = useMoney();
  const date = useDateFormat();
  const view = usePayment(id);
  const labels = useLearnerLabels(view.data ? [view.data.payment.learnerId] : []);
  const refunds = useRefunds({ paymentId: id });
  const flash = useFlash();
  const [dialog, setDialog] = useState<"allocate" | "refund" | null>(null);

  if (view.isPending && view.fetchStatus !== "idle") return <LoadingBlock />;
  if (view.isError) return <ErrorBlock error={view.error} onRetry={() => void view.refetch()} />;
  if (!view.data) return null;
  const { payment, receipt, allocations } = view.data;
  const confirmed = payment.status === "CONFIRMED";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title", { amount: money.of(payment.amount) })}
        description={t("subtitle", { learner: labels.get(payment.learnerId) ?? payment.learnerId.slice(0, 8), method: tMethod(payment.method) })}
        actions={
          <>
            <Link href="/v2/finance/payments" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            {receipt ? (
              <Link href={`/v2/finance/receipts/${receipt.id}`} className={buttonClass.primary}>
                {t("receipt", { number: receipt.number })}
              </Link>
            ) : null}
          </>
        }
      />
      {flash.node}
      {payment.simulated ? <Notice kind="warning">{t("simulated")}</Notice> : null}
      {payment.status === "FAILED" ? <Notice kind="error">{t("failed", { reason: payment.failureReason ?? "—" })}</Notice> : null}

      <section aria-labelledby="pay-summary" className="rounded-lg border p-4">
        <h2 id="pay-summary" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("summary")} <PaymentStatusBadge status={payment.status} />
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t("amount")}</dt>
            <dd className="text-base font-semibold tabular-nums">{money.of(payment.amount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("allocated")}</dt>
            <dd className="tabular-nums">{money.of(payment.allocated)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("unallocated")}</dt>
            <dd className="tabular-nums">{money.of(payment.unallocated)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("refunded")}</dt>
            <dd className="tabular-nums">{money.of(payment.refunded)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("receivedAt")}</dt>
            <dd>{date.instant(payment.receivedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("payer")}</dt>
            <dd>{payment.payerName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("reference")}</dt>
            <dd>{payment.reference ?? payment.providerRef ?? "—"}</dd>
          </div>
          {payment.cashSessionId ? (
            <div>
              <dt className="text-muted-foreground">{t("cashSession")}</dt>
              <dd>
                <Link href={`/v2/finance/cash?session=${payment.cashSessionId}`} className="text-primary underline-offset-4 hover:underline">
                  {t("openSession")}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {payment.status === "PENDING" && payment.provider ? <PaymentTracker paymentId={id} /> : null}

      <section aria-labelledby="pay-allocations" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pay-allocations" className="text-lg font-semibold">
            {t("allocations.title")}
          </h2>
          {confirmed && payment.unallocated.amount > 0 ? (
            <Can permission="finance.payment.create">
              <button type="button" className={buttonClass.secondary} onClick={() => setDialog("allocate")}>
                {t("allocations.allocate")}
              </button>
            </Can>
          ) : null}
        </div>
        <DataTable
          caption={t("allocations.caption")}
          columns={[
            { id: "invoice", header: t("allocations.invoice"), rowHeader: true, cell: (a) => (<Link href={`/v2/finance/invoices/${a.invoiceId}`} className="text-primary underline-offset-4 hover:underline">{a.invoiceId.slice(0, 8)}</Link>) },
            { id: "amount", header: t("allocations.amount"), align: "right", cell: (a) => <span className="tabular-nums">{money.of(a.amount)}</span> },
            { id: "reversed", header: t("allocations.reversed"), align: "right", cell: (a) => <span className="tabular-nums">{money.of(a.reversed)}</span>, className: "hidden sm:table-cell" },
            { id: "net", header: t("allocations.net"), align: "right", cell: (a) => <span className="font-medium tabular-nums">{money.of(a.net)}</span> },
          ]}
          rows={allocations}
          getRowId={(a) => a.id}
          emptyTitle={t("allocations.empty")}
        />
      </section>

      <section aria-labelledby="pay-refunds" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="pay-refunds" className="text-lg font-semibold">
            {t("refunds.title")}
          </h2>
          {confirmed ? (
            <Can permission="finance.payment.refund">
              <button type="button" className={buttonClass.secondary} onClick={() => setDialog("refund")}>
                {t("refunds.request")}
              </button>
            </Can>
          ) : null}
        </div>
        {refunds.isError ? <Notice kind="info">{t("refunds.unavailable")}</Notice> : null}
        {refunds.data && refunds.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("refunds.empty")}</p> : null}
        {refunds.data && refunds.data.length > 0 ? (
          <ul className="divide-y rounded-md border text-sm" aria-label={t("refunds.title")}>
            {refunds.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="font-medium tabular-nums">{money.of(r.amount)}</span>
                <span className="text-muted-foreground">{r.reason}</span>
                <RefundStatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {dialog === "allocate" ? <AllocateDialog paymentId={id} learnerId={payment.learnerId} onClose={() => setDialog(null)} onDone={() => flash.show(t("allocations.done"))} /> : null}
      {dialog === "refund" ? <RefundDialog paymentId={id} onClose={() => setDialog(null)} onDone={() => flash.show(t("refunds.requested"))} /> : null}
    </div>
  );
}

function AllocateDialog({ paymentId, learnerId, onClose, onDone }: { paymentId: string; learnerId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.paymentDetail.allocateDialog");
  const describeAmount = useAmountErrors();
  const allocate = useAllocatePayment();
  const [state, setState] = useState<AllocationState>({ ...EMPTY_ALLOCATION });
  const [errors, setErrors] = useState<FieldErrors>({});
  return (
    <FormDialog
      wide
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={allocate.isPending}
      error={allocate.error}
      onSubmit={() => {
        const built = buildAllocation(state, describeAmount);
        setErrors(built.errors);
        if (!built.body || built.body.mode === "NONE") return;
        allocate.mutate(
          { id: paymentId, allocation: built.body },
          {
            onSuccess: () => {
              onDone();
              onClose();
            },
          },
        );
      }}
    >
      <AllocationEditor learnerId={learnerId} value={state} onChange={setState} allowNone={false} errors={errors} />
    </FormDialog>
  );
}

function RefundDialog({ paymentId, onClose, onDone }: { paymentId: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.paymentDetail.refundDialog");
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const request = useRequestRefund();
  const runner = useIdempotentRunner<string>((fp) => fp, "rf");
  const [form, setForm] = useState({ amount: "", reason: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(request.error);

  async function submit() {
    const amount = parseAmountInput(form.amount);
    if (!amount.ok) return setErrors({ amount: describeAmount(amount) ?? "" });
    const parsed = validate(financeRequestRefundBodySchema, { amount: amount.amount, reason: form.reason.trim() });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    try {
      const done = await runner.run(`${amount.amount}|${parsed.data.reason}`, (key) => request.mutateAsync({ paymentId, amount: amount.amount, reason: parsed.data.reason, key }));
      if (done) {
        onDone();
        onClose();
      }
    } catch {
      /* erreur affichée dans la fenêtre */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={request.isPending} error={request.error && Object.keys(apiErrors).length === 0 ? request.error : undefined}>
      <MoneyField label={t("amount")} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} required error={errors.amount ?? apiErrors.amount} />
      <FormField label={t("reason")} required error={errors.reason ?? apiErrors.reason} hint={t("reasonHint")}>
        {(c) => <TextAreaControl {...c} value={form.reason} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} maxLength={500} />}
      </FormField>
      <Notice kind="info">{t("fourEyes")}</Notice>
    </FormDialog>
  );
}

