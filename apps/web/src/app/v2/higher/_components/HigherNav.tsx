"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function HigherNav() {
  const t = useTranslations("v2Higher.nav");
  const tPrerequisites = useTranslations("v2HigherPrerequisites");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/higher/diplomas", label: t("diplomas"), permission: "higher.diploma.read" },
        { href: "/v2/higher/attestations", label: t("attestations"), permission: "higher.diploma.read" },
        { href: "/v2/higher/documents", label: t("documents"), permission: "higher.document.read" },
        { href: "/v2/higher/credits", label: t("credits"), permission: "higher.credits.read" },
        { href: "/v2/higher/prerequisites", label: tPrerequisites("nav"), anyPermission: ["higher.prerequisite.manage", "higher.credits.read"] },
        { href: "/v2/higher/resit", label: t("resit"), permission: "higher.resit.manage" },
        { href: "/v2/higher/signatories", label: t("signatories"), permission: "higher.slot.manage" },
      ]}
    />
  );
}
