/**
 * Adaptateur SERVEUR (routes Next qui font proxy vers l'API) de `resolveTenant`.
 *
 * `tenantFallback(request)` remplace les anciens `|| 'imhotepacademy'` / `|| 'imhotepdata'` :
 * à utiliser en DERNIER recours, après l'en-tête X-Tenant reçu et la session, dans une chaîne `||`.
 * Il renvoie le tenant déduit de l'hôte de la requête (domaine personnalisé / sous-domaine), puis de
 * NEXT_PUBLIC_TENANT_SLUG, et sinon la chaîne vide : l'API répond alors « tenant requis » au lieu de
 * servir silencieusement les données d'un autre établissement.
 */

import { buildTenantConfig, resolveTenant, type ResolvedTenant, type TenantSessionLike } from "./resolve-tenant";

interface HeadersLike {
  get(name: string): string | null;
}

export interface RequestLike {
  headers: HeadersLike;
}

function hostOf(request?: RequestLike | null): string | null {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-host");
  const raw = forwarded ?? request.headers.get("host");
  // x-forwarded-host peut contenir une liste : on prend le premier hôte.
  return raw ? raw.split(",")[0].trim() : null;
}

export function resolveRequestTenant(
  request?: RequestLike | null,
  session?: TenantSessionLike | null,
): ResolvedTenant | null {
  return resolveTenant({
    session,
    hostname: hostOf(request),
    env: process.env.NEXT_PUBLIC_TENANT_SLUG ?? null,
    config: buildTenantConfig({
      baseDomains: process.env.NEXT_PUBLIC_TENANT_BASE_DOMAINS,
      customDomains: process.env.NEXT_PUBLIC_TENANT_CUSTOM_DOMAINS,
    }),
  });
}

export function tenantFallback(request?: RequestLike | null, session?: TenantSessionLike | null): string {
  return resolveRequestTenant(request, session)?.key ?? "";
}
