"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useFeature, usePermission } from "@/platform/access";
import { LoadingBlock, Notice } from "./states";

/**
 * Affiche `children` seulement si l'utilisateur détient la permission. Fail-closed : tant que la réponse n'est pas là ou
 * si l'endpoint est indisponible, rien n'est montré (ces hooks AFFICHENT ou masquent ; l'API reste la barrière).
 */
export function Can({ permission, children, fallback = null }: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  const { allowed } = usePermission(permission);
  return <>{allowed ? children : fallback}</>;
}

/** Bloc entier : message d'accès refusé explicite plutôt qu'un vide. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const t = useTranslations("errors");
  const { allowed, isLoading, isUnavailable } = usePermission(permission);
  if (isLoading) return <LoadingBlock />;
  if (!allowed) return <Notice kind="warning">{isUnavailable ? t("generic") : t("forbidden")}</Notice>;
  return <>{children}</>;
}

/** Fonctionnalité de l'offre (entitlement) : masquée ou remplacée quand elle n'est pas incluse. */
export function Feature({ feature, children, fallback = null }: { feature: string; children: ReactNode; fallback?: ReactNode }) {
  const { allowed } = useFeature(feature);
  return <>{allowed ? children : fallback}</>;
}

export function FeatureNotice({ children }: { children?: ReactNode }) {
  const t = useTranslations("errors");
  return <Notice kind="info">{children ?? t("unavailableFeature")}</Notice>;
}
