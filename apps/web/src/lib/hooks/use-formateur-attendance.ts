/**
 * use-formateur-attendance.ts
 * 
 * React hooks for trainer attendance management
 * Uses TanStack Query for data fetching and mutations
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MarkPresenceSchema, AttendanceResponseSchema } from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders } from "@/lib/api-utils";
import { z } from "zod";
import { toast } from "sonner";

/**
 * Hook to mark attendance for a learner
 */
export function useMarkAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      inscriptionId,
      present,
    }: {
      sessionId: string;
      inscriptionId: string;
      present: boolean;
    }) => {
      const validated = MarkPresenceSchema.parse({ present });
      const response = await fetch(
        `/api/v1/formateur/sessions/${sessionId}/inscrits/${inscriptionId}/presence`,
        {
          method: "PATCH",
          headers: {
            ...createApiHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(validated),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to mark attendance");
      }

      const rawData = await response.json();
      return AttendanceResponseSchema.parse(rawData);
    },
    onSuccess: (data, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["formateur", "sessions", variables.sessionId, "inscrits"] });
      queryClient.invalidateQueries({ queryKey: ["formateur", "sessions", variables.sessionId] });
      
      toast.success(
        data.data.present ? "Présence marquée avec succès" : "Absence marquée avec succès"
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors du marquage de la présence"
      );
    },
  });
}

/**
 * Hook to export attendance list
 */
export function useExportAttendance() {
  return useMutation({
    mutationFn: async ({
      sessionId,
      format = "csv",
    }: {
      sessionId: string;
      format?: "csv" | "pdf";
    }) => {
      const response = await fetch(
        `/api/v1/formateur/sessions/${sessionId}/attendance/export?format=${format}`,
        {
          headers: createApiHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to export attendance");
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : `emargement-${sessionId}.${format}`;

      // Get blob
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      return { success: true, filename };
    },
    onSuccess: () => {
      toast.success("Fichier d'émargement téléchargé avec succès");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de l'export de l'émargement"
      );
    },
  });
}

