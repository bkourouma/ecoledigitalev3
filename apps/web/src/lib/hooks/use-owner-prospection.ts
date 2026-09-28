"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerProspectionResponse } from "@ecoledigitale/contracts";

/**
 * Construit la query string du périmètre.
 *
 * Exportée pour que le bouton d'export CSV reprenne EXACTEMENT celui de
 * l'écran : un tableur qui ne dit pas la même chose que la page est pire qu'un
 * tableur absent.
 */
export function buildProspectionQueryString(
  anneeScolaire?: string | null,
  filiereIds?: string[],
  /** Ouverture de classe, clé « filiereId|nom ». Agit sur TOUS les blocs de
   *  l'écran, y compris « d'où viennent les étudiants » — et pas seulement
   *  sur l'argent. */
  nomClasse?: string | null
): string {
  const params = new URLSearchParams();
  if (anneeScolaire) params.set("anneeScolaire", anneeScolaire);
  if (filiereIds?.length) params.set("filiereIds", filiereIds.join(","));
  if (nomClasse) params.set("nomClasse", nomClasse);
  return params.toString();
}

export function useOwnerProspection(
  anneeScolaire?: string | null,
  filiereIds?: string[],
  nomClasse?: string | null
) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  const query = buildProspectionQueryString(anneeScolaire, filiereIds, nomClasse);
  const qs = query ? `?${query}` : "";

  return useQuery<OwnerProspectionResponse>({
    queryKey: ["owner-prospection", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/prospection${qs}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger la prospection"
        );
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    // Le tableau ne disparaît pas pendant qu'on change de filière.
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}
