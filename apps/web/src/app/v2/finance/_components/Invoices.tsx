"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FINANCE_INVOICE_STATUSES, financeCreditNoteBodySchema, type FinanceInvoiceDetailDto, type FinanceInvoiceSummaryDto } from "@ecoledigitale/contracts/v2/finance";
import { useFeature } from "@/platform/access";
import { useCancelInvoice, useGenerateInstallments, useInstallmentPlans, useInvoice, useInvoices, useIssueCreditNote, useIssueInvoice } from "@/platform/v2/finance";
import { useStudentOptions } from "@/platform/v2/lookups";
import { Can } from "@/platform/ui/AccessGate";
import { DataTable, type DataTableColumn } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextAreaControl, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { FormDialog, ReasonDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice, useFlash } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { InstallmentStatusBadge, InvoiceStatusBadge, PayerBadge } from "./labels";
import { AcademicYearField, LearnerName, MoneyField, useAmountErrors, useLearnerLabels, useValidator } from "./shared";

const PAGE_SIZE = 25;

export interface InvoicesInitialFilters {
  learnerId?: string;
  status?: string;
  groupKey?: string;
  academicYear?: string;
}

export function InvoicesScreen({ initial = {} }: { initial?: InvoicesInitialFilters }) {
  const t = useTranslations("v2Finance.invoices");
  const tStatus = useTranslations("v2Finance.status.invoice");
  const tPayer = useTranslations("v2Finance.payer");
  const money = useMoney();
  const date = useDateFormat();
  const [learner, setLearner] = useState<SelectOption | null>(initial.learnerId ? { value: initial.learnerId, label: initial.learnerId.slice(0, 8) } : null);
  const [filters, setFilters] = useState({ status: initial.status ?? "", payerKind: "", academicYear: initial.academicYear ?? "", groupKey: initial.groupKey ?? "" });
  const [page, setPage] = useState(1);
  const setFilter = (k: keyof typeof filters) => (v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const list = useInvoices({
    learnerId: learner?.value,
    status: filters.status || undefined,
    payerKind: filters.payerKind || undefined,
    academicYear: filters.academicYear || undefined,
    groupKey: filters.groupKey || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const labels = useLearnerLabels(list.data?.items.map((i) => i.learnerId) ?? []);

  const columns: DataTableColumn<FinanceInvoiceSummaryDto>[] = [
    {
      id: "number",
      header: t("columns.number"),
      rowHeader: true,
      cell: (i) => (
        <Link href={`/v2/finance/invoices/${i.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {i.number ?? t("draft")}
        </Link>
      ),
    },
    { id: "learner", header: t("columns.learner"), cell: (i) => <LearnerName id={i.learnerId} labels={labels} /> },
    { id: "year", header: t("columns.year"), cell: (i) => i.academicYear, className: "hidden lg:table-cell" },
    { id: "payer", header: t("columns.payer"), cell: (i) => <PayerBadge kind={i.payerKind} />, className: "hidden xl:table-cell" },
    { id: "status", header: t("columns.status"), cell: (i) => <InvoiceStatusBadge status={i.status} /> },
    { id: "total", header: t("columns.total"), align: "right", cell: (i) => <span className="tabular-nums">{money.of(i.total)}</span>, className: "hidden sm:table-cell" },
    { id: "paid", header: t("columns.paid"), align: "right", cell: (i) => <span className="tabular-nums">{money.of(i.paid)}</span>, className: "hidden md:table-cell" },
    { id: "balance", header: t("columns.balance"), align: "right", cell: (i) => <span className="font-medium tabular-nums">{money.of(i.balance)}</span> },
    { id: "due", header: t("columns.due"), cell: (i) => date.civil(i.dueDate), className: "hidden md:table-cell" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Can permission="finance.invoice.create">
            <Link href="/v2/finance/invoices/new" className={buttonClass.primary}>
              {t("new")}
            </Link>
          </Can>
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
          {(c) => <NativeSelect {...c} value={filters.status} onChange={setFilter("status")} placeholder={t("filters.allStatuses")} options={FINANCE_INVOICE_STATUSES.map((s) => ({ value: s, label: tStatus(s) }))} />}
        </FormField>
        <FormField label={t("filters.payer")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={filters.payerKind}
              onChange={setFilter("payerKind")}
              placeholder={t("filters.allPayers")}
              options={[
                { value: "LEARNER", label: tPayer("LEARNER") },
                { value: "FUNDER", label: tPayer("FUNDER") },
              ]}
            />
          )}
        </FormField>
        <AcademicYearField label={t("filters.year")} value={filters.academicYear} onChange={setFilter("academicYear")} allowEmpty />
      </div>
      {filters.groupKey ? (
        <Notice kind="info">
          {t("filters.groupActive", { group: filters.groupKey })}{" "}
          <button type="button" className="font-medium underline underline-offset-4" onClick={() => setFilter("groupKey")("")}>
            {t("filters.clearGroup")}
          </button>
        </Notice>
      ) : null}
      <DataTable
        caption={t("caption")}
        columns={columns}
        rows={list.data?.items ?? []}
        getRowId={(i) => i.id}
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
// Fiche d'une facture
// ---------------------------------------------------------------------------

export function InvoiceDetailScreen({ id }: { id: string }) {
  const t = useTranslations("v2Finance.invoiceDetail");
  const tCat = useTranslations("v2Finance.category");
  const money = useMoney();
  const date = useDateFormat();
  const invoice = useInvoice(id);
  const labels = useLearnerLabels(invoice.data ? [invoice.data.learnerId] : []);
  const flash = useFlash();
  const [dialog, setDialog] = useState<"cancel" | "credit" | "installments" | null>(null);
  const issue = useIssueInvoice();
  const cancel = useCancelInvoice();
  const installmentsFeature = useFeature("finance.installments");

  if (invoice.isPending && invoice.fetchStatus !== "idle") return <LoadingBlock />;
  if (invoice.isError) return <ErrorBlock error={invoice.error} onRetry={() => void invoice.refetch()} />;
  if (!invoice.data) return null;
  const inv: FinanceInvoiceDetailDto = invoice.data;
  const learnerName = labels.get(inv.learnerId) ?? inv.learnerId.slice(0, 8);
  const cancelled = inv.status === "CANCELLED";

  return (
    <div className="space-y-6">
      <PageHeader
        title={inv.number ?? t("draftTitle")}
        description={t("subtitle", { learner: learnerName, year: inv.academicYear })}
        actions={
          <>
            <Link href="/v2/finance/invoices" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            <button type="button" className={buttonClass.secondary} onClick={() => window.print()}>
              {t("print")}
            </button>
            {inv.status === "DRAFT" ? (
              <Can permission="finance.invoice.create">
                <button type="button" className={buttonClass.primary} disabled={issue.isPending} onClick={() => issue.mutate({ id }, { onSuccess: (r) => flash.show(t("issued", { number: r.number ?? "" })) })}>
                  {t("issue")}
                </button>
              </Can>
            ) : null}
            {!cancelled && inv.status !== "DRAFT" && inv.balance.amount > 0 ? (
              <Can permission="finance.payment.create">
                <Link href={`/v2/finance/payments/new?learnerId=${inv.learnerId}`} className={buttonClass.primary}>
                  {t("collect")}
                </Link>
              </Can>
            ) : null}
          </>
        }
      />
      {flash.node}
      {issue.isError ? <ErrorBlock error={issue.error} /> : null}
      {cancelled ? <Notice kind="warning">{t("cancelledNotice", { reason: inv.cancelReason ?? "—" })}</Notice> : null}
      {/* Chaque facture porte un identifiant de groupe : le bandeau « facture liée » n'a de sens que pour une facture de financeur, ou pour la part famille d'un financement partagé (QA C-05-05). */}
      {inv.relatedGroupId && (inv.payerKind === "FUNDER" || (inv.fundingType !== null && inv.fundingType !== "PRIVATE")) ? (
        <Notice kind="info">
          {inv.payerKind === "FUNDER" ? t("funderInvoice", { funder: inv.payerRef ?? "—" }) : t("familyInvoice")}
        </Notice>
      ) : null}

      <section aria-labelledby="inv-summary" className="rounded-lg border p-4">
        <h2 id="inv-summary" className="mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold">
          {t("summary")} <InvoiceStatusBadge status={inv.status} /> <PayerBadge kind={inv.payerKind} />
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["subtotal", inv.subtotal],
              ["discount", inv.discount],
              ["scholarship", inv.scholarship],
              ["total", inv.total],
              ["paid", inv.paid],
              ["credited", inv.credited],
              ["balance", inv.balance],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <dt className="text-muted-foreground">{t(`amounts.${key}`)}</dt>
              <dd className={key === "balance" || key === "total" ? "text-base font-semibold tabular-nums" : "tabular-nums"}>{money.of(value)}</dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">{t("dueDate")}</dt>
            <dd>{date.civil(inv.dueDate)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="inv-lines" className="space-y-2">
        <h2 id="inv-lines" className="text-lg font-semibold">
          {t("lines.title")}
        </h2>
        <DataTable
          caption={t("lines.caption")}
          columns={[
            { id: "description", header: t("lines.description"), rowHeader: true, cell: (l) => l.description },
            { id: "category", header: t("lines.category"), cell: (l) => tCat(l.category), className: "hidden sm:table-cell" },
            { id: "qty", header: t("lines.quantity"), align: "right", cell: (l) => l.quantity, className: "hidden md:table-cell" },
            { id: "unit", header: t("lines.unit"), align: "right", cell: (l) => <span className="tabular-nums">{money.of(l.unitAmount)}</span>, className: "hidden md:table-cell" },
            { id: "discount", header: t("lines.discount"), align: "right", cell: (l) => <span className="tabular-nums">{money.of(l.discount)}</span>, className: "hidden lg:table-cell" },
            { id: "scholarship", header: t("lines.scholarship"), align: "right", cell: (l) => <span className="tabular-nums">{money.of(l.scholarship)}</span>, className: "hidden lg:table-cell" },
            { id: "total", header: t("lines.total"), align: "right", cell: (l) => <span className="font-medium tabular-nums">{money.of(l.total)}</span> },
          ]}
          rows={inv.lines}
          getRowId={(l) => l.id}
        />
      </section>

      <section aria-labelledby="inv-installments" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="inv-installments" className="text-lg font-semibold">
            {t("installments.title")}
          </h2>
          {!cancelled && installmentsFeature.allowed ? (
            <Can permission="finance.invoice.create">
              <button type="button" className={buttonClass.secondary} onClick={() => setDialog("installments")}>
                {t("installments.generate")}
              </button>
            </Can>
          ) : null}
        </div>
        <DataTable
          caption={t("installments.caption")}
          columns={[
            { id: "seq", header: t("installments.seq"), cell: (n) => n.seq, className: "w-10" },
            { id: "label", header: t("installments.label"), rowHeader: true, cell: (n) => n.label },
            { id: "due", header: t("installments.due"), cell: (n) => date.civil(n.dueDate) },
            { id: "amount", header: t("installments.amount"), align: "right", cell: (n) => <span className="tabular-nums">{money.of(n.amount)}</span>, className: "hidden sm:table-cell" },
            { id: "paid", header: t("installments.paid"), align: "right", cell: (n) => <span className="tabular-nums">{money.of(n.paid)}</span>, className: "hidden md:table-cell" },
            { id: "remaining", header: t("installments.remaining"), align: "right", cell: (n) => <span className="font-medium tabular-nums">{money.of(n.remaining)}</span> },
            { id: "status", header: t("installments.status"), cell: (n) => <InstallmentStatusBadge status={n.status} /> },
          ]}
          rows={inv.installments}
          getRowId={(n) => n.id}
          emptyTitle={t("installments.empty")}
        />
      </section>

      {!cancelled && inv.status !== "DRAFT" ? (
        <Can permission="finance.invoice.cancel">
          <section aria-labelledby="inv-actions" className="space-y-2 rounded-lg border border-destructive/30 p-4">
            <h2 id="inv-actions" className="text-lg font-semibold">
              {t("danger.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("danger.hint")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => setDialog("credit")}>
                {t("danger.credit")}
              </button>
              <button type="button" className={buttonClass.danger} onClick={() => setDialog("cancel")}>
                {t("danger.cancel")}
              </button>
            </div>
          </section>
        </Can>
      ) : null}

      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t("cancelDialog.title")}
        description={t("cancelDialog.description")}
        reasonLabel={t("cancelDialog.reason")}
        confirmLabel={t("cancelDialog.confirm")}
        destructive
        isPending={cancel.isPending}
        error={cancel.error}
        onConfirm={(reason) => cancel.mutate({ id, reason }, { onSuccess: () => (setDialog(null), flash.show(t("cancelled"))) })}
      />
      {dialog === "credit" ? <CreditNoteDialog invoice={inv} onClose={() => setDialog(null)} onDone={(n) => flash.show(t("creditIssued", { number: n }))} /> : null}
      {dialog === "installments" ? <InstallmentsDialog id={id} onClose={() => setDialog(null)} onDone={() => flash.show(t("installmentsGenerated"))} /> : null}
    </div>
  );
}

function CreditNoteDialog({ invoice, onClose, onDone }: { invoice: FinanceInvoiceDetailDto; onClose: () => void; onDone: (number: string) => void }) {
  const t = useTranslations("v2Finance.invoiceDetail.creditDialog");
  const money = useMoney();
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const credit = useIssueCreditNote();
  const [form, setForm] = useState({ amount: "", reason: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(credit.error);

  function submit() {
    const amount = parseAmountInput(form.amount);
    if (!amount.ok) return setErrors({ amount: describeAmount(amount) ?? "" });
    const result = validate(financeCreditNoteBodySchema, { amount: amount.amount, reason: form.reason.trim() });
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    credit.mutate(
      { id: invoice.id, amount: amount.amount, reason: result.data.reason },
      {
        onSuccess: (r) => {
          onDone(r.creditNote.number);
          onClose();
        },
      },
    );
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description", { balance: money.of(invoice.balance) })} submitLabel={t("submit")} onSubmit={submit} isPending={credit.isPending} error={credit.error && Object.keys(apiErrors).length === 0 ? credit.error : undefined}>
      <MoneyField label={t("amount")} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} required error={errors.amount ?? apiErrors.amount} />
      <FormField label={t("reason")} required error={errors.reason ?? apiErrors.reason} hint={t("reasonHint")}>
        {(c) => <TextAreaControl {...c} value={form.reason} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} maxLength={500} />}
      </FormField>
    </FormDialog>
  );
}

function InstallmentsDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("v2Finance.invoiceDetail.installmentsDialog");
  const plans = useInstallmentPlans();
  const generate = useGenerateInstallments();
  const [planId, setPlanId] = useState("");
  const [baseDate, setBaseDate] = useState("");
  const options = useMemo(() => (plans.data ?? []).map((p) => ({ value: p.id, label: p.name })), [plans.data]);
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("title")}
      description={t("description")}
      submitLabel={t("submit")}
      isPending={generate.isPending}
      error={generate.error}
      onSubmit={() => {
        if (!planId) return;
        generate.mutate(
          { id, planId, ...(baseDate ? { baseDate } : {}) },
          {
            onSuccess: () => {
              onDone();
              onClose();
            },
          },
        );
      }}
    >
      <FormField label={t("plan")} required>
        {(c) => <NativeSelect {...c} value={planId} onChange={setPlanId} placeholder={t("choose")} options={options} />}
      </FormField>
      <FormField label={t("baseDate")} hint={t("baseDateHint")}>
        {(c) => <TextControl {...c} type="date" value={baseDate} onChange={setBaseDate} />}
      </FormField>
    </FormDialog>
  );
}

