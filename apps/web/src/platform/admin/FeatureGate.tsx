"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { EmptyState, LoadingState } from "@ecoledigitale/ui";
import { useFeature } from "@/platform/access";

/**
 * Affiche `children` seulement si la fonctionnalité fait partie de l'offre du tenant (`GET /entitlements/me`).
 * Si le service de droits est injoignable (`isUnavailable`), on n'invente pas un refus : les enfants s'affichent et
 * l'API (`requireFeature`) reste la barrière réelle. Ce composant sert à EXPLIQUER, pas à protéger.
 */
export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const state = useFeature(feature);
  const t = useTranslations("errors");
  const tu = useTranslations("ui");
  if (state.isLoading) return <LoadingState label={tu("loading")} rows={2} />;
  if (!state.allowed && !state.isUnavailable) return <EmptyState title={t("unavailableFeature")} />;
  return <>{children}</>;
}
