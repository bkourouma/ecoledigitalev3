"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function AssessmentsNav() {
  const t = useTranslations("v2Assess.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/assessments", label: t("list"), anyPermission: ["assessment.read", "grade.read", "grade.enter"], exact: true },
        { href: "/v2/assessments/new", label: t("new"), anyPermission: ["assessment.create", "assessment.manage"] },
        { href: "/v2/assessments/revisions", label: t("revisions"), anyPermission: ["grade.revise.request", "grade.revise.approve"] },
        { href: "/v2/assessments/types", label: t("types"), anyPermission: ["assessment.type.read", "assessment.type.manage"] },
      ]}
    />
  );
}
