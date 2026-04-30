"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerFinancesPeriod, OwnerFinancesResponse } from "@ecoledigitale/contracts";

export type OwnerFinancesQueryParams = {
  period: OwnerFinancesPeriod;
  academicYearId?: string;
  cycleId?: string;
};

function buildQueryString(p: OwnerFinancesQueryParams): string {
  const sp = new URLSearchParams();
  sp.set("period", p.period);
  if (p.academicYearId) sp.set("academicYearId", p.academicYearId);
  if (p.cycleId) sp.set("cycleId", p.cycleId);
  return sp.toString();
}

export function useOwnerFinances(params: OwnerFinancesQueryParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerFinancesResponse>({
    queryKey: ["owner-finances", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/finances?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Impossible de charger les finances");
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
