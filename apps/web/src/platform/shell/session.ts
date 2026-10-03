"use client";

/**
 * Accès tolérant à la session NextAuth pour les coques : jamais d'exception sans `SessionProvider` (tests, rendu isolé), et les
 * actions « changer de rôle » / « changer d'établissement » du module IAM (`useSession().update`, voir `iam-token.ts`).
 */

import { useCallback, useContext, useState } from "react";
import { getSession, SessionContext, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { saveToken } from "@/lib/jwt-storage";
import { routeForRole } from "@/lib/role-landing";
import { purgeOfflineDataBestEffort } from "@/platform/offline/purge";
import { isAuthV2 } from "@/platform/auth/iam-config";
import { explainIamCode } from "@/platform/auth/ui/iam-api";

export interface ShellSessionView {
  status: "loading" | "authenticated" | "unauthenticated" | "unknown";
  name: string | null;
  email: string | null;
  activeRole: string | null;
  roles: string[];
  tenantId: string | null;
  tenantSlug: string | null;
  tenants: Array<{ id: string; slug: string; name: string }>;
}

interface RawSession {
  user?: { name?: string | null; email?: string | null } | null;
  activeRole?: string;
  roles?: string[];
  availableRoles?: string[];
  tenantId?: string;
  tenantSlug?: string;
  tenants?: Array<{ id: string; slug: string; name: string }>;
}

export function useShellSession(): ShellSessionView {
  const ctx = useContext(SessionContext) as { data?: unknown; status?: ShellSessionView["status"] } | undefined;
  const raw = (ctx?.data ?? null) as RawSession | null;
  const roles = raw?.availableRoles ?? raw?.roles ?? [];
  return {
    status: ctx?.status ?? "unknown",
    name: raw?.user?.name ?? null,
    email: raw?.user?.email ?? null,
    activeRole: raw?.activeRole ?? roles[0] ?? null,
    roles: [...new Set(roles)],
    tenantId: raw?.tenantId ?? null,
    tenantSlug: raw?.tenantSlug ?? null,
    tenants: raw?.tenants ?? [],
  };
}

/** Déconnexion : purge des données hors ligne de l'appareil puis fermeture de la session. */
export function signOutEverywhere(): Promise<unknown> {
  return purgeOfflineDataBestEffort().then(() => signOut({ callbackUrl: "/login" }));
}

type UpdateFn = (data?: unknown) => Promise<unknown>;

/**
 * Changement de rôle actif / d'établissement. Une nouvelle session IAM est ouverte (l'ancienne est révoquée), puis la page
 * d'atterrissage du nouveau rôle s'ouvre et les composants serveur sont rechargés (la coque est choisie selon le nouveau rôle).
 * Disponible avec l'authentification V2 seulement ; sinon `available` est faux et la coque n'affiche aucune action.
 */
export function useSessionSwitch() {
  const router = useRouter();
  const ctx = useContext(SessionContext) as { update?: UpdateFn } | undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = isAuthV2() && typeof ctx?.update === "function";

  const run = useCallback(
    async (key: string, payload: Record<string, string>) => {
      if (!ctx?.update) return;
      setBusy(key);
      setError(null);
      try {
        const updated = (await ctx.update(payload)) as { iamError?: { code: string; retryAfterSec?: number | null }; iamPending?: unknown } | null | undefined;
        if (updated?.iamError) {
          const message = explainIamCode(updated.iamError.code, updated.iamError.retryAfterSec);
          await ctx.update({ action: "clear-error" });
          setError(message);
          return;
        }
        // Établissement protégé par la vérification en deux étapes : l'écran de choix d'établissement la demande.
        if (updated?.iamPending) {
          router.push("/v2/account/tenants");
          return;
        }
        const fresh = (await getSession()) as { jwtToken?: string; activeRole?: string; requiresRoleSelection?: boolean } | null;
        if (fresh?.jwtToken) saveToken(fresh.jwtToken);
        router.replace(fresh?.requiresRoleSelection ? "/select-role" : routeForRole(fresh?.activeRole ?? payload.activeRole));
        router.refresh();
      } finally {
        setBusy(null);
      }
    },
    [ctx, router],
  );

  return {
    available,
    busy,
    error,
    switchRole: (role: string) => run(`role:${role}`, { action: "switch-role", activeRole: role }),
    switchTenant: (tenantId: string) => run(`tenant:${tenantId}`, { action: "switch-tenant", tenantId }),
  };
}
