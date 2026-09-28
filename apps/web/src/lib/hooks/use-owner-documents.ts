"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerDocumentsResponse } from "@ecoledigitale/contracts";

/**
 * Documents officiels — diplômes, signataires, complétude des dossiers.
 *
 * Les quatre dimensions du périmètre voyagent et entrent dans la clé de cache.
 */

export type OwnerDocumentsParams = {
  anneeScolaire?: string;
  filiereIds?: string[];
  /** Ouverture de classe, clé « filiereId|nom ». */
  nomClasse?: string;
  semestreId?: string;
};

/** Exportée pour que l'export reprenne EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerDocumentsParams): string {
  const sp = new URLSearchParams();
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.nomClasse) sp.set("nomClasse", p.nomClasse);
  if (p.semestreId) sp.set("semestreId", p.semestreId);
  return sp.toString();
}

export function useOwnerDocuments(params: OwnerDocumentsParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const query = buildQueryString(params);
  const qs = query ? `?${query}` : "";

  return useQuery<OwnerDocumentsResponse>({
    queryKey: ["owner-documents", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/documents${qs}`, {
        headers: createApiHeaders(session),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger les documents"
        );
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });
}
