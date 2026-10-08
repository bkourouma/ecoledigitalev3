"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import type { financeFamilyOnlinePaymentDtoSchema, FinanceFamilyInvoiceSummaryDto } from "@ecoledigitale/contracts/v2/finance";
import { useFeature, usePermission } from "@/platform/access";
import {
  familyReceiptPdfPath,
  financeFamilyInitiatePaymentBodySchema,
  useFamilyInstallments,
  useFamilyInvoice,
  useFamilyPayment,
  useFamilyReceipt,
  useFamilyReceipts,
  useFamilyStatement,
  useInitiateFamilyPayment,
  useVerifyFamilyPayment,
} from "@/platform/v2/portal";
import { DataTable } from "@/platform/ui/DataTable";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useIdempotentRunner } from "@/platform/ui/idempotency";
import { FormDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { PdfButton } from "@/platform/ui/PdfButton";
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { InstallmentStatusBadge, InvoiceStatusBadge, PaymentStatusBadge } from "../finance/_components/labels";
import { ONLINE_PROVIDER_CHOICES, SANDBOX_ENABLED } from "../finance/_components/PaymentForm";
import { MoneyField, useAmountErrors, useValidator } from "../finance/_components/shared";

const OPEN_STATUSES = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

/**
 * Situation financière de la famille pour UN apprenant (`/finance/me/*`) : totaux, prochaines échéances, factures émises avec
 * échéancier, paiements, reçus (PDF scellé et vérifiable) et paiement en ligne (fonction `finance.online-payment`). Tout est calculé
 * par l'API sur le seul périmètre de la famille ; un apprenant hors périmètre répond 404 uniforme, affiché tel quel.
 */
export function FamilyFinance({ learnerId, title, description, receiptHref }: { learnerId: string; title: string; description?: string; receiptHref: (receiptId: string) => string }) {
  const t = useTranslations("v2Portal.family.finance");
  const money = useMoney();
  const date = useDateFormat();
  const online = useFeature("finance.online-payment");
  const canPayChild = usePermission("finance.child.pay").allowed;
  const canPaySelf = usePermission("finance.self.pay").allowed;
  const statement = useFamilyStatement(learnerId);
  const installments = useFamilyInstallments(learnerId, { open: true });
  const receipts = useFamilyReceipts(learnerId, { limit: 50 });
  const [paying, setPaying] = useState(false);
  const [started, setStarted] = useState<z.infer<typeof financeFamilyOnlinePaymentDtoSchema> | null>(null);

  const invoices = statement.data?.invoices ?? [];
  const open = invoices.filter((i) => OPEN_STATUSES.includes(i.status) && i.balance.amount > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={online.allowed && (canPayChild || canPaySelf) && open.length > 0 ? (
          <button type="button" className={buttonClass.primary} onClick={() => setPaying(true)}>
            {t("pay")}
          </button>
        ) : null}
      />
      {started ? <FamilyPaymentTracker learnerId={learnerId} started={started} onDismiss={() => setStarted(null)} /> : null}
      {statement.isPending ? <LoadingBlock /> : null}
      {statement.isError ? <ErrorBlock error={statement.error} onRetry={() => void statement.refetch()} /> : null}
      {statement.data ? (
        <>
          <section aria-labelledby="fam-totals" className="rounded-lg border p-4">
            <h2 id="fam-totals" className="mb-3 text-lg font-semibold">
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

          <section aria-labelledby="fam-installments" className="space-y-2">
            <h2 id="fam-installments" className="text-lg font-semibold">
              {t("installments.title")}
            </h2>
            {installments.isError ? <Notice kind="info">{t("installments.unavailable")}</Notice> : null}
            {installments.data && installments.data.length === 0 ? <p className="text-sm text-muted-foreground">{t("installments.empty")}</p> : null}
            {installments.data && installments.data.length > 0 ? (
              <DataTable
                caption={t("installments.caption")}
                columns={[
                  { id: "invoice", header: t("installments.invoice"), rowHeader: true, cell: (n) => n.invoiceNumber },
                  { id: "label", header: t("installments.label"), cell: (n) => n.label, className: "hidden sm:table-cell" },
                  { id: "due", header: t("installments.due"), cell: (n) => date.civil(n.dueDate) },
                  { id: "remaining", header: t("installments.remaining"), align: "right", cell: (n) => <span className="font-medium tabular-nums">{money.of(n.remaining)}</span> },
                  { id: "status", header: t("installments.status"), cell: (n) => <InstallmentStatusBadge status={n.status} /> },
                ]}
                rows={installments.data}
                getRowId={(n) => n.id}
              />
            ) : null}
          </section>

          <section aria-labelledby="fam-invoices" className="space-y-2">
            <h2 id="fam-invoices" className="text-lg font-semibold">
              {t("invoices.title")}
            </h2>
            {invoices.length === 0 ? <p className="text-sm text-muted-foreground">{t("invoices.empty")}</p> : null}
            <ul className="space-y-2">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <InvoiceCard learnerId={learnerId} invoice={inv} />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="fam-payments" className="space-y-2">
            <h2 id="fam-payments" className="text-lg font-semibold">
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

      <section aria-labelledby="fam-receipts" className="space-y-2">
        <h2 id="fam-receipts" className="text-lg font-semibold">
          {t("receipts.title")}
        </h2>
        {receipts.isError ? <ErrorBlock error={receipts.error} onRetry={() => void receipts.refetch()} /> : null}
        {receipts.data && receipts.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("receipts.empty")}</p> : null}
        <ul className="divide-y rounded-md border text-sm" aria-label={t("receipts.title")}>
          {(receipts.data?.items ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <Link href={receiptHref(r.id)} className="font-medium text-primary underline-offset-4 hover:underline">
                {r.number}
              </Link>
              <span className="text-muted-foreground">{date.instant(r.issuedAt)}</span>
              <span className="tabular-nums">{money.of(r.amount)}</span>
              <PdfButton path={familyReceiptPdfPath(learnerId, r.id)} fileName={`recu-${r.number}.pdf`} label={t("receipts.pdf")} ariaLabel={t("receipts.pdfOf", { number: r.number })} variant="ghost" />
            </li>
          ))}
        </ul>
      </section>

      {paying ? <PayDialog learnerId={learnerId} openInvoices={open} onClose={() => setPaying(false)} onStarted={(v) => (setStarted(v), setPaying(false))} /> : null}
    </div>
  );
}

/** Facture et ÉCHÉANCES (chargées à l'ouverture) : dates limites, reste dû et statut de chaque échéance, issus de l'API. */
function InvoiceCard({ learnerId, invoice }: { learnerId: string; invoice: FinanceFamilyInvoiceSummaryDto }) {
  const t = useTranslations("v2Portal.family.finance.invoices");
  const money = useMoney();
  const date = useDateFormat();
  const [expanded, setExpanded] = useState(false);
  const detail = useFamilyInvoice(learnerId, expanded ? invoice.id : null);
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

function PayDialog({ learnerId, openInvoices, onClose, onStarted }: { learnerId: string; openInvoices: FinanceFamilyInvoiceSummaryDto[]; onClose: () => void; onStarted: (v: z.infer<typeof financeFamilyOnlinePaymentDtoSchema>) => void }) {
  const t = useTranslations("v2Portal.family.finance.payDialog");
  const tProvider = useTranslations("v2Finance.onlineForm.providers");
  const money = useMoney();
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const initiate = useInitiateFamilyPayment();
  const runner = useIdempotentRunner<string>((fp) => fp, "ol");
  const [form, setForm] = useState({ invoiceId: openInvoices[0]?.id ?? "", amount: openInvoices[0] ? String(openInvoices[0].balance.amount) : "", provider: ONLINE_PROVIDER_CHOICES[0]!, phone: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const apiErrors = apiErrorToFieldErrors(initiate.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];

  async function submit() {
    const amount = parseAmountInput(form.amount);
    if (!amount.ok) return setErrors({ amount: describeAmount(amount) ?? "" });
    const parsed = validate(financeFamilyInitiatePaymentBodySchema, {
      invoiceId: form.invoiceId,
      amount: amount.amount,
      provider: form.provider,
      ...(form.phone.trim() ? { payer: { phoneNumber: form.phone.trim() } } : {}),
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    const body = parsed.data;
    try {
      const view = await runner.run(JSON.stringify(body), (key) => initiate.mutateAsync({ learnerId, body, key }));
      if (view) onStarted(view);
    } catch {
      /* erreur affichée ; clé conservée pour la nouvelle tentative */
    }
  }

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("title")} description={t("description")} submitLabel={t("submit")} onSubmit={() => void submit()} isPending={initiate.isPending} error={initiate.error && Object.keys(apiErrors).length === 0 ? initiate.error : undefined}>
      <FormField label={t("invoice")} required error={err("invoiceId")}>
        {(c) => (
          <NativeSelect
            {...c}
            value={form.invoiceId}
            onChange={(v) => {
              const inv = openInvoices.find((i) => i.id === v);
              setForm((f) => ({ ...f, invoiceId: v, amount: inv ? String(inv.balance.amount) : f.amount }));
            }}
            options={openInvoices.map((i) => ({ value: i.id, label: t("invoiceOption", { number: i.number ?? "—", balance: money.of(i.balance) }) }))}
          />
        )}
      </FormField>
      <MoneyField label={t("amount")} value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} required error={err("amount")} hint={t("amountHint")} />
      <FormField label={t("provider")} required error={err("provider")} hint={SANDBOX_ENABLED && form.provider === "sandbox" ? t("sandboxHint") : undefined}>
        {(c) => <NativeSelect {...c} value={form.provider} onChange={(v) => setForm((f) => ({ ...f, provider: v }))} options={ONLINE_PROVIDER_CHOICES.map((p) => ({ value: p, label: tProvider(p) }))} />}
      </FormField>
      <FormField label={t("phone")} hint={t("phoneHint")} error={err("payer.phoneNumber")}>
        {(c) => <TextControl {...c} type="tel" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} autoComplete="tel" maxLength={30} />}
      </FormField>
    </FormDialog>
  );
}

/**
 * Suivi d'un paiement en ligne : tant que le statut est « En attente », la vérification auprès du fournisseur (via l'API) est
 * relancée à intervalle régulier (une seule à la fois) jusqu'à un statut définitif ou `maxMs`. L'issue est celle de l'API.
 */
export function FamilyPaymentTracker({
  learnerId,
  started,
  onDismiss,
  intervalMs = 5000,
  maxMs = 10 * 60_000,
}: {
  learnerId: string;
  started: z.infer<typeof financeFamilyOnlinePaymentDtoSchema>;
  onDismiss: () => void;
  intervalMs?: number;
  maxMs?: number;
}) {
  const t = useTranslations("v2Portal.family.finance.tracker");
  const money = useMoney();
  const paymentId = started.payment.id;
  const view = useFamilyPayment(learnerId, paymentId);
  const verify = useVerifyFamilyPayment();
  const payment = view.data?.payment ?? started.payment;
  const status = payment.status;
  const startedAt = useRef(Date.now());
  const busy = useRef(false);
  const verifyRef = useRef(verify);
  verifyRef.current = verify;
  const instr = started.instructions;

  useEffect(() => {
    if (status !== "PENDING") return;
    const handle = setInterval(() => {
      if (busy.current || Date.now() - startedAt.current > maxMs) return;
      busy.current = true;
      verifyRef.current.mutate({ learnerId, id: paymentId }, { onSettled: () => (busy.current = false) });
    }, intervalMs);
    return () => clearInterval(handle);
  }, [status, learnerId, paymentId, intervalMs, maxMs]);

  function checkNow() {
    if (busy.current) return;
    busy.current = true;
    verify.mutate({ learnerId, id: paymentId }, { onSettled: () => (busy.current = false) });
  }

  return (
    <section aria-labelledby="fam-tracker" className="space-y-3 rounded-lg border p-4" aria-live="polite">
      <h2 id="fam-tracker" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        {t("title")} <PaymentStatusBadge status={status} />
      </h2>
      <p className="text-sm">{t("amount", { amount: money.of(payment.amount) })}</p>
      {instr && status === "PENDING" ? (
        <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
          {instr.instructions ? <p>{instr.instructions}</p> : null}
          {instr.ussdCode ? (
            <p>
              {t("ussd")} <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{instr.ussdCode}</code>
            </p>
          ) : null}
          {instr.redirectUrl && /^https:\/\//.test(instr.redirectUrl) ? (
            <a href={instr.redirectUrl} target="_blank" rel="noopener noreferrer" className={buttonClass.primary}>
              {t("redirect")}
            </a>
          ) : null}
        </div>
      ) : null}
      {status === "PENDING" ? (
        <>
          <Notice kind="info">{t("pending")}</Notice>
          <button type="button" className={buttonClass.secondary} onClick={checkNow} disabled={verify.isPending}>
            {t("checkNow")}
          </button>
        </>
      ) : null}
      {status === "CONFIRMED" ? <Notice kind="success">{t("confirmed")}</Notice> : null}
      {status === "FAILED" ? <Notice kind="error">{t("failed", { reason: payment.failureReason ?? "—" })}</Notice> : null}
      {verify.isError ? <ErrorBlock error={verify.error} /> : null}
      {status !== "PENDING" ? (
        <button type="button" className={buttonClass.secondary} onClick={onDismiss}>
          {t("dismiss")}
        </button>
      ) : null}
    </section>
  );
}

/** Reçu de la famille : instantané immuable de l'API (imprimable) et PDF scellé avec QR de vérification publique. */
export function FamilyReceiptDetail({ learnerId, id, backHref }: { learnerId: string; id: string; backHref: string }) {
  const t = useTranslations("v2Portal.family.finance.receipt");
  const tMethod = useTranslations("v2Finance.method");
  const money = useMoney();
  const date = useDateFormat();
  const receipt = useFamilyReceipt(learnerId, id);

  if (receipt.isPending) return <LoadingBlock />;
  if (receipt.isError) {
    return (
      <div className="space-y-4">
        <ErrorBlock error={receipt.error} onRetry={() => void receipt.refetch()} />
        <Link href={backHref} className={buttonClass.secondary}>
          {t("back")}
        </Link>
      </div>
    );
  }
  const r = receipt.data;
  const s = r.snapshot;
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={t("title", { number: r.number })}
          actions={
            <>
              <Link href={backHref} className={buttonClass.secondary}>
                {t("back")}
              </Link>
              <PdfButton path={familyReceiptPdfPath(learnerId, r.id)} fileName={`recu-${r.number}.pdf`} label={t("pdf")} variant="primary" />
              <button type="button" className={buttonClass.secondary} onClick={() => window.print()}>
                {t("print")}
              </button>
            </>
          }
        />
      </div>
      <article aria-label={t("document")} className="mx-auto max-w-2xl space-y-4 rounded-lg border bg-background p-6 print:max-w-none print:border-0 print:p-0">
        <header className="space-y-1 border-b pb-4 text-center">
          <h2 className="text-xl font-bold uppercase tracking-wide">{t("heading")}</h2>
          <p className="font-mono text-sm">{s.number}</p>
        </header>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("date")}</dt>
            <dd>{date.instant(s.issuedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("method")}</dt>
            <dd>
              {tMethod(s.method)}
              {s.reference ? ` · ${s.reference}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("amount")}</dt>
            <dd className="text-lg font-semibold tabular-nums">{money.of(r.amount)}</dd>
          </div>
          {s.balanceAfter ? (
            <div>
              <dt className="text-muted-foreground">{t("balanceAfter")}</dt>
              <dd className="tabular-nums">{money.of(s.balanceAfter)}</dd>
            </div>
          ) : null}
        </dl>
        {s.allocations.length === 0 ? (
          <EmptyBlock title={t("noAllocations")} />
        ) : (
          <ul className="divide-y rounded-md border text-sm" aria-label={t("allocations")}>
            {s.allocations.map((a) => (
              <li key={`${a.installmentId}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>
                  {a.invoiceNumber ?? "—"} · {a.label}
                </span>
                <span className="tabular-nums">{money.fmt(a.amount, r.amount.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
