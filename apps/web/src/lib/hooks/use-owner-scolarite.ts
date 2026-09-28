"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerScolariteResponse } from "@ecoledigitale/contracts";

/**
 * Scolarité — barème appliqué et facturation réelle.
 *
 * Les quatre dimensions du périmètre voyagent jusqu'à l'API, et entrent toutes
 * dans la clé de cache : sans cela React Query servirait les chiffres du filtre
 * précédent, ce qui sur un écran d'argent se lit comme une erreur de caisse.
 */

export type OwnerScolariteParams = {
  anneeScolaire?: string;
  filiereIds?: string[];
  /** Ouverture de classe, clé « filiereId|nom ». */
  nomClasse?: string;
  semestreId?: string;
};

/** Exportée pour que le bouton d'export reprenne EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerScolariteParams): string {
  const sp = new URLSearchParams();
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.nomClasse) sp.set("nomClasse", p.nomClasse);
  if (p.semestreId) sp.set("semestreId", p.semestreId);
  return sp.toString();
}

export function useOwnerScolarite(params: OwnerScolariteParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const query = buildQueryString(params);
  const qs = query ? `?${query}` : "";

  return useQuery<OwnerScolariteResponse>({
    queryKey: ["owner-scolarite", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/scolarite${qs}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger la scolarité"
        );
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    // Le tableau ne disparaît pas pendant qu'on change un filtre.
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}
