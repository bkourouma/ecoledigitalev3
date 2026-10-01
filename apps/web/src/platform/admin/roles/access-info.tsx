"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Notice } from "@ecoledigitale/ui";
import { useMyPermissions } from "@/platform/access";

/** Permissions que l'utilisateur détient (clés) ; `null` tant qu'elles sont inconnues (aucune pré-vérification d'anti-escalade). */
export function useHeldPermissions(): ReadonlySet<string> | null {
  const query = useMyPermissions();
  return useMemo(() => (query.data ? new Set(query.data.permissions) : null), [query.data]);
}

/**
 * La gestion des rôles et des attributions est une permission SENSIBLE : sans session MFA le serveur la refuse
 * (`rbac.mfa_required`). On le dit avant l'erreur quand l'API de permissions nous l'indique (`requiresMfa`).
 */
export function MfaSessionNotice() {
  const t = useTranslations("access.matrix");
  const query = useMyPermissions();
  const blocked = query.data?.requiresMfa?.some((key) => key === "rbac.role.manage" || key === "rbac.assignment.manage");
  return blocked ? <Notice tone="warning">{t("mfaSession")}</Notice> : null;
}
