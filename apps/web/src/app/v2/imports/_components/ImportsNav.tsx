"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function ImportsNav() {
  const t = useTranslations("v2Imports.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/imports", label: t("history"), permission: "imports.read", exact: true },
        { href: "/v2/imports/new", label: t("new"), permission: "imports.create" },
        { href: "/v2/imports/templates", label: t("templates"), permission: "imports.read" },
        { href: "/v2/imports/settings", label: t("settings"), permission: "imports.manage" },
      ]}
    />
  );
}
