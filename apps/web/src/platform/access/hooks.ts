/**
 * `usePermission(key)` / `useFeature(key)` : lisent `GET /api/v1/rbac/me/permissions` et
 * `GET /api/v1/entitlements/me` (une requête chacune, mise en cache et partagée par tous les composants).
 *
 * Fail-closed : tant que la réponse n'est pas là, ou si l'endpoint est indisponible, `allowed` vaut `false`
 * (et `isUnavailable` permet à l'UI de distinguer « refusé » de « inconnu »). Ces hooks servent à AFFICHER
 * ou masquer ; l'API reste la barrière réelle.
 */

import { hasPermission } from "@/platform/auth/policies";
import type { QueryHooks } from "@/platform/api/hooks";
import {
  ENTITLEMENT_FEATURES_ENDPOINT,
  ENTITLEMENTS_ENDPOINT,
  MyEntitlementsSchema,
  MyFeaturesSchema,
  MyPermissionsSchema,
  PERMISSIONS_ENDPOINT,
  type MyEntitlements,
  type MyPermissions,
} from "./types";

export interface AccessState {
  allowed: boolean;
  isLoading: boolean;
  /** L'endpoint a échoué ou n'existe pas encore : `allowed` est alors un refus par défaut. */
  isUnavailable: boolean;
}

const FIVE_MINUTES = 5 * 60 * 1000;

export function createAccessHooks(hooks: QueryHooks) {
  function useMyPermissions() {
    return hooks.useApiQuery<MyPermissions>(["rbac", "me", "permissions"], PERMISSIONS_ENDPOINT, {
      schema: MyPermissionsSchema,
      staleTime: FIVE_MINUTES,
      retry: false,
      refetchOnWindowFocus: false,
    });
  }

  /**
   * Fonctionnalités actives de l'établissement. Lecture ouverte à tout membre (`/entitlements/me/features`) d'abord ; si ce point
   * d'API est absent ou refusé, repli sur l'abonnement complet (`/entitlements/me`, réservé à la direction). Les deux requêtes sont
   * mises en cache : un refus ne se répète pas à chaque page (le repli reste fermé : fonctionnalité inconnue = non active).
   */
  function useMyEntitlements() {
    const open = hooks.useApiQuery<MyEntitlements>(["entitlements", "me", "features"], ENTITLEMENT_FEATURES_ENDPOINT, {
      schema: MyFeaturesSchema,
      staleTime: FIVE_MINUTES,
      retry: false,
      refetchOnWindowFocus: false,
    });
    const full = hooks.useApiQuery<MyEntitlements>(["entitlements", "me"], ENTITLEMENTS_ENDPOINT, {
      schema: MyEntitlementsSchema,
      enabled: open.isError,
      staleTime: FIVE_MINUTES,
      retry: false,
      refetchOnWindowFocus: false,
    });
    return open.isError ? full : open;
  }

  function usePermission(key: string): AccessState {
    const query = useMyPermissions();
    return {
      allowed: query.data ? hasPermission(query.data.permissions, key) : false,
      isLoading: query.isPending && query.fetchStatus !== "idle",
      isUnavailable: query.isError,
    };
  }

  function useFeature(key: string): AccessState {
    const query = useMyEntitlements();
    return {
      allowed: query.data ? query.data.features.includes(key) : false,
      isLoading: query.isPending && query.fetchStatus !== "idle",
      isUnavailable: query.isError,
    };
  }

  return { useMyPermissions, useMyEntitlements, usePermission, useFeature };
}
