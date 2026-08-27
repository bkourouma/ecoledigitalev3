"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type {
  OwnerPayrollArchive,
  OwnerPayrollResponse,
  OwnerPayrollStatus,
} from "@ecoledigitale/contracts";

export type OwnerPayrollFilters = {
  anneeScolaire?: string;
  periodId?: string;
  teacherId?: string;
  status?: OwnerPayrollStatus;
  archive: OwnerPayrollArchive;
};

export function buildQueryString(f: OwnerPayrollFilters): string {
  const p = new URLSearchParams();
  if (f.anneeScolaire) p.set("anneeScolaire", f.anneeScolaire);
  if (f.periodId) p.set("periodId", f.periodId);
  if (f.teacherId) p.set("teacherId", f.teacherId);
  if (f.status) p.set("status", f.status);
  p.set("archive", f.archive);
  return p.toString();
}

/**
 * Masse salariale enseignante.
 *
 * `keepPreviousData` : changer de période garde le tableau précédent à l'écran
 * pendant le chargement plutôt que de le vider, sans quoi la page saute à chaque
 * changement de filtre.
 */
export function useOwnerPayroll(filters: OwnerPayrollFilters) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(filters);

  return useQuery<OwnerPayrollResponse>({
    queryKey: ["owner-payroll", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/payroll?${qs}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger la masse salariale"
        );
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    placeholderData: keepPreviousData,
  });
}
