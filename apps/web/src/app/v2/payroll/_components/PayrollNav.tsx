"use client";

import { useTranslations } from "next-intl";
import { useFeature, usePermission } from "@/platform/access";
import { SectionNav, type SectionNavItem } from "@/platform/ui/SectionNav";

/** Navigation de la paie : chaque entrée n'apparaît que si la permission correspondante est détenue. */
export function PayrollNav() {
  const t = useTranslations("v2Payroll.nav");
  const own = usePermission("payroll.payslip.read_own");
  const ownerFeature = useFeature("payroll.owner-validation");
  const items: SectionNavItem[] = [
    { href: "/v2/payroll", label: t("periods"), permission: "payroll.period.manage", exact: true },
    { href: "/v2/payroll/payslips", label: t("payslips"), permission: "payroll.payslip.read" },
    { href: "/v2/payroll/configuration", label: t("configuration"), permission: "payroll.config.read" },
    { href: "/v2/payroll/history", label: t("history"), permission: "payroll.payslip.read" },
    { href: "/v2/payroll/reports", label: t("reports"), permission: "payroll.report.read" },
  ];
  // Masse salariale et validation du propriétaire : fonction de l'offre (`payroll.owner-validation`) + lecture des rapports.
  if (ownerFeature.allowed) items.push({ href: "/v2/payroll/owner", label: t("owner"), permission: "payroll.report.read" });
  // « Mes bulletins » : enseignant (permission `read_own`), entrée sans permission déclarée car filtrée ici.
  if (own.allowed) items.push({ href: "/v2/payroll/my", label: t("my") });
  return <SectionNav label={t("label")} items={items} />;
}
