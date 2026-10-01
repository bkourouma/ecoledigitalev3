"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function ResultsNav() {
  const t = useTranslations("v2Results.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/results", label: t("periods"), anyPermission: ["period.lock", "period.close", "result.read"], exact: true },
        { href: "/v2/results/matrix", label: t("matrix"), permission: "result.read" },
        { href: "/v2/results/decisions", label: t("decisions"), anyPermission: ["decision.record", "decision.approve", "appreciation.write"] },
        { href: "/v2/results/overrides", label: t("overrides"), anyPermission: ["result.override.request", "result.override.approve"] },
        { href: "/v2/results/resit", label: t("resit"), permission: "higher.resit.manage" },
      ]}
    />
  );
}
