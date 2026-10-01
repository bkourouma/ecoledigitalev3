"use client";

/**
 * Client API de la console plateforme (opérateur super-admin).
 *
 * L'authentification de l'opérateur est SÉPARÉE de celle des tenants : jeton `superAdminToken` du stockage local
 * (posé par `POST /api/v1/super-admin/auth/login`), jamais le jeton NextAuth. Les routes `/api/v1/platform/*` ne
 * sont pas rattachées à un tenant : client `tenantless` (pas d'en-tête `X-Tenant`, clés de cache `["api","platform",…]`).
 */

import { createApiClient, type ApiClient } from "@/platform/api/client";
import { createQueryHooks } from "@/platform/api/hooks";

export const OPERATOR_TOKEN_KEY = "superAdminToken";
export const OPERATOR_EMAIL_KEY = "superAdminEmail";
export const OPERATOR_LOGIN_PATH = "/v2/platform/login";
export const OPERATOR_HOME_PATH = "/v2/platform/tenants";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Décode la date d'expiration (`exp`, secondes) d'un JWT ; `null` si illisible. */
export function tokenExpiry(token: string): number | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function getOperatorToken(): string | null {
  const token = storage()?.getItem(OPERATOR_TOKEN_KEY) ?? null;
  if (!token) return null;
  const exp = tokenExpiry(token);
  return exp !== null && exp <= Date.now() ? null : token;
}

export function getOperatorEmail(): string | null {
  return storage()?.getItem(OPERATOR_EMAIL_KEY) ?? null;
}

export function saveOperatorSession(token: string, email: string): void {
  const s = storage();
  s?.setItem(OPERATOR_TOKEN_KEY, token);
  s?.setItem(OPERATOR_EMAIL_KEY, email);
}

export function clearOperatorSession(): void {
  const s = storage();
  s?.removeItem(OPERATOR_TOKEN_KEY);
  s?.removeItem(OPERATOR_EMAIL_KEY);
  s?.removeItem("superAdminSelectedTenant");
}

export function createOperatorClient(overrides: Partial<Parameters<typeof createApiClient>[0]> = {}): ApiClient {
  return createApiClient({
    baseUrl: "",
    tenantless: true,
    requireToken: true,
    getToken: getOperatorToken,
    onUnauthorized: () => {
      clearOperatorSession();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith(OPERATOR_LOGIN_PATH)) {
        window.location.assign(OPERATOR_LOGIN_PATH);
      }
    },
    ...overrides,
  });
}

export const operatorApi = createOperatorClient();
export const operatorHooks = createQueryHooks(operatorApi);
