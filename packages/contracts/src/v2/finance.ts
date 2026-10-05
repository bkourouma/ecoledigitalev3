/**
 * Contrats du module `finance` (routes `/api/v1/finance/*`). Écrits avant les routes
 * (ADR-001 règle 6) ; le client web est typé à partir de ces schémas.
 *
 * Conventions (ADR-007) :
 *  - MONTANTS : entiers en unités mineures (XOF : le franc). En ENTRÉE, un entier ou une
 *    chaîne décimale entière (`"500000"`), jamais de nombre à virgule ; la devise est portée
 *    par un champ `currency` (défaut `XOF`). En SORTIE, `{ amount: number, currency }`.
 *  - DATES : `YYYY-MM-DD` (date calendaire) ou ISO 8601 UTC (`...Z`) pour les instants.
 *  - IDENTIFIANTS : UUID. Clés d'idempotence : en-tête `Idempotency-Key` ou champ
 *    `idempotencyKey` du corps.
 *  - Valeurs d'énumération en anglais ; libellés en français.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const financeUuidSchema = z.string().uuid();
export const financeDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const isoInstant = z.string().datetime({ offset: true });

export const FINANCE_CURRENCIES = ["XOF", "XAF", "EUR", "USD"] as const;
export const financeCurrencySchema = z.enum(FINANCE_CURRENCIES);

/** Montant en entrée : entier sûr ≥ 0, ou chaîne de chiffres (≤ 15). Jamais de décimale. */
export const financeAmountSchema = z.union([
  z.number().int("Le montant est un entier (unités mineures).").nonnegative().safe(),
  z.string().regex(/^\d{1,15}$/, "Le montant est un entier (chaîne de chiffres)."),
]);
/** Quantité de monnaie strictement positive. */
export const financePositiveAmountSchema = financeAmountSchema.refine((v) => Number(v) > 0, "Le montant doit être strictement positif.");

/** Montant en sortie. */
export const financeMoneyDtoSchema = z.object({ amount: z.number().int(), currency: financeCurrencySchema });
export type FinanceMoneyDto = z.infer<typeof financeMoneyDtoSchema>;

export const FINANCE_FEE_CATEGORIES = [
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
export const financeFeeCategorySchema = z.enum(FINANCE_FEE_CATEGORIES);
export type FinanceFeeCategory = z.infer<typeof financeFeeCategorySchema>;

export const FINANCE_FUNDING_TYPES = ["PRIVATE", "STATE_ASSIGNED", "SCHOLARSHIP", "COMPANY", "STAFF_CHILD", "OTHER"] as const;
export const financeFundingTypeSchema = z.enum(FINANCE_FUNDING_TYPES);

export const FINANCE_PAYMENT_METHODS = ["CASH", "CHEQUE", "TRANSFER", "CARD", "MOBILE_MONEY", "ONLINE"] as const;
export const financePaymentMethodSchema = z.enum(FINANCE_PAYMENT_METHODS);
export const financeManualPaymentMethodSchema = z.enum(["CASH", "CHEQUE", "TRANSFER", "CARD", "MOBILE_MONEY"]);

export const FINANCE_INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED", "CREDITED"] as const;
export const financeInvoiceStatusSchema = z.enum(FINANCE_INVOICE_STATUSES);

export const FINANCE_PAYMENT_STATUSES = ["PENDING", "CONFIRMED", "FAILED", "REFUNDED"] as const;
export const financePaymentStatusSchema = z.enum(FINANCE_PAYMENT_STATUSES);

/** `REFUND_PENDING` : envoyé au fournisseur, sans conclusion ; `COMPLETED` : remboursé ; `REFUND_FAILED` : refus définitif, rien n'est parti. */
export const FINANCE_REFUND_STATUSES = ["REQUESTED", "APPROVED", "REFUND_PENDING", "COMPLETED", "REFUND_FAILED", "REJECTED"] as const;
export const financeRefundStatusSchema = z.enum(FINANCE_REFUND_STATUSES);

export const financePayerKindSchema = z.enum(["LEARNER", "FUNDER"]);
export const financeFunderKindSchema = z.enum(["STATE", "COMPANY", "INSTITUTION", "FOUNDATION", "OTHER"]);
export const financeAllocationOrderSchema = z.enum([
  "OLDEST_DUE_FIRST",
  "NEWEST_DUE_FIRST",
  "SMALLEST_REMAINING_FIRST",
  "LARGEST_REMAINING_FIRST",
  "PROPORTIONAL",
]);

export const financeIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9._:\-]+$/, "Clé d'idempotence : lettres, chiffres, . _ : -");

export const financePageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const financeIdParamsSchema = z.object({ id: financeUuidSchema }).strict();

const optionalText = (max: number) => z.string().trim().min(1).max(max);
const boolQuery = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

// ---------------------------------------------------------------------------
// Catalogue de frais, barèmes, plans, remises
// ---------------------------------------------------------------------------

export const financeCreateFeeBodySchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: optionalText(200),
    category: financeFeeCategorySchema,
    description: optionalText(1000).optional(),
    currency: financeCurrencySchema.optional(),
  })
  .strict();
export type FinanceCreateFeeBody = z.infer<typeof financeCreateFeeBodySchema>;

export const financeListFeesQuerySchema = z.object({
  category: financeFeeCategorySchema.optional(),
  activeOnly: boolQuery.optional(),
});

export const financeSetFeeStatusBodySchema = z.object({ active: z.boolean() }).strict();

export const financeFeeDtoSchema = z.object({
  id: financeUuidSchema,
  code: z.string(),
  name: z.string(),
  category: financeFeeCategorySchema,
  description: z.string().nullable(),
  currency: financeCurrencySchema,
  active: z.boolean(),
});
export type FinanceFeeDto = z.infer<typeof financeFeeDtoSchema>;

export const financeCreateFeeScheduleBodySchema = z
  .object({
    feeId: financeUuidSchema,
    academicYear: optionalText(20),
    amount: financeAmountSchema,
    currency: financeCurrencySchema.optional(),
    institutionId: financeUuidSchema.optional(),
    campusId: financeUuidSchema.optional(),
    levelKey: optionalText(60).optional(),
    trackKey: optionalText(60).optional(),
    learnerType: optionalText(60).optional(),
    effectiveFrom: financeDateSchema,
    effectiveTo: financeDateSchema.optional(),
    planId: financeUuidSchema.optional(),
  })
  .strict();
export type FinanceCreateFeeScheduleBody = z.infer<typeof financeCreateFeeScheduleBodySchema>;

export const financeListSchedulesQuerySchema = z.object({
  feeId: financeUuidSchema.optional(),
  academicYear: z.string().optional(),
  activeOnly: boolQuery.optional(),
});

export const financeResolveFeeQuerySchema = z.object({
  feeId: financeUuidSchema,
  academicYear: z.string().min(1),
  onDate: financeDateSchema.optional(),
  institutionId: financeUuidSchema.optional(),
  campusId: financeUuidSchema.optional(),
  levelKey: z.string().optional(),
  trackKey: z.string().optional(),
  learnerType: z.string().optional(),
});

export const financeFeeScheduleDtoSchema = z.object({
  id: financeUuidSchema,
  feeId: financeUuidSchema,
  academicYear: z.string(),
  scope: z.object({
    institutionId: financeUuidSchema.nullable(),
    campusId: financeUuidSchema.nullable(),
    levelKey: z.string().nullable(),
    trackKey: z.string().nullable(),
    learnerType: z.string().nullable(),
  }),
  amount: financeMoneyDtoSchema,
  effectiveFrom: financeDateSchema,
  effectiveTo: financeDateSchema.nullable(),
  planId: financeUuidSchema.nullable(),
  active: z.boolean(),
});
export type FinanceFeeScheduleDto = z.infer<typeof financeFeeScheduleDtoSchema>;

export const financePlanDueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DATE"), date: financeDateSchema }).strict(),
  z.object({ type: z.literal("OFFSET_DAYS"), days: z.number().int().min(0).max(3650) }).strict(),
  z.object({ type: z.literal("MONTH_DAY"), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }).strict(),
]);

export const financePlanShareSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FIXED"), amount: financePositiveAmountSchema }).strict(),
  z.object({ kind: z.literal("WEIGHT"), weight: z.number().int().min(1) }).strict(),
]);

export const financePlanStepSchema = z.object({ label: optionalText(120), share: financePlanShareSchema, due: financePlanDueSchema }).strict();
export type FinancePlanStep = z.infer<typeof financePlanStepSchema>;

export const financeCreatePlanBodySchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: optionalText(200),
    currency: financeCurrencySchema.optional(),
    steps: z.array(financePlanStepSchema).min(1).max(60),
  })
  .strict();
export type FinanceCreatePlanBody = z.infer<typeof financeCreatePlanBodySchema>;

export const financePlanDtoSchema = z.object({
  id: financeUuidSchema,
  code: z.string(),
  name: z.string(),
  currency: financeCurrencySchema,
  steps: z.array(
    z.object({
      label: z.string(),
      share: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("FIXED"), amount: z.number().int() }),
        z.object({ kind: z.literal("WEIGHT"), weight: z.number().int() }),
      ]),
      due: financePlanDueSchema,
    }),
  ),
  active: z.boolean(),
});

export const financeCreateDiscountBodySchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: optionalText(200),
    kind: z.enum(["PERCENT", "AMOUNT"]),
    /** Points de base : 1 % = 100 ; 10 % = 1000. */
    bps: z.number().int().min(1).max(10_000).optional(),
    amount: financePositiveAmountSchema.optional(),
    capAmount: financePositiveAmountSchema.optional(),
    currency: financeCurrencySchema.optional(),
    categories: z.array(financeFeeCategorySchema).max(11).optional(),
    stackable: z.boolean().optional(),
  })
  .strict();
export type FinanceCreateDiscountBody = z.infer<typeof financeCreateDiscountBodySchema>;

export const financeDiscountDtoSchema = z.object({
  id: financeUuidSchema,
  code: z.string(),
  name: z.string(),
  kind: z.enum(["PERCENT", "AMOUNT"]),
  bps: z.number().int().nullable(),
  amount: financeMoneyDtoSchema.nullable(),
  capAmount: financeMoneyDtoSchema.nullable(),
  categories: z.array(financeFeeCategorySchema).nullable(),
  stackable: z.boolean(),
  active: z.boolean(),
});

// ---------------------------------------------------------------------------
// Financement des apprenants et bourses
// ---------------------------------------------------------------------------

export const financeLearnerParamsSchema = z.object({ learnerId: financeUuidSchema }).strict();

export const financeSetFundingBodySchema = z
  .object({
    fundingType: financeFundingTypeSchema,
    assignmentRef: optionalText(120).optional(),
    /** O-04 : financements CUMULÉS avec le type principal (absent : cumul existant conservé ; null ou liste : remplacé). */
    additionalFundingTypes: z.array(financeFundingTypeSchema.exclude(["PRIVATE"])).max(5).nullable().optional(),
  })
  .strict();

export const financeCreateScholarshipBodySchema = z
  .object({
    learnerId: financeUuidSchema,
    academicYear: optionalText(20),
    funderKind: financeFunderKindSchema,
    funderName: optionalText(200),
    reference: optionalText(120).optional(),
    coverage: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("PERCENT"), bps: z.number().int().min(1).max(10_000) }).strict(),
      z.object({ kind: z.literal("FIXED"), amount: financePositiveAmountSchema }).strict(),
    ]),
    capAmount: financePositiveAmountSchema.optional(),
    currency: financeCurrencySchema.optional(),
    categories: z.array(financeFeeCategorySchema).max(11).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    /** O-04 : base du pourcentage ; `TOTAL` = part du total net (somme des parts contrôlée à 100 % au plus). */
    shareBasis: z.enum(["REMAINING", "TOTAL"]).optional(),
  })
  .strict();
export type FinanceCreateScholarshipBody = z.infer<typeof financeCreateScholarshipBodySchema>;

export const financeScholarshipStatusBodySchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "ENDED"]) }).strict();

export const financeScholarshipDtoSchema = z.object({
  id: financeUuidSchema,
  learnerId: financeUuidSchema,
  academicYear: z.string(),
  funderKind: financeFunderKindSchema,
  funderName: z.string(),
  reference: z.string().nullable(),
  coverage: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("PERCENT"), bps: z.number().int() }),
    z.object({ kind: z.literal("FIXED"), amount: financeMoneyDtoSchema }),
  ]),
  capAmount: financeMoneyDtoSchema.nullable(),
  categories: z.array(financeFeeCategorySchema).nullable(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ENDED"]),
  priority: z.number().int(),
  shareBasis: z.enum(["REMAINING", "TOTAL"]).default("REMAINING"),
});

export const financeLearnerFundingDtoSchema = z.object({
  account: z.object({
    learnerId: financeUuidSchema,
    fundingType: financeFundingTypeSchema,
    assignmentRef: z.string().nullable(),
    additionalFundingTypes: z.array(financeFundingTypeSchema).default([]),
  }),
  scholarships: z.array(financeScholarshipDtoSchema),
});

// ---------------------------------------------------------------------------
// Factures
// ---------------------------------------------------------------------------

export const financeInstallmentSpecSchema = z
  .object({
    planId: financeUuidSchema.optional(),
    planCode: z.string().trim().min(1).max(40).optional(),
    steps: z.array(financePlanStepSchema).min(1).max(60).optional(),
    baseDate: financeDateSchema.optional(),
  })
  .strict();
export type FinanceInstallmentSpec = z.infer<typeof financeInstallmentSpecSchema>;

export const financeInvoiceLineBodySchema = z
  .object({
    feeId: financeUuidSchema.optional(),
    category: financeFeeCategorySchema,
    description: optionalText(300),
    quantity: z.number().int().min(1).max(10_000).optional(),
    unitAmount: financeAmountSchema,
    /** Objet d'un autre module qui produit la ligne (ex. sélection de cours à la carte d'academic) ; sans clé étrangère. */
    sourceRef: financeUuidSchema.optional(),
  })
  .strict();

export const financeCreateInvoiceBodySchema = z
  .object({
    learnerId: financeUuidSchema,
    enrollmentId: financeUuidSchema.optional(),
    academicYear: optionalText(20).optional(),
    currency: financeCurrencySchema.optional(),
    lines: z.array(financeInvoiceLineBodySchema).min(1).max(200),
    groupKey: optionalText(120).optional(),
    groupLabel: optionalText(200).optional(),
    discountIds: z.array(financeUuidSchema).max(20).optional(),
    applyFunding: z.boolean().optional(),
    dueDate: financeDateSchema.optional(),
    installments: financeInstallmentSpecSchema.optional(),
    issue: z.boolean().optional(),
    idempotencyKey: financeIdempotencyKeySchema.optional(),
  })
  .strict();
export type FinanceCreateInvoiceBody = z.infer<typeof financeCreateInvoiceBodySchema>;

export const financeInvoiceFromScheduleBodySchema = z
  .object({
    learnerId: financeUuidSchema,
    enrollmentId: financeUuidSchema.optional(),
    academicYear: optionalText(20).optional(),
    items: z
      .array(
        z
          .object({
            feeId: financeUuidSchema.optional(),
            feeCode: z.string().trim().min(1).max(40).optional(),
            quantity: z.number().int().min(1).max(10_000).optional(),
            description: optionalText(300).optional(),
          })
          .strict()
          .refine((i) => Boolean(i.feeId) !== Boolean(i.feeCode), "Indiquez feeId OU feeCode."),
      )
      .min(1)
      .max(50),
    scope: z
      .object({
        institutionId: financeUuidSchema.optional(),
        campusId: financeUuidSchema.optional(),
        levelKey: optionalText(60).optional(),
        trackKey: optionalText(60).optional(),
        learnerType: optionalText(60).optional(),
      })
      .strict()
      .optional(),
    groupKey: optionalText(120).optional(),
    groupLabel: optionalText(200).optional(),
    effectiveOn: financeDateSchema.optional(),
    discountIds: z.array(financeUuidSchema).max(20).optional(),
    dueDate: financeDateSchema.optional(),
    installments: financeInstallmentSpecSchema.optional(),
    issue: z.boolean().optional(),
    ignoreFunding: z.boolean().optional(),
    idempotencyKey: financeIdempotencyKeySchema.optional(),
  })
  .strict();
export type FinanceInvoiceFromScheduleBody = z.infer<typeof financeInvoiceFromScheduleBodySchema>;

export const financeCancelInvoiceBodySchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

export const financeGenerateInstallmentsBodySchema = financeInstallmentSpecSchema;

export const financeCreditNoteBodySchema = z
  .object({ amount: financePositiveAmountSchema, currency: financeCurrencySchema.optional(), reason: z.string().trim().min(5).max(500) })
  .strict();

export const financeListInvoicesQuerySchema = financePageQuerySchema.extend({
  learnerId: financeUuidSchema.optional(),
  academicYear: z.string().optional(),
  status: financeInvoiceStatusSchema.optional(),
  groupKey: z.string().optional(),
  payerKind: financePayerKindSchema.optional(),
});

export const financeInvoiceLineDtoSchema = z.object({
  id: financeUuidSchema,
  position: z.number().int(),
  feeId: financeUuidSchema.nullable(),
  category: financeFeeCategorySchema,
  description: z.string(),
  quantity: z.number().int(),
  unitAmount: financeMoneyDtoSchema,
  gross: financeMoneyDtoSchema,
  discount: financeMoneyDtoSchema,
  scholarship: financeMoneyDtoSchema,
  total: financeMoneyDtoSchema,
  sourceRef: financeUuidSchema.nullable(),
});

export const financeInstallmentDtoSchema = z.object({
  id: financeUuidSchema,
  seq: z.number().int(),
  label: z.string(),
  dueDate: financeDateSchema,
  amount: financeMoneyDtoSchema,
  paid: financeMoneyDtoSchema,
  credited: financeMoneyDtoSchema,
  remaining: financeMoneyDtoSchema,
  status: z.enum(["PENDING", "PARTIALLY_PAID", "PAID", "OVERDUE", "CREDITED"]),
});

export const financeInvoiceSummaryDtoSchema = z.object({
  id: financeUuidSchema,
  number: z.string().nullable(),
  status: financeInvoiceStatusSchema,
  learnerId: financeUuidSchema,
  enrollmentId: financeUuidSchema.nullable(),
  academicYear: z.string(),
  groupKey: z.string().nullable(),
  groupLabel: z.string().nullable(),
  payerKind: financePayerKindSchema,
  payerRef: z.string().nullable(),
  fundingType: financeFundingTypeSchema.nullable(),
  relatedGroupId: financeUuidSchema.nullable(),
  subtotal: financeMoneyDtoSchema,
  discount: financeMoneyDtoSchema,
  scholarship: financeMoneyDtoSchema,
  total: financeMoneyDtoSchema,
  paid: financeMoneyDtoSchema,
  credited: financeMoneyDtoSchema,
  balance: financeMoneyDtoSchema,
  dueDate: financeDateSchema,
  issuedAt: isoInstant.nullable(),
  cancelledAt: isoInstant.nullable(),
  cancelReason: z.string().nullable(),
  createdAt: isoInstant,
});
export type FinanceInvoiceSummaryDto = z.infer<typeof financeInvoiceSummaryDtoSchema>;

export const financeInvoiceDetailDtoSchema = financeInvoiceSummaryDtoSchema.extend({
  lines: z.array(financeInvoiceLineDtoSchema),
  installments: z.array(financeInstallmentDtoSchema),
  discounts: z.array(z.object({ discountId: financeUuidSchema, amount: financeMoneyDtoSchema })),
});
export type FinanceInvoiceDetailDto = z.infer<typeof financeInvoiceDetailDtoSchema>;

export const financeInvoicesResultDtoSchema = z.object({
  replayed: z.boolean(),
  invoices: z.array(financeInvoiceDetailDtoSchema),
});

export const financeInvoicePreviewDtoSchema = z.object({
  invoices: z.array(
    z.object({
      payerKind: financePayerKindSchema,
      payerRef: z.string().nullable(),
      label: z.string(),
      lines: z.array(financeInvoiceLineDtoSchema),
      subtotal: financeMoneyDtoSchema,
      discount: financeMoneyDtoSchema,
      scholarship: financeMoneyDtoSchema,
      total: financeMoneyDtoSchema,
      installments: z.array(z.object({ seq: z.number().int(), label: z.string(), dueDate: financeDateSchema, amount: financeMoneyDtoSchema })),
      dueDate: financeDateSchema,
    }),
  ),
});

export const financeCreditNoteDtoSchema = z.object({
  id: financeUuidSchema,
  number: z.string(),
  invoiceId: financeUuidSchema,
  learnerId: financeUuidSchema,
  amount: financeMoneyDtoSchema,
  reason: z.string(),
  applications: z.array(z.object({ installmentId: financeUuidSchema, amount: z.number().int() })),
  issuedAt: isoInstant,
});

// ---------------------------------------------------------------------------
// Paiements, imputations, reçus
// ---------------------------------------------------------------------------

export const financeAllocationSpecSchema = z.discriminatedUnion("mode", [
  z
    .object({ mode: z.literal("AUTO"), order: financeAllocationOrderSchema.optional(), invoiceIds: z.array(financeUuidSchema).max(50).optional() })
    .strict(),
  z
    .object({
      mode: z.literal("MANUAL"),
      items: z
        .array(z.object({ installmentId: financeUuidSchema, amount: financePositiveAmountSchema, lineId: financeUuidSchema.optional() }).strict())
        .min(1)
        .max(100),
    })
    .strict(),
  z.object({ mode: z.literal("NONE") }).strict(),
]);
export type FinanceAllocationSpec = z.infer<typeof financeAllocationSpecSchema>;

export const financeRecordPaymentBodySchema = z
  .object({
    idempotencyKey: financeIdempotencyKeySchema.optional(),
    learnerId: financeUuidSchema,
    enrollmentId: financeUuidSchema.optional(),
    amount: financePositiveAmountSchema,
    currency: financeCurrencySchema.optional(),
    method: financeManualPaymentMethodSchema,
    reference: optionalText(120).optional(),
    payerName: optionalText(200).optional(),
    payerKind: financePayerKindSchema.optional(),
    payerRef: optionalText(120).optional(),
    allocation: financeAllocationSpecSchema.optional(),
    receivedAt: isoInstant.optional(),
  })
  .strict();
export type FinanceRecordPaymentBody = z.infer<typeof financeRecordPaymentBodySchema>;

export const financeInitiateOnlinePaymentBodySchema = z
  .object({
    idempotencyKey: financeIdempotencyKeySchema.optional(),
    learnerId: financeUuidSchema,
    enrollmentId: financeUuidSchema.optional(),
    amount: financePositiveAmountSchema,
    currency: financeCurrencySchema.optional(),
    provider: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    invoiceId: financeUuidSchema.optional(),
    payer: z
      .object({ phoneNumber: optionalText(30).optional(), name: optionalText(200).optional(), email: z.string().email().optional() })
      .strict()
      .optional(),
    returnUrl: z.string().url().max(500).optional(),
    description: optionalText(200).optional(),
    metadata: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
  })
  .strict();
export type FinanceInitiateOnlinePaymentBody = z.infer<typeof financeInitiateOnlinePaymentBodySchema>;

export const financeAllocatePaymentBodySchema = z
  .object({ allocation: z.discriminatedUnion("mode", [financeAllocationSpecSchema.options[0], financeAllocationSpecSchema.options[1]]) })
  .strict();

export const financeListPaymentsQuerySchema = financePageQuerySchema.extend({
  learnerId: financeUuidSchema.optional(),
  status: financePaymentStatusSchema.optional(),
  method: financePaymentMethodSchema.optional(),
  from: isoInstant.optional(),
  to: isoInstant.optional(),
});

export const financeListReceiptsQuerySchema = financePageQuerySchema.extend({ learnerId: financeUuidSchema.optional() });

export const financePaymentDtoSchema = z.object({
  id: financeUuidSchema,
  learnerId: financeUuidSchema,
  enrollmentId: financeUuidSchema.nullable(),
  payerKind: financePayerKindSchema,
  payerRef: z.string().nullable(),
  payerName: z.string().nullable(),
  method: financePaymentMethodSchema,
  status: financePaymentStatusSchema,
  amount: financeMoneyDtoSchema,
  allocated: financeMoneyDtoSchema,
  refunded: financeMoneyDtoSchema,
  unallocated: financeMoneyDtoSchema,
  provider: z.string().nullable(),
  providerRef: z.string().nullable(),
  simulated: z.boolean(),
  reference: z.string().nullable(),
  cashSessionId: financeUuidSchema.nullable(),
  receivedAt: isoInstant,
  confirmedAt: isoInstant.nullable(),
  failureReason: z.string().nullable(),
});
export type FinancePaymentDto = z.infer<typeof financePaymentDtoSchema>;

export const financeAllocationDtoSchema = z.object({
  id: financeUuidSchema,
  invoiceId: financeUuidSchema,
  installmentId: financeUuidSchema,
  lineId: financeUuidSchema.nullable(),
  amount: financeMoneyDtoSchema,
  reversed: financeMoneyDtoSchema,
  net: financeMoneyDtoSchema,
});

export const financeReceiptDtoSchema = z.object({
  id: financeUuidSchema,
  number: z.string(),
  paymentId: financeUuidSchema,
  learnerId: financeUuidSchema,
  amount: financeMoneyDtoSchema,
  issuedAt: isoInstant,
  snapshot: z.object({
    v: z.literal(1),
    number: z.string(),
    issuedAt: isoInstant,
    method: financePaymentMethodSchema,
    reference: z.string().nullable(),
    payer: z.object({ kind: financePayerKindSchema, ref: z.string().nullable(), name: z.string().nullable() }),
    allocations: z.array(
      z.object({
        invoiceId: financeUuidSchema,
        invoiceNumber: z.string().nullable(),
        installmentId: financeUuidSchema,
        label: z.string(),
        amount: z.number().int(),
      }),
    ),
    unallocated: financeMoneyDtoSchema,
    balanceAfter: financeMoneyDtoSchema.nullable(),
  }),
});
export type FinanceReceiptDto = z.infer<typeof financeReceiptDtoSchema>;

export const financePaymentViewDtoSchema = z.object({
  payment: financePaymentDtoSchema,
  receipt: financeReceiptDtoSchema.nullable(),
  allocations: z.array(financeAllocationDtoSchema),
  replayed: z.boolean(),
});

export const financeOnlinePaymentDtoSchema = financePaymentViewDtoSchema.extend({
  instructions: z
    .object({
      ussdCode: z.string().optional(),
      instructions: z.string().optional(),
      qrCode: z.string().optional(),
      redirectUrl: z.string().optional(),
      expiresAt: isoInstant.optional(),
    })
    .nullable(),
});

export const financeWebhookParamsSchema = z.object({ provider: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), tenantId: financeUuidSchema }).strict();

export const financeWebhookResultDtoSchema = z.object({
  status: z.enum(["RECEIVED", "PROCESSED", "IGNORED", "FAILED"]),
  replayed: z.boolean(),
  paymentId: financeUuidSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Événements webhook en échec : lecture et relecture (rejeu) sûres
// ---------------------------------------------------------------------------

export const FINANCE_WEBHOOK_EVENT_STATUSES = ["RECEIVED", "PROCESSED", "IGNORED", "FAILED"] as const;

/** `status` vaut `FAILED` par défaut : l'écran sert à traiter les événements que le module n'a pas pu appliquer. */
export const financeListWebhookEventsQuerySchema = financePageQuerySchema.extend({
  status: z.enum(FINANCE_WEBHOOK_EVENT_STATUSES).default("FAILED"),
  provider: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  paymentId: financeUuidSchema.optional(),
});

/**
 * Vue d'un événement webhook : JAMAIS la charge brute (`payload`), ni en-têtes, ni signature, ni secret. `error` est un
 * CODE court (ex. `finance.provider_amount_mismatch`), jamais un message du fournisseur.
 */
export const financeWebhookEventDtoSchema = z.object({
  id: financeUuidSchema,
  provider: z.string(),
  eventId: z.string(),
  eventType: z.string().nullable(),
  status: z.enum(FINANCE_WEBHOOK_EVENT_STATUSES),
  paymentId: financeUuidSchema.nullable(),
  error: z.string().nullable(),
  attempts: z.number().int().min(1),
  receivedAt: isoInstant,
  processedAt: isoInstant.nullable(),
});
export type FinanceWebhookEventDto = z.infer<typeof financeWebhookEventDtoSchema>;

export const financeWebhookEventsDtoSchema = z.object({ items: z.array(financeWebhookEventDtoSchema), total: z.number().int().min(0) });
export type FinanceWebhookEventsDto = z.infer<typeof financeWebhookEventsDtoSchema>;

/** Rejeu : motif facultatif (journal d'audit). Aucun montant, aucune issue : le serveur interroge le fournisseur. */
export const financeReplayWebhookEventBodySchema = z.object({ note: z.string().trim().min(1).max(500).optional() }).strict();

export const financeReplayWebhookEventResultDtoSchema = z.object({
  /** Vrai : l'événement n'était plus `FAILED`, rien n'a été retraité. */
  replayed: z.boolean(),
  /** Vrai : l'événement est sorti de l'état `FAILED` à ce rejeu. */
  resolved: z.boolean(),
  event: financeWebhookEventDtoSchema,
  paymentStatus: z.string().nullable(),
});
export type FinanceReplayWebhookEventResultDto = z.infer<typeof financeReplayWebhookEventResultDtoSchema>;

// ---------------------------------------------------------------------------
// Remboursements
// ---------------------------------------------------------------------------

export const financeRequestRefundBodySchema = z
  .object({
    idempotencyKey: financeIdempotencyKeySchema.optional(),
    amount: financePositiveAmountSchema,
    currency: financeCurrencySchema.optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();

/**
 * Repli MANUEL explicite pour un fournisseur sans API de remboursement (Orange Money, CinetPay), un partiel refusé par
 * le fournisseur (Wave) ou un fournisseur indisponible : l'exécutant atteste avoir remboursé à la main et fournit la
 * référence de preuve. Refusé (409) quand le fournisseur sait rembourser lui-même.
 */
export const financeManualRefundEvidenceSchema = z
  .object({ reference: z.string().trim().min(3).max(120), note: z.string().trim().max(500).optional() })
  .strict();

export const financeApproveRefundBodySchema = z.object({ complete: z.boolean().optional(), manual: financeManualRefundEvidenceSchema.optional() }).strict();
export const financeCompleteRefundBodySchema = z.object({ manual: financeManualRefundEvidenceSchema.optional() }).strict();
export const financeRejectRefundBodySchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

export const financeListRefundsQuerySchema = financePageQuerySchema.extend({
  paymentId: financeUuidSchema.optional(),
  status: financeRefundStatusSchema.optional(),
});

export const financeRefundDtoSchema = z.object({
  id: financeUuidSchema,
  paymentId: financeUuidSchema,
  amount: financeMoneyDtoSchema,
  reason: z.string(),
  status: financeRefundStatusSchema,
  requestedBy: financeUuidSchema,
  requestedAt: isoInstant,
  approvedBy: financeUuidSchema.nullable(),
  approvedAt: isoInstant.nullable(),
  completedAt: isoInstant.nullable(),
  rejectedBy: financeUuidSchema.nullable(),
  rejectedAt: isoInstant.nullable(),
  rejectionReason: z.string().nullable(),
  cashSessionId: financeUuidSchema.nullable(),
  /** `LEDGER` : écriture comptable seule ; `PROVIDER` : remboursé par le fournisseur ; `MANUAL` : à la main avec preuve ; `null` : pas encore exécuté. */
  // Ajouts (spec 015) : `default(null)` garde la compatibilité des clients et jeux d'essai antérieurs au remboursement fournisseur.
  executionMode: z.enum(["LEDGER", "PROVIDER", "MANUAL"]).nullable().default(null),
  provider: z.string().nullable().default(null),
  providerStatus: z.string().nullable().default(null),
  providerRequestedAt: isoInstant.nullable().default(null),
  failedAt: isoInstant.nullable().default(null),
  failureReason: z.string().nullable().default(null),
  manualReference: z.string().nullable().default(null),
});
export type FinanceRefundDto = z.infer<typeof financeRefundDtoSchema>;

// ---------------------------------------------------------------------------
// Rapprochement des paiements en attente et résolutions manuelles (spec 015)
// ---------------------------------------------------------------------------

/** Motifs de signalement `reconciliation_needed` (codes courts stables, jamais un message du fournisseur). */
export const FINANCE_RECONCILIATION_REASONS = [
  "unverifiable_no_provider_ref",
  "unverifiable_refund",
  "attempts_exhausted",
  "provider_unavailable",
  "provider_amount_mismatch",
  "provider_reference_mismatch",
  "provider_failed",
  "simulated_payment_in_production",
  "refund_exceeds_refundable",
  "payment_not_confirmed",
] as const;

export const financeListPendingPaymentsQuerySchema = financePageQuerySchema.extend({
  /** `true` : seulement les paiements signalés (action humaine requise) ; `false` : ceux que le job traite encore. */
  flagged: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  provider: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/).optional(),
  /** Reçus depuis au moins N minutes. */
  olderThanMinutes: z.coerce.number().int().min(0).max(525_600).optional(),
});

export const financeReconciliationDtoSchema = z.object({
  attempts: z.number().int().min(0),
  firstAttemptAt: isoInstant.nullable(),
  lastAttemptAt: isoInstant.nullable(),
  nextAttemptAt: isoInstant,
  lastOutcome: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  flaggedAt: isoInstant.nullable(),
  flagReason: z.string().nullable(),
});
export type FinanceReconciliationDto = z.infer<typeof financeReconciliationDtoSchema>;

export const financePendingPaymentDtoSchema = z.object({
  payment: financePaymentDtoSchema,
  reconciliation: financeReconciliationDtoSchema.nullable(),
  /** Demande de résolution manuelle en attente d'approbation (quatre yeux), s'il y en a une. */
  openResolutionId: financeUuidSchema.nullable(),
});
export type FinancePendingPaymentDto = z.infer<typeof financePendingPaymentDtoSchema>;

export const financePendingPaymentsDtoSchema = z.object({ items: z.array(financePendingPaymentDtoSchema), total: z.number().int().min(0) });
export type FinancePendingPaymentsDto = z.infer<typeof financePendingPaymentsDtoSchema>;

export const FINANCE_RESOLUTION_OUTCOMES = ["SUCCEEDED", "FAILED"] as const;
export const FINANCE_RESOLUTION_STATUSES = ["REQUESTED", "APPROVED", "REJECTED"] as const;

/** Demande de résolution manuelle : un paiement OU un remboursement, ce qui s'est réellement passé, un motif et une preuve. */
export const financeRequestResolutionBodySchema = z
  .object({
    paymentId: financeUuidSchema.optional(),
    refundId: financeUuidSchema.optional(),
    outcome: z.enum(FINANCE_RESOLUTION_OUTCOMES),
    reason: z.string().trim().min(10).max(500),
    evidenceRef: z.string().trim().min(3).max(120),
  })
  .strict()
  .refine((b) => (b.paymentId === undefined) !== (b.refundId === undefined), { message: "Désignez un paiement OU un remboursement.", path: ["paymentId"] });

export const financeDecideResolutionBodySchema = z.object({ note: z.string().trim().max(500).optional() }).strict();

export const financeListResolutionsQuerySchema = financePageQuerySchema.extend({
  status: z.enum(FINANCE_RESOLUTION_STATUSES).optional(),
  paymentId: financeUuidSchema.optional(),
  refundId: financeUuidSchema.optional(),
});

export const financeResolutionDtoSchema = z.object({
  id: financeUuidSchema,
  paymentId: financeUuidSchema.nullable(),
  refundId: financeUuidSchema.nullable(),
  outcome: z.enum(FINANCE_RESOLUTION_OUTCOMES),
  reason: z.string(),
  evidenceRef: z.string(),
  status: z.enum(FINANCE_RESOLUTION_STATUSES),
  requestedBy: financeUuidSchema,
  requestedAt: isoInstant,
  decidedBy: financeUuidSchema.nullable(),
  decidedAt: isoInstant.nullable(),
  decisionNote: z.string().nullable(),
});
export type FinanceResolutionDto = z.infer<typeof financeResolutionDtoSchema>;

// ---------------------------------------------------------------------------
// Caisses
// ---------------------------------------------------------------------------

export const financeCreateCashRegisterBodySchema = z
  .object({ code: z.string().trim().min(1).max(40), name: optionalText(200), campusId: financeUuidSchema.optional() })
  .strict();

export const financeOpenCashSessionBodySchema = z
  .object({ openingFloat: financeAmountSchema, currency: financeCurrencySchema.optional() })
  .strict();

export const financeCloseCashSessionBodySchema = z
  .object({ countedAmount: financeAmountSchema, currency: financeCurrencySchema.optional(), note: optionalText(500).optional() })
  .strict();

export const financeListCashSessionsQuerySchema = financePageQuerySchema.extend({
  registerId: financeUuidSchema.optional(),
  cashierId: financeUuidSchema.optional(),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
});

export const financeCashRegisterDtoSchema = z.object({
  id: financeUuidSchema,
  code: z.string(),
  name: z.string(),
  campusId: financeUuidSchema.nullable(),
  active: z.boolean(),
});

export const financeCashSessionDtoSchema = z.object({
  id: financeUuidSchema,
  registerId: financeUuidSchema,
  cashierId: financeUuidSchema,
  status: z.enum(["OPEN", "CLOSED"]),
  openingFloat: financeMoneyDtoSchema,
  openedAt: isoInstant,
  closedAt: isoInstant.nullable(),
  expected: financeMoneyDtoSchema.nullable(),
  counted: financeMoneyDtoSchema.nullable(),
  /** compté − attendu (négatif = manquant). */
  variance: z.object({ amount: z.number().int(), currency: financeCurrencySchema }).nullable(),
  closeNote: z.string().nullable(),
});

export const financeCashSessionSummaryDtoSchema = z.object({
  session: financeCashSessionDtoSchema,
  movements: z.object({
    received: financeMoneyDtoSchema,
    refunded: financeMoneyDtoSchema,
    paymentCount: z.number().int(),
    refundCount: z.number().int(),
  }),
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export const financeReportQuerySchema = z.object({
  academicYear: z.string().optional(),
  campusId: financeUuidSchema.optional(),
  groupKey: z.string().optional(),
  asOf: financeDateSchema.optional(),
  currency: financeCurrencySchema.optional(),
});

export const financeReceivablesByLearnerQuerySchema = financeReportQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  onlyOutstanding: boolQuery.optional(),
});

export const financeCollectionsTrendQuerySchema = z.object({
  from: financeDateSchema,
  to: financeDateSchema,
  granularity: z.enum(["day", "week", "month"]).optional(),
  currency: financeCurrencySchema.optional(),
});

export const financeAgedBalanceQuerySchema = financeReportQuerySchema.extend({
  byLearner: z.coerce.number().int().min(1).max(500).optional(),
});

export const financeSummaryDtoSchema = z.object({
  currency: financeCurrencySchema,
  asOf: financeDateSchema,
  invoiceCount: z.number().int(),
  billed: financeMoneyDtoSchema,
  credited: financeMoneyDtoSchema,
  netBilled: financeMoneyDtoSchema,
  collected: financeMoneyDtoSchema,
  outstanding: financeMoneyDtoSchema,
  overdue: financeMoneyDtoSchema,
  overdueInvoiceCount: z.number().int(),
  unallocatedPayments: financeMoneyDtoSchema,
  /** Points de base (8750 = 87,50 %) ; `null` s'il n'y a rien à recouvrer. */
  collectionRateBps: z.number().int().min(0).max(10_000).nullable(),
});
export type FinanceSummaryDto = z.infer<typeof financeSummaryDtoSchema>;

export const financeReceivableRowDtoSchema = z.object({
  key: z.string().nullable(),
  label: z.string().nullable(),
  invoiceCount: z.number().int(),
  learnerCount: z.number().int(),
  billed: financeMoneyDtoSchema,
  credited: financeMoneyDtoSchema,
  collected: financeMoneyDtoSchema,
  outstanding: financeMoneyDtoSchema,
  overdue: financeMoneyDtoSchema,
  collectionRateBps: z.number().int().min(0).max(10_000).nullable(),
});

export const financeLearnerReceivableRowDtoSchema = financeReceivableRowDtoSchema.extend({
  learnerId: financeUuidSchema,
  /** « NOM Prénom » (lecture par lot dans `people`) ; `null` si inconnu ou indisponible. */
  learnerName: z.string().nullable().optional(),
  oldestOverdueDate: financeDateSchema.nullable(),
});

export const financeTrendPointDtoSchema = z.object({
  bucket: financeDateSchema,
  collected: financeMoneyDtoSchema,
  refunded: financeMoneyDtoSchema,
  net: financeMoneyDtoSchema,
  paymentCount: z.number().int(),
});

export const FINANCE_AGING_BUCKETS = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_PLUS"] as const;

export const financeAgedBalanceDtoSchema = z.object({
  asOf: financeDateSchema,
  currency: financeCurrencySchema,
  buckets: z.record(z.enum(FINANCE_AGING_BUCKETS), z.object({ amount: financeMoneyDtoSchema, invoiceCount: z.number().int() })),
  total: financeMoneyDtoSchema,
  learners: z.array(z.object({ learnerId: financeUuidSchema, buckets: z.record(z.enum(FINANCE_AGING_BUCKETS), financeMoneyDtoSchema), total: financeMoneyDtoSchema })),
});

export const financeLearnerStatementDtoSchema = z.object({
  learnerId: financeUuidSchema,
  currency: financeCurrencySchema,
  invoices: z.array(financeInvoiceSummaryDtoSchema),
  payments: z.array(financePaymentDtoSchema),
  totals: z.object({
    billed: financeMoneyDtoSchema,
    credited: financeMoneyDtoSchema,
    collected: financeMoneyDtoSchema,
    outstanding: financeMoneyDtoSchema,
    unallocatedPayments: financeMoneyDtoSchema,
  }),
});

// ---------------------------------------------------------------------------
// Vues FAMILLE (`/finance/me/*`) : parent (`finance.child.*`) et élève (`finance.self.*`)
//
// Accès filtré par lien de tutelle / identité de l'élève, relu côté serveur ; toute ressource hors périmètre répond la même
// 404 `finance.not_found`. Seules les factures ÉMISES et paiements à la charge de la FAMILLE (`payerKind = LEARNER`) sont
// exposés. Les champs internes (`payerRef`, `cancelReason`, `providerRef`, `simulated`, `cashSessionId`) sont retirés.
// ---------------------------------------------------------------------------

export const FINANCE_FAMILY_RELATIONS = ["SELF", "GUARDIAN"] as const;
export const financeFamilyRelationSchema = z.enum(FINANCE_FAMILY_RELATIONS);

/** Non strict : les routes imbriquées (`:learnerId/invoices/:id`) portent aussi `id`. */
export const financeFamilyLearnerParamsSchema = z.object({ learnerId: financeUuidSchema });
export const financeFamilyItemParamsSchema = z.object({ learnerId: financeUuidSchema, id: financeUuidSchema }).strict();

export const financeFamilyStatementQuerySchema = z.object({ academicYear: z.string().trim().min(1).max(20).optional(), currency: financeCurrencySchema.optional() }).strict();
export const financeFamilyInvoicesQuerySchema = financePageQuerySchema.extend({
  academicYear: z.string().trim().min(1).max(20).optional(),
  status: financeInvoiceStatusSchema.optional(),
});
export const financeFamilyInstallmentsQuerySchema = z.object({ open: boolQuery.optional() });
export const financeFamilyPaymentsQuerySchema = financePageQuerySchema.extend({ status: financePaymentStatusSchema.optional() });
export const financeFamilyReceiptsQuerySchema = financePageQuerySchema;

export const financeFamilyLearnerDtoSchema = z.object({ learnerId: financeUuidSchema, relation: financeFamilyRelationSchema, displayName: z.string().nullable().optional() });
export type FinanceFamilyLearnerDto = z.infer<typeof financeFamilyLearnerDtoSchema>;
export const financeFamilyLearnersDtoSchema = z.object({ items: z.array(financeFamilyLearnerDtoSchema) });

export const financeFamilyInvoiceSummaryDtoSchema = financeInvoiceSummaryDtoSchema.omit({ payerRef: true, cancelReason: true });
export type FinanceFamilyInvoiceSummaryDto = z.infer<typeof financeFamilyInvoiceSummaryDtoSchema>;
export const financeFamilyInvoiceDetailDtoSchema = financeFamilyInvoiceSummaryDtoSchema.extend({
  lines: z.array(financeInvoiceLineDtoSchema),
  installments: z.array(financeInstallmentDtoSchema),
  discounts: z.array(z.object({ discountId: financeUuidSchema, amount: financeMoneyDtoSchema })),
});
export type FinanceFamilyInvoiceDetailDto = z.infer<typeof financeFamilyInvoiceDetailDtoSchema>;

export const financeFamilyInstallmentDtoSchema = financeInstallmentDtoSchema.extend({
  invoiceId: financeUuidSchema,
  invoiceNumber: z.string(),
  invoiceStatus: financeInvoiceStatusSchema,
  academicYear: z.string(),
});
export type FinanceFamilyInstallmentDto = z.infer<typeof financeFamilyInstallmentDtoSchema>;

export const financeFamilyPaymentDtoSchema = financePaymentDtoSchema.omit({ payerRef: true, providerRef: true, simulated: true, cashSessionId: true });
export type FinanceFamilyPaymentDto = z.infer<typeof financeFamilyPaymentDtoSchema>;
export const financeFamilyPaymentViewDtoSchema = z.object({
  payment: financeFamilyPaymentDtoSchema,
  receipt: financeReceiptDtoSchema.nullable(),
  allocations: z.array(financeAllocationDtoSchema),
  replayed: z.boolean(),
});
export const financeFamilyOnlinePaymentDtoSchema = financeFamilyPaymentViewDtoSchema.extend({ instructions: financeOnlinePaymentDtoSchema.shape.instructions });

export const financeFamilyStatementDtoSchema = z.object({
  learnerId: financeUuidSchema,
  currency: financeCurrencySchema,
  invoices: z.array(financeFamilyInvoiceSummaryDtoSchema),
  payments: z.array(financeFamilyPaymentDtoSchema),
  totals: financeLearnerStatementDtoSchema.shape.totals,
});
export type FinanceFamilyStatementDto = z.infer<typeof financeFamilyStatementDtoSchema>;

/** Paiement en ligne initié par le parent (ou l'élève) : la facture visée est OBLIGATOIRE, le montant ≤ son reste dû. */
export const financeFamilyInitiatePaymentBodySchema = z
  .object({
    idempotencyKey: financeIdempotencyKeySchema.optional(),
    invoiceId: financeUuidSchema,
    amount: financePositiveAmountSchema,
    currency: financeCurrencySchema.optional(),
    provider: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
    payer: financeInitiateOnlinePaymentBodySchema.shape.payer,
    returnUrl: z.string().url().max(500).optional(),
    description: optionalText(200).optional(),
  })
  .strict();
export type FinanceFamilyInitiatePaymentBody = z.infer<typeof financeFamilyInitiatePaymentBodySchema>;

// ---------------------------------------------------------------------------
// Exports CSV serveur : `GET /finance/exports/{invoices|payments|receivables}` (+ `/meta` en JSON)
//
// Le fichier contient TOUTES les lignes du filtre jusqu'à un plafond (`FINANCE_EXPORT_MAX_ROWS`, défaut 50 000). Au-delà il
// est TRONQUÉ et la troncature est signalée par les en-têtes `X-Export-*` ET par la route `/meta` (JSON, lisible par le client
// typé sans toucher aux en-têtes) : un export tronqué n'est jamais présenté comme complet.
// ---------------------------------------------------------------------------

export const FINANCE_EXPORT_DATASETS = ["invoices", "payments", "receivables"] as const;
export const financeExportDatasetSchema = z.enum(FINANCE_EXPORT_DATASETS);
export type FinanceExportDataset = z.infer<typeof financeExportDatasetSchema>;
/** Plafond par défaut d'un export (lignes) : documenté, surchargé par `FINANCE_EXPORT_MAX_ROWS` côté serveur. */
export const FINANCE_EXPORT_DEFAULT_MAX_ROWS = 50_000;

/** En-têtes de réponse d'un export CSV (noms en minuscules, comme les expose `fetch`). */
export const FINANCE_EXPORT_HEADERS = Object.freeze({
  truncated: "x-export-truncated",
  rowCount: "x-export-row-count",
  totalCount: "x-export-total-count",
  maxRows: "x-export-max-rows",
});

export const financeExportInvoicesQuerySchema = z.object({
  learnerId: financeUuidSchema.optional(),
  academicYear: z.string().optional(),
  status: financeInvoiceStatusSchema.optional(),
  groupKey: z.string().optional(),
  payerKind: financePayerKindSchema.optional(),
});
export const financeExportPaymentsQuerySchema = z.object({
  learnerId: financeUuidSchema.optional(),
  status: financePaymentStatusSchema.optional(),
  method: financePaymentMethodSchema.optional(),
  from: isoInstant.optional(),
  to: isoInstant.optional(),
});
export const financeExportReceivablesQuerySchema = financeReportQuerySchema.extend({ onlyOutstanding: boolQuery.optional() });

export const financeExportMetaDtoSchema = z.object({
  dataset: financeExportDatasetSchema,
  /** Lignes correspondant au filtre. */
  totalCount: z.number().int().nonnegative(),
  /** Lignes présentes dans le fichier : `min(totalCount, maxRows)`. */
  rowCount: z.number().int().nonnegative(),
  maxRows: z.number().int().positive(),
  truncated: z.boolean(),
});
export type FinanceExportMetaDto = z.infer<typeof financeExportMetaDtoSchema>;

/**
 * Lit les en-têtes `X-Export-*` d'une réponse d'export (`get` = `headers.get` de fetch). `null` si l'un manque : l'appelant
 * doit alors traiter l'export comme POTENTIELLEMENT tronqué (jamais comme complet).
 */
export function parseFinanceExportHeaders(get: (name: string) => string | null | undefined): { truncated: boolean; rowCount: number; totalCount: number; maxRows: number } | null {
  const truncated = get(FINANCE_EXPORT_HEADERS.truncated);
  const rowCount = Number(get(FINANCE_EXPORT_HEADERS.rowCount));
  const totalCount = Number(get(FINANCE_EXPORT_HEADERS.totalCount));
  const maxRows = Number(get(FINANCE_EXPORT_HEADERS.maxRows));
  if ((truncated !== "true" && truncated !== "false") || ![rowCount, totalCount, maxRows].every((n) => Number.isInteger(n) && n >= 0)) return null;
  return { truncated: truncated === "true", rowCount, totalCount, maxRows };
}

// ---------------------------------------------------------------------------
// Listes paginées
// ---------------------------------------------------------------------------

export const financePageDtoSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() });

// ---------------------------------------------------------------------------
// Fournisseurs de paiement : configuration par tenant (spec 015-payments). AUCUN secret n'est jamais renvoyé :
// les réponses indiquent seulement quels secrets sont ENREGISTRÉS.
// ---------------------------------------------------------------------------

export const FINANCE_PROVIDER_NAMES = ["orange_money", "mtn_momo", "wave", "cinetpay", "tresorpay"] as const;
export const financeProviderNameSchema = z.enum(FINANCE_PROVIDER_NAMES);
export type FinanceProviderName = z.infer<typeof financeProviderNameSchema>;

export const FINANCE_PROVIDER_MODES = ["sandbox", "production"] as const;
export const financeProviderModeSchema = z.enum(FINANCE_PROVIDER_MODES);

export const financeProviderParamsSchema = z.object({ provider: financeProviderNameSchema }).strict();

const providerFieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const providerFieldValueSchema = z.string().min(1).max(512);

/** Écriture : mode, réglages non secrets et secrets (un secret omis est conservé). Aucune URL de point d'accès. */
export const financeSaveProviderBodySchema = z
  .object({
    mode: financeProviderModeSchema.optional(),
    settings: z.record(providerFieldKeySchema, providerFieldValueSchema).optional(),
    secrets: z.record(providerFieldKeySchema, providerFieldValueSchema).optional(),
    clearSecrets: z.array(providerFieldKeySchema).max(20).optional(),
    regenerateWebhookSecret: z.boolean().optional(),
  })
  .strict();
export type FinanceSaveProviderBody = z.infer<typeof financeSaveProviderBodySchema>;

export const financeProviderStatusBodySchema = z.object({ enabled: z.boolean() }).strict();

export const financeProviderFieldDtoSchema = z.object({
  key: z.string(),
  label: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  kind: z.enum(["text", "select"]),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  generated: z.boolean(),
  help: z.string().optional(),
  /** Secret : seulement « enregistré ou non ». Non secret : la valeur. */
  isSet: z.boolean(),
  value: z.string().nullable(),
});
export type FinanceProviderFieldDto = z.infer<typeof financeProviderFieldDtoSchema>;

export const financeProviderTestDtoSchema = z.object({
  at: isoInstant,
  ok: z.boolean(),
  code: z.string(),
});

export const financeProviderDtoSchema = z.object({
  provider: financeProviderNameSchema,
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** Une configuration existe pour ce tenant. */
  configured: z.boolean(),
  /** Tous les champs obligatoires sont renseignés. */
  complete: z.boolean(),
  missing: z.array(z.string()),
  mode: financeProviderModeSchema.nullable(),
  /** Le mode `sandbox` est refusé dans l'environnement courant (production). */
  sandboxAllowed: z.boolean(),
  supportsRefund: z.boolean(),
  webhookAuth: z.enum(["signature", "signed_url"]),
  /** URL à copier chez le fournisseur ; `null` tant que `FINANCE_WEBHOOK_BASE_URL` n'est pas défini. */
  webhookUrl: z.string().nullable(),
  fields: z.array(financeProviderFieldDtoSchema),
  lastTest: financeProviderTestDtoSchema.nullable(),
  updatedAt: isoInstant.nullable(),
});
export type FinanceProviderDto = z.infer<typeof financeProviderDtoSchema>;

export const financeProviderListDtoSchema = z.object({
  items: z.array(financeProviderDtoSchema),
  /** Le coffre des secrets est disponible (clé maître définie) : sinon aucune saisie n'est possible. */
  secretsAvailable: z.boolean(),
  environment: z.enum(["development", "test", "staging", "production"]),
});
export type FinanceProviderListDto = z.infer<typeof financeProviderListDtoSchema>;

export const financeProviderTestResultDtoSchema = z.object({ ok: z.boolean(), code: z.string(), at: isoInstant });
export type FinanceProviderTestResultDto = z.infer<typeof financeProviderTestResultDtoSchema>;

export const financeRotateSecretsResultDtoSchema = z.object({ rotated: z.number().int().nonnegative(), keyId: z.string() });
export type FinanceRotateSecretsResultDto = z.infer<typeof financeRotateSecretsResultDtoSchema>;

// ---------------------------------------------------------------------------
// Charges utiles des événements PUBLIÉS (consommées par academic : confirmation automatique d'une inscription)
// ---------------------------------------------------------------------------

const financeEventMoneySchema = z.object({ amount: z.number().int(), currency: z.string().min(1) });

/**
 * `finance.invoice.paid` : publié quand une facture émise devient entièrement payée. La charge est ENRICHIE (additive) pour
 * `academic` : `enrollmentId` (inscription visée), `containsRegistrationFee` (au moins une ligne `REGISTRATION`) et
 * `sourceRefs` (objets d'autres modules soldés, ex. sélection de cours à la carte). Décision métier 2026-10-01.
 */
export const financeInvoicePaidEventPayloadSchema = z.object({
  v: z.literal(1),
  invoiceId: financeUuidSchema,
  number: z.string().min(1),
  learnerId: financeUuidSchema,
  total: financeEventMoneySchema,
  enrollmentId: financeUuidSchema.nullable(),
  containsRegistrationFee: z.boolean(),
  sourceRefs: z.array(z.object({ sourceRef: financeUuidSchema, category: financeFeeCategorySchema })),
});
export type FinanceInvoicePaidEventPayload = z.infer<typeof financeInvoicePaidEventPayloadSchema>;

export const financeEventPayloadSchemas = {
  "finance.invoice.paid": financeInvoicePaidEventPayloadSchema,
} as const;
