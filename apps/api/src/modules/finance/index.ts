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
  DEFAULT_RECONCILIATION_CONFIG,
  type ReconciliationConfig,
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
export { denyAllGuardianship, InMemoryGuardianship, type GuardianshipPort } from "./application/ports/guardianship";
export { unavailableReceiptDocuments, type OfficialDocumentInput, type OfficialDocumentState, type OfficialDocumentStatus, type ReceiptDocumentPort } from "./application/ports/documents";
export { getReceiptPdf, type ReceiptPdfAudience } from "./application/receipt-document";
export { buildReceiptDocument, type ReceiptDocument } from "./domain/receipt-document";
export { FAMILY_PERMISSIONS, familyIdempotencyKey, type FamilyAccess, type FamilyAction, type FamilyRelation } from "./application/family";
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

// Faits publiés pour les adaptateurs de plateforme (academic, reportcards) : frais d'inscription soldés, facture, impayé
export {
  getBilledAmounts,
  getInvoiceFacts,
  getLearnerStanding,
  getLinkedInvoicesTotals,
  getRegistrationFeeStatus,
  hasOverdueBalance,
  isRegistrationFeeDue,
  registrationFeeStateOf,
  type BilledAmounts,
  type InvoiceFacts,
  type InvoiceTotals,
  type LearnerStanding,
  type RegistrationFeeQuery,
  type RegistrationFeeState,
  type RegistrationFeeStatus,
} from "./application/facts";

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

// Modèle de pack `finance` : catégories de frais REGISTRATION / TUITION (libellés seulement, AUCUN montant)
export { instantiateFinancePack, type FinancePackReport } from "./application/pack";
export { feeTemplatesForPack, FINANCE_PACK_TEMPLATES, type FinancePackKey, type PackFeeTemplate } from "./domain/pack-template";
export { FEE_CATEGORIES, FEE_CATEGORY_LABELS_FR } from "./domain/types";

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
  planRefundRoute,
  rejectRefund,
  requestRefund,
  type ApproveRefundInput,
  type ManualRefundEvidence,
  type RefundRoute,
  type RequestRefundInput,
} from "./application/refunds";
export {
  approveManualResolution,
  resolveManually,
  requireRecentMfa,
  listManualResolutions,
  listPendingReconciliations,
  rejectManualResolution,
  requestManualResolution,
  type RequestResolutionInput,
} from "./application/manual-resolution";
export {
  backoffDelayMs,
  reconcileAllTenants,
  reconcileTenant,
  type ReconcileAllReport,
  type ReconcileTenantReport,
  type SubjectCounts,
} from "./application/reconciliation";
export { getFinanceWorkerResources, resetFinanceWorkerResources, setFinanceWorkerResources, type FinanceWorkerResources } from "./application/worker-resources";
export { FinanceMetricNames, logAlerts, noopMetrics, type FinanceAlert, type FinanceAlertPort, type FinanceMetricsPort } from "./application/ports/operations";

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
  getProviderAccountsReport,
  getReceivablesByGroup,
  getReceivablesByLearner,
  type ProviderAccountsReport,
  type ReportFilter,
} from "./application/reports";
export type {
  AgedBalanceReport,
  AgedLearnerRow,
  FinanceSummary,
  LearnerReceivableRow,
  ProviderAccountRow,
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

// Exports CSV serveur (plafond et troncature signalée)
export {
  DEFAULT_EXPORT_MAX_ROWS,
  EXPORT_COLUMNS,
  EXPORT_DATASETS,
  exportInvoicesCsv,
  exportPaymentsCsv,
  exportReceivablesCsv,
  type CsvExport,
  type ExportDataset,
  type ExportMeta,
} from "./application/exports";
export { csvCell, toCsv } from "./domain/csv";

// Échéances en retard pour les relances et alertes du module notifications (016) : lectures seules
export {
  isInstallmentOverdue,
  listOverdueInstallments,
  type ListOverdueInstallmentsInput,
  type OverdueInstallmentFact,
} from "./application/overdue-feed";
