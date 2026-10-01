"use client";

/**
 * Menu de navigation piloté par l'API (`GET /api/v1/rbac/me/navigation`).
 *
 * Tant que l'endpoint n'existe pas, échoue ou renvoie un menu vide, `source` vaut `"legacy"` : l'appelant
 * garde alors le Sidebar historique, dont le comportement est inchangé. Aucune requête n'est émise quand
 * `enabled` est faux (drapeau `NEXT_PUBLIC_PLATFORM_NAV` éteint).
 */

import { platformHooks } from "@/platform/api/default-client";
import type { QueryHooks } from "@/platform/api/hooks";
import { NAVIGATION_ENDPOINT, NavigationResponseSchema, sortMenuItems, type MenuItem, type MenuPortal } from "./types";

export interface UseNavigationOptions {
  /** Restreint le menu à un portail (paramètre `portal` de la requête et filtre local). */
  portal?: MenuPortal | null;
  /** Faux : aucune requête, `source: "legacy"`. */
  enabled?: boolean;
}

export type NavigationSource = "api" | "legacy";

export interface NavigationState {
  items: MenuItem[];
  source: NavigationSource;
  isLoading: boolean;
  /** Vrai quand l'appel a échoué (endpoint absent, 401, réseau…) : le legacy prend le relais. */
  isUnavailable: boolean;
}

const TEN_MINUTES = 10 * 60 * 1000;

export function createUseNavigation(hooks: QueryHooks) {
  return function useNavigation(options: UseNavigationOptions = {}): NavigationState {
    const enabled = options.enabled ?? true;
    const portal = options.portal ?? undefined;
    const query = hooks.useApiQuery<MenuItem[]>(["rbac", "me", "navigation", portal ?? "all"], NAVIGATION_ENDPOINT, {
      query: portal ? { portal } : undefined,
      schema: NavigationResponseSchema,
      enabled,
      staleTime: TEN_MINUTES,
      retry: false,
      refetchOnWindowFocus: false,
    });

    if (!enabled) return { items: [], source: "legacy", isLoading: false, isUnavailable: false };

    const raw = query.data ?? [];
    const items = sortMenuItems(portal ? raw.filter((item) => item.portal === portal) : raw);
    return {
      items,
      source: items.length > 0 ? "api" : "legacy",
      isLoading: query.isPending && query.fetchStatus !== "idle",
      isUnavailable: query.isError,
    };
  };
}

export const useNavigation = createUseNavigation(platformHooks);
