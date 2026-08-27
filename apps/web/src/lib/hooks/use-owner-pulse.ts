"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerPulseResponse } from "@ecoledigitale/contracts";

/**
 * Le pouls de l'établissement : les 8 indicateurs de tête, consolidés scolaire
 * et professionnel.
 *
 * `anneeScolaire` fait partie de la clé de cache : le tableau de bord et le
 * composant `<OwnerPulse />` appellent tous deux ce hook avec la même année et
 * se partagent donc UNE requête. Changer d'année en crée une autre, et
 * `keepPreviousData` garde les tuiles précédentes à l'écran pendant le calcul
 * plutôt que de faire sauter la page sur huit squelettes.
 */
export function useOwnerPulse(anneeScolaire?: string) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<OwnerPulseResponse>({
    queryKey: ["owner-pulse", tenantId, anneeScolaire ?? null],
    queryFn: async ({ queryKey }) => {
      const headers = createApiHeaders(session);
      const year = queryKey[2] as string | null;
      const qs = year ? `?anneeScolaire=${encodeURIComponent(year)}` : "";
      const res = await fetch(`/api/v1/owner/pulse${qs}`, { headers });
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
    placeholderData: keepPreviousData,
  });
}
