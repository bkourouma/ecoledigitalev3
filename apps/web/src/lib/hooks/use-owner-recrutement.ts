"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerRecrutementResponse } from "@ecoledigitale/contracts";

export type OwnerRecrutementParams = {
  dateDebut?: string;
  dateFin?: string;
  accountType?: "student" | "parent";
  status?: "pending" | "approved" | "rejected";
};

/** Exporté pour que le bouton d'export réutilise EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerRecrutementParams): string {
  const sp = new URLSearchParams();
  if (p.dateDebut) sp.set("dateDebut", p.dateDebut);
  if (p.dateFin) sp.set("dateFin", p.dateFin);
  if (p.accountType) sp.set("accountType", p.accountType);
  if (p.status) sp.set("status", p.status);
  return sp.toString();
}

export function useOwnerRecrutement(params: OwnerRecrutementParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerRecrutementResponse>({
    queryKey: ["owner-recrutement", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/recrutement?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger le recrutement"
        );
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
