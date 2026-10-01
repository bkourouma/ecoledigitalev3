"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { errorMessageSpec } from "./errors";

/**
 * Renvoie `(error) => string` : message localisé de l'erreur. Les clés viennent de `errors.*`, `common.*` et
 * `apiErrors.*` (catalogue `messages/fr-CI.json`) ; le message de l'API est repris tel quel pour les erreurs
 * métier non couvertes.
 */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations();
  return useCallback(
    (error: unknown) => {
      const spec = errorMessageSpec(error);
      if (spec.raw && !spec.key.startsWith("apiErrors.")) return spec.raw;
      if (spec.key.startsWith("apiErrors.") && !t.has(spec.key as never)) return spec.raw ?? t("errors.generic");
      return t(spec.key as never, spec.values as never);
    },
    [t],
  );
}
