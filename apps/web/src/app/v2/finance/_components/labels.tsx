"use client";

import { useTranslations } from "next-intl";
import { StatusBadge } from "@/platform/ui/PageHeader";
import { financeTone } from "./shared";

/** Pastilles d'état : le libellé traduit porte le sens, la couleur n'est qu'un renfort. */
export function InvoiceStatusBadge({ status }: { status: string }) {
  const t = useTranslations("v2Finance.status.invoice");
  return <StatusBadge label={t(status)} tone={financeTone(status)} />;
}

export function InstallmentStatusBadge({ status }: { status: string }) {
  const t = useTranslations("v2Finance.status.installment");
  return <StatusBadge label={t(status)} tone={financeTone(status)} />;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const t = useTranslations("v2Finance.status.payment");
  return <StatusBadge label={t(status)} tone={financeTone(status)} />;
}

export function RefundStatusBadge({ status }: { status: string }) {
  const t = useTranslations("v2Finance.status.refund");
  return <StatusBadge label={t(status)} tone={financeTone(status)} />;
}

export function PayerBadge({ kind }: { kind: string }) {
  const t = useTranslations("v2Finance.payer");
  return <StatusBadge label={t(kind)} tone={kind === "FUNDER" ? "info" : "neutral"} />;
}

export function useMethodLabel() {
  const t = useTranslations("v2Finance.method");
  return (method: string) => t(method);
}
