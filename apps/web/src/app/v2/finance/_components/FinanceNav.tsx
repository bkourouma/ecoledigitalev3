"use client";

import { useTranslations } from "next-intl";
import { usePermission } from "@/platform/access";
import { SectionNav, type SectionNavItem } from "@/platform/ui/SectionNav";

/** Navigation de la section finance : chaque entrée n'apparaît que si la permission correspondante est détenue. */
export function FinanceNav() {
  const t = useTranslations("v2Finance.nav");
  const child = usePermission("finance.child.read");
  const self = usePermission("finance.self.read");
  const items: SectionNavItem[] = [
    { href: "/v2/finance", label: t("overview"), permission: "finance.report.read", exact: true },
    { href: "/v2/finance/invoices", label: t("invoices"), permission: "finance.invoice.read" },
    { href: "/v2/finance/payments", label: t("payments"), permission: "finance.payment.read" },
    { href: "/v2/finance/receipts", label: t("receipts"), permission: "finance.receipt.read" },
    { href: "/v2/finance/refunds", label: t("refunds"), permission: "finance.payment.read" },
    { href: "/v2/finance/cash", label: t("cash"), permission: "finance.cashregister.open" },
    { href: "/v2/finance/fees", label: t("fees"), permission: "finance.fee.read" },
    { href: "/v2/finance/funding", label: t("funding"), permission: "finance.invoice.read" },
    { href: "/v2/finance/reports", label: t("reports"), permission: "finance.report.read" },
  ];
  // « Mes finances » : parent (`finance.child.read`) ou élève (`finance.self.read`), routes famille `/finance/me/*`.
  if (child.allowed || self.allowed) items.push({ href: "/v2/finance/me", label: t("me") });
  return <SectionNav label={t("label")} items={items} />;
}
