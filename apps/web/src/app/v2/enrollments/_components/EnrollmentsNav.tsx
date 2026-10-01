"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function EnrollmentsNav() {
  const t = useTranslations("v2Enrollments.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/enrollments", label: t("list"), permission: "enrollment.read", exact: true },
        { href: "/v2/enrollments/new", label: t("new"), permission: "enrollment.create" },
      ]}
    />
  );
}
