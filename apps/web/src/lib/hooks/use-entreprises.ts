/**
 * useEntreprises Hook
 * 
 * React hooks for enterprise client management
 * Uses TanStack Query for data fetching and mutations
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  EntrepriseListQuery,
  EntrepriseListResponse,
  EntrepriseDetailResponse,
  CreateEntrepriseRequest,
  UpdateEntrepriseRequest,
  GenerateFacturationGroupeeRequest,
  GenerateFacturationGroupeeResponse,
} from "@ecoledigitale/contracts/src/entreprises";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import { toast } from "sonner";

/**
 * Hook to fetch enterprises list
 */
export function useEntreprisesList(query: EntrepriseListQuery) {
  return useQuery<EntrepriseListResponse>({
    queryKey: ["entreprises", "list", query],
    queryFn: async () => {
      const queryString = buildQueryString(query);
      const response = await fetch(`/api/v1/admin/entreprises?${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch enterprises");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to fetch enterprise details
 */
export function useEntrepriseDetails(entrepriseId: string | null) {
  return useQuery<EntrepriseDetailResponse>({
    queryKey: ["entreprises", "detail", entrepriseId],
    queryFn: async () => {
      if (!entrepriseId) throw new Error("Enterprise ID is required");

      const response = await fetch(`/api/v1/admin/entreprises/${entrepriseId}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch enterprise details");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    enabled: !!entrepriseId,
    staleTime: 30000,
  });
}

/**
 * Hook to create enterprise
 */
export function useCreateEntreprise() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateEntrepriseRequest) => {
      const response = await fetch("/api/v1/admin/entreprises", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create enterprise");
      }

      const rawData = await response.json();
      return rawData.data as { id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entreprises"] });
      toast.success("Entreprise créée avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la création");
    },
  });
}

/**
 * Hook to update enterprise
 */
export function useUpdateEntreprise() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateEntrepriseRequest }) => {
      const response = await fetch(`/api/v1/admin/entreprises/${id}`, {
        method: "PUT",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update enterprise");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entreprises"] });
      toast.success("Entreprise mise à jour avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la mise à jour");
    },
  });
}

/**
 * Hook to delete enterprise
 */
export function useDeleteEntreprise() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/v1/admin/entreprises/${id}`, {
        method: "DELETE",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete enterprise");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entreprises"] });
      toast.success("Entreprise supprimée avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la suppression");
    },
  });
}

/**
 * Hook to generate grouped invoice
 */
export function useGenerateFacturationGroupee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      entrepriseId,
      request,
    }: {
      entrepriseId: string;
      request: GenerateFacturationGroupeeRequest;
    }) => {
      const response = await fetch(`/api/v1/admin/entreprises/${entrepriseId}/facturation-groupee`, {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate grouped invoice");
      }

      const rawData = await response.json();
      return rawData.data as GenerateFacturationGroupeeResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entreprises"] });
      toast.success("Facture groupée générée avec succès");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la génération");
    },
  });
}

/**
 * Utility to export enterprises to Excel
 */
export async function exportEntreprisesToExcel(): Promise<void> {
  try {
    const response = await fetch("/api/v1/admin/entreprises/export", {
      headers: createApiHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to export enterprises");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `entreprises-${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast.success("Export réussi");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Erreur lors de l'export");
    throw error;
  }
}
