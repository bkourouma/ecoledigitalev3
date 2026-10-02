"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { financeInitiateOnlinePaymentBodySchema, type financeOnlinePaymentDtoSchema, type FinanceInvoiceSummaryDto } from "@ecoledigitale/contracts/v2/finance";
import type { z } from "zod";
import { useFeature, usePermission } from "@/platform/access";
import { useInitiateOnlinePayment, useInvoice, useLearnerStatement, useReceipts } from "@/platform/v2/finance";
import { useMyChildren, useMyStudentRecord } from "@/platform/v2/people";
import { DataTable } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useIdempotentRunner } from "@/platform/ui/idempotency";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { InstallmentStatusBadge, InvoiceStatusBadge, PaymentStatusBadge } from "./labels";
import { ONLINE_PROVIDERS } from "./PaymentForm";
import { PaymentTracker } from "./PaymentTracker";
import { MoneyField, useAmountErrors, useValidator } from "./shared";

type Learner = { id: string; name: string; classroom: string | null };

/**
 * Apprenants dont l'utilisateur peut voir les finances : ses ENFANTS (liens de tutelle vivants, tels que renvoyés par
 * `GET /people/children`) ou lui-même (élève). Rien n'est déduit côté écran : un identifiant absent de cette liste
 * n'est jamais interrogé côté finance (voir `MyChildFinanceScreen`).
 */
function useMyLearners(): { learners: Learner[]; isLoading: boolean; error: unknown; refetch: () => void } {
  const child = usePermission("student.child.read");
  const self = usePermission("student.self.read");
  const children = useMyChildren(child.allowed);
  const own = useMyStudentRecord(self.allowed && !child.allowed);
  const learners: Learner[] = [
    ...(children.data ?? []).map((c) => ({ id: c.id, name: c.displayName, classroom: c.currentEnrollment?.classroomName ?? null })),
    ...(own.data ? [{ id: own.data.id, name: own.data.displayName, classroom: own.data.currentEnrollment?.classroomName ?? null }] : []),
  ];
  return {
    learners,
    isLoading: child.isLoading || self.isLoading || (child.allowed && children.isPending) || (self.allowed && !child.allowed && own.isPending),
    error: children.error ?? own.error,
    refetch: () => void (children.refetch(), own.refetch()),
  };
}

export function MyFinanceScreen() {
  const t = useTranslations("v2Finance.me");
  const { learners, isLoading, error, refetch } = useMyLearners();
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />
      {isLoading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock error={error} onRetry={refetch} /> : null}
      {!isLoading && !error && learners.length === 0 ? <EmptyBlock title={t("empty")} description={t("emptyHint")} /> : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t("listLabel")}>
        {learners.map((l) => (
          <li key={l.id}>
            <LearnerCard learner={l} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function LearnerCard({ learner }: { learner: Learner }) {
  const t = useTranslations("v2Finance.me.card");
  const money = useMoney();
  const statement = useLearnerStatement(learner.id);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-base font-semibold">{learner.name}</h2>
        <p className="text-sm text-muted-foreground">{learner.classroom ?? t("notEnrolled")}</p>
      </div>
      {statement.isPending && statement.fetchStatus !== "idle" ? <LoadingBlock className="py-2" /> : null}
      {statement.isError ? <Notice kind="info">{t("unavailable")}</Notice> : null}
      {statement.data ? (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("billed")}</dt>
            <dd className="tabular-nums">{money.of(statement.data.totals.billed)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("collected")}</dt>
            <dd className="tabular-nums">{money.of(statement.data.totals.collected)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">{t("outstanding")}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money.of(statement.data.totals.outstanding)}</dd>
          </div>
        </dl>
      ) : null}
      <Link href={`/v2/finance/me/${learner.id}`} className={buttonClass.secondary}>
        {t("open")}
        <span className="sr-only"> — {learner.name}</span>
      </Link>
    </div>
  );
}

export function MyChildFinanceScreen({ learnerId }: { learnerId: string }) {
  const t = useTranslations("v2Finance.me.detail");
  const money = useMoney();
  const date = useDateFormat();
  const online = useFeature("finance.online-payment");
  const { learners, isLoading, error, refetch } = useMyLearners();
  const learner = learners.find((l) => l.id === learnerId) ?? null;
  // Garde de tutelle : tant que le lien n'est pas confirmé par l'API des personnes, AUCUNE donnée financière n'est lue.
  const statement = useLearnerStatement(learner ? learnerId : null);
  const receipts = useReceipts({ learnerId, limit: 50 }, { enabled: learner !== null });
  const [paying, setPaying] = useState(false);
  const [started, setStarted] = useState<z.infer<typeof financeOnlinePaymentDtoSchema> | null>(null);

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={refetch} />;
  if (!learner) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("forbiddenTitle")} />
        <Notice kind="warning">{t("forbidden")}</Notice>
        <Link href="/v2/finance/me" className={buttonClass.secondary}>
          {t("back")}
        </Link>
      </div>
    );
  }

  const invoices = statement.data?.invoices ?? [];
  const open = invoices.filter((i) => ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status) && i.balance.amount > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={learner.name}
        description={learner.classroom ?? t("notEnrolled")}
        actions={
          <>
            <Link href="/v2/finance/me" className={buttonClass.secondary}>
              {t("back")}
            </Link>
            {online.allowed && open.length > 0 ? (
              <button type="button" className={buttonClass.primary} onClick={() => setPaying(true)}>
                {t("pay")}
              </button>
            ) : null}
          </>
        }
      />
      {started ? <PaymentTracker paymentId={started.payment.id} /> : null}
      {statement.isPending && statement.fetchStatus !== "idle" ? <LoadingBlock /> : null}
      {statement.isError ? <ErrorBlock error={statement.error} onRetry={() => void statement.refetch()} /> : null}
      {statement.data ? (
        <>
          <section aria-labelledby="me-totals" className="rounded-lg border p-4">
            <h2 id="me-totals" className="mb-3 text-lg font-semibold">
              {t("totals.title")}
            </h2>
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {(["billed", "credited", "collected", "outstanding"] as const).map((k) => (
                <div key={k}>
                  <dt className="text-muted-foreground">{t(`totals.${k}`)}</dt>
                  <dd className={k === "outstanding" ? "text-xl font-semibold tabular-nums" : "tabular-nums"}>{money.of(statement.data!.totals[k])}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="me-invoices" className="space-y-2">
            <h2 id="me-invoices" className="text-lg font-semibold">
              {t("invoices.title")}
            </h2>
            {invoices.length === 0 ? <p className="text-sm text-muted-foreground">{t("invoices.empty")}</p> : null}
            <ul className="space-y-2">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <InvoiceCard invoice={inv} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="me-payments" className="space-y-2">
            <h2 id="me-payments" className="text-lg font-semibold">
              {t("payments.title")}
            </h2>
            <DataTable
              caption={t("payments.caption")}
              columns={[
                { id: "date", header: t("payments.date"), rowHeader: true, cell: (p) => date.instant(p.receivedAt) },
                { id: "amount", header: t("payments.amount"), align: "right", cell: (p) => <span className="font-medium tabular-nums">{money.of(p.amount)}</span> },
                { id: "status", header: t("payments.status"), cell: (p) => <PaymentStatusBadge status={p.status} /> },
              ]}
              rows={statement.data.payments}
              getRowId={(p) => p.id}
              emptyTitle={t("payments.empty")}
            />
          </section>
        </>
      ) : null}

      <section aria-labelledby="me-receipts" className="space-y-2">
        <h2 id="me-receipts" className="text-lg font-semibold">
          {t("receipts.title")}
        </h2>
        {receipts.isError ? <Notice kind="info">{t("receipts.unavailable")}</Notice> : null}
        {receipts.data && receipts.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("receipts.empty")}</p> : null}
        <ul className="divide-y rounded-md border text-sm" aria-label={t("receipts.title")}>
          {(receipts.data?.items ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <Link href={`/v2/finance/me/${learnerId}/receipts/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {r.number}
              </Link>
              <span className="text-muted-foreground">{date.instant(r.issuedAt)}</span>
              <span className="tabular-nums">{money.of(r.amount)}</span>
            </li>
          ))}
        </ul>
      </section>

      {paying ? <PayDialog learnerId={learnerId} openInvoices={open} onClose={() => setPaying(false)} onStarted={(v) => (setStarted(v), setPaying(false))} /> : null}
    </div>
  );
}

/** Facture et ÉCHÉANCES (chargées à l'ouverture) : dates limites, reste dû et statut de chaque échéance, issus de l'API. */
function InvoiceCard({ invoice }: { invoice: FinanceInvoiceSummaryDto }) {
  const t = useTranslations("v2Finance.me.detail.invoices");
  const money = useMoney();
  const date = useDateFormat();
  const [expanded, setExpanded] = useState(false);
  const detail = useInvoice(expanded ? invoice.id : null);
  return (
    <details className="rounded-lg border" onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3">
        <span className="font-medium">{invoice.number ?? t("draft")}</span>
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <InvoiceStatusBadge status={invoice.status} />
          <span className="tabular-nums">{t("balance", { amount: money.of(invoice.balance) })}</span>
        </span>
      </summary>
      <div className="border-t p-3">
        {expanded && detail.isPending ? <LoadingBlock /> : null}
        {detail.isError ? <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} /> : null}
        {detail.data ? (
          <DataTable
            caption={t("installments", { number: invoice.number ?? "" })}
            columns={[
              { id: "label", header: t("columns.label"), rowHeader: true, cell: (n) => n.label },
              { id: "due", header: t("columns.due"), cell: (n) => date.civil(n.dueDate) },
              { id: "amount", header: t("columns.amount"), align: "right", cell: (n) => <span className="tabular-nums">{money.of(n.amount)}</span>, className: "hidden sm:table-cell" },
              { id: "remaining", header: t("columns.remaining"), align: "right", cell: (n) => <span className="font-medium tabular-nums">{money.of(n.remaining)}</span> },
              { id: "status", header: t("columns.status"), cell: (n) => <InstallmentStatusBadge status={n.status} /> },
            ]}
            rows={detail.data.installments}
            getRowId={(n) => n.id}
            emptyTitle={t("noInstallments")}
          />
        ) : null}
      </div>
    </details>
  );
}

function PayDialog({ learnerId, openInvoices, onClose, onStarted }: { learnerId: string; openInvoices: FinanceInvoiceSummaryDto[]; onClose: () => void; onStarted: (v: z.infer<typeof financeOnlinePaymentDtoSchema>) => void }) {
  const t = useTranslations("v2Finance.me.payDialog");
  const tProvider = useTranslations("v2Finance.onlineForm.providers");
  const money = useMoney();
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const initiate = useInitiateOnlinePayment();
  const runner = useIdempotentRunner<string>((fp) => fp, "ol");
  const [form, setForm] = useState({ invoiceId: openInvoices[0]?.id ?? "", amount: openInvoices[0] ? String(openInvoices[0].balance.amount) : "", provider: "orange_money", phone: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(initiate.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];

  async function submit() {
    const amount = parseAmountInput(form.amount);
    if (!amount.ok) return setErrors({ amount: describeAmount(amount) ?? "" });
    const parsed = validate(financeInitiateOnlinePaymentBodySchema, {
      learnerId,
      amount: amount.amount,
      provider: form.provider,
      ...(form.invoiceId ? { invoiceId: form.invoiceId } : {}),
      ...(form.phone.trim() ? { payer: { phoneNumber: form.phone.trim() } } : {}),
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    const body = parsed.data;
    try {
      const view = await runner.run(JSON.stringify(body), (key) => initiate.mutateAsync({ body, key }));
      if (view) onStarted(view);
    } catch {
      /* erreur affichée ; clé conservée */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={initiate.isPending} error={initiate.error && Object.keys(apiErrors).length === 0 ? initiate.error : undefined}>
      <FormField label={t("invoice")} error={err("invoiceId")}>
        {(c) => (
          <NativeSelect
            {...c}
            value={form.invoiceId}
            onChange={(v) => {
              const inv = openInvoices.find((i) => i.id === v);
              setForm((f) => ({ ...f, invoiceId: v, amount: inv ? String(inv.balance.amount) : f.amount }));
            }}
            placeholder={t("anyInvoice")}
            options={openInvoices.map((i) => ({ value: i.id, label: t("invoiceOption", { number: i.number ?? "—", balance: money.of(i.balance) }) }))}
          />
        )}
      </FormField>
      <MoneyField label={t("amount")} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} required error={err("amount")} hint={t("amountHint")} />
      <FormField label={t("provider")} required error={err("provider")}>
        {(c) => <NativeSelect {...c} value={form.provider} onChange={(v) => setForm((f) => ({ ...f, provider: v }))} options={ONLINE_PROVIDERS.map((p) => ({ value: p, label: tProvider(p) }))} />}
      </FormField>
      <FormField label={t("phone")} hint={t("phoneHint")} error={err("payer.phoneNumber")}>
        {(c) => <TextControl {...c} type="tel" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} autoComplete="tel" maxLength={30} />}
      </FormField>
    </FormDialog>
  );
}
