"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function StaffNav() {
  const t = useTranslations("v2Staff.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/staff", label: t("staff"), permission: "staff.read", exact: true },
        { href: "/v2/staff/new", label: t("new"), permission: "staff.create" },
        { href: "/v2/staff/assignments", label: t("assignments"), permission: "teaching.read" },
        { href: "/v2/staff/me", label: t("me"), permission: "staff.own.read" },
      ]}
    />
  );
}
