"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { createApiHeaders } from "@/lib/api-utils";
import {
  ADMIN_MENU_KEY_BY_HREF,
  type AdminManagedUser,
  type AdminMenuCatalogResponse,
  type AdminMyMenusResponse,
  type AdminRole,
  type AdminRolesListResponse,
  type AdminUsersListResponse,
} from "@ecoledigitale/contracts";

const BASE = "/api/v1/admin/access";

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { message?: unknown };
  const message =
    typeof body.message === "string"
      ? body.message
      : body.message
        ? JSON.stringify(body.message)
        : fallback;
  throw new Error(message);
}

function useTenantId(): string {
  const { data: session } = useSession();
  return (session as { tenantId?: string } | null)?.tenantId ?? "no-tenant";
}

export function useAdminMenuCatalog() {
  const { data: session } = useSession();
  const tenantId = useTenantId();

  return useQuery<AdminMenuCatalogResponse>({
    queryKey: ["admin-menu-catalog", tenantId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/menus/catalog`, { headers: createApiHeaders(session) });
      if (!res.ok) await readError(res, "Impossible de charger le catalogue des menus");
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    staleTime: 10 * 60 * 1000,
  });
}

export function useAdminRoles() {
  const { data: session } = useSession();
  const tenantId = useTenantId();

  return useQuery<AdminRolesListResponse>({
    queryKey: ["admin-roles", tenantId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/roles`, { headers: createApiHeaders(session) });
      if (!res.ok) await readError(res, "Impossible de charger les rôles");
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    staleTime: 30 * 1000,
  });
}

export function useCreateAdminRole() {
  const { data: session } = useSession();
  const tenantId = useTenantId();
  const queryClient = useQueryClient();

  return useMutation<AdminRole, Error, { name: string; menuKeys: string[] }>({
    mutationFn: async (input) => {
      const res = await fetch(`${BASE}/roles`, {
        method: "POST",
        headers: createApiHeaders(session),
        body: JSON.stringify(input),
      });
      if (!res.ok) await readError(res, "Création du rôle impossible");
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-roles", tenantId] });
    },
  });
}

export function useUpdateAdminRole() {
  const { data: session } = useSession();
  const tenantId = useTenantId();
  const queryClient = useQueryClient();

  return useMutation<
    AdminRole,
    Error,
    { id: string; name?: string; isActive?: boolean; menuKeys?: string[] }
  >({
    mutationFn: async ({ id, ...patch }) => {
      const res = await fetch(`${BASE}/roles/${id}`, {
        method: "PATCH",
        headers: createApiHeaders(session),
        body: JSON.stringify(patch),
      });
      if (!res.ok) await readError(res, "Mise à jour du rôle impossible");
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-roles", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-my-menus", tenantId] });
    },
  });
}

export function useDeleteAdminRole() {
  const { data: session } = useSession();
  const tenantId = useTenantId();
  const queryClient = useQueryClient();

  return useMutation<{ success: boolean }, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`${BASE}/roles/${id}`, {
        method: "DELETE",
        headers: createApiHeaders(session),
      });
      if (!res.ok) await readError(res, "Suppression impossible");
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-roles", tenantId] });
    },
  });
}

export function useAdminManagedUsers() {
  const { data: session } = useSession();
  const tenantId = useTenantId();

  return useQuery<AdminUsersListResponse>({
    queryKey: ["admin-managed-users", tenantId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/users`, { headers: createApiHeaders(session) });
      if (!res.ok) await readError(res, "Impossible de charger les utilisateurs");
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    staleTime: 30 * 1000,
  });
}

export function useCreateAdminUser() {
  const { data: session } = useSession();
  const tenantId = useTenantId();
  const queryClient = useQueryClient();

  return useMutation<
    AdminManagedUser,
    Error,
    { firstName: string; lastName: string; email: string; password: string; adminRoleId: string }
  >({
    mutationFn: async (input) => {
      const res = await fetch(`${BASE}/users`, {
        method: "POST",
        headers: createApiHeaders(session),
        body: JSON.stringify(input),
      });
      if (!res.ok) await readError(res, "Création de l'utilisateur impossible");
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-managed-users", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-roles", tenantId] });
    },
  });
}

export function useSetUserAdminRole() {
  const { data: session } = useSession();
  const tenantId = useTenantId();
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, { userId: string; adminRoleId: string | null }>({
    mutationFn: async ({ userId, adminRoleId }) => {
      const res = await fetch(`${BASE}/users/${userId}/admin-role`, {
        method: "PATCH",
        headers: createApiHeaders(session),
        body: JSON.stringify({ adminRoleId }),
      });
      if (!res.ok) await readError(res, "Affectation du rôle impossible");
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-managed-users", tenantId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-roles", tenantId] });
    },
  });
}

/**
 * Menus du sidebar administrateur autorisés pour l'utilisateur connecté.
 *
 * Tant que la requête n'a pas répondu — ou si elle échoue — on laisse tout
 * visible : un rôle personnalisé restreint l'affichage, il ne doit pas faire
 * clignoter le menu des comptes non concernés.
 */
export function useAdminMenuAccess() {
  const { data: session } = useSession();
  const tenantId = useTenantId();

  const query = useQuery<AdminMyMenusResponse>({
    queryKey: ["admin-my-menus", tenantId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/me/menus`, { headers: createApiHeaders(session) });
      if (!res.ok) await readError(res, "Impossible de charger vos permissions");
      return res.json();
    },
    enabled: !!session && tenantId !== "no-tenant",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return useMemo(() => {
    const data = query.data;
    const allowAll = !data || data.allowAll || query.isError;
    const allowed = new Set(data?.menuKeys ?? []);

    return {
      allowAll,
      adminRoleName: data?.adminRoleName ?? null,
      isLoading: query.isLoading,
      /** Autorise un menu à partir de sa clé de catalogue. */
      canSeeKey: (key: string) => allowAll || allowed.has(key),
      /**
       * Autorise une entrée du sidebar à partir de son `href`.
       * Un href absent du catalogue n'est pas administrable : il reste visible.
       */
      canSeeHref: (href: string) => {
        if (allowAll) return true;
        const key = ADMIN_MENU_KEY_BY_HREF[href];
        if (!key) return true;
        return allowed.has(key);
      },
    };
  }, [query.data, query.isError, query.isLoading]);
}
