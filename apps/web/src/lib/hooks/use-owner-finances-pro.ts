"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type {
  OwnerFinancesProMode,
  OwnerFinancesProPeriod,
  OwnerFinancesProResponse,
} from "@ecoledigitale/contracts";

export type OwnerFinancesProParams = {
  period: OwnerFinancesProPeriod;
  dateDebut?: string;
  dateFin?: string;
  anneeScolaire?: string;
  filiereIds?: string[];
  semestreId?: string;
  mode?: OwnerFinancesProMode;
  etat?: "non_regle" | "partiel" | "solde" | "tous";
};

/** Exporté pour que le bouton d'export réutilise EXACTEMENT le périmètre affiché. */
export function buildQueryString(p: OwnerFinancesProParams): string {
  const sp = new URLSearchParams();
  sp.set("period", p.period);
  if (p.period === "custom") {
    if (p.dateDebut) sp.set("dateDebut", p.dateDebut);
    if (p.dateFin) sp.set("dateFin", p.dateFin);
  }
  if (p.anneeScolaire) sp.set("anneeScolaire", p.anneeScolaire);
  if (p.filiereIds && p.filiereIds.length > 0) sp.set("filiereIds", p.filiereIds.join(","));
  if (p.semestreId) sp.set("semestreId", p.semestreId);
  if (p.mode) sp.set("mode", p.mode);
  if (p.etat) sp.set("etat", p.etat);
  return sp.toString();
}

export function useOwnerFinancesPro(params: OwnerFinancesProParams) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const qs = buildQueryString(params);

  return useQuery<OwnerFinancesProResponse>({
    queryKey: ["owner-finances-pro", tenantId, qs],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/finances/professionnel?${qs}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ||
            "Impossible de charger le recouvrement du module professionnel"
        );
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}
