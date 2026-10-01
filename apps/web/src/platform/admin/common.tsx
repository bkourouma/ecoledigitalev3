"use client";

import { useCallback } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { EmptyState, ErrorState } from "@ecoledigitale/ui";
import { ApiError } from "@/platform/api/errors";
import { isUnavailableEndpoint } from "./errors";
import { useErrorMessage } from "./use-error-message";

/** Date/heure localisée (fuseau du fournisseur i18n, `Africa/Abidjan`) ; `—` si absente ou illisible. */
export function useDateTime(): (iso: string | null | undefined, style?: "short" | "long") => string {
  const format = useFormatter();
  const t = useTranslations("ui");
  return useCallback(
    (iso, style = "short") => {
      if (!iso) return t("dash");
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return t("dash");
      return format.dateTime(date, style === "long" ? { dateStyle: "long", timeStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" });
    },
    [format, t],
  );
}

/** Date seule (échéances, validités). */
export function useDateOnly(): (iso: string | null | undefined) => string {
  const format = useFormatter();
  const t = useTranslations("ui");
  return useCallback(
    (iso) => {
      if (!iso) return t("dash");
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? t("dash") : format.dateTime(date, { dateStyle: "medium" });
    },
    [format, t],
  );
}

export interface ApiErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  /** Un endpoint absent (404/501) est présenté comme « section pas encore disponible » plutôt que comme une panne. */
  treatMissingAsUnavailable?: boolean;
}

/** Erreur d'API présentée de façon cohérente : message localisé, référence de support, bouton « Réessayer ». */
export function ApiErrorState({ error, onRetry, title, treatMissingAsUnavailable }: ApiErrorStateProps) {
  const message = useErrorMessage();
  const t = useTranslations("ui");
  if (treatMissingAsUnavailable && isUnavailableEndpoint(error)) {
    return <EmptyState title={t("notAvailableTitle")} description={t("notAvailableBody")} />;
  }
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <ErrorState
      title={title}
      message={message(error)}
      reference={requestId ? t("reference", { id: requestId }) : undefined}
      onRetry={onRetry}
      retryLabel={t("retry")}
    />
  );
}
