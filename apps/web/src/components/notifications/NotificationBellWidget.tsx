"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  NotificationBell,
  type NotificationItem,
} from "@ecoledigitale/ui";

/**
 * Live data wrapper for the shared <NotificationBell> presentation component.
 * Drop into the persistent header (apps/web/src/components/layout/Header.tsx).
 *
 * - Polls /api/v1/notifications-inbox/unread-count every 30s
 * - Fetches the first page of /api/v1/notifications-inbox on demand
 * - Mutations invalidate both queries
 */
export function NotificationBellWidget() {
  const qc = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: ["notifications-inbox", "unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/v1/notifications-inbox/unread-count");
      if (!res.ok) throw new Error("Failed to fetch unread count");
      const j = await res.json();
      return j?.data?.count ?? 0;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const listQuery = useQuery({
    queryKey: ["notifications-inbox", "list"],
    queryFn: async (): Promise<NotificationItem[]> => {
      const res = await fetch("/api/v1/notifications-inbox?limit=20");
      if (!res.ok) throw new Error("Failed to fetch notifications");
      const j = await res.json();
      return j?.data ?? [];
    },
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/v1/notifications-inbox/${id}/read`, { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-inbox"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/v1/notifications-inbox/read-all", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-inbox"] });
    },
  });

  return (
    <NotificationBell
      notifications={listQuery.data ?? []}
      unreadCount={unreadQuery.data ?? 0}
      loading={listQuery.isFetching}
      onMarkRead={(id) => markRead.mutateAsync(id)}
      onMarkAllRead={() => markAllRead.mutateAsync()}
      locale="fr-FR"
    />
  );
}
