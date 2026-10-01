"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

/** Navigation commune aux élèves, tuteurs et « mes enfants » : chaque entrée n'apparaît que si la permission est accordée. */
export function PeopleNav() {
  const t = useTranslations("v2Students.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/students", label: t("students"), permission: "student.list", exact: true },
        { href: "/v2/students/new", label: t("new"), permission: "student.create" },
        { href: "/v2/guardians", label: t("guardians"), permission: "guardian.read" },
        { href: "/v2/students/children", label: t("children"), permission: "student.child.read" },
      ]}
    />
  );
}
