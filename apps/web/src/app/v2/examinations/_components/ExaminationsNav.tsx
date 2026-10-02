"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function ExaminationsNav() {
  const t = useTranslations("v2Examinations.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/examinations", label: t("sessions"), permission: "exam.session.read", exact: true },
        { href: "/v2/examinations/candidates", label: t("candidates"), anyPermission: ["exam.candidate.read", "exam.candidate.manage"] },
        { href: "/v2/examinations/assignments", label: t("assignments"), anyPermission: ["exam.center.manage", "exam.session.read"] },
        { href: "/v2/examinations/centers", label: t("centers"), permission: "exam.center.manage" },
        { href: "/v2/examinations/mock", label: t("mock"), permission: "exam.mock.manage" },
        { href: "/v2/examinations/results", label: t("results"), anyPermission: ["exam.result.read", "exam.result.enter", "exam.score.enter"] },
        { href: "/v2/examinations/imports", label: t("imports"), permission: "exam.import.manage" },
        { href: "/v2/examinations/corrections", label: t("corrections"), anyPermission: ["exam.result.read", "exam.result.revise"] },
        { href: "/v2/examinations/statistics", label: t("statistics"), permission: "exam.statistics.read" },
        { href: "/v2/examinations/exports", label: t("exports"), anyPermission: ["exam.export.run", "exam.document.issue"] },
        { href: "/v2/examinations/types", label: t("types"), permission: "exam.type.read" },
        { href: "/v2/examinations/family", label: t("family"), anyPermission: ["exam.document.child.read", "exam.document.self.read"] },
      ]}
    />
  );
}
