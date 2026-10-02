"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { FINANCE_PAYMENT_METHODS, financeInitiateOnlinePaymentBodySchema, financeRecordPaymentBodySchema } from "@ecoledigitale/contracts/v2/finance";
import { useFeature } from "@/platform/access";
import { useInitiateOnlinePayment, useInvoices, useMyCashSession, useRecordPayment } from "@/platform/v2/finance";
import { useStudentOptions } from "@/platform/v2/lookups";
import { FeatureNotice } from "@/platform/ui/AccessGate";
import { FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useIdempotentRunner } from "@/platform/ui/idempotency";
import { ModalDialog } from "@/platform/ui/ModalDialog";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, Notice } from "@/platform/ui/states";
import { useDescribeError } from "@/platform/ui/errors";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { AllocationEditor, buildAllocation, EMPTY_ALLOCATION, type AllocationState } from "./AllocationEditor";
import { PaymentTracker } from "./PaymentTracker";
import { MoneyField, useAmountErrors, useValidator } from "./shared";
import type { z } from "zod";
import type { FinanceRecordPaymentBody, financeOnlinePaymentDtoSchema, financePaymentViewDtoSchema } from "@ecoledigitale/contracts/v2/finance";

type PaymentView = z.infer<typeof financePaymentViewDtoSchema>;
type OnlineView = z.infer<typeof financeOnlinePaymentDtoSchema>;

const MANUAL_METHODS = FINANCE_PAYMENT_METHODS.filter((m) => m !== "ONLINE");

/**
 * Encaissement manuel (espèces, chèque, virement, carte, mobile money).
 *
 * Sécurité de l'opération : la saisie est d'abord RELUE dans une fenêtre de confirmation ; l'envoi porte une clé
 * d'idempotence (en-tête et corps), reprise à l'identique après un échec réseau et abandonnée après un succès ; un
 * double clic ou un second appui pendant l'envoi n'émet jamais une seconde requête. Le reçu, les imputations et le solde
 * restant sont ceux renvoyés par l'API.
 */
export function NewPaymentScreen({ initialLearnerId }: { initialLearnerId?: string }) {
  const t = useTranslations("v2Finance.paymentForm");
  const tMethod = useTranslations("v2Finance.method");
  const tPayer = useTranslations("v2Finance.payer");
  const money = useMoney();
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const describe = useDescribeError();
  const session = useMyCashSession();
  const record = useRecordPayment();
  const runner = useIdempotentRunner<string>((fp) => fp, "pay");

  const [learner, setLearner] = useState<SelectOption | null>(initialLearnerId ? { value: initialLearnerId, label: initialLearnerId.slice(0, 8) } : null);
  const [form, setForm] = useState({ amount: "", method: "CASH", reference: "", payerName: "", payerKind: "LEARNER", payerRef: "" });
  const [allocation, setAllocation] = useState<AllocationState>(EMPTY_ALLOCATION);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pendingBody, setPendingBody] = useState<FinanceRecordPaymentBody | null>(null);
  const [result, setResult] = useState<PaymentView | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const apiErrors = apiErrorToFieldErrors(record.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];

  const noOpenSession = form.method === "CASH" && session.isSuccess && session.data === null;

  function buildBody(): { body: FinanceRecordPaymentBody | null; errors: FieldErrors } {
    const amount = parseAmountInput(form.amount);
    const local: FieldErrors = {};
    if (!amount.ok) local.amount = describeAmount(amount) ?? "";
    const alloc = buildAllocation(allocation, describeAmount);
    Object.assign(local, alloc.errors);
    if (Object.keys(local).length > 0 || !amount.ok) return { body: null, errors: local };
    const candidate = {
      learnerId: learner?.value ?? "",
      amount: amount.amount,
      method: form.method,
      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
      ...(form.payerName.trim() ? { payerName: form.payerName.trim() } : {}),
      ...(form.payerKind === "FUNDER" ? { payerKind: "FUNDER", ...(form.payerRef.trim() ? { payerRef: form.payerRef.trim() } : {}) } : {}),
      ...(alloc.body ? { allocation: alloc.body } : {}),
    };
    const parsed = validate(financeRecordPaymentBodySchema, candidate);
    return parsed.ok ? { body: parsed.data, errors: {} } : { body: null, errors: parsed.errors };
  }

  function review() {
    const built = buildBody();
    setErrors(built.errors);
    if (built.body) setPendingBody(built.body);
  }

  async function confirm() {
    if (!pendingBody) return;
    const body = pendingBody;
    try {
      const view = await runner.run(JSON.stringify(body), (key) => record.mutateAsync({ body, key }));
      if (view) {
        setResult(view);
        setPendingBody(null);
      }
    } catch {
      /* l'erreur est affichée dans la fenêtre ; la clé est conservée : « Confirmer » renvoie la MÊME demande */
    }
  }

  function reset() {
    runner.reset();
    record.reset();
    setResult(null);
    setPendingBody(null);
    setForm({ amount: "", method: "CASH", reference: "", payerName: "", payerKind: "LEARNER", payerRef: "" });
    setAllocation(EMPTY_ALLOCATION);
    setErrors({});
  }

  if (result) return <PaymentDone view={result} onNew={reset} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={<Link href="/v2/finance/payments" className={buttonClass.secondary}>{t("cancel")}</Link>} />

      <section aria-labelledby="pay-learner" className="space-y-3 rounded-lg border p-4">
        <h2 id="pay-learner" className="text-lg font-semibold">
          {t("learner.title")}
        </h2>
        <FormField label={t("learner.label")} required error={err("learnerId")}>
          {(c) => (
            <SelectAsync
              {...c}
              value={learner}
              onChange={(o) => {
                setLearner(o);
                setAllocation(EMPTY_ALLOCATION);
              }}
              useOptions={useStudentOptions}
              placeholder={t("learner.placeholder")}
            />
          )}
        </FormField>
        {learner ? <LearnerBalance learnerId={learner.value} /> : null}
      </section>

      <section aria-labelledby="pay-details" className="space-y-3 rounded-lg border p-4">
        <h2 id="pay-details" className="text-lg font-semibold">
          {t("details.title")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label={t("details.amount")} value={form.amount} onChange={set("amount")} required error={err("amount")} />
          <FormField label={t("details.method")} required error={err("method")}>
            {(c) => <NativeSelect {...c} value={form.method} onChange={set("method")} options={MANUAL_METHODS.map((m) => ({ value: m, label: tMethod(m) }))} />}
          </FormField>
          <FormField label={t("details.reference")} hint={t("details.referenceHint")} error={err("reference")}>
            {(c) => <TextControl {...c} value={form.reference} onChange={set("reference")} maxLength={120} />}
          </FormField>
          <FormField label={t("details.payerName")} hint={t("details.payerNameHint")} error={err("payerName")}>
            {(c) => <TextControl {...c} value={form.payerName} onChange={set("payerName")} maxLength={200} />}
          </FormField>
          <FormField label={t("details.payerKind")}>
            {(c) => (
              <NativeSelect
                {...c}
                value={form.payerKind}
                onChange={set("payerKind")}
                options={[
                  { value: "LEARNER", label: tPayer("LEARNER") },
                  { value: "FUNDER", label: tPayer("FUNDER") },
                ]}
              />
            )}
          </FormField>
          {form.payerKind === "FUNDER" ? (
            <FormField label={t("details.payerRef")} hint={t("details.payerRefHint")} error={err("payerRef")}>
              {(c) => <TextControl {...c} value={form.payerRef} onChange={set("payerRef")} maxLength={120} />}
            </FormField>
          ) : null}
        </div>
        {noOpenSession ? (
          <Notice kind="warning">
            {t("details.noSession")}{" "}
            <Link href="/v2/finance/cash" className="font-medium underline underline-offset-4">
              {t("details.openSession")}
            </Link>
          </Notice>
        ) : null}
      </section>

      <AllocationEditor learnerId={learner?.value ?? null} value={allocation} onChange={setAllocation} errors={errors} />

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={buttonClass.primary} onClick={review} disabled={!learner || noOpenSession}>
          {t("review")}
        </button>
      </div>

      {pendingBody ? (
        <ModalDialog open onOpenChange={(o) => !o && !record.isPending && (setPendingBody(null), record.reset())} title={t("confirm.title")} description={t("confirm.description")}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("confirm.learner")}</dt>
              <dd className="font-medium">{learner?.label}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("confirm.amount")}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money.fmt(Number(pendingBody.amount))}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("confirm.method")}</dt>
              <dd>{tMethod(pendingBody.method)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("confirm.allocation")}</dt>
              <dd>{t(`confirm.modes.${pendingBody.allocation?.mode ?? "AUTO"}`)}</dd>
            </div>
          </dl>
          {record.isError ? (
            <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {describe(record.error)} {t("confirm.retryHint")}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={buttonClass.secondary} disabled={record.isPending} onClick={() => (setPendingBody(null), record.reset())}>
              {t("confirm.back")}
            </button>
            <button type="button" className={buttonClass.primary} disabled={record.isPending} onClick={() => void confirm()}>
              {record.isPending ? t("confirm.sending") : t("confirm.submit")}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

/** Situation du compte de l'apprenant au moment d'encaisser (montants renvoyés par l'API). */
function LearnerBalance({ learnerId }: { learnerId: string }) {
  const t = useTranslations("v2Finance.paymentForm.balance");
  const money = useMoney();
  const invoices = useInvoices({ learnerId, limit: 100 });
  if (invoices.isPending || invoices.isError || !invoices.data) return null;
  const open = invoices.data.items.filter((i) => ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status) && i.balance.amount > 0);
  if (open.length === 0) return <p className="text-sm text-muted-foreground">{t("none")}</p>;
  return (
    <div>
      <p className="text-sm font-medium">{t("title")}</p>
      <ul className="mt-1 divide-y rounded-md border text-sm">
        {open.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
            <Link href={`/v2/finance/invoices/${inv.id}`} className="text-primary underline-offset-4 hover:underline">
              {inv.number ?? "—"}
            </Link>
            <span className="tabular-nums">{t("remaining", { amount: money.of(inv.balance) })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PaymentDone({ view, onNew }: { view: PaymentView; onNew: () => void }) {
  const t = useTranslations("v2Finance.paymentForm.done");
  const money = useMoney();
  const { payment, receipt, allocations } = view;
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} />
      {view.replayed ? <Notice kind="info">{t("replayed")}</Notice> : <Notice kind="success">{t("message", { amount: money.of(payment.amount) })}</Notice>}
      <dl className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{t("receipt")}</dt>
          <dd className="font-semibold">
            {receipt ? (
              <Link href={`/v2/finance/receipts/${receipt.id}`} className="text-primary underline-offset-4 hover:underline">
                {receipt.number}
              </Link>
            ) : (
              "—"
            )}
          </dd>
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
          <dt className="text-muted-foreground">{t("balanceAfter")}</dt>
          <dd className="tabular-nums">{receipt?.snapshot.balanceAfter ? money.of(receipt.snapshot.balanceAfter) : "—"}</dd>
        </div>
      </dl>
      {allocations.length > 0 ? <p className="text-sm text-muted-foreground">{t("allocations", { count: allocations.length })}</p> : null}
      <div className="flex flex-wrap gap-2">
        {receipt ? (
          <Link href={`/v2/finance/receipts/${receipt.id}`} className={buttonClass.primary}>
            {t("printReceipt")}
          </Link>
        ) : null}
        <Link href={`/v2/finance/payments/${payment.id}`} className={buttonClass.secondary}>
          {t("details")}
        </Link>
        <button type="button" className={buttonClass.secondary} onClick={onNew}>
          {t("another")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paiement en ligne
// ---------------------------------------------------------------------------

/** Codes des fournisseurs connus du module (adaptateurs configurés par établissement) ; « autre » accepte un code libre. */
export const ONLINE_PROVIDERS = ["orange_money", "mtn_momo", "wave", "cinetpay", "tresorpay"] as const;

export function OnlinePaymentScreen({ initialLearnerId }: { initialLearnerId?: string }) {
  const t = useTranslations("v2Finance.onlineForm");
  const tProvider = useTranslations("v2Finance.onlineForm.providers");
  const feature = useFeature("finance.online-payment");
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const initiate = useInitiateOnlinePayment();
  const runner = useIdempotentRunner<string>((fp) => fp, "ol");

  const [learner, setLearner] = useState<SelectOption | null>(initialLearnerId ? { value: initialLearnerId, label: initialLearnerId.slice(0, 8) } : null);
  const [form, setForm] = useState({ amount: "", provider: "orange_money", otherProvider: "", phone: "", name: "", email: "", invoiceId: "", description: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [started, setStarted] = useState<OnlineView | null>(null);
  const invoices = useInvoices({ learnerId: learner?.value, limit: 100 }, { enabled: learner !== null });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const apiErrors = apiErrorToFieldErrors(initiate.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];

  async function submit() {
    const amount = parseAmountInput(form.amount);
    if (!amount.ok) return setErrors({ amount: describeAmount(amount) ?? "" });
    const provider = form.provider === "other" ? form.otherProvider.trim() : form.provider;
    const payer = {
      ...(form.phone.trim() ? { phoneNumber: form.phone.trim() } : {}),
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
    };
    const parsed = validate(financeInitiateOnlinePaymentBodySchema, {
      learnerId: learner?.value ?? "",
      amount: amount.amount,
      provider,
      ...(form.invoiceId ? { invoiceId: form.invoiceId } : {}),
      ...(Object.keys(payer).length > 0 ? { payer } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    });
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    const body = parsed.data;
    try {
      const view = await runner.run(JSON.stringify(body), (key) => initiate.mutateAsync({ body, key }));
      if (view) setStarted(view);
    } catch {
      /* erreur affichée ; clé conservée pour la nouvelle tentative */
    }
  }

  if (started) {
    const instr = started.instructions;
    return (
      <div className="space-y-6">
        <PageHeader title={t("started.title")} actions={<Link href="/v2/finance/payments" className={buttonClass.secondary}>{t("started.toList")}</Link>} />
        {started.replayed ? <Notice kind="info">{t("started.replayed")}</Notice> : null}
        {instr ? (
          <section aria-labelledby="online-instr" className="space-y-2 rounded-lg border p-4">
            <h2 id="online-instr" className="text-lg font-semibold">
              {t("started.instructions")}
            </h2>
            {instr.instructions ? <p className="text-sm">{instr.instructions}</p> : null}
            {instr.ussdCode ? (
              <p className="text-sm">
                {t("started.ussd")} <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{instr.ussdCode}</code>
              </p>
            ) : null}
            {instr.redirectUrl && /^https:\/\//.test(instr.redirectUrl) ? (
              <a href={instr.redirectUrl} target="_blank" rel="noopener noreferrer" className={buttonClass.primary}>
                {t("started.redirect")}
              </a>
            ) : null}
          </section>
        ) : null}
        <PaymentTracker paymentId={started.payment.id} />
        <button type="button" className={buttonClass.secondary} onClick={() => (runner.reset(), initiate.reset(), setStarted(null))}>
          {t("started.another")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={<Link href="/v2/finance/payments" className={buttonClass.secondary}>{t("cancel")}</Link>} />
      {!feature.isLoading && !feature.allowed && !feature.isUnavailable ? <FeatureNotice>{t("featureOff")}</FeatureNotice> : null}
      <section className="space-y-3 rounded-lg border p-4" aria-labelledby="online-form">
        <h2 id="online-form" className="sr-only">
          {t("title")}
        </h2>
        <FormField label={t("learner")} required error={err("learnerId")}>
          {(c) => <SelectAsync {...c} value={learner} onChange={setLearner} useOptions={useStudentOptions} placeholder={t("learnerPlaceholder")} />}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyField label={t("amount")} value={form.amount} onChange={set("amount")} required error={err("amount")} />
          <FormField label={t("provider")} required error={err("provider")}>
            {(c) => <NativeSelect {...c} value={form.provider} onChange={set("provider")} options={[...ONLINE_PROVIDERS.map((p) => ({ value: p, label: tProvider(p) })), { value: "other", label: tProvider("other") }]} />}
          </FormField>
          {form.provider === "other" ? (
            <FormField label={t("otherProvider")} hint={t("otherProviderHint")} required error={err("provider")}>
              {(c) => <TextControl {...c} value={form.otherProvider} onChange={set("otherProvider")} maxLength={40} />}
            </FormField>
          ) : null}
          <FormField label={t("invoice")} hint={t("invoiceHint")} error={err("invoiceId")}>
            {(c) => (
              <NativeSelect
                {...c}
                value={form.invoiceId}
                onChange={set("invoiceId")}
                disabled={!learner}
                placeholder={t("invoiceAny")}
                options={(invoices.data?.items ?? []).filter((i) => ["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(i.status)).map((i) => ({ value: i.id, label: i.number ?? i.id.slice(0, 8) }))}
              />
            )}
          </FormField>
          <FormField label={t("phone")} hint={t("phoneHint")} error={err("payer.phoneNumber")}>
            {(c) => <TextControl {...c} type="tel" value={form.phone} onChange={set("phone")} maxLength={30} autoComplete="tel" />}
          </FormField>
          <FormField label={t("payerName")} error={err("payer.name")}>
            {(c) => <TextControl {...c} value={form.name} onChange={set("name")} maxLength={200} />}
          </FormField>
          <FormField label={t("email")} error={err("payer.email")}>
            {(c) => <TextControl {...c} type="email" value={form.email} onChange={set("email")} autoComplete="email" />}
          </FormField>
          <FormField label={t("descriptionLabel")} error={err("description")}>
            {(c) => <TextControl {...c} value={form.description} onChange={set("description")} maxLength={200} />}
          </FormField>
        </div>
      </section>
      {initiate.isError && Object.keys(apiErrors).length === 0 ? <ErrorBlock error={initiate.error} /> : null}
      <div className="flex justify-end">
        <button type="button" className={buttonClass.primary} onClick={() => void submit()} disabled={initiate.isPending || !learner || (!feature.allowed && !feature.isUnavailable)}>
          {initiate.isPending ? t("sending") : t("submit")}
        </button>
      </div>
    </div>
  );
}
