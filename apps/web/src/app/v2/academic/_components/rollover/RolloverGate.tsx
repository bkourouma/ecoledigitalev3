"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useFeature } from "@/platform/access";
import { FeatureNotice, RequirePermission } from "@/platform/ui/AccessGate";
import { LoadingBlock } from "@/platform/ui/states";

/**
 * Garde d'affichage de la reconduction : permission `academic.year.rollover` ET fonction `academic.rollover` de l'offre.
 * Les gardes serveur des pages et l'API restent la barrière ; si le droit d'offre est simplement illisible, l'écran
 * s'ouvre et l'API tranche.
 */
export function RolloverGate({ children }: { children: ReactNode }) {
  const t = useTranslations("v2Rollover");
  const feature = useFeature("academic.rollover");
  return (
    <RequirePermission permission="academic.year.rollover">
      {feature.isLoading ? <LoadingBlock /> : !feature.allowed && !feature.isUnavailable ? <FeatureNotice>{t("featureOff")}</FeatureNotice> : children}
    </RequirePermission>
  );
}
