"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerAlertsListResponse } from "@ecoledigitale/contracts";

export function useOwnerAlerts() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<OwnerAlertsListResponse>({
    queryKey: ["owner-alerts", tenantId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch("/api/v1/owner/alerts", { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Impossible de charger les alertes");
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 30 * 1000,
  });
}

/**
 * Recalcule les alertes de pilotage, puis recharge la liste.
 *
 * Le recalcul est une ÉCRITURE : il ne se déclenche plus au simple chargement de
 * la page (`GET /owner/alerts` est redevenu une lecture pure), mais sur ce geste
 * explicite. Une alerte dont la condition a disparu est résolue par le recalcul.
 */
export function useSyncOwnerAlerts() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch("/api/v1/owner/alerts/sync", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { message?: string }).message || `Erreur ${res.status}`);
      }
      return body;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner-alerts", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["owner-dashboard", tenantId] });
    },
  });
}

/**
 * Acquittement d'une alerte de pilotage.
 *
 * Extrait de la page `/owner/alertes` pour que le panneau du tableau de bord
 * acquitte réellement : son bouton « Acquitter » n'était qu'un lien vers la page
 * des alertes, ce qui obligeait à refaire le geste ailleurs.
 *
 * `mutation.variables` porte l'id en cours : c'est lui qui doit piloter l'état
 * de chargement d'une ligne, sinon toutes les lignes passent en attente.
 */
export function useAcknowledgeOwnerAlert() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const headers = createApiHeaders(session);
      const res = await fetch(`/api/v1/owner/alerts/${id}/acknowledge`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { message?: string }).message || `Erreur ${res.status}`);
      }
      return body;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["owner-alerts", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["owner-dashboard", tenantId] });
    },
  });
}
