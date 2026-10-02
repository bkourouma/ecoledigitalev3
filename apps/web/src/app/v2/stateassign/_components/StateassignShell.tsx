"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";
import { PERM, VIEW_PERMISSIONS } from "./permissions";

/** Navigation de la section « élèves affectés par l'État » (onglets défilants sur mobile) : chaque entrée suit la permission de son écran. */
export function StateassignNav() {
  const t = useTranslations("v2Stateassign.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/stateassign", label: t("assignments"), anyPermission: VIEW_PERMISSIONS, exact: true },
        { href: "/v2/stateassign/verification", label: t("verification"), permission: PERM.verify },
        { href: "/v2/stateassign/reconciliation", label: t("reconciliation"), anyPermission: [PERM.reconcile, PERM.read] },
        { href: "/v2/stateassign/receivables", label: t("receivables"), anyPermission: [PERM.read, PERM.receivableManage] },
        { href: "/v2/stateassign/reports", label: t("reports"), anyPermission: [PERM.read, PERM.export] },
        { href: "/v2/stateassign/settings", label: t("settings"), permission: PERM.settingsManage },
      ]}
    />
  );
}

export function StateassignShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <StateassignNav />
      {children}
    </div>
  );
}
