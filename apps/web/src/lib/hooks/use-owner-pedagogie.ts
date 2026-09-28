"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerPedagogieResponse, OwnerUeCategorie } from "@ecoledigitale/contracts";

export type OwnerPedagogieParams = {
  anneeScolaire?: string;
  filiereIds?: string[];
  semestreId?: string;
  /**
   * Ouverture de classe, cle « filiereId|nom ».
   *
   * Le service l applique depuis le 22/09/2026, par DEUX chemins — les
   * ouvertures pour la sante des UE, les etudiants inscrits pour les bulletins
   * — mais le hook ne l envoyait pas : la barre proposait le filtre et rien ne
   * bougeait. Quatre points font un filtre, pas trois : le perimetre affiche,
   * le schema Zod, le predicat SQL, ET la query string.
   */
  nomClasse?: string;
  statut?: "en_cours" | "termine" | "tous";
  categorie?: OwnerUeCategorie;
};

/** Exporté pour que le bouton d'export réutilise EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerPedagogieParams): string {
  const sp = new URLSearchParams();
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  // Forme CSV : l'API accepte aussi la répétition, mais le CSV garde la queryKey
  // stable et lisible dans les outils de debug.
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.semestreId) sp.set("semestreId", p.semestreId);
  if (p.nomClasse) sp.set("nomClasse", p.nomClasse);
  if (p.statut) sp.set("statut", p.statut);
  if (p.categorie) sp.set("categorie", p.categorie);
  return sp.toString();
}

export function useOwnerPedagogie(params: OwnerPedagogieParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerPedagogieResponse>({
    queryKey: ["owner-pedagogie", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/pedagogie?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ||
            "Impossible de charger le pilotage pédagogique"
        );
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
