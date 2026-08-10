"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerStatsFiltersResponse } from "@ecoledigitale/contracts";

/**
 * Référentiel des filtres (filières, semestres, années scolaires).
 *
 * `staleTime` volontairement long : ce référentiel bouge à la journée, pas à la
 * minute, et il est partagé par toutes les pages de statistiques.
 */
export function useOwnerStatsFilters() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<OwnerStatsFiltersResponse>({
    queryKey: ["owner-stats-filters", tenantId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch("/api/v1/owner/stats/filters", { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger les filtres"
        );
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 5 * 60 * 1000,
  });
}
