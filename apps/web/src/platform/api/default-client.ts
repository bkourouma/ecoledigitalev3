"use client";

/**
 * Client API et hooks par défaut du navigateur : même domaine (réécriture Next `/api/v1/*`), jeton du
 * stockage JWT historique, tenant résolu par `resolveBrowserTenant` (jeton > sous-domaine > env).
 */

import { getToken, getUserFromToken, isTokenExpired } from "@/lib/jwt-storage";
import { resolveBrowserTenant } from "@/platform/tenant/browser";
import { createApiClient } from "./client";
import { createQueryHooks } from "./hooks";

/** Jeton valide du stockage navigateur ; `null` côté serveur (SSR) où il n'existe pas (évite le bruit de jwt-storage). */
function currentToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = getToken();
  return token && !isTokenExpired(token) ? token : null;
}

export const platformApi = createApiClient({
  baseUrl: "",
  requireToken: true,
  getToken: currentToken,
  getTenant: () => {
    const token = currentToken();
    return resolveBrowserTenant(token ? getUserFromToken(token) : null)?.key ?? null;
  },
});

export const platformHooks = createQueryHooks(platformApi);
