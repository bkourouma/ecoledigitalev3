"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import type { OwnerAssignableRolesResponse, OwnerUsersListResponse } from "@ecoledigitale/contracts";

export function useOwnerUsers() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<OwnerUsersListResponse>({
    queryKey: ["owner-users", tenantId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch("/api/v1/owner/users", { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Impossible de charger les utilisateurs");
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 60 * 1000,
  });
}

export function useOwnerAssignableRoles() {
  const { data: session } = useSession();
  const tenantId = (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";

  return useQuery<OwnerAssignableRolesResponse>({
    queryKey: ["owner-roles-assignable", tenantId],
    queryFn: async () => {
      const headers = createApiHeaders(session);
      const res = await fetch("/api/v1/owner/roles/assignable", { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Impossible de charger les rôles");
      }
      return res.json();
    },
    enabled: !!session && !!tenantId && tenantId !== "no-tenant",
    staleTime: 5 * 60 * 1000,
  });
}
