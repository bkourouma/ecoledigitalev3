"use client";

/**
 * Messages d'erreur affichables. Les messages de l'API (`{ code, message }`) restent la source de vérité pour les
 * erreurs métier ; `errors.*` ne sert qu'aux erreurs techniques du client (réseau, délai, session).
 */

import { useTranslations } from "next-intl";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";

export type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

/** Fonction pure (testable sans React) : `t` est le traducteur de l'espace de noms `errors` et `common`. */
export function describeError(error: unknown, tErrors: TranslateFn, tCommon: TranslateFn): string {
  if (error instanceof ApiError) {
    if (error.code === ClientErrorCode.TENANT_UNKNOWN) return tCommon("tenantUnknown");
    if (error.code === ClientErrorCode.NETWORK) return tErrors("network");
    if (error.code === ClientErrorCode.TIMEOUT) return tErrors("timeout");
    if (error.code === ClientErrorCode.RESPONSE_INVALID) return tErrors("invalidResponse");
    if (error.status === 401) return tErrors("unauthorized");
    if (error.status === 429) return tErrors("rateLimited");
    // Les erreurs métier du serveur sont déjà en français et précises : on les affiche telles quelles.
    if (error.status >= 400 && error.status < 500 && error.message.trim() !== "") return error.message;
    if (error.status >= 500) return tErrors("generic");
    return error.message.trim() !== "" ? error.message : tErrors("generic");
  }
  return tErrors("generic");
}

export function useDescribeError(): (error: unknown) => string {
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  return (error) => describeError(error, tErrors as unknown as TranslateFn, tCommon as unknown as TranslateFn);
}

/** `true` pour une erreur qui signifie « fonction non incluse dans l'offre » (403 du garde d'entitlement). */
export function isFeatureUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && /feature_not_available|FEATURE_DISABLED/i.test(error.code);
}
