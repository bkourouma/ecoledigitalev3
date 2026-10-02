"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

/** Navigation de l'espace élève : chaque entrée n'apparaît que si la permission est accordée. */
export function StudentNav() {
  const t = useTranslations("v2StudentSelf.nav");
  return <SectionNav label={t("label")} items={[{ href: "/v2/student/me", label: t("myRecord"), permission: "student.self.read" }]} />;
}
