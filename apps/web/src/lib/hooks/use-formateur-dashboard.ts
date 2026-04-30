/**
 * use-formateur-dashboard.ts
 * 
 * React hooks for trainer dashboard functionality
 * Uses TanStack Query for data fetching and caching
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { DashboardResponseSchema } from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders } from "@/lib/api-utils";

export function useFormateurDashboard() {
  return useQuery({
    queryKey: ["formateur", "dashboard"],
    queryFn: async () => {
      const response = await fetch("/api/v1/formateur/dashboard", {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch dashboard data");
      }

      const rawData = await response.json();
      return DashboardResponseSchema.parse(rawData);
    },
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}

