/**
 * Branche `platformHooks` / `platformApi` (client du navigateur) sur un faux client de test.
 *
 * Usage dans un fichier de test :
 *
 *   vi.mock("@/platform/api/default-client", async () => (await import("@/platform/test/api-mock")).defaultClientModule);
 *   import { setTestApi } from "@/platform/test/api-mock";
 *   const api = setTestApi({ "GET /api/v1/academic/years": { items: [] } });
 *
 * `usePermission` / `useFeature` passent aussi par ce faux client : déclarer les routes
 * `GET /api/v1/rbac/me/permissions` et `GET /api/v1/entitlements/me/features` (voir `accessRoutes`).
 */

import type { ApiClient } from "@/platform/api/client";
import type { QueryHooks } from "@/platform/api/hooks";
import { createTestApi, type RouteHandler } from "./render";

let current: ReturnType<typeof createTestApi> | null = null;

export function setTestApi(routes: Record<string, RouteHandler | unknown>) {
  current = createTestApi(routes);
  return current;
}

function active() {
  if (!current) throw new Error("setTestApi() doit être appelé avant le rendu.");
  return current;
}

const delegatingHooks: QueryHooks = {
  get client() {
    return active().hooks.client;
  },
  queryKey: (...parts) => active().hooks.queryKey(...parts),
  useApiInfiniteQuery: (...args) => active().hooks.useApiInfiniteQuery(...args),
  useApiQuery: (...args) => active().hooks.useApiQuery(...args),
  useApiMutation: (...args) => active().hooks.useApiMutation(...args),
};

const delegatingClient = new Proxy({} as ApiClient, {
  get: (_target, property) => (active().client as unknown as Record<string | symbol, unknown>)[property],
});

export const defaultClientModule = { platformHooks: delegatingHooks, platformApi: delegatingClient };

/** Routes d'accès : permissions et fonctionnalités accordées à l'utilisateur de test. */
export function accessRoutes(permissions: string[], features: string[] = []): Record<string, unknown> {
  return {
    "GET /api/v1/rbac/me/permissions": { permissions },
    "GET /api/v1/entitlements/me/features": { features },
  };
}
