/**
 * Enregistrements (agrégats relus de la base) manipulés par les cas d'usage.
 * Types purs : aucune dépendance d'infrastructure.
 */
import type { CurrencyCode, Money } from "@ecoledigitale/kernel";
import type { InvoiceLine } from "./invoice";
import type { Installment } from "./installments";
import type {
  CashSessionStatus,
  FundingType,
  InvoiceStatus,
  IsoDate,
  PayerKind,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  Uuid,
} from "./types";

export interface InvoiceRecord {
  readonly id: Uuid;
  readonly number: string | null;
  readonly status: InvoiceStatus;
  readonly learnerId: Uuid;
  readonly enrollmentId: Uuid | null;
  readonly academicYear: string;
  readonly groupKey: string | null;
  readonly groupLabel: string | null;
  readonly institutionId: Uuid | null;
  readonly campusId: Uuid | null;
  readonly fundingType: FundingType | null;
  readonly payerKind: PayerKind;
  readonly payerRef: string | null;
  readonly relatedGroupId: Uuid | null;
  readonly currency: CurrencyCode;
  readonly subtotal: Money;
  readonly discount: Money;
  readonly scholarship: Money;
  readonly total: Money;
  readonly paid: Money;
  readonly credited: Money;
  readonly dueDate: IsoDate;
  readonly issuedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  readonly idempotencyKey: string | null;
  readonly requestFingerprint: string | null;
  readonly createdAt: Date;
}

export interface InvoiceDetail {
  readonly invoice: InvoiceRecord;
  readonly lines: ReadonlyArray<InvoiceLine>;
  readonly installments: ReadonlyArray<Installment>;
  readonly discounts: ReadonlyArray<{ discountId: Uuid; amount: Money }>;
  readonly balance: Money;
}

export interface PaymentRecord {
  readonly id: Uuid;
  readonly learnerId: Uuid;
  readonly enrollmentId: Uuid | null;
  readonly payerKind: PayerKind;
  readonly payerRef: string | null;
  readonly payerName: string | null;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly allocated: Money;
  readonly refunded: Money;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly provider: string | null;
  readonly providerRef: string | null;
  readonly providerStatus: string | null;
  readonly simulated: boolean;
  readonly reference: string | null;
  readonly intendedInvoiceId: Uuid | null;
  readonly cashSessionId: Uuid | null;
  readonly receivedAt: Date;
  readonly confirmedAt: Date | null;
  readonly failedAt: Date | null;
  readonly failureReason: string | null;
  readonly createdBy: Uuid | null;
  readonly createdAt: Date;
}

export interface AllocationRow {
  readonly id: Uuid;
  readonly paymentId: Uuid;
  readonly invoiceId: Uuid;
  readonly installmentId: Uuid;
  readonly lineId: Uuid | null;
  readonly amount: Money;
  readonly reversed: Money;
  readonly net: Money;
  readonly createdAt: Date;
}

export interface ReceiptRecord {
  readonly id: Uuid;
  readonly number: string;
  readonly paymentId: Uuid;
  readonly learnerId: Uuid;
  readonly amount: Money;
  readonly issuedAt: Date;
  readonly issuedBy: Uuid | null;
  readonly snapshot: ReceiptSnapshot;
}

export interface ReceiptSnapshot {
  v: 1;
  number: string;
  issuedAt: string;
  learnerId: Uuid;
  enrollmentId: Uuid | null;
  payer: { kind: PayerKind; ref: string | null; name: string | null };
  method: PaymentMethod;
  reference: string | null;
  amount: { amount: number; currency: string };
  allocations: Array<{ invoiceId: Uuid; invoiceNumber: string | null; installmentId: Uuid; label: string; amount: number }>;
  unallocated: { amount: number; currency: string };
  /** Reste dû sur les factures concernées après ce paiement. */
  balanceAfter: { amount: number; currency: string } | null;
}

export interface RefundRecord {
  readonly id: Uuid;
  readonly paymentId: Uuid;
  readonly amount: Money;
  readonly reason: string;
  readonly status: RefundStatus;
  readonly requestedBy: Uuid;
  readonly requestedAt: Date;
  readonly approvedBy: Uuid | null;
  readonly approvedAt: Date | null;
  readonly completedAt: Date | null;
  readonly rejectedBy: Uuid | null;
  readonly rejectedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly cashSessionId: Uuid | null;
  readonly idempotencyKey: string | null;
  readonly requestFingerprint: string | null;
}

export interface CreditNoteRecord {
  readonly id: Uuid;
  readonly number: string;
  readonly invoiceId: Uuid;
  readonly learnerId: Uuid;
  readonly amount: Money;
  readonly reason: string;
  readonly applications: ReadonlyArray<{ installmentId: Uuid; amount: number }>;
  readonly issuedAt: Date;
  readonly issuedBy: Uuid | null;
}

export interface CashRegisterRecord {
  readonly id: Uuid;
  readonly code: string;
  readonly name: string;
  readonly campusId: Uuid | null;
  readonly active: boolean;
}

export interface CashSessionRecord {
  readonly id: Uuid;
  readonly registerId: Uuid;
  readonly cashierId: Uuid;
  readonly status: CashSessionStatus;
  readonly openingFloat: Money;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly expected: Money | null;
  readonly counted: Money | null;
  readonly variance: Money | null;
  readonly closeNote: string | null;
}

export type WebhookEventStatus = "RECEIVED" | "PROCESSED" | "IGNORED" | "FAILED";

export interface WebhookEventRecord {
  readonly id: Uuid;
  readonly provider: string;
  readonly eventId: string;
  readonly eventType: string | null;
  readonly status: WebhookEventStatus;
  readonly paymentId: Uuid | null;
  readonly error: string | null;
  readonly attempts: number;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}
