"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerAssiduiteResponse } from "@ecoledigitale/contracts";

export type OwnerAssiduiteParams = {
  dateDebut?: string;
  dateFin?: string;
  filiereIds?: string[];
  semestreId?: string;
  building?: string;
};

/** Exporté pour que le bouton d'export réutilise EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerAssiduiteParams): string {
  const sp = new URLSearchParams();
  if (p.dateDebut) sp.set("dateDebut", p.dateDebut);
  if (p.dateFin) sp.set("dateFin", p.dateFin);
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
