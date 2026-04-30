/**
 * useExports Hook
 * 
 * React hooks for data export functionalities
 * Uses TanStack Query for export job management
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExportInscriptionsRequest,
  ExportPaiementsRequest,
  ExportPresencesRequest,
  ExportCAFormationRequest,
  ExportPersonnaliseRequest,
  ExportJobResponse,
} from "@ecoledigitale/contracts/src/exports";
import { createApiHeaders } from "@/lib/api-utils";
import { toast } from "sonner";

/**
 * Hook to create export job
 */
export function useCreateExportJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      type,
      request,
    }: {
      type: "inscriptions" | "paiements" | "presences" | "ca_formation" | "personnalise";
      request: ExportInscriptionsRequest | ExportPaiementsRequest | ExportPresencesRequest | ExportCAFormationRequest | ExportPersonnaliseRequest;
    }) => {
      const response = await fetch(`/api/v1/admin/exports/${type}`, {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create export job");
      }

      const rawData = await response.json();
      return rawData.job_id as string;
    },
    onSuccess: (jobId) => {
      queryClient.invalidateQueries({ queryKey: ["exports", "jobs"] });
      toast.success("Export démarré. Vous serez notifié lorsqu'il sera prêt.");
      return jobId;
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Erreur lors de la création de l'export");
    },
  });
}

/**
 * Hook to get export job status
 */
export function useExportJobStatus(jobId: string | null) {
  return useQuery<ExportJobResponse>({
    queryKey: ["exports", "jobs", jobId],
    queryFn: async () => {
      if (!jobId) throw new Error("Job ID is required");

      const response = await fetch(`/api/v1/admin/exports/jobs/${jobId}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch job status");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    enabled: !!jobId,
    refetchInterval: (data) => {
      // Poll every 2 seconds if job is pending or processing
      if (data?.status === "pending" || data?.status === "processing") {
        return 2000;
      }
      return false;
    },
  });
}

/**
 * Utility to download export file
 */
export async function downloadExportFile(jobId: string): Promise<void> {
  try {
    const response = await fetch(`/api/v1/admin/exports/jobs/${jobId}/download`, {
      headers: createApiHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to download export");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export-${jobId}.${blob.type.includes("csv") ? "csv" : "xlsx"}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast.success("Export téléchargé avec succès");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Erreur lors du téléchargement");
    throw error;
  }
}
