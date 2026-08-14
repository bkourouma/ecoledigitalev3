"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerPulseResponse } from "@ecoledigitale/contracts";

/**
 * Le pouls de l'établissement : les 8 indicateurs de tête, consolidés scolaire
 * et professionnel. Un seul appel, partagé par toutes les pages owner grâce à
 * la clé de cache — la barre ne se recharge pas d'un écran à l'autre.
 */
export function useOwnerPulse() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<OwnerPulseResponse>({
    queryKey: ["owner-pulse", tenantId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch("/api/v1/owner/pulse", { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message || "Impossible de charger les indicateurs"
        );
      }
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    // Les agrégats portent sur des mois et des années scolaires : les rafraîchir
    // à la seconde n'apporte rien et coûte huit requêtes lourdes.
    staleTime: 5 * 60 * 1000,
  });
}
