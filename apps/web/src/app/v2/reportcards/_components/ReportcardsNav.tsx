"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function ReportcardsNav() {
  const t = useTranslations("v2Reportcards.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/reportcards", label: t("list"), permission: "reportcard.read", exact: true },
        { href: "/v2/reportcards/issue", label: t("issue"), permission: "reportcard.generate" },
        { href: "/v2/reportcards/family", label: t("family"), anyPermission: ["reportcard.self.read", "reportcard.child.read"] },
        { href: "/v2/reportcards/templates", label: t("templates"), permission: "reportcard.template.manage" },
        { href: "/v2/reportcards/identity", label: t("identity"), permission: "reportcard.branding.manage" },
        { href: "/v2/reportcards/signatories", label: t("signatories"), permission: "reportcard.signatory.manage" },
      ]}
    />
  );
}
