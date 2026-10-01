/**
 * Domaine → DTO (contrats `packages/contracts/src/v2/finance.ts`).
 * Montants : `{ amount, currency }` ; dates calendaires `YYYY-MM-DD` ; instants ISO UTC.
 */
import type { Money } from "@ecoledigitale/kernel";
import type { Discount } from "../domain/discount";
import type { Fee } from "../domain/fee";
import type { FeeSchedule } from "../domain/fee-schedule";
import type { LearnerAccount } from "../domain/funding";
import {
  installmentRemaining,
  installmentStatus,
  type GeneratedInstallment,
  type Installment,
  type InstallmentPlan,
} from "../domain/installments";
import { invoiceBalance, type InvoiceLine } from "../domain/invoice";
import { unallocatedAmount } from "../domain/payment";
import type {
  AllocationRow,
  CashRegisterRecord,
  CashSessionRecord,
  CreditNoteRecord,
  InvoiceDetail,
  InvoiceRecord,
  PaymentRecord,
  ReceiptRecord,
  RefundRecord,
} from "../domain/records";
import type { Scholarship } from "../domain/scholarship";
import type { IsoDate } from "../domain/types";
import type { PaymentView } from "../application/billing-core";
import type { OnlinePaymentResult } from "../application/online-payments";
import type { InvoicePreview, LearnerStatement } from "../application/invoices";
import type { CashSessionSummary } from "../application/cash";
import type {
  AgedBalanceReport,
  AgedLearnerRow,
  FinanceSummary,
  LearnerReceivableRow,
  ReceivableRow,
  TrendPoint,
} from "../infrastructure/reports-repository";

export const money = (m: Money): { amount: number; currency: Money["currency"] } => ({ amount: m.amount, currency: m.currency });
const moneyOrNull = (m: Money | null): ReturnType<typeof money> | null => (m ? money(m) : null);
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const feeDto = (f: Fee) => ({ ...f });

export const scheduleDto = (s: FeeSchedule) => ({
  id: s.id,
  feeId: s.feeId,
  academicYear: s.academicYear,
  scope: { ...s.scope },
  amount: money(s.amount),
  effectiveFrom: s.effectiveFrom,
  effectiveTo: s.effectiveTo,
  planId: s.planId,
  active: s.active,
});

export const planDto = (p: InstallmentPlan) => ({
  id: p.id,
  code: p.code,
  name: p.name,
  currency: p.currency,
  steps: p.steps.map((s) => ({
    label: s.label,
    share: s.share.kind === "FIXED" ? { kind: "FIXED" as const, amount: s.share.amount.amount } : { kind: "WEIGHT" as const, weight: s.share.weight },
    due: { ...s.due },
  })),
  active: p.active,
});

export const discountDto = (d: Discount) => ({
  id: d.id,
  code: d.code,
  name: d.name,
  kind: d.kind,
  bps: d.bps,
  amount: moneyOrNull(d.amount),
  capAmount: moneyOrNull(d.capAmount),
  categories: d.categories ? [...d.categories] : null,
  stackable: d.stackable,
  active: d.active,
});

export const scholarshipDto = (s: Scholarship) => ({
  id: s.id,
  learnerId: s.learnerId,
  academicYear: s.academicYear,
  funderKind: s.funderKind,
  funderName: s.funderName,
  reference: s.reference,
  coverage: s.coverage.kind === "PERCENT" ? { kind: "PERCENT" as const, bps: s.coverage.bps } : { kind: "FIXED" as const, amount: money(s.coverage.amount) },
  capAmount: moneyOrNull(s.capAmount),
  categories: s.categories ? [...s.categories] : null,
  status: s.status,
  priority: s.priority,
});

export const learnerFundingDto = (v: { account: LearnerAccount; scholarships: Scholarship[] }) => ({
  account: { ...v.account },
  scholarships: v.scholarships.map(scholarshipDto),
});

export const invoiceSummaryDto = (i: InvoiceRecord) => ({
  id: i.id,
  number: i.number,
  status: i.status,
  learnerId: i.learnerId,
  enrollmentId: i.enrollmentId,
  academicYear: i.academicYear,
  groupKey: i.groupKey,
  groupLabel: i.groupLabel,
  payerKind: i.payerKind,
  payerRef: i.payerRef,
  fundingType: i.fundingType,
  relatedGroupId: i.relatedGroupId,
  subtotal: money(i.subtotal),
  discount: money(i.discount),
  scholarship: money(i.scholarship),
  total: money(i.total),
  paid: money(i.paid),
  credited: money(i.credited),
  balance: money(invoiceBalance({ total: i.total, paid: i.paid, credited: i.credited })),
  dueDate: i.dueDate,
  issuedAt: iso(i.issuedAt),
  cancelledAt: iso(i.cancelledAt),
  cancelReason: i.cancelReason,
  createdAt: i.createdAt.toISOString(),
});

export const lineDto = (l: InvoiceLine) => ({
  id: l.id,
  position: l.position,
  feeId: l.feeId,
  category: l.category,
  description: l.description,
  quantity: l.quantity,
  unitAmount: money(l.unitAmount),
  gross: money(l.gross),
  discount: money(l.discount),
  scholarship: money(l.scholarship),
  total: money(l.total),
});

export const installmentDto = (i: Installment, today: IsoDate) => ({
  id: i.id,
  seq: i.seq,
  label: i.label,
  dueDate: i.dueDate,
  amount: money(i.amount),
  paid: money(i.paid),
  credited: money(i.credited),
  remaining: money(installmentRemaining(i)),
  status: installmentStatus(i, today),
});

export const invoiceDetailDto = (d: InvoiceDetail, today: IsoDate) => ({
  ...invoiceSummaryDto(d.invoice),
  lines: d.lines.map(lineDto),
  installments: d.installments.map((i) => installmentDto(i, today)),
  discounts: d.discounts.map((x) => ({ discountId: x.discountId, amount: money(x.amount) })),
});

export const invoicePreviewDto = (p: InvoicePreview) => ({
  invoices: p.invoices.map((i) => ({
    payerKind: i.payerKind,
    payerRef: i.payerRef,
    label: i.label,
    lines: i.lines.map(lineDto),
    subtotal: money(i.subtotal),
    discount: money(i.discount),
    scholarship: money(i.scholarship),
    total: money(i.total),
    installments: i.installments.map((x: GeneratedInstallment) => ({ seq: x.seq, label: x.label, dueDate: x.dueDate, amount: money(x.amount) })),
    dueDate: i.dueDate,
  })),
});

export const creditNoteDto = (c: CreditNoteRecord) => ({
  id: c.id,
  number: c.number,
  invoiceId: c.invoiceId,
  learnerId: c.learnerId,
  amount: money(c.amount),
  reason: c.reason,
  applications: c.applications.map((a) => ({ installmentId: a.installmentId, amount: a.amount })),
  issuedAt: c.issuedAt.toISOString(),
});

export const paymentDto = (p: PaymentRecord) => ({
  id: p.id,
  learnerId: p.learnerId,
  enrollmentId: p.enrollmentId,
  payerKind: p.payerKind,
  payerRef: p.payerRef,
  payerName: p.payerName,
  method: p.method,
  status: p.status,
  amount: money(p.amount),
  allocated: money(p.allocated),
  refunded: money(p.refunded),
  unallocated: money(p.status === "CONFIRMED" ? unallocatedAmount(p) : p.amount.subtract(p.amount)),
  provider: p.provider,
  providerRef: p.providerRef,
  simulated: p.simulated,
  reference: p.reference,
  cashSessionId: p.cashSessionId,
  receivedAt: p.receivedAt.toISOString(),
  confirmedAt: iso(p.confirmedAt),
  failureReason: p.failureReason,
});

export const allocationDto = (a: AllocationRow) => ({
  id: a.id,
  invoiceId: a.invoiceId,
  installmentId: a.installmentId,
  lineId: a.lineId,
  amount: money(a.amount),
  reversed: money(a.reversed),
  net: money(a.net),
});

export const receiptDto = (r: ReceiptRecord) => ({
  id: r.id,
  number: r.number,
  paymentId: r.paymentId,
  learnerId: r.learnerId,
  amount: money(r.amount),
  issuedAt: r.issuedAt.toISOString(),
  snapshot: {
    v: r.snapshot.v,
    number: r.snapshot.number,
    issuedAt: r.snapshot.issuedAt,
    method: r.snapshot.method,
    reference: r.snapshot.reference,
    payer: r.snapshot.payer,
    allocations: r.snapshot.allocations,
    unallocated: r.snapshot.unallocated as ReturnType<typeof money>,
    balanceAfter: r.snapshot.balanceAfter as ReturnType<typeof money> | null,
  },
});

export const paymentViewDto = (v: PaymentView) => ({
  payment: paymentDto(v.payment),
  receipt: v.receipt ? receiptDto(v.receipt) : null,
  allocations: v.allocations.map(allocationDto),
  replayed: v.replayed,
});

export const onlinePaymentDto = (v: OnlinePaymentResult) => ({
  ...paymentViewDto(v),
  instructions: v.instructions
    ? {
        ...v.instructions,
        ...(v.instructions.expiresAt ? { expiresAt: v.instructions.expiresAt.toISOString() } : {}),
      }
    : null,
});

export const refundDto = (r: RefundRecord) => ({
  id: r.id,
  paymentId: r.paymentId,
  amount: money(r.amount),
  reason: r.reason,
  status: r.status,
  requestedBy: r.requestedBy,
  requestedAt: r.requestedAt.toISOString(),
  approvedBy: r.approvedBy,
  approvedAt: iso(r.approvedAt),
  completedAt: iso(r.completedAt),
  rejectedBy: r.rejectedBy,
  rejectedAt: iso(r.rejectedAt),
  rejectionReason: r.rejectionReason,
  cashSessionId: r.cashSessionId,
});

export const cashRegisterDto = (r: CashRegisterRecord) => ({ ...r });

export const cashSessionDto = (s: CashSessionRecord) => ({
  id: s.id,
  registerId: s.registerId,
  cashierId: s.cashierId,
  status: s.status,
  openingFloat: money(s.openingFloat),
  openedAt: s.openedAt.toISOString(),
  closedAt: iso(s.closedAt),
  expected: moneyOrNull(s.expected),
  counted: moneyOrNull(s.counted),
  variance: moneyOrNull(s.variance),
  closeNote: s.closeNote,
});

export const cashSessionSummaryDto = (s: CashSessionSummary) => ({
  session: cashSessionDto(s.session),
  movements: {
    received: money(s.movements.received),
    refunded: money(s.movements.refunded),
    paymentCount: s.movements.paymentCount,
    refundCount: s.movements.refundCount,
  },
});

export const summaryDto = (s: FinanceSummary) => ({
  currency: s.currency,
  asOf: s.asOf,
  invoiceCount: s.invoiceCount,
  billed: money(s.billed),
  credited: money(s.credited),
  netBilled: money(s.netBilled),
  collected: money(s.collected),
  outstanding: money(s.outstanding),
  overdue: money(s.overdue),
  overdueInvoiceCount: s.overdueInvoiceCount,
  unallocatedPayments: money(s.unallocatedPayments),
  collectionRateBps: s.collectionRateBps,
});

export const receivableRowDto = (r: ReceivableRow) => ({
  key: r.key,
  label: r.label,
  invoiceCount: r.invoiceCount,
  learnerCount: r.learnerCount,
  billed: money(r.billed),
  credited: money(r.credited),
  collected: money(r.collected),
  outstanding: money(r.outstanding),
  overdue: money(r.overdue),
  collectionRateBps: r.collectionRateBps,
});

export const learnerReceivableRowDto = (r: LearnerReceivableRow) => ({
  ...receivableRowDto(r),
  learnerId: r.learnerId,
  oldestOverdueDate: r.oldestOverdueDate,
});

export const trendPointDto = (p: TrendPoint) => ({
  bucket: p.bucket,
  collected: money(p.collected),
  refunded: money(p.refunded),
  net: money(p.net),
  paymentCount: p.paymentCount,
});

export const agedBalanceDto = (r: AgedBalanceReport & { learners: AgedLearnerRow[] }) => ({
  asOf: r.asOf,
  currency: r.currency,
  buckets: Object.fromEntries(Object.entries(r.buckets).map(([k, v]) => [k, { amount: money(v.amount), invoiceCount: v.invoiceCount }])),
  total: money(r.total),
  learners: r.learners.map((l) => ({
    learnerId: l.learnerId,
    buckets: Object.fromEntries(Object.entries(l.buckets).map(([k, v]) => [k, money(v)])),
    total: money(l.total),
  })),
});

export const learnerStatementDto = (s: LearnerStatement) => ({
  learnerId: s.learnerId,
  currency: s.currency,
  invoices: s.invoices.map(invoiceSummaryDto),
  payments: s.payments.map(paymentDto),
  totals: {
    billed: money(s.totals.billed),
    credited: money(s.totals.credited),
    collected: money(s.totals.collected),
    outstanding: money(s.totals.outstanding),
    unallocatedPayments: money(s.totals.unallocatedPayments),
  },
});
