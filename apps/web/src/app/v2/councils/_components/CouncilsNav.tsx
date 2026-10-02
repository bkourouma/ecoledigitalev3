"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function CouncilsNav() {
  const t = useTranslations("v2Councils.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/councils", label: t("calendar"), permission: "council.read", exact: true },
        { href: "/v2/councils/effets", label: t("effects"), permission: "council.effect.manage" },
        { href: "/v2/councils/orientation", label: t("orientation"), permission: "council.orientation.read" },
        { href: "/v2/councils/parametres", label: t("settings"), permission: "council.settings.manage" },
        { href: "/v2/councils/famille", label: t("family"), permission: "council.child.read" },
        { href: "/v2/councils/moi", label: t("me"), permission: "council.self.read" },
      ]}
    />
  );
}
