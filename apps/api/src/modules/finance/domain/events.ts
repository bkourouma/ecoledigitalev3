/**
 * Événements de domaine publiés par le module finance (outbox, ADR-004).
 *
 * Nommage `finance.<entité>.<verbe-passé>` ; payload JSON versionné `{ v: 1, … }`.
 * On ajoute des champs, on n'en retire jamais sans nouvelle version.
 * Les montants sont des entiers en unités mineures + devise.
 */
import type { Uuid } from "./types";

export const FinanceEvents = {
  INVOICE_ISSUED: "finance.invoice.issued",
  INVOICE_PAID: "finance.invoice.paid",
  INVOICE_OVERDUE: "finance.invoice.overdue",
  INVOICE_CANCELLED: "finance.invoice.cancelled",
  CREDIT_NOTE_ISSUED: "finance.credit_note.issued",
  PAYMENT_INITIATED: "finance.payment.initiated",
  PAYMENT_COMPLETED: "finance.payment.completed",
  PAYMENT_FAILED: "finance.payment.failed",
  PAYMENT_ALLOCATED: "finance.payment.allocated",
  RECEIPT_ISSUED: "finance.receipt.issued",
  REFUND_REQUESTED: "finance.refund.requested",
  REFUND_COMPLETED: "finance.refund.completed",
  REFUND_REJECTED: "finance.refund.rejected",
  CASH_SESSION_OPENED: "finance.cash_session.opened",
  CASH_SESSION_CLOSED: "finance.cash_session.closed",
} as const;

export type FinanceEventType = (typeof FinanceEvents)[keyof typeof FinanceEvents];

export const ALL_FINANCE_EVENT_TYPES: ReadonlyArray<FinanceEventType> = Object.values(FinanceEvents);

export interface MoneyPayload {
  amount: number;
  currency: string;
}

export interface InvoiceIssuedPayload {
  v: 1;
  invoiceId: Uuid;
  number: string;
  learnerId: Uuid;
  enrollmentId: Uuid | null;
  payerKind: "LEARNER" | "FUNDER";
  academicYear: string;
  total: MoneyPayload;
  dueDate: string;
  fundingType: string | null;
}

export interface InvoicePaidPayload {
  v: 1;
  invoiceId: Uuid;
  number: string;
  learnerId: Uuid;
  total: MoneyPayload;
}

export interface InvoiceOverduePayload {
  v: 1;
  invoiceId: Uuid;
  number: string;
  learnerId: Uuid;
  enrollmentId: Uuid | null;
  balance: MoneyPayload;
  overdueAmount: MoneyPayload;
  oldestDueDate: string;
  daysOverdue: number;
  asOf: string;
}

export interface InvoiceCancelledPayload {
  v: 1;
  invoiceId: Uuid;
  number: string | null;
  learnerId: Uuid;
  reason: string;
}

export interface CreditNoteIssuedPayload {
  v: 1;
  creditNoteId: Uuid;
  number: string;
  invoiceId: Uuid;
  learnerId: Uuid;
  amount: MoneyPayload;
  reason: string;
}

export interface PaymentCompletedPayload {
  v: 1;
  paymentId: Uuid;
  learnerId: Uuid;
  enrollmentId: Uuid | null;
  payerKind: "LEARNER" | "FUNDER";
  method: string;
  amount: MoneyPayload;
  receiptId: Uuid;
  receiptNumber: string;
  allocations: Array<{ invoiceId: Uuid; installmentId: Uuid; amount: number }>;
  unallocated: MoneyPayload;
  provider: string | null;
  confirmedAt: string;
}

export interface PaymentFailedPayload {
  v: 1;
  paymentId: Uuid;
  learnerId: Uuid;
  amount: MoneyPayload;
  provider: string | null;
  reason: string;
}

export interface PaymentInitiatedPayload {
  v: 1;
  paymentId: Uuid;
  learnerId: Uuid;
  amount: MoneyPayload;
  provider: string;
  providerRef: string | null;
}

export interface PaymentAllocatedPayload {
  v: 1;
  paymentId: Uuid;
  learnerId: Uuid;
  allocations: Array<{ invoiceId: Uuid; installmentId: Uuid; amount: number }>;
}

export interface ReceiptIssuedPayload {
  v: 1;
  receiptId: Uuid;
  number: string;
  paymentId: Uuid;
  learnerId: Uuid;
  amount: MoneyPayload;
}

export interface RefundPayload {
  v: 1;
  refundId: Uuid;
  paymentId: Uuid;
  learnerId: Uuid;
  amount: MoneyPayload;
  reason: string;
  status: "REQUESTED" | "COMPLETED" | "REJECTED";
}

export interface CashSessionPayload {
  v: 1;
  sessionId: Uuid;
  registerId: Uuid;
  cashierId: Uuid;
  openingFloat: MoneyPayload;
  expected?: MoneyPayload;
  counted?: MoneyPayload;
  variance?: MoneyPayload;
}
