import { Money, newId } from "@ecoledigitale/kernel";
import type { Installment } from "../../domain/installments";
import type { AllocationTarget } from "../../domain/allocation";
import type { InvoiceLine } from "../../domain/invoice";

export const xof = (n: number): Money => Money.of(n, "XOF");

export const installment = (
  over: { id?: string; invoiceId?: string; seq?: number; label?: string; dueDate?: string; amount?: number; paid?: number; credited?: number } = {},
): Installment => ({
  id: over.id ?? newId(),
  invoiceId: over.invoiceId ?? "00000000-0000-7000-8000-000000000001",
  seq: over.seq ?? 1,
  label: over.label ?? "Échéance",
  dueDate: over.dueDate ?? "2026-01-15",
  amount: xof(over.amount ?? 100_000),
  paid: xof(over.paid ?? 0),
  credited: xof(over.credited ?? 0),
});

export const target = (over: {
  id?: string;
  invoiceId?: string;
  dueDate?: string;
  seq?: number;
  issuedAt?: string;
  remaining: number;
}): AllocationTarget => ({
  invoiceId: over.invoiceId ?? "00000000-0000-7000-8000-0000000000aa",
  installmentId: over.id ?? newId(),
  dueDate: over.dueDate ?? "2026-01-15",
  seq: over.seq ?? 1,
  invoiceIssuedAt: over.issuedAt ?? "2025-09-01T00:00:00.000Z",
  remaining: xof(over.remaining),
});

export const line = (over: Partial<InvoiceLine> & { gross?: number }): InvoiceLine => {
  const gross = xof(over.gross ?? 100_000);
  return {
    id: over.id ?? newId(),
    position: over.position ?? 1,
    feeId: over.feeId ?? null,
    category: over.category ?? "TUITION",
    description: over.description ?? "Scolarité",
    quantity: 1,
    unitAmount: gross,
    gross,
    discount: xof(0),
    scholarship: xof(0),
    total: gross,
    sourceRef: over.sourceRef ?? null,
  };
};
