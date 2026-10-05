"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function ScheduleNav() {
  const t = useTranslations("v2Schedule.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/schedule", label: t("timetable"), exact: true },
        { href: "/v2/schedule/today", label: t("today"), permission: "schedule.own.read" },
        { href: "/v2/schedule/occurrences", label: t("occurrences"), permission: "schedule.read" },
        { href: "/v2/schedule/timetables", label: t("timetables"), permission: "schedule.read" },
        { href: "/v2/schedule/generator", label: t("generator"), permission: "schedule.manage" },
        { href: "/v2/schedule/replacements", label: t("replacements"), permission: "schedule.manage" },
        { href: "/v2/schedule/rooms", label: t("rooms"), permission: "schedule.read" },
        { href: "/v2/schedule/export", label: t("export") },
      ]}
    />
  );
}
