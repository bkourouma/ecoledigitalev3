"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function SchoolLifeNav() {
  const t = useTranslations("v2Schoollife.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/schoollife", label: t("dashboard"), permission: "schoollife.read.all", exact: true },
        { href: "/v2/schoollife/saisie", label: t("quickEntry"), anyPermission: ["schoollife.incident.write", "schoollife.note.write"] },
        { href: "/v2/schoollife/validations", label: t("validations"), anyPermission: ["schoollife.measure.validate", "schoollife.exclusion.validate"] },
        { href: "/v2/schoollife/convocations", label: t("convocations"), permission: "schoollife.convocation.manage" },
        { href: "/v2/schoollife/parametres", label: t("settings"), permission: "schoollife.settings.manage" },
        { href: "/v2/schoollife/famille", label: t("family"), permission: "schoollife.child.read" },
        { href: "/v2/schoollife/moi", label: t("me"), permission: "schoollife.self.read" },
      ]}
    />
  );
}
