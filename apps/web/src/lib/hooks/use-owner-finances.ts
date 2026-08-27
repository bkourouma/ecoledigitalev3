"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerFinancesPeriod, OwnerFinancesResponse } from "@ecoledigitale/contracts";

export type OwnerFinancesQueryParams = {
  period: OwnerFinancesPeriod;
  /**
   * Année scolaire « AAAA-AAAA+1 », dérivée des ouvertures de classe. Remplace
   * l'ancien `academicYearId` : la table `academic_years` ne décrivait pas
   * l'activité réelle de l'établissement.
   */
  anneeScolaire?: string;
  /** Restreint la moitié scolaire. */
  /** Restreint la moitié professionnelle. */
  filiereIds?: string[];
};

export function buildQueryString(p: OwnerFinancesQueryParams): string {
  const sp = new URLSearchParams();
  sp.set("period", p.period);
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  if (p.filiereIds?.length) sp.set("filiereIds", p.filiereIds.join(","));
  return sp.toString();
}

/**
 * Encaissements consolidés, scolarité et module professionnel.
 *
 * `keepPreviousData` : changer de période garde les chiffres précédents à
 * l'écran pendant le calcul plutôt que de faire sauter la page.
 */
export function useOwnerFinances(params: OwnerFinancesQueryParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerFinancesResponse>({
    queryKey: ["owner-finances", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/finances?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger les encaissements"
        );
      }
      const json = (await res.json()) as OwnerFinancesResponse | null;
      if (!json || typeof json !== "object" || !("totals" in json)) {
        throw new Error("Impossible de charger les encaissements");
      }
      // Une API pas encore redémarrée peut omettre ces tableaux. Sans défaut,
      // l'écran lisait `.length` sur `undefined` et tombait entièrement.
      return {
        ...json,
        monthly: json.monthly ?? [],
        byFiliere: json.byFiliere ?? [],
        byMode: json.byMode ?? [],
        filiereIds: json.filiereIds ?? [],
      };
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}
