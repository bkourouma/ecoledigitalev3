/**
 * useReporting Hook
 * 
 * React hooks for reporting and dashboard data
 * Uses TanStack Query for data fetching
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import {
  DashboardMetricsQuery,
  DashboardMetricsResponse,
  CAPrevisionnelQuery,
  CAPrevisionnelResponse,
  TauxConversionResponse,
  StatisticsQuery,
  StatisticsResponse,
} from "@ecoledigitale/contracts/src/reporting";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";

/**
 * Hook to fetch dashboard metrics
 */
export function useDashboardMetrics(query: DashboardMetricsQuery) {
  return useQuery<DashboardMetricsResponse>({
    queryKey: ["reporting", "dashboard", query],
    queryFn: async () => {
      const queryString = buildQueryString(query);
      const response = await fetch(`/api/v1/admin/reporting/dashboard?${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch dashboard metrics");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    staleTime: 60000, // Cache for 1 minute
  });
}

/**
 * Hook to fetch CA prévisionnel
 */
export function useCAPrevisionnel(query: CAPrevisionnelQuery) {
  return useQuery<CAPrevisionnelResponse>({
    queryKey: ["reporting", "ca-previsionnel", query],
    queryFn: async () => {
      const queryString = buildQueryString(query);
      const response = await fetch(`/api/v1/admin/reporting/ca-previsionnel?${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch CA prévisionnel");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    staleTime: 60000,
  });
}

/**
 * Hook to fetch conversion rates
 */
export function useTauxConversion() {
  return useQuery<TauxConversionResponse>({
    queryKey: ["reporting", "taux-conversion"],
    queryFn: async () => {
      const response = await fetch("/api/v1/admin/reporting/taux-conversion", {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch conversion rates");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    staleTime: 60000,
  });
}

/**
 * Hook to fetch statistics
 */
export function useStatistics(query: StatisticsQuery) {
  return useQuery<StatisticsResponse>({
    queryKey: ["reporting", "statistiques", query],
    queryFn: async () => {
      const queryString = buildQueryString(query);
      const response = await fetch(`/api/v1/admin/reporting/statistiques?${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch statistics");
      }

      const rawData = await response.json();
      return rawData.data;
    },
    staleTime: 60000,
  });
}
