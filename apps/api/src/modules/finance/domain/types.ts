/**
 * Vocabulaire du domaine finance.
 *
 * Conventions (ADR-007) : valeurs d'énumération en anglais MAJUSCULES ; les
 * libellés français (`*_LABELS_FR`) ne servent qu'à l'affichage.
 */

/** Date calendaire sans heure `YYYY-MM-DD` (ADR-007 : type SQL `date`). */
export type IsoDate = string;

/** UUID (v7 généré par `newId()` du kernel). */
export type Uuid = string;

export const FEE_CATEGORIES = [
  "REGISTRATION",
  "TUITION",
  "CANTEEN",
  "TRANSPORT",
  "UNIFORM",
  "DOCUMENTS",
  "EXAMS",
  "ACTIVITIES",
  "DEFENSE",
  "LIBRARY",
  "OTHER",
] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];

export const FEE_CATEGORY_LABELS_FR: Readonly<Record<FeeCategory, string>> = Object.freeze({
  REGISTRATION: "Inscription",
  TUITION: "Scolarité",
  CANTEEN: "Cantine",
  TRANSPORT: "Transport",
  UNIFORM: "Uniforme",
  DOCUMENTS: "Documents",
  EXAMS: "Examens",
  ACTIVITIES: "Activités",
  DEFENSE: "Soutenance",
  LIBRARY: "Bibliothèque",
  OTHER: "Autres",
});

/** Type de financement porté par le compte de l'apprenant (PRD §20). */
export const FUNDING_TYPES = [
  "PRIVATE",
  "STATE_ASSIGNED",
  "SCHOLARSHIP",
  "COMPANY",
  "STAFF_CHILD",
  "OTHER",
] as const;
export type FundingType = (typeof FUNDING_TYPES)[number];

export const PAYMENT_METHODS = ["CASH", "CHEQUE", "TRANSFER", "CARD", "MOBILE_MONEY", "ONLINE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS_FR: Readonly<Record<PaymentMethod, string>> = Object.freeze({
  CASH: "Espèces",
  CHEQUE: "Chèque",
  TRANSFER: "Virement",
  CARD: "Carte",
  MOBILE_MONEY: "Mobile Money",
  ONLINE: "Paiement en ligne",
});

export const INVOICE_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
  "CREDITED",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "FAILED", "REFUNDED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * `REFUND_PENDING` : envoyé au fournisseur, résultat pas encore connu (rien n'est encore écrit au grand livre) ;
 * `COMPLETED` : remboursé (écritures inverses passées) ; `REFUND_FAILED` : refus définitif du fournisseur, rien n'est parti.
 */
export const REFUND_STATUSES = ["REQUESTED", "APPROVED", "REFUND_PENDING", "COMPLETED", "REFUND_FAILED", "REJECTED"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Comment un remboursement a été exécuté : écriture comptable seule, appel du fournisseur, ou remboursement manuel justifié. */
export const REFUND_EXECUTION_MODES = ["LEDGER", "PROVIDER", "MANUAL"] as const;
export type RefundExecutionMode = (typeof REFUND_EXECUTION_MODES)[number];

export const CASH_SESSION_STATUSES = ["OPEN", "CLOSED"] as const;
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

/** Qui doit la somme : l'apprenant (famille) ou un financeur (État, entreprise…). */
export const PAYER_KINDS = ["LEARNER", "FUNDER"] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];

export const FUNDER_KINDS = ["STATE", "COMPANY", "INSTITUTION", "FOUNDATION", "OTHER"] as const;
export type FunderKind = (typeof FUNDER_KINDS)[number];

export const SCHOLARSHIP_STATUSES = ["ACTIVE", "SUSPENDED", "ENDED"] as const;
export type ScholarshipStatus = (typeof SCHOLARSHIP_STATUSES)[number];

/** Ordre d'imputation automatique d'un paiement sur les échéances ouvertes. */
export const ALLOCATION_ORDERS = [
  "OLDEST_DUE_FIRST",
  "NEWEST_DUE_FIRST",
  "SMALLEST_REMAINING_FIRST",
  "LARGEST_REMAINING_FIRST",
  "PROPORTIONAL",
] as const;
export type AllocationOrder = (typeof ALLOCATION_ORDERS)[number];
export const DEFAULT_ALLOCATION_ORDER: AllocationOrder = "OLDEST_DUE_FIRST";

export const DOCUMENT_KINDS = ["INVOICE", "RECEIPT", "CREDIT_NOTE"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (values as readonly string[]).includes(value);

export const isFeeCategory = isOneOf(FEE_CATEGORIES);
export const isFundingType = isOneOf(FUNDING_TYPES);
export const isPaymentMethod = isOneOf(PAYMENT_METHODS);
export const isInvoiceStatus = isOneOf(INVOICE_STATUSES);
export const isPaymentStatus = isOneOf(PAYMENT_STATUSES);
