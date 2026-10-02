"use client";

import { useTranslations } from "next-intl";
import { ApiError, ClientErrorCode } from "@/platform/api/errors";
import { useDescribeError } from "@/platform/ui/errors";

/**
 * Message d'erreur des écrans « fournisseurs de paiement » : UN message français par code connu, jamais le message brut
 * du serveur (une erreur de configuration pourrait porter autre chose qu'un texte prévu pour l'écran). Pour les codes
 * inconnus : message générique selon le statut ; les erreurs réseau, délai, session et limitation passent par le message
 * technique commun du client.
 */
export function useProviderError(): (error: unknown) => string {
  const t = useTranslations("v2FinanceProviders");
  const describe = useDescribeError();
  return (error) => {
    if (error instanceof ApiError) {
      switch (error.code) {
        case "finance.secrets_unavailable":
          return t("errors.secretsUnavailable");
        case "finance.provider_sandbox_forbidden":
          return t("errors.sandboxForbidden");
        case "finance.provider_not_configured":
          return t("errors.notConfigured");
        case "finance.provider_test_throttled":
          return t("errors.testThrottled");
        case "finance.provider_disabled":
          return t("errors.disabled");
        case "finance.provider_unknown":
          return t("errors.unknownProvider");
        case "finance.provider_incomplete":
          return t("errors.incomplete");
        case ClientErrorCode.NETWORK:
        case ClientErrorCode.TIMEOUT:
        case ClientErrorCode.TENANT_UNKNOWN:
        case ClientErrorCode.RESPONSE_INVALID:
          return describe(error);
        default:
          break;
      }
      if (error.status === 401 || error.status === 429 || error.status >= 500) return describe(error);
      if (error.status === 403) return t("errors.forbidden");
      if (error.status >= 400) return t("errors.rejected");
    }
    return t("errors.generic");
  };
}
