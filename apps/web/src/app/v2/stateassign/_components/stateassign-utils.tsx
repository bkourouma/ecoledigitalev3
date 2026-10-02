"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { AssignmentStatus, ControlStatus, ReceivableStatus, ReconciliationStatus } from "@ecoledigitale/contracts/v2/stateassign";
import { useAcademicYears } from "@/platform/v2/academic";
import { useInstitutions } from "@/platform/v2/lookups";
import { FormField, NativeSelect } from "@/platform/ui/FormField";
import type { Tone } from "@/platform/ui/PageHeader";
import { ErrorBlock } from "@/platform/ui/states";

export { PERM, VIEW_PERMISSIONS } from "./permissions";

export const ASSIGNMENT_TONE: Readonly<Record<AssignmentStatus, Tone>> = {
  RECEIVED: "info",
  VERIFIED: "info",
  ACTIVE: "success",
  SUSPENDED: "warning",
  ENDED: "neutral",
  REJECTED: "danger",
  TRANSFERRED: "neutral",
  SUPERSEDED: "neutral",
};

export const RECONCILIATION_TONE: Readonly<Record<ReconciliationStatus, Tone>> = { NEVER: "neutral", BALANCED: "success", DISCREPANCY: "danger" };
export const RECEIVABLE_TONE: Readonly<Record<ReceivableStatus, Tone>> = { OPEN: "info", PARTIALLY_RECEIVED: "warning", RECEIVED: "success", CANCELLED: "neutral" };
export const CONTROL_TONE: Readonly<Record<ControlStatus, Tone>> = { PENDING: "info", OK: "success", ANOMALY: "danger", WAIVED: "neutral" };

/** Un champ de date civile `AAAA-MM-JJ` saisi (le serveur valide aussi). */
export const isIsoDate = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);

export interface Scope {
  institutionId: string;
  academicYearId: string;
}

/**
 * Filtres d'établissement et d'année : un seul établissement => champ masqué (l'API borne déjà la lecture à ce que le compte voit). L'année est facultative
 * (vide = toutes). Aucune donnée n'est filtrée côté client : les valeurs partent dans la requête.
 */
export function ScopeFilters({ value, onChange }: { value: Scope; onChange: (next: Scope) => void }) {
  const t = useTranslations("v2Stateassign.common");
  const institutions = useInstitutions();
  const items = useMemo(() => institutions.data ?? [], [institutions.data]);
  const years = useAcademicYears(value.institutionId ? { institutionId: value.institutionId } : {});

  if (institutions.isError) return <ErrorBlock error={institutions.error} onRetry={() => void institutions.refetch()} />;
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={t("scope")}>
      {items.length > 1 ? (
        <FormField label={t("institution")}>
          {(c) => <NativeSelect {...c} value={value.institutionId} onChange={(institutionId) => onChange({ institutionId, academicYearId: "" })} placeholder={t("allInstitutions")} options={items.map((i) => ({ value: i.id, label: i.name }))} />}
        </FormField>
      ) : null}
      <FormField label={t("year")}>
        {(c) => <NativeSelect {...c} value={value.academicYearId} onChange={(academicYearId) => onChange({ ...value, academicYearId })} placeholder={t("allYears")} options={(years.data ?? []).map((y) => ({ value: y.id, label: y.label }))} />}
      </FormField>
    </div>
  );
}

/** Paramètres d'une requête depuis la portée (clés absentes quand le filtre est vide). */
export function scopeQuery(scope: Scope): { institutionId?: string; academicYearId?: string } {
  return { ...(scope.institutionId ? { institutionId: scope.institutionId } : {}), ...(scope.academicYearId ? { academicYearId: scope.academicYearId } : {}) };
}
