"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiHeaders } from "@/lib/api-utils";
import { getToken, getUserFromToken } from "@/lib/jwt-storage";

/**
 * Barème de scolarité — les frais par CLASSE (table `programmes`), regroupés
 * par filière.
 *
 * La scolarité proposée est calculée : pour chaque semestre de la classe, on
 * somme le prix des UE qui le composent. L'utilisateur reste libre de saisir un
 * autre montant, et renseigne lui-même inscription, frais annexes et autres.
 */

export interface ScolariteSemestre {
  id: string;
  libelle: string;
  nbUe: number;
  montant: number;
}

export interface ScolariteFrais {
  id: string;
  inscription: number;
  scolarite: number;
  annexes: number;
  autres: number;
  currency: string;
  updatedAt: string;
}

export interface ScolariteClasse {
  programmeId: string;
  programmeName: string;
  programmeCode: string;
  cycleId: string;
  cycleName: string;
  cycleCode: string;
  currency: string;
  /** Somme des prix des UE de tous les semestres de la classe. */
  scolariteCalculee: number;
  semestres: ScolariteSemestre[];
  /** Frais déjà enregistrés pour cette classe, `null` si jamais saisis. */
  fees: ScolariteFrais | null;
}

export interface UpsertScolarite {
  cycleId: string;
  programmeId: string;
  inscription: number;
  scolarite: number;
  annexes: number;
  autres: number;
  currency: string;
}

function createFinanceHeaders() {
  const headers = createApiHeaders();
  const token = typeof window !== "undefined" ? getToken() : null;
  const user = token ? getUserFromToken(token) : null;

  if (user?.tenantId) {
    headers["X-Tenant"] = user.tenantId;
  }

  return headers;
}

async function readError(response: Response, fallback: string) {
  try {
    const error = await response.json();
    return error.message || error.error || fallback;
  } catch {
    return `Erreur ${response.status}: ${response.statusText}`;
  }
}

/** Barème de toutes les classes d'une filière. */
export function useScolariteBareme(filiereId: string) {
  return useQuery({
    queryKey: ["scolarite-bareme", filiereId],
    enabled: Boolean(filiereId),
    queryFn: async (): Promise<ScolariteClasse[]> => {
      const response = await fetch(`/api/v1/cycle-fees/scolarite?filiereId=${filiereId}`, {
        headers: createFinanceHeaders(),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Impossible de charger le barème de la filière"));
      }

      const payload = await response.json();
      return payload.data ?? [];
    },
  });
}

/** Enregistre les frais d'une classe. */
export function useUpsertScolarite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpsertScolarite) => {
      const response = await fetch("/api/v1/cycle-fees/upsert", {
        method: "POST",
        headers: createFinanceHeaders(),
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Impossible d'enregistrer les frais"));
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scolarite-bareme"] });
      queryClient.invalidateQueries({ queryKey: ["cycle-fees"] });
    },
  });
}
