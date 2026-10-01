"use client";

import { useTranslations } from "next-intl";
import { SectionNav } from "@/platform/ui/SectionNav";

export function AttendanceNav() {
  const t = useTranslations("v2Attendance.nav");
  return (
    <SectionNav
      label={t("label")}
      items={[
        { href: "/v2/attendance/call", label: t("call"), permission: "attendance.take" },
        { href: "/v2/attendance", label: t("dashboard"), permission: "attendance.read", exact: true },
        { href: "/v2/attendance/sessions", label: t("sessions"), permission: "attendance.read" },
        { href: "/v2/attendance/absences", label: t("absences"), permission: "attendance.report.read" },
        { href: "/v2/attendance/justifications", label: t("justifications"), permission: "attendance.justification.read" },
        { href: "/v2/attendance/compliance", label: t("compliance"), permission: "attendance.report.read" },
        { href: "/v2/attendance/alerts", label: t("alerts"), permission: "attendance.read" },
        { href: "/v2/attendance/conflicts", label: t("conflicts"), permission: "attendance.manage" },
        { href: "/v2/attendance/staff", label: t("staff"), permission: "attendance.staff.read" },
        { href: "/v2/attendance/staff/me", label: t("staffMe"), permission: "attendance.own.read" },
        { href: "/v2/attendance/children", label: t("children"), permission: "attendance.child.read" },
        { href: "/v2/attendance/me", label: t("me"), permission: "attendance.self.read" },
      ]}
    />
  );
}
