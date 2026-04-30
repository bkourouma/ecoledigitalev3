/**
 * use-formateur-schedule.ts
 * 
 * React hooks for trainer schedule and unavailability management
 * Uses TanStack Query for data fetching and caching
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PlanningQuerySchema,
  PlanningResponseSchema,
  CreateIndisponibiliteSchema,
} from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import { z } from "zod";

type PlanningQuery = z.infer<typeof PlanningQuerySchema>;

/**
 * Hook to fetch trainer schedule (sessions and unavailability)
 */
export function useFormateurSchedule(query: PlanningQuery) {
  return useQuery({
    queryKey: ["formateur", "planning", query],
    queryFn: async () => {
      const queryString = buildQueryString(query as any);
      const response = await fetch(`/api/v1/formateur/planning${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch schedule");
      }

      const rawData = await response.json();
      return PlanningResponseSchema.parse(rawData);
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to fetch all unavailability periods
 */
export function useFormateurIndisponibilites() {
  return useQuery({
    queryKey: ["formateur", "disponibilites"],
    queryFn: async () => {
      const response = await fetch("/api/v1/formateur/disponibilites", {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch unavailability periods");
      }

      const rawData = await response.json();
      return rawData;
    },
  });
}

/**
 * Hook to create unavailability period
 */
export function useCreateIndisponibilite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: z.infer<typeof CreateIndisponibiliteSchema>) => {
      const validated = CreateIndisponibiliteSchema.parse(data);
      const response = await fetch("/api/v1/formateur/disponibilites", {
        method: "POST",
        headers: {
          ...createApiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validated),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create unavailability period");
      }

      return await response.json();
    },
    onSuccess: () => {
      // Invalidate schedule and unavailability queries
      queryClient.invalidateQueries({ queryKey: ["formateur", "planning"] });
      queryClient.invalidateQueries({ queryKey: ["formateur", "disponibilites"] });
    },
  });
}

/**
 * Hook to delete unavailability period
 */
export function useDeleteIndisponibilite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/v1/formateur/disponibilites/${id}`, {
        method: "DELETE",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete unavailability period");
      }

      return await response.json();
    },
    onSuccess: () => {
      // Invalidate schedule and unavailability queries
      queryClient.invalidateQueries({ queryKey: ["formateur", "planning"] });
      queryClient.invalidateQueries({ queryKey: ["formateur", "disponibilites"] });
    },
  });
}

