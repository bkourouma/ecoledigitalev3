"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FINANCE_FEE_CATEGORIES,
  financeCreateInvoiceBodySchema,
  financeInvoiceFromScheduleBodySchema,
  financeInvoicePreviewDtoSchema,
  type FinanceCreateInvoiceBody,
  type FinanceInvoiceFromScheduleBody,
} from "@ecoledigitale/contracts/v2/finance";
import type { z } from "zod";
import { useStudentEnrollments } from "@/platform/v2/people";
import { useCreateInvoice, useDiscounts, useFees, useInstallmentPlans, useIssueInvoiceFromSchedule, usePreviewInvoice } from "@/platform/v2/finance";
import { useStudentOptions } from "@/platform/v2/lookups";
import { DataTable } from "@/platform/ui/DataTable";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { useIdempotentRunner } from "@/platform/ui/idempotency";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { buttonClass, PageHeader } from "@/platform/ui/PageHeader";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { ErrorBlock, LoadingBlock, Notice } from "@/platform/ui/states";
import { apiErrorToFieldErrors, type FieldErrors } from "@/platform/ui/validation";
import { PayerBadge } from "./labels";
import { AcademicYearField, MoneyField, useAmountErrors, useValidator } from "./shared";

type Preview = z.infer<typeof financeInvoicePreviewDtoSchema>;

interface ItemForm {
  feeId: string;
  quantity: string;
  description: string;
}
interface LineForm {
  category: string;
  description: string;
  quantity: string;
  unitAmount: string;
  feeId: string;
}

const EMPTY_ITEM: ItemForm = { feeId: "", quantity: "1", description: "" };
const EMPTY_LINE: LineForm = { category: "TUITION", description: "", quantity: "1", unitAmount: "", feeId: "" };

/**
 * Émission d'une facture : depuis le catalogue (aperçu calculé par l'API AVANT émission) ou saisie libre (enregistrée en
 * brouillon, relue sur la fiche puis émise). L'émission porte une clé d'idempotence : un double clic ou une nouvelle
 * tentative après un incident réseau ne crée jamais deux factures.
 */
export function NewInvoiceScreen({ initialLearnerId }: { initialLearnerId?: string }) {
  const t = useTranslations("v2Finance.invoiceForm");
  const router = useRouter();
  const describeAmount = useAmountErrors();
  const validate = useValidator();
  const money = useMoney();

  const [mode, setMode] = useState<"catalog" | "manual">("catalog");
  const [learner, setLearner] = useState<SelectOption | null>(initialLearnerId ? { value: initialLearnerId, label: initialLearnerId.slice(0, 8) } : null);
  const [enrollmentId, setEnrollmentId] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [items, setItems] = useState<ItemForm[]>([{ ...EMPTY_ITEM }]);
  const [lines, setLines] = useState<LineForm[]>([{ ...EMPTY_LINE }]);
  const [discountIds, setDiscountIds] = useState<string[]>([]);
  const [scope, setScope] = useState({ levelKey: "", trackKey: "", learnerType: "" });
  const [dueDate, setDueDate] = useState("");
  const [planId, setPlanId] = useState("");
  const [baseDate, setBaseDate] = useState("");
  const [ignoreFunding, setIgnoreFunding] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<{ fingerprint: string; data: Preview } | null>(null);
  const [created, setCreated] = useState<Array<{ id: string; number: string | null; payerKind: string }> | null>(null);

  const enrollments = useStudentEnrollments(learner?.value ?? null);
  const fees = useFees({ activeOnly: true });
  const plans = useInstallmentPlans();
  const discounts = useDiscounts();
  const previewCall = usePreviewInvoice();
  const issueFromSchedule = useIssueInvoiceFromSchedule();
  const createManual = useCreateInvoice();
  const runner = useIdempotentRunner<string>((fp) => fp, "inv");

  const apiErrors = apiErrorToFieldErrors(issueFromSchedule.error ?? createManual.error ?? previewCall.error);
  const err = (k: string) => errors[k] ?? apiErrors[k];

  const installments = planId ? { planId, ...(baseDate ? { baseDate } : {}) } : undefined;
  const common = {
    learnerId: learner?.value ?? "",
    ...(enrollmentId ? { enrollmentId } : {}),
    ...(academicYear ? { academicYear } : {}),
    ...(discountIds.length > 0 ? { discountIds } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(installments ? { installments } : {}),
  };

  function catalogBody(): FinanceInvoiceFromScheduleBody | null {
    const scopeBody = Object.fromEntries(Object.entries(scope).filter(([, v]) => v.trim() !== ""));
    const body = {
      ...common,
      items: items.map((i) => ({ feeId: i.feeId, ...(i.quantity && i.quantity !== "1" ? { quantity: Number(i.quantity) } : {}), ...(i.description.trim() ? { description: i.description.trim() } : {}) })),
      ...(Object.keys(scopeBody).length > 0 ? { scope: scopeBody } : {}),
      ...(ignoreFunding ? { ignoreFunding: true } : {}),
    };
    const result = validate(financeInvoiceFromScheduleBodySchema, body);
    if (!result.ok) {
      setErrors(result.errors);
      return null;
    }
    setErrors({});
    return result.data;
  }

  function manualBody(): FinanceCreateInvoiceBody | null {
    const local: FieldErrors = {};
    const built = lines.map((l, i) => {
      const unit = parseAmountInput(l.unitAmount, { allowZero: true });
      if (!unit.ok) local[`lines.${i}.unitAmount`] = describeAmount(unit) ?? "";
      return {
        category: l.category,
        description: l.description.trim(),
        ...(l.quantity && l.quantity !== "1" ? { quantity: Number(l.quantity) } : {}),
        unitAmount: unit.ok ? unit.amount : 0,
        ...(l.feeId ? { feeId: l.feeId } : {}),
      };
    });
    if (Object.keys(local).length > 0) {
      setErrors(local);
      return null;
    }
    const result = validate(financeCreateInvoiceBodySchema, { ...common, lines: built, issue: false });
    if (!result.ok) {
      setErrors(result.errors);
      return null;
    }
    setErrors({});
    return result.data;
  }

  const fingerprint = mode === "catalog" ? JSON.stringify({ common, items, scope, ignoreFunding }) : "";
  const previewFresh = preview !== null && preview.fingerprint === fingerprint;

  function runPreview() {
    const body = catalogBody();
    if (!body) return;
    previewCall.mutate(body, { onSuccess: (data) => setPreview({ fingerprint, data }) });
  }

  async function submitCatalog(issue: boolean) {
    const body = catalogBody();
    if (!body) return;
    const full = { ...body, issue };
    const fp = JSON.stringify(full);
    try {
      const result = await runner.run(fp, (key) => issueFromSchedule.mutateAsync({ body: full, key }));
      if (result) setCreated(result.invoices.map((i) => ({ id: i.id, number: i.number, payerKind: i.payerKind })));
    } catch {
      /* l'erreur est affichée par `issueFromSchedule.error` ; la clé est conservée pour la nouvelle tentative */
    }
  }

  async function submitManual() {
    const body = manualBody();
    if (!body) return;
    const fp = JSON.stringify(body);
    try {
      const result = await runner.run(fp, (key) => createManual.mutateAsync({ body, key }));
      if (result) {
        const first = result.invoices[0];
        if (result.invoices.length === 1 && first) router.push(`/v2/finance/invoices/${first.id}`);
        else setCreated(result.invoices.map((i) => ({ id: i.id, number: i.number, payerKind: i.payerKind })));
      }
    } catch {
      /* idem */
    }
  }

  const pending = issueFromSchedule.isPending || createManual.isPending;
  const feeOptions = useMemo(() => (fees.data ?? []).map((f) => ({ value: f.id, label: f.name })), [fees.data]);

  if (created) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("done.title")} />
        <Notice kind="success">{t("done.message", { count: created.length })}</Notice>
        <ul className="divide-y rounded-md border text-sm" aria-label={t("done.list")}>
          {created.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 p-3">
              <Link href={`/v2/finance/invoices/${c.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {c.number ?? t("done.draft")}
              </Link>
              <PayerBadge kind={c.payerKind} />
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Link href="/v2/finance/invoices" className={buttonClass.secondary}>
            {t("done.toList")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={<Link href="/v2/finance/invoices" className={buttonClass.secondary}>{t("cancel")}</Link>} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("mode.legend")}</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("mode.legend")}>
          {(["catalog", "manual"] as const).map((m) => (
            <label key={m} className={`inline-flex min-h-[2.75rem] cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${mode === m ? "border-primary bg-primary/5" : "border-input"}`}>
              <input type="radio" name="invoice-mode" checked={mode === m} onChange={() => (setMode(m), setErrors({}))} className="accent-primary" />
              {t(`mode.${m}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`mode.${mode}Hint`)}</p>
      </fieldset>

      <section aria-labelledby="invoice-learner" className="space-y-3 rounded-lg border p-4">
        <h2 id="invoice-learner" className="text-lg font-semibold">
          {t("learner.title")}
        </h2>
        <FormField label={t("learner.label")} required error={err("learnerId")}>
          {(c) => (
            <SelectAsync
              {...c}
              value={learner}
              onChange={(o) => {
                setLearner(o);
                setEnrollmentId("");
                setPreview(null);
              }}
              useOptions={useStudentOptions}
              placeholder={t("learner.placeholder")}
            />
          )}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("learner.enrollment")} hint={t("learner.enrollmentHint")} error={err("enrollmentId")}>
            {(c) => (
              <NativeSelect
                {...c}
                value={enrollmentId}
                onChange={setEnrollmentId}
                disabled={!learner}
                placeholder={enrollments.isPending && learner ? t("learner.loading") : t("learner.noEnrollment")}
                options={(enrollments.data ?? []).map((e) => ({ value: e.enrollmentId, label: [e.classroomName, e.gradeLevelLabel, e.registrationNumber].filter(Boolean).join(" · ") }))}
              />
            )}
          </FormField>
          <AcademicYearField label={t("learner.year")} value={academicYear} onChange={setAcademicYear} error={err("academicYear")} allowEmpty />
        </div>
      </section>

      {mode === "catalog" ? (
        <section aria-labelledby="invoice-items" className="space-y-3 rounded-lg border p-4">
          <h2 id="invoice-items" className="text-lg font-semibold">
            {t("items.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("items.hint")}</p>
          {err("items") ? <p role="alert" className="text-xs font-medium text-destructive">{err("items")}</p> : null}
          <ul className="space-y-3">
            {items.map((item, i) => (
              <li key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[2fr_6rem_2fr_auto] sm:items-end">
                <FormField label={t("items.fee")} required error={err(`items.${i}.feeId`)}>
                  {(c) => <NativeSelect {...c} value={item.feeId} onChange={(v) => setItems((all) => all.map((x, idx) => (idx === i ? { ...x, feeId: v } : x)))} placeholder={t("items.choose")} options={feeOptions} />}
                </FormField>
                <FormField label={t("items.quantity")} error={err(`items.${i}.quantity`)}>
                  {(c) => <TextControl {...c} type="number" min={1} step={1} inputMode="numeric" value={item.quantity} onChange={(v) => setItems((all) => all.map((x, idx) => (idx === i ? { ...x, quantity: v } : x)))} />}
                </FormField>
                <FormField label={t("items.description")} error={err(`items.${i}.description`)}>
                  {(c) => <TextControl {...c} value={item.description} onChange={(v) => setItems((all) => all.map((x, idx) => (idx === i ? { ...x, description: v } : x)))} maxLength={300} />}
                </FormField>
                {items.length > 1 ? (
                  <button type="button" className={buttonClass.ghost} onClick={() => setItems((all) => all.filter((_, idx) => idx !== i))}>
                    {t("items.remove")}
                    <span className="sr-only"> {i + 1}</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" className={buttonClass.secondary} onClick={() => setItems((all) => [...all, { ...EMPTY_ITEM }])} disabled={items.length >= 50}>
            {t("items.add")}
          </button>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">{t("scope.title")}</summary>
            <p className="mt-2 text-xs text-muted-foreground">{t("scope.hint")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {(["levelKey", "trackKey", "learnerType"] as const).map((k) => (
                <FormField key={k} label={t(`scope.${k}`)} error={err(`scope.${k}`)}>
                  {(c) => <TextControl {...c} value={scope[k]} onChange={(v) => setScope((s) => ({ ...s, [k]: v }))} maxLength={60} />}
                </FormField>
              ))}
            </div>
          </details>
        </section>
      ) : (
        <section aria-labelledby="invoice-lines" className="space-y-3 rounded-lg border p-4">
          <h2 id="invoice-lines" className="text-lg font-semibold">
            {t("lines.title")}
          </h2>
          {err("lines") ? <p role="alert" className="text-xs font-medium text-destructive">{err("lines")}</p> : null}
          <ul className="space-y-3">
            {lines.map((line, i) => (
              <li key={i} className="space-y-3 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label={t("lines.category")} required error={err(`lines.${i}.category`)}>
                    {(c) => <NativeSelect {...c} value={line.category} onChange={(v) => setLines((all) => all.map((x, idx) => (idx === i ? { ...x, category: v } : x)))} options={FINANCE_FEE_CATEGORIES.map((v) => ({ value: v, label: t(`categories.${v}`) }))} />}
                  </FormField>
                  <FormField label={t("lines.description")} required error={err(`lines.${i}.description`)}>
                    {(c) => <TextControl {...c} value={line.description} onChange={(v) => setLines((all) => all.map((x, idx) => (idx === i ? { ...x, description: v } : x)))} maxLength={300} />}
                  </FormField>
                  <FormField label={t("lines.quantity")} error={err(`lines.${i}.quantity`)}>
                    {(c) => <TextControl {...c} type="number" min={1} step={1} inputMode="numeric" value={line.quantity} onChange={(v) => setLines((all) => all.map((x, idx) => (idx === i ? { ...x, quantity: v } : x)))} />}
                  </FormField>
                  <MoneyField label={t("lines.unitAmount")} value={line.unitAmount} onChange={(v) => setLines((all) => all.map((x, idx) => (idx === i ? { ...x, unitAmount: v } : x)))} required allowZero error={err(`lines.${i}.unitAmount`)} />
                </div>
                {lines.length > 1 ? (
                  <button type="button" className={buttonClass.ghost} onClick={() => setLines((all) => all.filter((_, idx) => idx !== i))}>
                    {t("lines.remove")}
                    <span className="sr-only"> {i + 1}</span>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" className={buttonClass.secondary} onClick={() => setLines((all) => [...all, { ...EMPTY_LINE }])} disabled={lines.length >= 200}>
            {t("lines.add")}
          </button>
        </section>
      )}

      <section aria-labelledby="invoice-options" className="space-y-3 rounded-lg border p-4">
        <h2 id="invoice-options" className="text-lg font-semibold">
          {t("options.title")}
        </h2>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("options.discounts")}</legend>
          {(discounts.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">{t("options.noDiscounts")}</p> : null}
          <div className="grid gap-x-4 sm:grid-cols-2">
            {(discounts.data ?? [])
              .filter((d) => d.active)
              .map((d) => (
                <CheckControl key={d.id} checked={discountIds.includes(d.id)} onChange={(on) => setDiscountIds((all) => (on ? [...all, d.id] : all.filter((x) => x !== d.id)))} label={`${d.name} (${d.kind === "PERCENT" ? money.bps(d.bps) : money.of(d.amount)})`} />
              ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("options.dueDate")} hint={t("options.dueDateHint")} error={err("dueDate")}>
            {(c) => <TextControl {...c} type="date" value={dueDate} onChange={setDueDate} />}
          </FormField>
          <FormField label={t("options.plan")} hint={t("options.planHint")} error={err("installments.planId")}>
            {(c) => <NativeSelect {...c} value={planId} onChange={setPlanId} placeholder={t("options.noPlan")} options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />}
          </FormField>
          <FormField label={t("options.baseDate")} error={err("installments.baseDate")}>
            {(c) => <TextControl {...c} type="date" value={baseDate} onChange={setBaseDate} disabled={!planId} />}
          </FormField>
        </div>
        {mode === "catalog" ? <CheckControl checked={ignoreFunding} onChange={setIgnoreFunding} label={t("options.ignoreFunding")} hint={t("options.ignoreFundingHint")} /> : null}
      </section>

      {previewCall.isError ? <ErrorBlock error={previewCall.error} /> : null}
      {issueFromSchedule.isError || createManual.isError ? <ErrorBlock error={issueFromSchedule.error ?? createManual.error} /> : null}

      {mode === "catalog" && previewCall.isPending ? <LoadingBlock label={t("preview.loading")} /> : null}
      {mode === "catalog" && preview ? <PreviewPanel preview={preview.data} stale={!previewFresh} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {mode === "catalog" ? (
          <>
            <button type="button" className={buttonClass.secondary} onClick={runPreview} disabled={previewCall.isPending || pending}>
              {t("actions.preview")}
            </button>
            <button type="button" className={buttonClass.secondary} onClick={() => void submitCatalog(false)} disabled={pending || !previewFresh}>
              {t("actions.draft")}
            </button>
            <button type="button" className={buttonClass.primary} onClick={() => void submitCatalog(true)} disabled={pending || !previewFresh} aria-describedby={preview ? undefined : "preview-required"}>
              {t("actions.issue")}
            </button>
          </>
        ) : (
          <button type="button" className={buttonClass.primary} onClick={() => void submitManual()} disabled={pending}>
            {t("actions.saveDraft")}
          </button>
        )}
      </div>
      {mode === "catalog" && !preview ? (
        <p id="preview-required" className="text-right text-xs text-muted-foreground">
          {t("preview.required")}
        </p>
      ) : null}
    </div>
  );
}

function PreviewPanel({ preview, stale }: { preview: Preview; stale: boolean }) {
  const t = useTranslations("v2Finance.invoiceForm.preview");
  const money = useMoney();
  const date = useDateFormat();
  return (
    <section aria-labelledby="invoice-preview" className="space-y-4 rounded-lg border-2 border-primary/30 p-4">
      <h2 id="invoice-preview" className="text-lg font-semibold">
        {t("title")}
      </h2>
      {stale ? <Notice kind="warning">{t("stale")}</Notice> : <p className="text-sm text-muted-foreground">{t("hint")}</p>}
      {preview.invoices.map((inv, index) => (
        <article key={index} className="space-y-3 rounded-md border p-3" aria-label={inv.label}>
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{inv.label}</h3>
            <PayerBadge kind={inv.payerKind} />
          </header>
          <DataTable
            caption={t("lines", { label: inv.label })}
            columns={[
              { id: "description", header: t("columns.description"), rowHeader: true, cell: (l) => l.description },
              { id: "quantity", header: t("columns.quantity"), align: "right", cell: (l) => l.quantity, className: "hidden sm:table-cell" },
              { id: "unit", header: t("columns.unit"), align: "right", cell: (l) => <span className="tabular-nums">{money.of(l.unitAmount)}</span>, className: "hidden md:table-cell" },
              { id: "discount", header: t("columns.discount"), align: "right", cell: (l) => <span className="tabular-nums">{money.of(l.discount)}</span>, className: "hidden md:table-cell" },
              { id: "scholarship", header: t("columns.scholarship"), align: "right", cell: (l) => <span className="tabular-nums">{money.of(l.scholarship)}</span>, className: "hidden md:table-cell" },
              { id: "total", header: t("columns.total"), align: "right", cell: (l) => <span className="font-medium tabular-nums">{money.of(l.total)}</span> },
            ]}
            rows={inv.lines}
            getRowId={(l) => l.id}
          />
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            {(
              [
                ["subtotal", inv.subtotal],
                ["discount", inv.discount],
                ["scholarship", inv.scholarship],
                ["total", inv.total],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{t(`totals.${k}`)}</dt>
                <dd className={k === "total" ? "text-base font-semibold tabular-nums" : "tabular-nums"}>{money.of(v)}</dd>
              </div>
            ))}
          </dl>
          <DataTable
            caption={t("installments", { label: inv.label })}
            columns={[
              { id: "seq", header: t("columns.seq"), cell: (n) => n.seq, className: "w-10" },
              { id: "label", header: t("columns.label"), rowHeader: true, cell: (n) => n.label },
              { id: "due", header: t("columns.due"), cell: (n) => date.civil(n.dueDate) },
              { id: "amount", header: t("columns.amount"), align: "right", cell: (n) => <span className="tabular-nums">{money.of(n.amount)}</span> },
            ]}
            rows={inv.installments}
            getRowId={(n) => String(n.seq)}
            emptyTitle={t("noInstallments", { due: date.civil(inv.dueDate) })}
          />
        </article>
      ))}
    </section>
  );
}
