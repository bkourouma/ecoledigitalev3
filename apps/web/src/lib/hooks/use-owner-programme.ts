"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerProgrammeResponse } from "@ecoledigitale/contracts";

/** Programme — UE, ECUE et maquette. Les quatre dimensions entrent dans la clé. */
export type OwnerProgrammeParams = {
  anneeScolaire?: string;
  filiereIds?: string[];
  nomClasse?: string;
  semestreId?: string;
};

/** Exportée pour que l'export reprenne EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerProgrammeParams): string {
  const sp = new URLSearchParams();
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.nomClasse) sp.set("nomClasse", p.nomClasse);
  if (p.semestreId) sp.set("semestreId", p.semestreId);
  return sp.toString();
}

export function useOwnerProgramme(params: OwnerProgrammeParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const query = buildQueryString(params);
  const qs = query ? `?${query}` : "";

  return useQuery<OwnerProgrammeResponse>({
    queryKey: ["owner-programme", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/programme${qs}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger le programme"
        );
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}
