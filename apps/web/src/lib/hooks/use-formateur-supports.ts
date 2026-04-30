/**
 * use-formateur-supports.ts
 * 
 * React hooks for trainer course materials management
 * Uses TanStack Query for data fetching and mutations
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SupportsListQuerySchema,
  UpdateSupportSchema,
} from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import { z } from "zod";
import { toast } from "sonner";

type SupportsListQuery = z.infer<typeof SupportsListQuerySchema>;

/**
 * Hook to fetch trainer's course materials list
 */
export function useFormateurSupports(query: SupportsListQuery) {
  return useQuery({
    queryKey: ["formateur", "supports", query],
    queryFn: async () => {
      const queryString = buildQueryString(query as any);
      const response = await fetch(`/api/v1/formateur/supports${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch course materials");
      }

      const rawData = await response.json();
      return rawData;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to fetch detailed course material information
 */
export function useFormateurSupportDetail(supportId: string | null) {
  return useQuery({
    queryKey: ["formateur", "supports", supportId],
    queryFn: async () => {
      if (!supportId) return null;

      const response = await fetch(`/api/v1/formateur/supports/${supportId}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch course material details");
      }

      const rawData = await response.json();
      return rawData;
    },
    enabled: !!supportId,
    staleTime: 60000, // Cache for 1 minute
  });
}

/**
 * Hook to upload a course material
 */
export function useUploadSupport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      file: File;
      titre: string;
      description?: string;
      formation_id?: string;
      video_provider?: "local" | "vimeo";
      vimeo_url?: string;
      thumbnail_url?: string;
      thumbnail_file?: File;
      session_ids?: string[];
      visible_apprenants?: boolean;
    }) => {
      const formData = new FormData();
      formData.append("titre", data.titre);
      if (data.description) formData.append("description", data.description);
      if (data.formation_id) formData.append("formation_id", data.formation_id);
      if (data.video_provider) formData.append("video_provider", data.video_provider);
      if (data.vimeo_url) formData.append("vimeo_url", data.vimeo_url);
      if (data.thumbnail_url) formData.append("thumbnail_url", data.thumbnail_url);
      if (data.thumbnail_file) formData.append("thumbnail_file", data.thumbnail_file);
      if (data.session_ids && data.session_ids.length > 0) {
        data.session_ids.forEach((id) => formData.append("session_ids", id));
      }
      formData.append("visible_apprenants", String(data.visible_apprenants !== false));
      // Append file last so server-side multipart parsers can read metadata fields early.
      formData.append("file", data.file);

      // Let the browser set multipart/form-data boundary for FormData payloads.
      const headers = createApiHeaders();
      delete (headers as any)["Content-Type"];

      const response = await fetch("/api/v1/formateur/supports/upload", {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to upload course material");
      }

      return await response.json();
    },
    onSuccess: (response) => {
      const createdSupport = (response as any)?.data;
      if (createdSupport?.id) {
        queryClient.setQueriesData({ queryKey: ["formateur", "supports"] }, (oldData: any) => {
          const currentSupports = oldData?.data?.supports;
          if (!Array.isArray(currentSupports)) return oldData;
          if (currentSupports.some((support: any) => support?.id === createdSupport.id)) return oldData;

          const supportForList = {
            ...createdSupport,
            sessions: createdSupport.sessions || [],
            nb_telechargements: createdSupport.nb_telechargements ?? 0,
            formation: createdSupport.formation ?? null,
          };

          const updatedSupports = [supportForList, ...currentSupports];
          const currentPagination = oldData?.data?.pagination;
          const updatedTotal =
            typeof currentPagination?.total === "number"
              ? currentPagination.total + 1
              : currentPagination?.total;

          return {
            ...oldData,
            data: {
              ...oldData.data,
              supports: updatedSupports,
              pagination: currentPagination
                ? {
                    ...currentPagination,
                    total: updatedTotal,
                    totalPages:
                      typeof updatedTotal === "number" &&
                      typeof currentPagination.limit === "number" &&
                      currentPagination.limit > 0
                        ? Math.max(1, Math.ceil(updatedTotal / currentPagination.limit))
                        : currentPagination.totalPages,
                  }
                : currentPagination,
            },
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: ["formateur", "supports"] });
      toast.success("Support de cours uploadé avec succès");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de l'upload du support"
      );
    },
  });
}

/**
 * Hook to update course material metadata
 */
export function useUpdateSupport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      supportId,
      updates,
    }: {
      supportId: string;
      updates: z.infer<typeof UpdateSupportSchema>;
    }) => {
      const validated = UpdateSupportSchema.parse(updates);
      const response = await fetch(`/api/v1/formateur/supports/${supportId}`, {
        method: "PUT",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validated),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update course material");
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      // Invalidate supports list and detail
      queryClient.invalidateQueries({ queryKey: ["formateur", "supports"] });
      queryClient.invalidateQueries({ queryKey: ["formateur", "supports", variables.supportId] });
      toast.success("Support de cours mis Ã  jour avec succÃ¨s");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de la mise Ã  jour"
      );
    },
  });
}

/**
 * Hook to delete a course material
 */
export function useDeleteSupport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (supportId: string) => {
      const response = await fetch(`/api/v1/formateur/supports/${supportId}`, {
        method: "DELETE",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete course material");
      }

      return await response.json();
    },
    onSuccess: () => {
      // Invalidate supports list
      queryClient.invalidateQueries({ queryKey: ["formateur", "supports"] });
      toast.success("Support de cours supprimÃ© avec succÃ¨s");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de la suppression"
      );
    },
  });
}

