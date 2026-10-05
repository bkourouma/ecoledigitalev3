"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";
import { VIEW_PERMISSIONS } from "./documents-utils";

/** Navigation de la section documents (onglets défilants sur mobile) : chaque entrée suit la permission de son écran. */
export function DocumentsNav() {
  const t = useTranslations("v2Documents.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/documents", label: t("explorer"), anyPermission: VIEW_PERMISSIONS, exact: true },
        { href: "/v2/documents/search", label: t("search"), anyPermission: VIEW_PERMISSIONS },
        { href: "/v2/documents/expirations", label: t("expirations"), anyPermission: VIEW_PERMISSIONS },
        { href: "/v2/documents/categories", label: t("categories"), permission: "documents.category.manage" },
        { href: "/v2/documents/quarantine", label: t("quarantine"), permission: "documents.quarantine.manage" },
        { href: "/v2/documents/settings", label: t("settings"), permission: "documents.settings.manage" },
      ]}
    />
  );
}

export function DocumentsShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <DocumentsNav />
      {children}
    </div>
  );
}
