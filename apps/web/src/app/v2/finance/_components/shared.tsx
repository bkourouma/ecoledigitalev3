"use client";

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { peopleStudentDetailDtoSchema } from "@ecoledigitale/contracts/v2/people";
import { ListCampusesResponseSchema } from "@ecoledigitale/contracts/v2/tenancy";
import { platformApi, platformHooks } from "@/platform/api/default-client";
import { useAcademicYears } from "@/platform/v2/academic";
import { useInstitutions } from "@/platform/v2/lookups";
import { FormField, NativeSelect, TextControl, type FieldControlProps } from "@/platform/ui/FormField";
import { parseAmountInput, type AmountParse } from "@/platform/ui/money";
import type { Tone } from "@/platform/ui/PageHeader";
import { validateWith, type FieldErrors, type Validated } from "@/platform/ui/validation";
import type { ZodTypeAny } from "zod";

/** Tonalité d'une pastille d'état (le sens est porté par le libellé traduit, jamais par la couleur seule). */
export function financeTone(status: string): Tone {
  switch (status) {
    case "PAID":
    case "CONFIRMED":
    case "COMPLETED":
    case "ACTIVE":
    case "CLOSED":
      return "success";
    case "ISSUED":
    case "REQUESTED":
    case "PENDING":
    case "OPEN":
    case "APPROVED":
      return "info";
    case "PARTIALLY_PAID":
    case "SUSPENDED":
    case "DRAFT":
      return "warning";
    case "OVERDUE":
    case "FAILED":
    case "REJECTED":
    case "CANCELLED":
      return "danger";
    default:
      return "neutral";
  }
}

/** Libellé court d'un identifiant quand le nom n'est pas disponible (droit de lecture des élèves absent). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Noms des apprenants d'une page de résultats : une lecture par élève distinct, mise en cache partagée avec les fiches
 * élèves (`["people","students","one",id]`). Sans le droit de lecture (403) ou en cas d'erreur, le libellé retombe sur
 * un identifiant court — l'écran reste utilisable.
 */
export function useLearnerLabels(ids: ReadonlyArray<string>): ReadonlyMap<string, string> {
  const unique = useMemo(() => [...new Set(ids)].slice(0, 100), [ids]);
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: platformHooks.queryKey("people", "students", "one", id),
      queryFn: ({ signal }: { signal: AbortSignal }) => platformApi.get(`/api/v1/people/students/${id}`, { schema: peopleStudentDetailDtoSchema, signal }),
      enabled: platformHooks.client.getTenant() !== null,
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    unique.forEach((id, index) => {
      const data = results[index]?.data;
      if (data) map.set(id, `${data.displayName}`);
    });
    return map;
    // `results` change à chaque rendu : on dépend des données elles-mêmes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique, results.map((r) => r.dataUpdatedAt).join(",")]);
}

/** Campus de chaque établissement du tenant (index id -> { nom, établissement }) ; vide si la lecture est refusée. */
export function useCampusIndex(): { campuses: ReadonlyArray<{ id: string; name: string; institutionId: string }>; byId: ReadonlyMap<string, string> } {
  const institutions = useInstitutions();
  const items = useMemo(() => institutions.data ?? [], [institutions.data]);
  const results = useQueries({
    queries: items.map((institution) => ({
      queryKey: platformHooks.queryKey("tenancy", "campuses", institution.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        platformApi.get(`/api/v1/tenancy/institutions/${institution.id}/campuses`, { schema: ListCampusesResponseSchema, signal }),
      staleTime: 10 * 60_000,
      retry: false,
    })),
  });
  return useMemo(() => {
    const campuses = results.flatMap((r) => (r.data?.items ?? []).map((c) => ({ id: c.id, name: c.name, institutionId: c.institutionId })));
    return { campuses, byId: new Map(campuses.map((c) => [c.id, c.name])) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(",")]);
}

export function LearnerName({ id, labels }: { id: string; labels: ReadonlyMap<string, string> }) {
  return <>{labels.get(id) ?? shortId(id)}</>;
}

/** Messages d'erreur d'un montant saisi (clés `v2Finance.errors.amount.*`). */
export function useAmountErrors() {
  const t = useTranslations("v2Finance.errors.amount");
  return (result: AmountParse): string | null => {
    if (result.ok) return null;
    return t(result.reason);
  };
}

/**
 * Champ de montant ENTIER (francs) : refuse les décimales plutôt que de les deviner ; la valeur transmise à l'API est
 * l'entier lu, jamais un calcul.
 */
export function MoneyField({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  allowZero,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  allowZero?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("v2Finance.common");
  const describe = useAmountErrors();
  const parsed = value.trim() === "" ? null : parseAmountInput(value, { allowZero });
  const liveError = error ?? (parsed && !parsed.ok ? describe(parsed) : null);
  return (
    <FormField label={label} required={required} error={liveError} hint={hint ?? t("amountHint")}>
      {(c: FieldControlProps) => <TextControl {...c} value={value} onChange={onChange} inputMode="numeric" autoComplete="off" disabled={disabled} />}
    </FormField>
  );
}

/** Année scolaire (chaîne libre côté finance, p. ex. « 2026-2027 ») : liste des années de l'établissement, sinon saisie libre. */
export function AcademicYearField({
  value,
  onChange,
  label,
  error,
  required,
  allowEmpty,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  error?: string | null;
  required?: boolean;
  allowEmpty?: boolean;
}) {
  const t = useTranslations("v2Finance.common");
  const years = useAcademicYears();
  const options = (years.data ?? []).map((y) => ({ value: y.code, label: y.label }));
  return (
    <FormField label={label} required={required} error={error}>
      {(c) =>
        options.length > 0 ? (
          <NativeSelect {...c} value={value} onChange={onChange} placeholder={allowEmpty ? t("allYears") : t("choose")} options={options} />
        ) : (
          <TextControl {...c} value={value} onChange={onChange} placeholder="2026-2027" maxLength={20} />
        )
      }
    </FormField>
  );
}

/**
 * Validation d'un corps avec le schéma du contrat, messages en français : les messages par défaut de Zod (« Required »,
 * « Expected string, received … ») sont remplacés ; les messages écrits dans les contrats (déjà en français) sont gardés.
 */
export function useValidator() {
  const t = useTranslations("v2Finance.errors");
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

/** Enveloppe `{ ok, errors }` des écrans qui valident un corps avec le schéma du contrat. */
export function firstError(errors: Record<string, string>, ...paths: string[]): string | undefined {
  for (const p of paths) if (errors[p]) return errors[p];
  return undefined;
}
