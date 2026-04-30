"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FormationListQuery,
  FormationListResponse,
  FormationDetailResponse,
  SessionsResponse,
  SimilarFormationsResponse,
  ThemesResponse,
  StatsResponse,
} from "@ecoledigitale/contracts";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Hook to fetch list of professional training programs with search, filters, sorting, and pagination
 */
export function useFormations(query: FormationListQuery = {}) {
  return useQuery<FormationListResponse>({
    queryKey: ["formations-pro", query],
    queryFn: async () => {
      const queryString = buildQueryString(query);
      // Use Next.js proxy route instead of direct backend call
      const url = queryString 
        ? `/api/v1/formations-pro${queryString}`
        : `/api/v1/formations-pro`;
      const response = await fetch(url, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        let errorMessage = "Failed to fetch formations";
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      return response.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    retry: (failureCount, error: any) => {
      // Don't retry on 503 (Service Unavailable) - backend is down
      if (error?.message?.includes("Failed to connect") || failureCount >= 2) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Hook to fetch training program detail by slug
 */
export function useFormationDetail(slug: string | null) {
  return useQuery<FormationDetailResponse>({
    queryKey: ["formation-pro", slug],
    queryFn: async () => {
      if (!slug) throw new Error("Slug is required");

      // Use Next.js proxy route instead of direct backend call
      const response = await fetch(`/api/v1/formations-pro/${slug}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        // Try to parse error response
        let errorMessage = "Failed to fetch formation detail";
        let errorData: any = null;
        
        try {
          errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          // If JSON parsing fails, use status text
          errorMessage = response.statusText || errorMessage;
        }

        // Create a more descriptive error for 404
        if (response.status === 404) {
          const notFoundError = new Error("Training program not found or inactive");
          (notFoundError as any).status = 404;
          (notFoundError as any).code = "NOT_FOUND";
          (notFoundError as any).originalMessage = errorMessage;
          throw notFoundError;
        }

        // For other errors, include status code
        const error = new Error(errorMessage);
        (error as any).status = response.status;
        (error as any).originalData = errorData;
        throw error;
      }

      return response.json();
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000, // 5 minutes cache
    retry: (failureCount, error: any) => {
      // Don't retry on 404 errors
      if (error?.status === 404) {
        return false;
      }
      // Retry up to 2 times for other errors
      return failureCount < 2;
    },
  });
}

/**
 * Hook to fetch training sessions for a specific formation
 */
export function useFormationSessions(formationId: string | null, limit: number = 50) {
  return useQuery<SessionsResponse>({
    queryKey: ["formation-pro-sessions", formationId, limit],
    queryFn: async () => {
      if (!formationId) throw new Error("Formation ID is required");

      // Use Next.js proxy route instead of direct backend call
      const response = await fetch(
        `/api/v1/formations-pro/${formationId}/sessions?limit=${limit}`,
        {
          headers: createApiHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch sessions");
      }

      return response.json();
    },
    enabled: !!formationId,
    staleTime: 2 * 60 * 1000, // 2 minutes cache (sessions change more frequently)
  });
}

/**
 * Hook to fetch similar training recommendations
 */
export function useSimilarFormations(formationId: string | null) {
  return useQuery<SimilarFormationsResponse>({
    queryKey: ["formation-pro-similar", formationId],
    queryFn: async () => {
      if (!formationId) throw new Error("Formation ID is required");

      // Use Next.js proxy route instead of direct backend call
      const response = await fetch(
        `/api/v1/formations-pro/${formationId}/similaires`,
        {
          headers: createApiHeaders(),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch similar formations");
      }

      return response.json();
    },
    enabled: !!formationId,
    staleTime: 10 * 60 * 1000, // 10 minutes cache (recommendations don't change often)
  });
}

/**
 * Hook to fetch available themes for filtering
 */
export function useThemes() {
  return useQuery<ThemesResponse>({
    queryKey: ["formation-pro-themes"],
    queryFn: async () => {
      // Use Next.js proxy route instead of direct backend call
      const response = await fetch(`/api/v1/formations-pro/themes`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        let errorMessage = "Failed to fetch themes";
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      return response.json();
    },
    staleTime: 30 * 60 * 1000, // 30 minutes cache (themes don't change often)
    retry: (failureCount, error: any) => {
      // Don't retry on 503 (Service Unavailable) - backend is down
      if (error?.message?.includes("Failed to connect") || failureCount >= 2) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Hook to fetch filter statistics
 */
export function useFormationStats() {
  return useQuery<StatsResponse>({
    queryKey: ["formation-pro-stats"],
    queryFn: async () => {
      // Use Next.js proxy route instead of direct backend call
      const response = await fetch(`/api/v1/formations-pro/stats`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        let errorMessage = "Failed to fetch statistics";
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      return response.json();
    },
    staleTime: 30 * 60 * 1000, // 30 minutes cache (stats don't change often)
    retry: (failureCount, error: any) => {
      // Don't retry on 503 (Service Unavailable) - backend is down
      if (error?.message?.includes("Failed to connect") || failureCount >= 2) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Hook to create a new training session for a formation
 */
export function useCreateFormationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      formationId,
      data,
    }: {
      formationId: string;
      data: {
        code_session?: string;
        date_debut: string;
        date_fin: string;
        horaires?: string;
        mode_formation: "presential" | "remote" | "hybrid" | "elearning" | "presentiel" | "distanciel" | "hybride";
        lieu?: string;
        lien_visio?: string;
        places_totales: number;
        prix_ht?: number | null;
        prix_ttc?: number | null;
        notes_internes?: string;
      };
    }) => {
      const response = await fetch(`/api/v1/formations-pro/${formationId}/sessions`, {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || "Erreur lors de la création de la session");
      }

      return response.json();
    },
    onSuccess: async (_, variables) => {
      // Invalider les queries de sessions pour cette formation
      await queryClient.invalidateQueries({
        queryKey: ["formation-pro-sessions", variables.formationId],
        exact: false,
      });
      
      // Invalider aussi la query de détail de la formation pour rafraîchir les sessions affichées
      await queryClient.invalidateQueries({
        queryKey: ["formation-pro"],
        exact: false,
      });
      
      // Invalider la liste des formations pour mettre à jour les prochaines sessions
      await queryClient.invalidateQueries({
        queryKey: ["formations-pro"],
        exact: false,
      });
    },
  });
}

/**
 * Hook to update an existing training session
 */
export function useUpdateFormationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      formationId,
      sessionId,
      data,
    }: {
      formationId: string;
      sessionId: string;
      data: {
        code_session?: string;
        date_debut?: string;
        date_fin?: string;
        horaires?: string;
        mode_formation?: "presential" | "remote" | "hybrid" | "elearning" | "presentiel" | "distanciel" | "hybride";
        lieu?: string | null;
        lien_visio?: string | null;
        places_totales?: number;
        prix_ht?: number | null;
        prix_ttc?: number | null;
        notes_internes?: string | null;
        statut?: "planifiee" | "ouverte" | "complete" | "en_cours" | "terminee" | "annulee";
      };
    }) => {
      const response = await fetch(`/api/v1/formations-pro/${formationId}/sessions/${sessionId}`, {
        method: "PUT",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || "Erreur lors de la mise à jour de la session");
      }

      return response.json();
    },
    onSuccess: async (_, variables) => {
      // Invalider les queries de sessions pour cette formation
      await queryClient.invalidateQueries({
        queryKey: ["formation-pro-sessions", variables.formationId],
        exact: false,
      });
      
      // Invalider aussi la query de détail de la formation pour rafraîchir les sessions affichées
      await queryClient.invalidateQueries({
        queryKey: ["formation-pro"],
        exact: false,
      });
      
      // Invalider la liste des formations pour mettre à jour les prochaines sessions
      await queryClient.invalidateQueries({
        queryKey: ["formations-pro"],
        exact: false,
      });
    },
  });
}

/**
 * Hook to delete a training session
 */
export function useDeleteFormationSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      formationId,
      sessionId,
    }: {
      formationId: string;
      sessionId: string;
    }) => {
      const response = await fetch(`/api/v1/formations-pro/${formationId}/sessions/${sessionId}`, {
        method: "DELETE",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || "Erreur lors de la suppression de la session");
      }

      return response.json();
    },
    onSuccess: async (_, variables) => {
      // Invalider les queries de sessions pour cette formation
      await queryClient.invalidateQueries({
        queryKey: ["formation-pro-sessions", variables.formationId],
        exact: false,
      });
      
      // Invalider aussi la query de détail de la formation pour rafraîchir les sessions affichées
      await queryClient.invalidateQueries({
        queryKey: ["formation-pro"],
        exact: false,
      });
      
      // Invalider la liste des formations pour mettre à jour les prochaines sessions
      await queryClient.invalidateQueries({
        queryKey: ["formations-pro"],
        exact: false,
      });
    },
  });
}

/**
 * Hook to delete a formation
 */
export function useDeleteFormation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formationId: string) => {
      const response = await fetch(`/api/v1/formations-pro/${formationId}`, {
        method: "DELETE",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        let errorData: any;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP ${response.status}`, message: response.statusText };
        }
        
        // Create an error object with more details
        const error = new Error(errorData.message || errorData.error || "Erreur lors de la suppression de la formation");
        (error as any).error = errorData.error;
        (error as any).status = response.status;
        (error as any).data = errorData;
        throw error;
      }

      return response.json();
    },
    onSuccess: async () => {
      // Invalider la liste des formations
      await queryClient.invalidateQueries({
        queryKey: ["formations-pro"],
        exact: false,
      });
    },
  });
}

/**
 * Function to download training program PDF
 */
export async function downloadFormationPDF(formationId: string, slug: string): Promise<void> {
  try {
    // Use Next.js proxy route instead of direct backend call
    const response = await fetch(`/api/v1/formations-pro/${formationId}/programme-pdf`, {
      headers: createApiHeaders(),
    });

    // Check content type first
    const contentType = response.headers.get('content-type') || '';
    
    if (!response.ok) {
      if (response.status === 503) {
        throw new Error("PDF generation is taking longer than expected. Please try again later.");
      }
      
      // Try to parse error as JSON, but handle cases where it might not be JSON
      let errorMessage = "Failed to generate PDF";
      
      if (contentType.includes('application/json')) {
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
      } else {
        try {
          const text = await response.text();
          errorMessage = text || response.statusText || errorMessage;
        } catch {
          errorMessage = response.statusText || errorMessage;
        }
      }
      
      throw new Error(errorMessage);
    }

    // Check if response is actually a PDF
    if (!contentType.includes('application/pdf')) {
      // Clone the response to read it without consuming the original
      const clonedResponse = response.clone();
      const text = await clonedResponse.text();
      let errorData: any;
      try {
        errorData = JSON.parse(text);
      } catch {
        errorData = { message: text || "Invalid response format" };
      }
      throw new Error(errorData.message || "Server returned invalid response");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `programme-${slug}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error: any) {
    console.error("Error downloading PDF:", error);
    // Re-throw with a user-friendly message if it's not already an Error with message
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(error?.message || "Erreur lors du téléchargement du PDF");
  }
}

