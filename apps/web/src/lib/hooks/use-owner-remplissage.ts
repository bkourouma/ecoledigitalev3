"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerRemplissageResponse } from "@ecoledigitale/contracts";

export function useOwnerRemplissage(filiereIds?: string[]) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = filiereIds?.length ? `?filiereIds=${filiereIds.join(",")}` : "";

  return useQuery<OwnerRemplissageResponse>({
    queryKey: ["owner-remplissage", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/remplissage${qs}`, {
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
