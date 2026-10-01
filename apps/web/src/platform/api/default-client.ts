"use client";

/**
 * Client API et hooks par défaut du navigateur : même domaine (réécriture Next `/api/v1/*`), jeton du
 * stockage JWT historique, tenant résolu par `resolveBrowserTenant` (jeton > sous-domaine > env).
 */

import { getToken, getUserFromToken, isTokenExpired } from "@/lib/jwt-storage";
import { resolveBrowserTenant } from "@/platform/tenant/browser";
import { createApiClient } from "./client";
import { createQueryHooks } from "./hooks";

export const platformApi = createApiClient({
  baseUrl: "",
  getToken: () => {
    const token = getToken();
    return token && !isTokenExpired(token) ? token : null;
  },
  getTenant: () => {
    const token = getToken();
    const claims = token && !isTokenExpired(token) ? getUserFromToken(token) : null;
    return resolveBrowserTenant(claims)?.key ?? null;
  },
});

export const platformHooks = createQueryHooks(platformApi);
