"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerEconomieResponse } from "@ecoledigitale/contracts";

export type BaseExercice = "scolaire" | "civil";

export function useOwnerEconomie(
  anneeScolaire?: string | null,
  filiereIds?: string[],
  /**
   * Base de l'exercice du compte de résultat.
   *
   * Volontairement hors de la barre de filtres : un résultat porte sur UN
   * exercice, là où la barre accepte « toutes années ». Le sélecteur vit sur
   * l'écran, à côté du tableau qu'il commande.
   */
  baseExercice?: BaseExercice
) {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  // `URLSearchParams` plutôt qu'une concaténation : l'année et les filières
  // s'ajoutent indépendamment, et la clé de cache doit refléter les deux — sans
  // quoi changer d'année réafficherait les chiffres de la précédente.
  const params = new URLSearchParams();
  if (anneeScolaire) params.set("anneeScolaire", anneeScolaire);
  if (filiereIds?.length) params.set("filiereIds", filiereIds.join(","));
  if (baseExercice) params.set("baseExercice", baseExercice);
  const qs = params.toString() ? `?${params.toString()}` : "";

  return useQuery<OwnerEconomieResponse>({
    queryKey: ["owner-economie", tenantId, qs],
    queryFn: async () => {
      const res = await fetch(`/api/v1/owner/economie${qs}`, {
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
