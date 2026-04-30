"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerDashboardResponse } from "@ecoledigitale/contracts";

export function useOwnerDashboard() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<OwnerDashboardResponse>({
    queryKey: ["owner-dashboard", tenantId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch("/api/v1/owner/dashboard", { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Impossible de charger le tableau de bord");
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
