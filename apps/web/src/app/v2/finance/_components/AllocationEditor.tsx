"use client";

import { useTranslations } from "next-intl";
import { useInvoice, useInvoices, type AllocationBody } from "@/platform/v2/finance";
import { CheckControl, FormField, NativeSelect, TextControl } from "@/platform/ui/FormField";
import { useDateFormat } from "@/platform/ui/format";
import { parseAmountInput, useMoney } from "@/platform/ui/money";
import { ErrorBlock, LoadingBlock } from "@/platform/ui/states";
import type { FieldErrors } from "@/platform/ui/validation";
import { InstallmentStatusBadge } from "./labels";
import { useAmountErrors } from "./shared";

export type AllocationMode = "AUTO" | "MANUAL" | "NONE";
export const ALLOCATION_ORDERS = ["OLDEST_DUE_FIRST", "NEWEST_DUE_FIRST", "SMALLEST_REMAINING_FIRST", "LARGEST_REMAINING_FIRST", "PROPORTIONAL"] as const;

export interface AllocationState {
  mode: AllocationMode;
  order: string;
  invoiceIds: string[];
  /** Montants saisis par échéance (texte tel que saisi). */
  manual: Record<string, string>;
}

export const EMPTY_ALLOCATION: AllocationState = { mode: "AUTO", order: "", invoiceIds: [], manual: {} };

/** Statuts de factures sur lesquels un paiement peut encore être imputé (filtre d'AFFICHAGE ; l'API décide). */
const OPEN_STATUSES = new Set(["ISSUED", "PARTIALLY_PAID", "OVERDUE"]);

/**
 * Corps `allocation` du contrat à partir de la saisie. En imputation manuelle, seuls les montants saisis (entiers) sont
 * transmis ; le contrôle « imputé ≤ encaissé ≤ reste dû » est fait par l'API.
 */
export function buildAllocation(state: AllocationState, describeAmount: (r: ReturnType<typeof parseAmountInput>) => string | null): { body?: AllocationBody | { mode: "NONE" }; errors: FieldErrors } {
  if (state.mode === "NONE") return { body: { mode: "NONE" }, errors: {} };
  if (state.mode === "AUTO") {
    return {
      body: {
        mode: "AUTO",
        ...(state.order ? { order: state.order as never } : {}),
        ...(state.invoiceIds.length > 0 ? { invoiceIds: state.invoiceIds } : {}),
      },
      errors: {},
    };
  }
  const items: Array<{ installmentId: string; amount: number }> = [];
  const errors: FieldErrors = {};
  for (const [installmentId, text] of Object.entries(state.manual)) {
    if (text.trim() === "") continue;
    const parsed = parseAmountInput(text);
    if (!parsed.ok) errors[`manual.${installmentId}`] = describeAmount(parsed) ?? "";
    else items.push({ installmentId, amount: parsed.amount });
  }
  if (Object.keys(errors).length === 0 && items.length === 0) errors.manual = "empty";
  return Object.keys(errors).length > 0 ? { errors } : { body: { mode: "MANUAL", items }, errors };
}

export function AllocationEditor({
  learnerId,
  value,
  onChange,
  allowNone = true,
  errors = {},
}: {
  learnerId: string | null;
  value: AllocationState;
  onChange: (next: AllocationState) => void;
  allowNone?: boolean;
  errors?: FieldErrors;
}) {
  const t = useTranslations("v2Finance.allocation");
  const tOrder = useTranslations("v2Finance.allocationOrder");
  const money = useMoney();
  const invoices = useInvoices({ learnerId: learnerId ?? undefined, limit: 100 }, { enabled: learnerId !== null });
  const open = (invoices.data?.items ?? []).filter((i) => OPEN_STATUSES.has(i.status) && i.balance.amount > 0);
  const modes: AllocationMode[] = allowNone ? ["AUTO", "MANUAL", "NONE"] : ["AUTO", "MANUAL"];

  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t("legend")}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("legend")}>
        {modes.map((m) => (
          <label key={m} className={`inline-flex min-h-[2.75rem] cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${value.mode === m ? "border-primary bg-primary/5" : "border-input"}`}>
            <input type="radio" name="allocation-mode" checked={value.mode === m} onChange={() => onChange({ ...value, mode: m })} className="accent-primary" />
            {t(`modes.${m}`)}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t(`hints.${value.mode}`)}</p>

      {value.mode === "AUTO" ? (
        <div className="space-y-3">
          <FormField label={t("order")}>
            {(c) => <NativeSelect {...c} value={value.order} onChange={(v) => onChange({ ...value, order: v })} placeholder={t("orderDefault")} options={ALLOCATION_ORDERS.map((o) => ({ value: o, label: tOrder(o) }))} />}
          </FormField>
          {open.length > 0 ? (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t("restrict")}</legend>
              <p className="text-xs text-muted-foreground">{t("restrictHint")}</p>
              {open.map((inv) => (
                <CheckControl
                  key={inv.id}
                  checked={value.invoiceIds.includes(inv.id)}
                  onChange={(on) => onChange({ ...value, invoiceIds: on ? [...value.invoiceIds, inv.id] : value.invoiceIds.filter((x) => x !== inv.id) })}
                  label={t("invoiceLabel", { number: inv.number ?? "—", balance: money.of(inv.balance) })}
                />
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {value.mode === "MANUAL" ? (
        <div className="space-y-2">
          {invoices.isPending && learnerId ? <LoadingBlock /> : null}
          {invoices.isError ? <ErrorBlock error={invoices.error} /> : null}
          {learnerId && !invoices.isPending && open.length === 0 ? <p className="text-sm text-muted-foreground">{t("noOpenInvoices")}</p> : null}
          {errors.manual ? <p role="alert" className="text-xs font-medium text-destructive">{t("manualEmpty")}</p> : null}
          {open.map((inv) => (
            <details key={inv.id} className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-medium">{t("invoiceLabel", { number: inv.number ?? "—", balance: money.of(inv.balance) })}</summary>
              <InstallmentInputs invoiceId={inv.id} value={value} onChange={onChange} errors={errors} />
            </details>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}

function InstallmentInputs({ invoiceId, value, onChange, errors }: { invoiceId: string; value: AllocationState; onChange: (next: AllocationState) => void; errors: FieldErrors }) {
  const t = useTranslations("v2Finance.allocation");
  const money = useMoney();
  const date = useDateFormat();
  const detail = useInvoice(invoiceId);
  const describeAmount = useAmountErrors();
  if (detail.isPending) return <LoadingBlock />;
  if (detail.isError) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  const rows = detail.data?.installments.filter((n) => n.remaining.amount > 0) ?? [];
  if (rows.length === 0) return <p className="p-2 text-sm text-muted-foreground">{t("noOpenInstallments")}</p>;
  return (
    <ul className="mt-2 divide-y">
      {rows.map((n) => {
        const text = value.manual[n.id] ?? "";
        const parsed = text.trim() === "" ? null : parseAmountInput(text);
        const error = errors[`manual.${n.id}`] || (parsed && !parsed.ok ? describeAmount(parsed) : null);
        return (
          <li key={n.id} className="grid gap-2 py-2 sm:grid-cols-[1fr_12rem] sm:items-start">
            <div className="text-sm">
              <p className="font-medium">
                {n.label} <InstallmentStatusBadge status={n.status} />
              </p>
              <p className="text-xs text-muted-foreground">{t("installmentInfo", { due: date.civil(n.dueDate), remaining: money.of(n.remaining) })}</p>
            </div>
            <FormField label={t("amountFor", { label: n.label })} error={error}>
              {(c) => <TextControl {...c} inputMode="numeric" value={text} onChange={(v) => onChange({ ...value, manual: { ...value.manual, [n.id]: v } })} />}
            </FormField>
          </li>
        );
      })}
    </ul>
  );
}
