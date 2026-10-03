"use client";

/**
 * Marque de l'établissement affichée dans l'en-tête des coques (nom, logo) : lisible par TOUT membre authentifié.
 *
 *   1. `GET /api/v1/tenancy/branding` (marque minimale, ouverte à tout membre) ;
 *   2. repli : le profil complet (`GET /api/v1/tenancy/profile`, permission `tenancy.institution.read`), demandé seulement si la
 *      marque minimale est indisponible ET que le compte détient cette permission (aucune requête condamnée à un 403) ;
 *   3. sinon : aucun nom, la coque affiche son libellé générique. Jamais d'erreur affichée pour un nom manquant.
 *
 * Le logo n'est repris que s'il s'agit d'une URL https ou d'un chemin interne (aucune chaîne libre n'atteint `src`).
 */

import { z } from "zod";
import { useMemo } from "react";
import { platformHooks } from "@/platform/api/default-client";
import { usePermission } from "@/platform/access";
import { useTenantProfile } from "@/platform/admin/tenancy/hooks";

export const TENANCY_BRANDING_ENDPOINT = "/api/v1/tenancy/branding";

export interface ShellBranding {
  name: string | null;
  logoUrl: string | null;
}

const Nullish = z.string().nullish();
const BrandingNestedSchema = z.object({ logoUrl: Nullish }).passthrough().nullish();

/** Forme tolérante : `{ name | displayName | tradeName | legalName, logoUrl, branding?: { logoUrl }, theme?: { logoUrl } }`. */
export const BrandingResponseSchema = z
  .object({
    name: Nullish,
    displayName: Nullish,
    tradeName: Nullish,
    legalName: Nullish,
    logoUrl: Nullish,
    branding: BrandingNestedSchema,
    theme: BrandingNestedSchema,
  })
  .passthrough()
  .transform((v): ShellBranding => normalizeBranding({ name: v.displayName ?? v.tradeName ?? v.name ?? v.legalName, logoUrl: v.logoUrl ?? v.branding?.logoUrl ?? v.theme?.logoUrl }));

const SAFE_LOGO = /^https:\/\/|^\/(?!\/)/;

export function normalizeBranding(input: { name?: string | null; logoUrl?: string | null }): ShellBranding {
  const name = typeof input.name === "string" && input.name.trim() !== "" ? input.name.trim() : null;
  const logoUrl = typeof input.logoUrl === "string" && SAFE_LOGO.test(input.logoUrl) ? input.logoUrl : null;
  return { name, logoUrl };
}

export function useShellBranding(): ShellBranding {
  const minimal = platformHooks.useApiQuery<ShellBranding>(["tenancy", "branding"], TENANCY_BRANDING_ENDPOINT, {
    schema: BrandingResponseSchema,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const canReadProfile = usePermission("tenancy.institution.read").allowed;
  // Le profil complet n'est interrogé que si la marque minimale a échoué et que le compte peut le lire.
  const profile = useTenantProfile({ enabled: minimal.isError && canReadProfile });
  return useMemo(() => {
    if (minimal.data && (minimal.data.name || minimal.data.logoUrl)) return minimal.data;
    if (profile.data) return normalizeBranding({ name: profile.data.tradeName ?? profile.data.legalName, logoUrl: profile.data.branding.logoUrl });
    return minimal.data ?? { name: null, logoUrl: null };
  }, [minimal.data, profile.data]);
}
