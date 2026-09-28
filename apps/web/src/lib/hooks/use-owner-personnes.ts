"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerPersonnesResponse } from "@ecoledigitale/contracts";

export type OwnerPersonnesParams = {
  /** Année scolaire dérivée `YYYY-YYYY`. Absente ⇒ toutes années cumulées. */
  anneeScolaire?: string;
  filiereIds?: string[];
  /**
   * Ouverture de classe, clé « filiereId|nom ». Elle agit sur les TROIS
   * périmètres de cet écran — étudiants, enseignants et parents : ne la
   * brancher que sur les étudiants ferait comparer une classe à tout
   * l'établissement dans le ratio étudiants/enseignant.
   */
  nomClasse?: string;
};

/** Exporté pour que le bouton d'export réutilise EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerPersonnesParams): string {
  const sp = new URLSearchParams();
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.nomClasse) sp.set("nomClasse", p.nomClasse);
  return sp.toString();
}

export function useOwnerPersonnes(params: OwnerPersonnesParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerPersonnesResponse>({
    queryKey: ["owner-personnes", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/personnes?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger la démographie"
        );
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
