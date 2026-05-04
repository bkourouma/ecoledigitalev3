"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NotificationBell, type NotificationItem } from "@ecoledigitale/ui";

/**
 * Drop into the (dashboard) layout header. Authenticates via the next-auth session cookie
 * (handled automatically by the browser) — no token plumbing required.
 */
export function NotificationBellWidget() {
  const qc = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: ["apprenant-notifications", "unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/apprenant/notifications/unread-count");
      if (!res.ok) throw new Error("Failed to fetch unread count");
      const j = await res.json();
      return j?.data?.count ?? 0;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const listQuery = useQuery({
    queryKey: ["apprenant-notifications", "list"],
    queryFn: async (): Promise<NotificationItem[]> => {
      const res = await fetch("/api/apprenant/notifications?limit=20");
      if (!res.ok) throw new Error("Failed to fetch notifications");
      const j = await res.json();
      return j?.data ?? [];
    },
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/apprenant/notifications/${id}/read`, { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apprenant-notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/apprenant/notifications/read-all", { method: "POST" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apprenant-notifications"] });
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
