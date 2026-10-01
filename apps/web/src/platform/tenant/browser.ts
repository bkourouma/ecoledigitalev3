/**
 * Adaptateur NAVIGATEUR de `resolveTenant` : lit window.location, le choix super-admin et les variables
 * `NEXT_PUBLIC_*`. Sûr en SSR (renvoie alors la résolution sans nom d'hôte).
 */

import {
  buildTenantConfig,
  requireTenant,
  resolveTenant,
  type ResolvedTenant,
  type TenantResolverConfig,
  type TenantSessionLike,
} from "./resolve-tenant";

/** Les variables NEXT_PUBLIC_* doivent être référencées littéralement pour être injectées au build. */
export function readPublicTenantEnv(): { env: string | null; config: TenantResolverConfig } {
  return {
    env: process.env.NEXT_PUBLIC_TENANT_SLUG ?? null,
    config: buildTenantConfig({
      baseDomains: process.env.NEXT_PUBLIC_TENANT_BASE_DOMAINS,
      customDomains: process.env.NEXT_PUBLIC_TENANT_CUSTOM_DOMAINS,
    }),
  };
}

function readSuperAdminSelection(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem("superAdminSelectedTenant") : null;
  } catch {
    return null;
  }
}

export function resolveBrowserTenant(session?: TenantSessionLike | null): ResolvedTenant | null {
  const { env, config } = readPublicTenantEnv();
  return resolveTenant({
    override: readSuperAdminSelection(),
    session,
    hostname: typeof window !== "undefined" ? window.location.hostname : null,
    env,
    config,
  });
}

/** Comme `resolveBrowserTenant` mais lève `TenantUnknownError` quand le tenant est inconnu. */
export function requireBrowserTenant(session?: TenantSessionLike | null): ResolvedTenant {
  const { env, config } = readPublicTenantEnv();
  return requireTenant({
    override: readSuperAdminSelection(),
    session,
    hostname: typeof window !== "undefined" ? window.location.hostname : null,
    env,
    config,
  });
}
