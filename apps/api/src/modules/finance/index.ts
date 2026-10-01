/**
 * API PUBLIQUE du module `finance` — seul point d'import autorisé pour les autres modules.
 *
 *   import { createFinanceDeps, recordManualPayment, financePlugin } from "../finance";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>`
 * (convention n° 4) ; les montants sont des `Money` (kernel), les apprenants et inscriptions
 * des UUID résolus par les ports `LearnerDirectory` / `EnrollmentDirectory`.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as financeManifest } from "./manifest";

// Plugin Fastify
export { financePlugin, financeEnvironmentOf, FINANCE_ROUTES_PREFIX, registerFinancePorts, type FinancePluginOptions } from "./http/plugin";
export { createFinancePortRegistry, type FinancePortRegistry, type FinancePortSet } from "./application/port-registry";

// Dépendances et configuration
export {
  createFinanceDeps,
  DEFAULT_FINANCE_CONFIG,
  inTx as financeInTx,
  type FinanceConfig,
  type FinanceDeps,
  type FinanceDepsInput,
} from "./application/deps";

// Ports
export { noopAudit, RecordingAudit, type AuditEntry, type AuditPort } from "./application/ports/audit";
export { financeAuditAdapter } from "./infrastructure/audit-adapter";
export {
  InMemoryEnrollmentDirectory,
  InMemoryLearnerDirectory,
  noEnrollments,
  passThroughLearners,
  type EnrollmentDirectory,
  type LearnerDirectory,
} from "./application/ports/directories";
export type {
  PaymentProvider,
  ProviderHeaders,
  ProviderInitiateRequest,
  ProviderInitiation,
  ProviderMetadata,
  ProviderPayer,
  ProviderPaymentStatus,
  ProviderVerification,
  ProviderVerifyRequest,
  ProviderWebhookEvent,
} from "./application/ports/payment-provider";
export type { EnrollmentRef, LearnerRef } from "./domain/refs";

// Fournisseurs de paiement
export {
  createProviderRegistry,
  EnvProviderConfigSource,
  isDevLikeEnvironment,
  ProviderRegistry,
  sandboxDefinition,
  StaticProviderConfigSource,
  type AppEnvironment,
  type ProviderConfigSource,
  type ProviderDefinition,
  type ProviderFactoryContext,
  type ProviderRegistryOptions,
  type ProviderSettings,
} from "./infrastructure/providers/registry";
export {
  DEFAULT_SANDBOX_SECRET,
  resolveSandboxOutcome,
  SANDBOX_PROVIDER_NAME,
  SANDBOX_SIGNATURE_HEADER,
  SandboxProvider,
  type SandboxOutcome,
  type SandboxWebhook,
} from "./infrastructure/providers/sandbox-provider";

// Cas d'usage — catalogue
export {
  changeScholarshipStatus,
  createDiscount,
  createFee,
  createFeeSchedule,
  createInstallmentPlan,
  createScholarship,
  deactivateSchedule,
  getLearnerFunding,
  listDiscountCatalog,
  listFeeCatalog,
  listInstallmentPlans,
  listSchedules,
  resolveFeeAmount,
  setFeeStatus,
  setLearnerFunding,
  type CreateFeeScheduleInput,
  type CreateInstallmentPlanInput,
} from "./application/catalog";

// Cas d'usage — facturation
export {
  cancelInvoice,
  createInvoice,
  generateInstallmentPlan,
  getInvoiceById,
  getLearnerStatement,
  issueCreditNote,
  issueInvoice,
  issueInvoiceFromSchedule,
  listInvoicePage,
  markOverdueInvoices,
  previewInvoiceFromSchedule,
  type CreateInvoiceInput,
  type InstallmentSpec,
  type InvoiceFromScheduleInput,
  type InvoicePreview,
  type InvoicesResult,
  type IssueCreditNoteInput,
  type LearnerStatement,
} from "./application/invoices";

// Cas d'usage — encaissements
export {
  allocatePayment,
  getPaymentView,
  getReceiptById,
  getReceiptOfPayment,
  listPaymentPage,
  listReceiptPage,
  recordManualPayment,
  type AllocationSpec,
  type RecordManualPaymentInput,
} from "./application/payments";
export {
  applyProviderOutcome,
  handleProviderWebhook,
  initiateOnlinePayment,
  verifyPendingPayment,
  type HandleWebhookInput,
  type InitiateOnlinePaymentInput,
  type OnlinePaymentResult,
  type WebhookResult,
} from "./application/online-payments";
export type { PaymentView } from "./application/billing-core";
export {
  approveRefund,
  completeRefund,
  getRefundById,
  listRefundPage,
  rejectRefund,
  requestRefund,
  type ApproveRefundInput,
  type RequestRefundInput,
} from "./application/refunds";

// Cas d'usage — caisses
export {
  closeCashSession,
  createCashRegister,
  getCashSessionSummary,
  getMyOpenSession,
  listRegisters,
  listSessionPage,
  openCashSession,
  type CashSessionSummary,
  type CloseCashSessionInput,
  type OpenCashSessionInput,
} from "./application/cash";

// Tâches planifiées (apps/worker)
export { markOverdueForAllTenants, type OverdueJobResult } from "./application/jobs";

// Reporting
export {
  getAgedBalance,
  getCollectionsTrend,
  getFinanceSummary,
  getReceivablesByGroup,
  getReceivablesByLearner,
  type ReportFilter,
} from "./application/reports";
export type {
  AgedBalanceReport,
  AgedLearnerRow,
  FinanceSummary,
  LearnerReceivableRow,
  ReceivableRow,
  TrendGranularity,
  TrendPoint,
} from "./infrastructure/reports-repository";

// Domaine (types et fonctions pures utiles aux autres modules et au web)
export * from "./domain/types";
export { FinanceCode } from "./domain/errors";
export { FinanceEvents, ALL_FINANCE_EVENT_TYPES, type FinanceEventType } from "./domain/events";
export type * from "./domain/records";
export { formatDocumentNumber, parseDocumentNumber } from "./domain/numbering";
export { generateInstallments, type PlanStep, type InstallmentPlan, type GeneratedInstallment } from "./domain/installments";
export { collectionRateBps, agingBucket, AGING_BUCKETS } from "./domain/reporting";
export type { Fee } from "./domain/fee";
export type { FeeSchedule, FeeScope } from "./domain/fee-schedule";
export type { Discount } from "./domain/discount";
export type { Scholarship } from "./domain/scholarship";
export type { LearnerAccount } from "./domain/funding";
export type { InvoiceLine } from "./domain/invoice";
export type { Installment } from "./domain/installments";
