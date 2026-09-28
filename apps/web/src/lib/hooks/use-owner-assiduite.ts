"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerAssiduiteResponse } from "@ecoledigitale/contracts";

export type OwnerAssiduiteParams = {
  dateDebut?: string;
  dateFin?: string;
  /**
   * Annee scolaire et ouverture de classe : le service les applique depuis le
   * 22/09/2026 (adoption du socle de perimetre), mais le hook ne les envoyait
   * pas et la barre ne les proposait pas. Quatre points font un filtre — le
   * perimetre affiche, le schema Zod, le predicat SQL, ET la query string.
   */
  anneeScolaire?: string;
  nomClasse?: string;
  filiereIds?: string[];
  semestreId?: string;
  building?: string;
};

/** Exporté pour que le bouton d'export réutilise EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerAssiduiteParams): string {
  const sp = new URLSearchParams();
  if (p.dateDebut) sp.set("dateDebut", p.dateDebut);
  if (p.dateFin) sp.set("dateFin", p.dateFin);
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  if (p.nomClasse) sp.set("nomClasse", p.nomClasse);
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.semestreId) sp.set("semestreId", p.semestreId);
  if (p.building) sp.set("building", p.building);
  return sp.toString();
}

export function useOwnerAssiduite(params: OwnerAssiduiteParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerAssiduiteResponse>({
    queryKey: ["owner-assiduite", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/assiduite?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger l’assiduité"
        );
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
