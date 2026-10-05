"use client";

/**
 * Hooks typés du module `finance` (`/api/v1/finance/*`) : une fonction par ressource, schémas Zod de
 * `packages/contracts/src/v2/finance.ts`. AUCUN calcul financier ici ni dans les écrans : le web affiche les montants
 * calculés par l'API (facturé, encaissé, restant dû, taux, écart de caisse…) et lui transmet les actions. Les montants
 * envoyés sont des entiers (unités mineures) ; la devise n'est pas envoyée (défaut du tenant côté API).
 *
 * Clés de cache : `["finance", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  financeAgedBalanceDtoSchema,
  financeProviderAccountsReportDtoSchema,
  financeCashRegisterDtoSchema,
  financeCashSessionDtoSchema,
  financeCashSessionSummaryDtoSchema,
  financeCreditNoteDtoSchema,
  financeDiscountDtoSchema,
  financeFeeDtoSchema,
  financeFeeScheduleDtoSchema,
  financeInvoiceDetailDtoSchema,
  financeInvoicePreviewDtoSchema,
  financeInvoiceSummaryDtoSchema,
  financeInvoicesResultDtoSchema,
  financeLearnerFundingDtoSchema,
  financeLearnerReceivableRowDtoSchema,
  financeLearnerStatementDtoSchema,
  financeOnlinePaymentDtoSchema,
  financePageDtoSchema,
  financePaymentDtoSchema,
  financePaymentViewDtoSchema,
  financePlanDtoSchema,
  financeReceivableRowDtoSchema,
  financeReceiptDtoSchema,
  financeRefundDtoSchema,
  financeScholarshipDtoSchema,
  financeSummaryDtoSchema,
  financeTrendPointDtoSchema,
  type FinanceCreateDiscountBody,
  type FinanceCreateFeeBody,
  type FinanceCreateFeeScheduleBody,
  type FinanceCreateInvoiceBody,
  type FinanceCreatePlanBody,
  type FinanceCreateScholarshipBody,
  type FinanceInitiateOnlinePaymentBody,
  type FinanceInvoiceFromScheduleBody,
  type FinanceRecordPaymentBody,
} from "@ecoledigitale/contracts/v2/finance";
import { useApiAction } from "./actions";

export const FINANCE_BASE = "/api/v1/finance";

const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;
type Query = Record<string, string | number | boolean | undefined>;

const KEY = (resource: string) => ["finance", resource] as const;

// ---------------------------------------------------------------------------
// Catalogue : frais, barèmes, plans, remises
// ---------------------------------------------------------------------------

export function useFees(query: { category?: string; activeOnly?: boolean } = {}) {
  return hooks.useApiQuery(["finance", "fees", "list"], `${FINANCE_BASE}/fees`, { schema: itemsOf(financeFeeDtoSchema), select: pickItems, query: query as Query });
}

export function useCreateFee() {
  return useApiAction({ path: `${FINANCE_BASE}/fees`, body: (v: FinanceCreateFeeBody) => v, schema: financeFeeDtoSchema, invalidate: [KEY("fees")] });
}

export function useSetFeeStatus() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; active: boolean }) => `${FINANCE_BASE}/fees/${v.id}/status`,
    body: (v) => ({ active: v.active }),
    schema: financeFeeDtoSchema,
    invalidate: [KEY("fees")],
  });
}

export function useFeeSchedules(query: { feeId?: string; academicYear?: string; activeOnly?: boolean } = {}) {
  return hooks.useApiQuery(["finance", "schedules", "list"], `${FINANCE_BASE}/fee-schedules`, { schema: itemsOf(financeFeeScheduleDtoSchema), select: pickItems, query: query as Query });
}

export function useCreateFeeSchedule() {
  return useApiAction({ path: `${FINANCE_BASE}/fee-schedules`, body: (v: FinanceCreateFeeScheduleBody) => v, schema: financeFeeScheduleDtoSchema, invalidate: [KEY("schedules")] });
}

/** Montant applicable résolu PAR L'API (le plus spécifique gagne ; ambiguïté = erreur). */
export function useResolveFee(query: { feeId: string; academicYear: string; levelKey?: string; trackKey?: string; learnerType?: string; campusId?: string; institutionId?: string; onDate?: string } | null) {
  return hooks.useApiQuery(["finance", "schedules", "resolve", query], `${FINANCE_BASE}/fee-schedules/resolve`, {
    schema: financeFeeScheduleDtoSchema,
    query: (query ?? {}) as Query,
    enabled: query !== null,
    retry: false,
  });
}

export function useInstallmentPlans() {
  return hooks.useApiQuery(["finance", "plans", "list"], `${FINANCE_BASE}/installment-plans`, { schema: itemsOf(financePlanDtoSchema), select: pickItems });
}

export function useCreatePlan() {
  return useApiAction({ path: `${FINANCE_BASE}/installment-plans`, body: (v: FinanceCreatePlanBody) => v, schema: financePlanDtoSchema, invalidate: [KEY("plans")] });
}

export function useDiscounts() {
  return hooks.useApiQuery(["finance", "discounts", "list"], `${FINANCE_BASE}/discounts`, { schema: itemsOf(financeDiscountDtoSchema), select: pickItems });
}

export function useCreateDiscount() {
  return useApiAction({ path: `${FINANCE_BASE}/discounts`, body: (v: FinanceCreateDiscountBody) => v, schema: financeDiscountDtoSchema, invalidate: [KEY("discounts")] });
}

// ---------------------------------------------------------------------------
// Financement et bourses
// ---------------------------------------------------------------------------

export function useLearnerFunding(learnerId: string | null) {
  return hooks.useApiQuery(["finance", "funding", learnerId], `${FINANCE_BASE}/learners/${learnerId}/funding`, { schema: financeLearnerFundingDtoSchema, enabled: learnerId !== null });
}

export function useSetLearnerFunding() {
  return useApiAction({
    method: "PUT",
    path: (v: { learnerId: string; fundingType: string; assignmentRef?: string }) => `${FINANCE_BASE}/learners/${v.learnerId}/funding`,
    body: (v) => ({ fundingType: v.fundingType, ...(v.assignmentRef ? { assignmentRef: v.assignmentRef } : {}) }),
    invalidate: [KEY("funding"), KEY("statement")],
  });
}

export function useCreateScholarship() {
  return useApiAction({ path: `${FINANCE_BASE}/scholarships`, body: (v: FinanceCreateScholarshipBody) => v, schema: financeScholarshipDtoSchema, invalidate: [KEY("funding")] });
}

export function useSetScholarshipStatus() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; status: "ACTIVE" | "SUSPENDED" | "ENDED" }) => `${FINANCE_BASE}/scholarships/${v.id}/status`,
    body: (v) => ({ status: v.status }),
    invalidate: [KEY("funding")],
  });
}

// ---------------------------------------------------------------------------
// Factures
// ---------------------------------------------------------------------------

export interface InvoicesQuery {
  learnerId?: string;
  academicYear?: string;
  status?: string;
  groupKey?: string;
  payerKind?: string;
  limit?: number;
  offset?: number;
}

export function useInvoices(query: InvoicesQuery = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["finance", "invoices", "list"], `${FINANCE_BASE}/invoices`, {
    schema: financePageDtoSchema(financeInvoiceSummaryDtoSchema),
    query: query as Query,
    enabled: options.enabled,
  });
}

export function useInvoice(id: string | null) {
  return hooks.useApiQuery(["finance", "invoices", "one", id], `${FINANCE_BASE}/invoices/${id}`, { schema: financeInvoiceDetailDtoSchema, enabled: id !== null });
}

const INVOICE_KEYS = [KEY("invoices"), KEY("statement"), KEY("reports")] as const;

/** Aperçu avant émission : AUCUNE écriture (calculé par l'API). */
export function usePreviewInvoice() {
  return useApiAction({
    path: `${FINANCE_BASE}/invoices/from-schedule/preview`,
    body: (v: FinanceInvoiceFromScheduleBody) => v,
    schema: financeInvoicePreviewDtoSchema,
  });
}

export function useIssueInvoiceFromSchedule() {
  return useApiAction({
    path: `${FINANCE_BASE}/invoices/from-schedule`,
    body: (v: { body: FinanceInvoiceFromScheduleBody; key: string }) => v.body,
    idempotencyKey: (v) => v.key,
    schema: financeInvoicesResultDtoSchema,
    invalidate: INVOICE_KEYS,
  });
}

export function useCreateInvoice() {
  return useApiAction({
    path: `${FINANCE_BASE}/invoices`,
    body: (v: { body: FinanceCreateInvoiceBody; key: string }) => v.body,
    idempotencyKey: (v) => v.key,
    schema: financeInvoicesResultDtoSchema,
    invalidate: INVOICE_KEYS,
  });
}

export function useIssueInvoice() {
  return useApiAction({ path: (v: { id: string }) => `${FINANCE_BASE}/invoices/${v.id}/issue`, schema: financeInvoiceDetailDtoSchema, invalidate: INVOICE_KEYS });
}

export function useCancelInvoice() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${FINANCE_BASE}/invoices/${v.id}/cancel`,
    body: (v) => ({ reason: v.reason }),
    schema: financeInvoiceDetailDtoSchema,
    invalidate: INVOICE_KEYS,
  });
}

export function useGenerateInstallments() {
  return useApiAction({
    path: (v: { id: string; planId?: string; planCode?: string; baseDate?: string }) => `${FINANCE_BASE}/invoices/${v.id}/installments`,
    body: (v) => ({ ...(v.planId ? { planId: v.planId } : {}), ...(v.planCode ? { planCode: v.planCode } : {}), ...(v.baseDate ? { baseDate: v.baseDate } : {}) }),
    schema: financeInvoiceDetailDtoSchema,
    invalidate: INVOICE_KEYS,
  });
}

const creditNoteResultSchema = z.object({ creditNote: financeCreditNoteDtoSchema, invoice: financeInvoiceDetailDtoSchema });

export function useIssueCreditNote() {
  return useApiAction({
    path: (v: { id: string; amount: number; reason: string }) => `${FINANCE_BASE}/invoices/${v.id}/credit-notes`,
    body: (v) => ({ amount: v.amount, reason: v.reason }),
    schema: creditNoteResultSchema,
    invalidate: INVOICE_KEYS,
  });
}

export function useLearnerStatement(learnerId: string | null, query: { academicYear?: string } = {}) {
  return hooks.useApiQuery(["finance", "statement", learnerId], `${FINANCE_BASE}/learners/${learnerId}/statement`, {
    schema: financeLearnerStatementDtoSchema,
    query: query as Query,
    enabled: learnerId !== null,
  });
}

// ---------------------------------------------------------------------------
// Paiements, reçus
// ---------------------------------------------------------------------------

export interface PaymentsQuery {
  learnerId?: string;
  status?: string;
  method?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function usePayments(query: PaymentsQuery = {}) {
  return hooks.useApiQuery(["finance", "payments", "list"], `${FINANCE_BASE}/payments`, { schema: financePageDtoSchema(financePaymentDtoSchema), query: query as Query });
}

export function usePayment(id: string | null) {
  return hooks.useApiQuery(["finance", "payments", "one", id], `${FINANCE_BASE}/payments/${id}`, { schema: financePaymentViewDtoSchema, enabled: id !== null });
}

const PAYMENT_KEYS = [KEY("payments"), KEY("invoices"), KEY("statement"), KEY("receipts"), KEY("cash"), KEY("reports")] as const;

/** Encaissement manuel. La clé d'idempotence est OBLIGATOIRE côté API : elle est passée en en-tête ET dans le corps. */
export function useRecordPayment() {
  return useApiAction({
    path: `${FINANCE_BASE}/payments`,
    body: (v: { body: FinanceRecordPaymentBody; key: string }) => ({ ...v.body, idempotencyKey: v.key }),
    idempotencyKey: (v) => v.key,
    schema: financePaymentViewDtoSchema,
    invalidate: PAYMENT_KEYS,
  });
}

export function useInitiateOnlinePayment() {
  return useApiAction({
    path: `${FINANCE_BASE}/payments/online`,
    body: (v: { body: FinanceInitiateOnlinePaymentBody; key: string }) => ({ ...v.body, idempotencyKey: v.key }),
    idempotencyKey: (v) => v.key,
    schema: financeOnlinePaymentDtoSchema,
    invalidate: PAYMENT_KEYS,
  });
}

/** Vérification active auprès du fournisseur (suivi de statut d'un paiement en ligne). */
export function useVerifyPayment() {
  return useApiAction({ path: (v: { id: string }) => `${FINANCE_BASE}/payments/${v.id}/verify`, schema: financePaymentViewDtoSchema, invalidate: PAYMENT_KEYS });
}

export type AllocationBody =
  | { mode: "AUTO"; order?: "OLDEST_DUE_FIRST" | "NEWEST_DUE_FIRST" | "SMALLEST_REMAINING_FIRST" | "LARGEST_REMAINING_FIRST" | "PROPORTIONAL"; invoiceIds?: string[] }
  | { mode: "MANUAL"; items: Array<{ installmentId: string; amount: number; lineId?: string }> };

export function useAllocatePayment() {
  return useApiAction({
    path: (v: { id: string; allocation: AllocationBody }) => `${FINANCE_BASE}/payments/${v.id}/allocations`,
    body: (v) => ({ allocation: v.allocation }),
    schema: financePaymentViewDtoSchema,
    invalidate: PAYMENT_KEYS,
  });
}

export function useReceipts(query: { learnerId?: string; limit?: number; offset?: number } = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["finance", "receipts", "list"], `${FINANCE_BASE}/receipts`, {
    schema: financePageDtoSchema(financeReceiptDtoSchema),
    query: query as Query,
    enabled: options.enabled,
  });
}

export function useReceipt(id: string | null) {
  return hooks.useApiQuery(["finance", "receipts", "one", id], `${FINANCE_BASE}/receipts/${id}`, { schema: financeReceiptDtoSchema, enabled: id !== null });
}

// ---------------------------------------------------------------------------
// Remboursements (quatre yeux)
// ---------------------------------------------------------------------------

export function useRefunds(query: { paymentId?: string; status?: string; limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery(["finance", "refunds", "list"], `${FINANCE_BASE}/refunds`, { schema: itemsOf(financeRefundDtoSchema), select: pickItems, query: query as Query });
}

const REFUND_KEYS = [KEY("refunds"), KEY("payments"), KEY("invoices"), KEY("statement"), KEY("cash"), KEY("reports")] as const;

export function useRequestRefund() {
  return useApiAction({
    path: (v: { paymentId: string; amount: number; reason: string; key: string }) => `${FINANCE_BASE}/payments/${v.paymentId}/refunds`,
    body: (v) => ({ amount: v.amount, reason: v.reason, idempotencyKey: v.key }),
    idempotencyKey: (v) => v.key,
    schema: financeRefundDtoSchema,
    invalidate: REFUND_KEYS,
  });
}

export function useApproveRefund() {
  return useApiAction({
    path: (v: { id: string; complete?: boolean }) => `${FINANCE_BASE}/refunds/${v.id}/approve`,
    body: (v) => (v.complete !== undefined ? { complete: v.complete } : {}),
    schema: financeRefundDtoSchema,
    invalidate: REFUND_KEYS,
  });
}

export function useCompleteRefund() {
  return useApiAction({ path: (v: { id: string }) => `${FINANCE_BASE}/refunds/${v.id}/complete`, schema: financeRefundDtoSchema, invalidate: REFUND_KEYS });
}

export function useRejectRefund() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${FINANCE_BASE}/refunds/${v.id}/reject`,
    body: (v) => ({ reason: v.reason }),
    schema: financeRefundDtoSchema,
    invalidate: REFUND_KEYS,
  });
}

// ---------------------------------------------------------------------------
// Caisses
// ---------------------------------------------------------------------------

export function useCashRegisters() {
  return hooks.useApiQuery(["finance", "cash", "registers"], `${FINANCE_BASE}/cash-registers`, { schema: itemsOf(financeCashRegisterDtoSchema), select: pickItems });
}

export function useCreateCashRegister() {
  return useApiAction({
    path: `${FINANCE_BASE}/cash-registers`,
    body: (v: { code: string; name: string; campusId?: string }) => v,
    schema: financeCashRegisterDtoSchema,
    invalidate: [["finance", "cash", "registers"]],
  });
}

export function useMyCashSession() {
  return hooks.useApiQuery(["finance", "cash", "mine"], `${FINANCE_BASE}/cash-sessions/mine`, {
    schema: z.object({ session: financeCashSessionDtoSchema.nullable() }),
    select: (d) => d.session,
  });
}

export function useCashSessions(query: { registerId?: string; status?: "OPEN" | "CLOSED"; limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery(["finance", "cash", "sessions"], `${FINANCE_BASE}/cash-sessions`, { schema: itemsOf(financeCashSessionDtoSchema), select: pickItems, query: query as Query });
}

export function useCashSessionSummary(id: string | null) {
  return hooks.useApiQuery(["finance", "cash", "summary", id], `${FINANCE_BASE}/cash-sessions/${id}`, { schema: financeCashSessionSummaryDtoSchema, enabled: id !== null });
}

export function useOpenCashSession() {
  return useApiAction({
    path: (v: { registerId: string; openingFloat: number }) => `${FINANCE_BASE}/cash-registers/${v.registerId}/sessions`,
    body: (v) => ({ openingFloat: v.openingFloat }),
    schema: financeCashSessionDtoSchema,
    invalidate: [KEY("cash")],
  });
}

/** Clôture avec comptage : l'écart (compté − attendu) est calculé PAR L'API. */
export function useCloseCashSession() {
  return useApiAction({
    path: (v: { id: string; countedAmount: number; note?: string }) => `${FINANCE_BASE}/cash-sessions/${v.id}/close`,
    body: (v) => ({ countedAmount: v.countedAmount, ...(v.note ? { note: v.note } : {}) }),
    schema: financeCashSessionSummaryDtoSchema,
    invalidate: [KEY("cash")],
  });
}

// ---------------------------------------------------------------------------
// Rapports
// ---------------------------------------------------------------------------

export interface ReportQuery {
  academicYear?: string;
  groupKey?: string;
  asOf?: string;
}

export function useFinanceSummary(query: ReportQuery = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["finance", "reports", "summary"], `${FINANCE_BASE}/reports/summary`, { schema: financeSummaryDtoSchema, query: query as Query, enabled: options.enabled });
}

export function useReceivablesByGroup(query: ReportQuery = {}) {
  return hooks.useApiQuery(["finance", "reports", "by-group"], `${FINANCE_BASE}/reports/receivables-by-group`, { schema: itemsOf(financeReceivableRowDtoSchema), select: pickItems, query: query as Query });
}

export function useReceivablesByLearner(query: ReportQuery & { limit?: number; offset?: number; onlyOutstanding?: boolean } = {}) {
  return hooks.useApiQuery(["finance", "reports", "by-learner"], `${FINANCE_BASE}/reports/receivables-by-learner`, {
    schema: financePageDtoSchema(financeLearnerReceivableRowDtoSchema),
    query: query as Query,
  });
}

export function useCollectionsTrend(query: { from: string; to: string; granularity?: "day" | "week" | "month" }, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["finance", "reports", "trend"], `${FINANCE_BASE}/reports/collections-trend`, {
    schema: itemsOf(financeTrendPointDtoSchema),
    select: pickItems,
    query: query as Query,
    enabled: options.enabled,
  });
}

/** Q-PAY-30 : paiements en ligne de l'école par fournisseur et par compte (propre / plateforme). */
export function useProviderAccountsReport(query: { from?: string; to?: string } = {}) {
  return hooks.useApiQuery(["finance", "reports", "provider-accounts"], `${FINANCE_BASE}/reports/provider-accounts`, { schema: financeProviderAccountsReportDtoSchema, query: query as Query });
}

export function useAgedBalance(query: ReportQuery & { byLearner?: number } = {}) {
  return hooks.useApiQuery(["finance", "reports", "aged"], `${FINANCE_BASE}/reports/aged-balance`, { schema: financeAgedBalanceDtoSchema, query: query as Query });
}

export type {
  FinanceCreateDiscountBody,
  FinanceCreateFeeBody,
  FinanceCreateFeeScheduleBody,
  FinanceCreateInvoiceBody,
  FinanceCreatePlanBody,
  FinanceCreateScholarshipBody,
  FinanceInitiateOnlinePaymentBody,
  FinanceInvoiceFromScheduleBody,
  FinanceRecordPaymentBody,
};
