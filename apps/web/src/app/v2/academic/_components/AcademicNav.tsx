"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function AcademicNav() {
  const t = useTranslations("v2Academic.nav");
  const tRollover = useTranslations("v2Rollover");
  const tSettings = useTranslations("v2AcademicSettings");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/academic/years", label: t("years"), permission: "academic.year.read" },
        { href: "/v2/academic/programs", label: t("programs"), permission: "academic.program.read" },
        { href: "/v2/academic/curriculum", label: t("curriculum"), permission: "curriculum.read" },
        { href: "/v2/academic/subjects", label: t("subjects"), permission: "curriculum.read" },
        { href: "/v2/academic/classrooms", label: t("classrooms"), permission: "academic.classroom.read" },
        { href: "/v2/academic/offerings", label: t("offerings"), permission: "academic.classroom.read" },
        { href: "/v2/academic/rollover", label: tRollover("nav"), permission: "academic.year.rollover" },
        { href: "/v2/academic/settings", label: tSettings("nav"), permission: "academic.read" },
      ]}
    />
  );
}
