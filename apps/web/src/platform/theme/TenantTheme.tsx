"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { platformHooks } from "@/platform/api/default-client";
import type { QueryHooks } from "@/platform/api/hooks";
import { TENANCY_PROFILE_ENDPOINT, TenancyProfileSchema, buildBrandVariables, type BrandVariables, type TenancyProfile } from "./theme";

const TEN_MINUTES = 10 * 60 * 1000;

/** Pose (ou retire) les variables de marque sur un élément ; renvoie une fonction de nettoyage. */
export function applyBrandVariables(root: HTMLElement, variables: BrandVariables): () => void {
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  return () => {
    for (const name of Object.keys(variables)) root.style.removeProperty(name);
  };
}

/**
 * Applique le thème du tenant. Sans profil (endpoint absent, erreur, visiteur non connecté), ce sont les
 * valeurs par défaut EcoleDigitale qui sont posées. Ne rend rien ; ne touche pas à `[data-role]`.
 */
export function useTenantTheme(hooks: QueryHooks = platformHooks, authenticated = true): void {
  const query = hooks.useApiQuery<TenancyProfile>(["tenancy", "profile"], TENANCY_PROFILE_ENDPOINT, {
    schema: TenancyProfileSchema,
    enabled: authenticated,
    staleTime: TEN_MINUTES,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const profile = query.data;

  useEffect(() => applyBrandVariables(document.documentElement, buildBrandVariables(profile)), [profile]);
}

export function TenantTheme(): null {
  const { status } = useSession();
  // Visiteur non connecté : pas d'appel API (l'intercepteur redirigerait vers /login) -> thème par défaut.
  useTenantTheme(platformHooks, status === "authenticated");
  return null;
}
