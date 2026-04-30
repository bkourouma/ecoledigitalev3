/**
 * use-formateur-sessions.ts
 * 
 * React hooks for trainer session management
 * Uses TanStack Query for data fetching and caching
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SessionListQuerySchema,
  SessionDetailResponseSchema,
  InscritsResponseSchema,
  UpdateSessionNotesSchema,
  SessionNotesResponseSchema,
} from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import { z } from "zod";
import { toast } from "sonner";

type SessionListQuery = z.infer<typeof SessionListQuerySchema>;

/**
 * Hook to fetch trainer's assigned sessions list
 */
export function useFormateurSessions(query: SessionListQuery) {
  return useQuery({
    queryKey: ["formateur", "sessions", query],
    queryFn: async () => {
      const queryString = buildQueryString(query as any);
      const response = await fetch(`/api/v1/formateur/sessions${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch sessions");
      }

      const rawData = await response.json();
      return rawData;
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to fetch detailed session information
 */
export function useFormateurSessionDetail(sessionId: string | null) {
  return useQuery({
    queryKey: ["formateur", "sessions", sessionId],
    queryFn: async () => {
      if (!sessionId) return null;

      const response = await fetch(`/api/v1/formateur/sessions/${sessionId}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch session details");
      }

      const rawData = await response.json();
      return SessionDetailResponseSchema.parse(rawData);
    },
    enabled: !!sessionId,
    staleTime: 60000, // Cache for 1 minute
  });
}

/**
 * Hook to fetch enrolled learners for a session
 */
export function useFormateurSessionInscrits(sessionId: string | null) {
  return useQuery({
    queryKey: ["formateur", "sessions", sessionId, "inscrits"],
    queryFn: async () => {
      if (!sessionId) return null;

      const response = await fetch(`/api/v1/formateur/sessions/${sessionId}/inscrits`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch enrolled learners");
      }

      const rawData = await response.json();
      return InscritsResponseSchema.parse(rawData);
    },
    enabled: !!sessionId,
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to update session notes
 */
export function useUpdateSessionNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      notes,
    }: {
      sessionId: string;
      notes: string;
    }) => {
      const validated = UpdateSessionNotesSchema.parse({ notes });
      const response = await fetch(`/api/v1/formateur/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validated),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update session notes");
      }

      const rawData = await response.json();
      return SessionNotesResponseSchema.parse(rawData);
    },
    onSuccess: (data, variables) => {
      // Invalidate session detail query
      queryClient.invalidateQueries({ queryKey: ["formateur", "sessions", variables.sessionId] });
      toast.success("Notes enregistrées avec succès");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de l'enregistrement des notes"
      );
    },
  });
}
