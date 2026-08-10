"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerReferentielResponse, OwnerUeCategorie } from "@ecoledigitale/contracts";

export type OwnerReferentielParams = {
  cycleId?: string;
  filiereIds?: string[];
  categorie?: OwnerUeCategorie;
};

function buildQueryString(p: OwnerReferentielParams): string {
  const sp = new URLSearchParams();
  if (p.cycleId) sp.set("cycleId", p.cycleId);
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.categorie) sp.set("categorie", p.categorie);
  return sp.toString();
}

export function useOwnerReferentiel(params: OwnerReferentielParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerReferentielResponse>({
    queryKey: ["owner-referentiel", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/referentiel?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger le référentiel"
        );
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
