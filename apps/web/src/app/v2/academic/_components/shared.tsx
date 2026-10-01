"use client";

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useInstitutions } from "@/platform/v2/lookups";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import { ErrorBlock } from "@/platform/ui/states";
import type { Tone } from "@/platform/ui/PageHeader";

/** Tonalité d'une pastille d'état (affichage seulement ; le sens est porté par le libellé traduit). */
export function toneOf(status: string): Tone {
  switch (status) {
    case "OPEN":
    case "ACTIVE":
    case "PUBLISHED":
    case "CONFIRMED":
    case "IN_PROGRESS":
      return "success";
    case "DRAFT":
    case "PLANNED":
    case "PENDING":
      return "info";
    case "GRADING_CLOSED":
    case "SUSPENDED":
    case "FULL":
      return "warning";
    case "CANCELLED":
    case "WITHDRAWN":
    case "TRANSFERRED_OUT":
      return "danger";
    default:
      return "neutral";
  }
}

/**
 * Établissement des créations : un seul établissement => sélectionné d'office et champ masqué ; plusieurs => liste de
 * choix. Les contrats exigent `institutionId` à la création d'une année, d'un programme ou d'une classe.
 */
export function InstitutionField({ value, onChange, error }: { value: string; onChange: (id: string) => void; error?: string | null }) {
  const t = useTranslations("v2Academic.common");
  const q = useInstitutions();
  const items = useMemo(() => q.data ?? [], [q.data]);
  useEffect(() => {
    if (!value && items.length === 1) onChange(items[0]!.id);
  }, [items, value, onChange]);
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  if (items.length <= 1) {
    // Un seul établissement : choisi d'office, champ masqué. Une erreur de contrat reste visible malgré tout.
    return error ? (
      <p role="alert" className="text-xs font-medium text-destructive">
        {error}
      </p>
    ) : null;
  }
  return (
    <FormField label={t("institution")} required error={error}>
      {(c) => <NativeSelect {...c} value={value} onChange={onChange} placeholder={t("choose")} options={items.map((i) => ({ value: i.id, label: i.name }))} />}
    </FormField>
  );
}

/** Établissement effectif d'un formulaire de création (le seul du tenant, ou celui qu'on a choisi). */
export function useDefaultInstitutionId(chosen: string): { institutionId: string; isReady: boolean; error: unknown } {
  const q = useInstitutions();
  const items = q.data ?? [];
  const institutionId = chosen || (items.length === 1 ? items[0]!.id : "");
  return { institutionId, isReady: !q.isPending, error: q.error };
}
