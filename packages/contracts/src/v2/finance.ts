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

export const FINANCE_REFUND_STATUSES = ["REQUESTED", "APPROVED", "COMPLETED", "REJECTED"] as const;
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
  .object({ fundingType: financeFundingTypeSchema, assignmentRef: optionalText(120).optional() })
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
});

export const financeLearnerFundingDtoSchema = z.object({
  account: z.object({ learnerId: financeUuidSchema, fundingType: financeFundingTypeSchema, assignmentRef: z.string().nullable() }),
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

export const financeApproveRefundBodySchema = z.object({ complete: z.boolean().optional() }).strict();
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
});
export type FinanceRefundDto = z.infer<typeof financeRefundDtoSchema>;

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
// Listes paginées
// ---------------------------------------------------------------------------

export const financePageDtoSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() });
