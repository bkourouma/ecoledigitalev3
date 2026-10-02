"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ZodTypeAny } from "zod";
import { peopleStaffDetailDtoSchema } from "@ecoledigitale/contracts/v2/people";
import { platformApi, platformHooks } from "@/platform/api/default-client";
import { FormField, TextControl } from "@/platform/ui/FormField";
import { SelectAsync, type SelectOption } from "@/platform/ui/SelectAsync";
import { useStaffOptions } from "@/platform/v2/lookups";
import { parseAmountInput, type AmountParse } from "@/platform/ui/money";
import { StatusBadge, type Tone } from "@/platform/ui/PageHeader";
import { validateWith, type FieldErrors, type Validated } from "@/platform/ui/validation";

export function payslipTone(status: string): Tone {
  switch (status) {
    case "PAID":
      return "success";
    case "APPROVED":
      return "info";
    case "CALCULATED":
      return "neutral";
    case "DISPUTED":
      return "warning";
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

export function PayslipStatusBadge({ status }: { status: string }) {
  const t = useTranslations("v2Payroll.status.payslip");
  return <StatusBadge label={t(status)} tone={payslipTone(status)} />;
}

export function PeriodStatusBadge({ status }: { status: string }) {
  const t = useTranslations("v2Payroll.status.period");
  const tone: Tone = status === "ACTIVE" ? "success" : status === "DRAFT" ? "info" : status === "CLOSED" ? "warning" : "neutral";
  return <StatusBadge label={t(status)} tone={tone} />;
}

/**
 * Noms du personnel pour des listes qui ne portent que l'identifiant (configurations, tarifs) : une lecture par membre,
 * cache partagé avec les fiches du personnel ; sans droit de lecture, retombe sur un identifiant court.
 */
export function useStaffLabels(ids: ReadonlyArray<string>): ReadonlyMap<string, string> {
  const unique = useMemo(() => [...new Set(ids)].slice(0, 100), [ids]);
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: platformHooks.queryKey("people", "staff", "one", id),
      queryFn: ({ signal }: { signal: AbortSignal }) => platformApi.get(`/api/v1/people/staff/${id}`, { schema: peopleStaffDetailDtoSchema, signal }),
      enabled: platformHooks.client.getTenant() !== null,
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    unique.forEach((id, index) => {
      const data = results[index]?.data;
      if (data) map.set(id, data.displayName);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, results.map((r) => r.dataUpdatedAt).join(",")]);
}

export const shortId = (id: string): string => id.slice(0, 8);

export function useAmountErrors() {
  const t = useTranslations("v2Payroll.errors.amount");
  return (result: AmountParse): string | null => (result.ok ? null : t(result.reason));
}

/** Champ de montant ENTIER (francs) : décimales refusées, jamais devinées. */
export function MoneyField({ label, value, onChange, error, hint, required, allowZero }: { label: string; value: string; onChange: (v: string) => void; error?: string | null; hint?: string; required?: boolean; allowZero?: boolean }) {
  const t = useTranslations("v2Payroll.common");
  const describe = useAmountErrors();
  const parsed = value.trim() === "" ? null : parseAmountInput(value, { allowZero });
  return (
    <FormField label={label} required={required} error={error ?? (parsed && !parsed.ok ? describe(parsed) : null)} hint={hint ?? t("amountHint")}>
      {(c) => <TextControl {...c} value={value} onChange={onChange} inputMode="numeric" autoComplete="off" />}
    </FormField>
  );
}

/** Validation avec le schéma du contrat, messages en français (les messages par défaut de Zod sont remplacés). */
export function useValidator() {
  const t = useTranslations("v2Payroll.errors");
  return <S extends ZodTypeAny>(schema: S, value: unknown): Validated<S> => {
    const result = validateWith(schema, value);
    if (result.ok) return result;
    const errors: FieldErrors = {};
    for (const [key, message] of Object.entries(result.errors)) {
      if (message === "Required") errors[key] = t("required");
      else if (/^(Expected|Invalid (input|enum|union|discriminator|literal|uuid|string|date))/.test(message) || /^String must contain|^Number must be/.test(message) || message === "Invalid") errors[key] = t("invalid");
      else errors[key] = message;
    }
    return { ok: false, errors };
  };
}

/** Explication d'un refus par lot (séparation des tâches, seuil propriétaire…) : le message de l'API reste affiché. */
export function useRejectionHint(): (code: string) => string | null {
  const t = useTranslations("v2Payroll.rejectionHints");
  const known = new Set(["payroll.separation_of_duties", "payroll.owner_approval_required", "payroll.invalid_transition", "payroll.payslip_locked", "payroll.not_found", "payroll.empty_selection", "payroll.concurrent_update"]);
  return (code) => (known.has(code) ? t(code.replace("payroll.", "")) : null);
}

/** Sélection de plusieurs membres du personnel (pastilles retirables) : périmètre d'une période ou d'un calcul. */
export function StaffMultiPicker({ value, onChange, label, hint, canTeachOnly = true }: { value: ReadonlyArray<SelectOption>; onChange: (next: SelectOption[]) => void; label: string; hint?: string; canTeachOnly?: boolean }) {
  const t = useTranslations("v2Payroll.common");
  const useOptions = (search: string, enabled: boolean) => useStaffOptions(search, enabled, canTeachOnly ? { canTeach: true } : {});
  return (
    <div className="space-y-2">
      <FormField label={label} hint={hint}>
        {(c) => (
          <SelectAsync
            {...c}
            value={null}
            onChange={(o) => {
              if (o && !value.some((v) => v.value === o.value)) onChange([...value, o]);
            }}
            useOptions={useOptions}
            placeholder={t("addStaff")}
            clearable={false}
          />
        )}
      </FormField>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {value.map((o) => (
            <li key={o.value} className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-sm">
              {o.label}
              <button type="button" onClick={() => onChange(value.filter((v) => v.value !== o.value))} className="rounded-full px-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("removeStaff", { name: o.label })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
