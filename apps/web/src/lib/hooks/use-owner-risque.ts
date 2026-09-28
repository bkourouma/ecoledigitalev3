"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerRisqueResponse } from "@ecoledigitale/contracts";

export type OwnerRisqueParams = {
  filiereIds?: string[];
  /**
   * Ouverture de classe, cle « filiereId|nom ». Ni annee ni semestre : cet
   * ecran travaille sur une fenetre de 30 jours calee sur la derniere seance
   * connue, pas sur un exercice.
   */
  nomClasse?: string;
};

/** Exporte pour que le bouton d export reutilise EXACTEMENT le perimetre affiche. */
export function buildQueryString(p: OwnerRisqueParams): string {
  const sp = new URLSearchParams();
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.nomClasse) sp.set("nomClasse", p.nomClasse);
  return sp.toString();
}

export function useOwnerRisque(params: OwnerRisqueParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const query = buildQueryString(params);
  const qs = query ? `?${query}` : "";

  return useQuery<OwnerRisqueResponse>({
    queryKey: ["owner-risque", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/risque${qs}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Chargement impossible");
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    // Le bloc de filtres ne disparaît pas pendant qu'on change un filtre.
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}
