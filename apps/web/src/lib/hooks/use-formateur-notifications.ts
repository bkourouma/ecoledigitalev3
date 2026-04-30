/**
 * use-formateur-notifications.ts
 * 
 * React hooks for trainer notifications
 * Uses TanStack Query for data fetching and mutations
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  NotificationsQuerySchema,
  NotificationsResponseSchema,
  MarkNotificationReadResponseSchema,
} from "@ecoledigitale/contracts/src/formateurs";
import { createApiHeaders, buildQueryString } from "@/lib/api-utils";
import { toast } from "sonner";
import { z } from "zod";

type NotificationsQuery = z.infer<typeof NotificationsQuerySchema>;

/**
 * Hook to fetch trainer notifications
 */
export function useFormateurNotifications(query: NotificationsQuery = {}) {
  return useQuery({
    queryKey: ["formateur", "notifications", query],
    queryFn: async () => {
      const queryString = buildQueryString(query as any);
      const response = await fetch(`/api/v1/formateur/notifications${queryString}`, {
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to fetch notifications");
      }

      const rawData = await response.json();
      return NotificationsResponseSchema.parse(rawData);
    },
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Hook to mark notification as read
 */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await fetch(`/api/v1/formateur/notifications/${notificationId}/lire`, {
        method: "PATCH",
        headers: createApiHeaders(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to mark notification as read");
      }

      const rawData = await response.json();
      return MarkNotificationReadResponseSchema.parse(rawData);
    },
    onSuccess: () => {
      // Invalidate notifications queries
      queryClient.invalidateQueries({ queryKey: ["formateur", "notifications"] });
      queryClient.invalidateQueries({ queryKey: ["formateur", "dashboard"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Erreur lors de la mise à jour de la notification"
      );
    },
  });
}

