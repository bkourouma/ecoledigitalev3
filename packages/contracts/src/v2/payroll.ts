/**
 * Contrats du module `payroll` (routes `/api/v1/payroll/*`, spec 032). Écrits avant les routes (ADR-001 règle 6) ;
 * le client web est typé à partir de ces schémas.
 *
 * Conventions :
 *  - MONTANTS : entiers de l'unité de la devise (XOF : le franc) — JAMAIS de flottant ni de décimale ;
 *  - DURÉES : minutes entières. Majoration : millièmes (‰) — 1 000 = ×1,0 ; 1 500 = ×1,5 ;
 *  - DATES calendaires `AAAA-MM-JJ` (jour civil, sans fuseau) ; HEURES MURALES `HH:MM` ; INSTANTS en ISO 8601 UTC ;
 *  - IDENTIFIANTS : UUID. Enseignants, séances, présences, nœuds de curriculum et années sont ceux d'autres modules,
 *    vérifiés par des ports (aucune clé étrangère) ;
 *  - valeurs d'énumération en anglais ; messages d'erreur en français (corps d'erreur du kernel).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const payrollUuidSchema = z.string().uuid();
export const payrollDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
export const payrollTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure attendue au format HH:MM.");
export const payrollInstantSchema = z.string().datetime({ offset: true });
/** Montant entier (unité de la devise), positif ou nul. */
export const payrollAmountSchema = z.number().int().nonnegative().safe();
export const payrollPositiveAmountSchema = z.number().int().positive().safe();
export const payrollMinutesSchema = z.number().int().nonnegative();

export const PAYROLL_PAYSLIP_STATUSES = ["CALCULATED", "APPROVED", "PAID", "DISPUTED", "CANCELLED"] as const;
export const payrollPayslipStatusSchema = z.enum(PAYROLL_PAYSLIP_STATUSES);
export const PAYROLL_CONFIG_TYPES = ["SALARY", "HOURLY", "MIXED"] as const;
export const payrollConfigTypeSchema = z.enum(PAYROLL_CONFIG_TYPES);
export const PAYROLL_HOUR_SOURCES = ["SESSION", "ATTENDANCE"] as const;
export const payrollHourSourceSchema = z.enum(PAYROLL_HOUR_SOURCES);
export const payrollSourceFilterSchema = z.enum(["ALL", "SESSION", "ATTENDANCE"]);
export const PAYROLL_RATE_ORIGINS = ["NODE_STAFF", "NODE_GENERIC", "CONFIG_DEFAULT", "SALARY_ZERO"] as const;
export const payrollRateOriginSchema = z.enum(PAYROLL_RATE_ORIGINS);
export const PAYROLL_PERIOD_STATUSES = ["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"] as const;
export const payrollPeriodStatusSchema = z.enum(PAYROLL_PERIOD_STATUSES);
export const PAYROLL_PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK_TRANSFER", "CHEQUE", "OTHER"] as const;
export const payrollPaymentMethodSchema = z.enum(PAYROLL_PAYMENT_METHODS);
export const PAYROLL_SKIP_REASONS = ["NO_CONFIG", "NO_HOURS", "NO_RATE_RESOLVED", "PAYSLIP_LOCKED", "OUT_OF_SCOPE", "STALE_SOURCE", "NOTHING_TO_PAY", "ALREADY_CALCULATED"] as const;
export const payrollSkipReasonSchema = z.enum(PAYROLL_SKIP_REASONS);
export const payrollRunOutcomeSchema = z.enum(["CALCULATED", "SKIPPED", "LOCKED", "FAILED"]);
export const payrollConfigStateSchema = z.enum(["ACTIVE", "EXPIRED", "FUTURE", "ABSENT"]);
export const payrollAdjustmentKindSchema = z.enum(["BONUS", "DEDUCTION"]);

export const payrollIdParamsSchema = z.object({ id: payrollUuidSchema });
export const payrollStaffParamsSchema = z.object({ id: payrollUuidSchema });

const reasonSchema = z.string().trim().min(3, "Un motif d'au moins 3 caractères est requis.").max(500);
const pageQueryShape = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
};

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export const payrollSettingsBodySchema = z
  .object({
    currency: z.string().length(3).optional(),
    defaultOvertimeThresholdMinutes: z.number().int().positive().optional(),
    defaultOvertimeMultiplierPermille: z.number().int().min(1000).max(5000).optional(),
    requireSeparateApprover: z.boolean().optional(),
    /** Au-delà de ce montant, seul le propriétaire arrête le bulletin ; `null` supprime le seuil. */
    ownerApprovalThreshold: payrollPositiveAmountSchema.nullable().optional(),
  })
  .strict();

export const payrollSettingsDtoSchema = z.object({
  currency: z.string(),
  defaultOvertimeThresholdMinutes: z.number().int(),
  defaultOvertimeMultiplierPermille: z.number().int(),
  requireSeparateApprover: z.boolean(),
  ownerApprovalThreshold: z.number().int().nullable(),
  updatedAt: payrollInstantSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

export const payrollCreatePeriodBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).nullish(),
    startDate: payrollDateSchema,
    endDate: payrollDateSchema,
    academicYearId: payrollUuidSchema,
    /** Aucune cible = période collective. */
    staffIds: z.array(payrollUuidSchema).max(2000).optional(),
  })
  .strict();

export const payrollUpdatePeriodBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullish(),
    startDate: payrollDateSchema.optional(),
    endDate: payrollDateSchema.optional(),
    academicYearId: payrollUuidSchema.optional(),
    addStaffIds: z.array(payrollUuidSchema).max(2000).optional(),
    removeStaffIds: z.array(payrollUuidSchema).max(2000).optional(),
    status: payrollPeriodStatusSchema.optional(),
  })
  .strict();

export const payrollListPeriodsQuerySchema = z.object({
  status: payrollPeriodStatusSchema.optional(),
  academicYearId: payrollUuidSchema.optional(),
  ...pageQueryShape,
});

export const payrollPeriodDtoSchema = z.object({
  id: payrollUuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  startDate: payrollDateSchema,
  endDate: payrollDateSchema,
  status: payrollPeriodStatusSchema,
  academicYearId: payrollUuidSchema,
  awaitingCalculation: z.boolean(),
  targeted: z.boolean(),
  targetStaffIds: z.array(payrollUuidSchema),
  createdAt: payrollInstantSchema,
  updatedAt: payrollInstantSchema,
});

export const payrollPeriodPageDtoSchema = z.object({ items: z.array(payrollPeriodDtoSchema), total: z.number().int() });
export const payrollPendingPeriodDtoSchema = z.object({ pending: payrollPeriodDtoSchema.nullable() });

// ---------------------------------------------------------------------------
// Configurations de paie
// ---------------------------------------------------------------------------

export const payrollConfigBodySchema = z
  .object({
    staffId: payrollUuidSchema,
    type: payrollConfigTypeSchema,
    monthlySalary: payrollAmountSchema.nullish(),
    annualSalary: payrollAmountSchema.nullish(),
    /** 0 est une valeur (taux nul) ; absent/null = pas de tarif par défaut. */
    defaultHourlyRate: payrollAmountSchema.nullish(),
    overtimeThresholdMinutes: z.number().int().positive().optional(),
    overtimeMultiplierPermille: z.number().int().min(1000).max(5000).optional(),
    effectiveFrom: payrollDateSchema,
    effectiveTo: payrollDateSchema.nullish(),
  })
  .strict();

export const payrollConfigUpdateBodySchema = payrollConfigBodySchema.omit({ staffId: true });

export const payrollListConfigsQuerySchema = z.object({ staffId: payrollUuidSchema.optional(), activeOn: payrollDateSchema.optional(), ...pageQueryShape });
export const payrollCurrentConfigQuerySchema = z.object({ onDate: payrollDateSchema.optional() });

export const payrollConfigDtoSchema = z.object({
  id: payrollUuidSchema,
  staffId: payrollUuidSchema,
  type: payrollConfigTypeSchema,
  monthlySalary: z.number().int().nullable(),
  annualSalary: z.number().int().nullable(),
  defaultHourlyRate: z.number().int().nullable(),
  overtimeThresholdMinutes: z.number().int(),
  overtimeMultiplierPermille: z.number().int(),
  effectiveFrom: payrollDateSchema,
  effectiveTo: payrollDateSchema.nullable(),
  createdAt: payrollInstantSchema,
  updatedAt: payrollInstantSchema,
});
export const payrollConfigPageDtoSchema = z.object({ items: z.array(payrollConfigDtoSchema), total: z.number().int() });
export const payrollCurrentConfigDtoSchema = z.object({ state: payrollConfigStateSchema, config: payrollConfigDtoSchema.nullable() });

// ---------------------------------------------------------------------------
// Tarifs horaires
// ---------------------------------------------------------------------------

export const payrollRateBodySchema = z
  .object({
    curriculumNodeId: payrollUuidSchema,
    /** Absent/null = tarif générique du nœud. */
    staffId: payrollUuidSchema.nullish(),
    rate: payrollAmountSchema,
    validFrom: payrollDateSchema,
    validTo: payrollDateSchema.nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .strict();
export const payrollRateUpdateBodySchema = payrollRateBodySchema.pick({ rate: true, validFrom: true, validTo: true, notes: true });
export const payrollListRatesQuerySchema = z.object({
  nodeId: payrollUuidSchema.optional(),
  staffId: payrollUuidSchema.optional(),
  generic: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  activeOn: payrollDateSchema.optional(),
  ...pageQueryShape,
});
export const payrollResolveRateQuerySchema = z.object({ nodeId: payrollUuidSchema.optional(), staffId: payrollUuidSchema, date: payrollDateSchema });

export const payrollRateDtoSchema = z.object({
  id: payrollUuidSchema,
  curriculumNodeId: payrollUuidSchema,
  staffId: payrollUuidSchema.nullable(),
  rate: z.number().int(),
  validFrom: payrollDateSchema,
  validTo: payrollDateSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: payrollInstantSchema,
  updatedAt: payrollInstantSchema,
});
export const payrollRatePageDtoSchema = z.object({ items: z.array(payrollRateDtoSchema), total: z.number().int() });
export const payrollResolvedRateDtoSchema = z.object({ rate: z.number().int().nullable(), origin: payrollRateOriginSchema.nullable(), configState: payrollConfigStateSchema });

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

export const payrollCalculateBodySchema = z
  .object({
    staffIds: z.array(payrollUuidSchema).max(2000).optional(),
    scope: payrollSourceFilterSchema.optional(),
    recalculate: z.boolean().optional(),
    /** Aperçu : calcule sans rien persister. */
    dryRun: z.boolean().optional(),
  })
  .strict();

export const payrollLineDtoSchema = z.object({
  position: z.number().int(),
  source: payrollHourSourceSchema,
  sourceRefId: payrollUuidSchema,
  date: payrollDateSchema,
  startTime: payrollTimeSchema.nullable(),
  minutes: z.number().int(),
  rate: z.number().int(),
  multiplierPermille: z.number().int(),
  amount: z.number().int(),
  isOvertime: z.boolean(),
  rateOrigin: payrollRateOriginSchema,
  label: z.string().nullable(),
  code: z.string().nullable(),
  classroomLabel: z.string().nullable(),
});

export const payrollPreviewDtoSchema = z.object({
  kind: payrollConfigTypeSchema,
  salary: z.number().int(),
  regularHours: z.number().int(),
  overtime: z.number().int(),
  bonus: z.number().int(),
  deduction: z.number().int(),
  total: z.number().int(),
  regularMinutes: z.number().int(),
  overtimeMinutes: z.number().int(),
  lines: z.array(payrollLineDtoSchema),
  details: z.record(z.unknown()),
});

export const payrollRunItemDtoSchema = z.object({
  staffId: payrollUuidSchema,
  staffName: z.string(),
  outcome: payrollRunOutcomeSchema,
  skipReason: payrollSkipReasonSchema.nullable(),
  message: z.string().nullable(),
  payslipId: payrollUuidSchema.nullable(),
  minutesBySource: z.record(z.number().int()).nullable(),
  total: z.number().int().nullable(),
  preview: payrollPreviewDtoSchema.nullable().optional(),
});

export const payrollCalculationReportDtoSchema = z.object({
  runId: payrollUuidSchema.nullable(),
  periodId: payrollUuidSchema,
  dryRun: z.boolean(),
  scope: payrollSourceFilterSchema,
  recalculate: z.boolean(),
  calculated: z.number().int(),
  skipped: z.number().int(),
  locked: z.number().int(),
  failed: z.number().int(),
  durationMs: z.number().int(),
  items: z.array(payrollRunItemDtoSchema),
});

export const payrollRunDtoSchema = z.object({
  id: payrollUuidSchema,
  periodId: payrollUuidSchema,
  scope: payrollSourceFilterSchema,
  recalculate: z.boolean(),
  dryRun: z.boolean(),
  status: z.enum(["RUNNING", "COMPLETED", "FAILED"]),
  calculated: z.number().int(),
  skipped: z.number().int(),
  locked: z.number().int(),
  failed: z.number().int(),
  durationMs: z.number().int().nullable(),
  error: z.string().nullable(),
  requestedBy: payrollUuidSchema,
  requestedAt: payrollInstantSchema,
  finishedAt: payrollInstantSchema.nullable(),
  items: z.array(payrollRunItemDtoSchema),
});

// ---------------------------------------------------------------------------
// Bulletins
// ---------------------------------------------------------------------------

export const payrollListPayslipsQuerySchema = z.object({
  periodId: payrollUuidSchema.optional(),
  staffId: payrollUuidSchema.optional(),
  status: payrollPayslipStatusSchema.optional(),
  academicYearId: payrollUuidSchema.optional(),
  from: payrollDateSchema.optional(),
  to: payrollDateSchema.optional(),
  ...pageQueryShape,
});

export const payrollPayslipDtoSchema = z.object({
  id: payrollUuidSchema,
  periodId: payrollUuidSchema,
  staffId: payrollUuidSchema,
  staffName: z.string(),
  kind: payrollConfigTypeSchema,
  status: payrollPayslipStatusSchema,
  /** « Impayé » = arrêté mais pas encore versé. */
  statusLabel: z.string(),
  currency: z.string(),
  salaryAmount: z.number().int(),
  baseAmount: z.number().int(),
  overtimeAmount: z.number().int(),
  bonusAmount: z.number().int(),
  deductionAmount: z.number().int(),
  totalAmount: z.number().int(),
  regularMinutes: z.number().int(),
  overtimeMinutes: z.number().int(),
  calculatedAt: payrollInstantSchema,
  calculatedByName: z.string(),
  approvedAt: payrollInstantSchema.nullable(),
  approvedByName: z.string().nullable(),
  paidAt: payrollInstantSchema.nullable(),
  paidByName: z.string().nullable(),
  paymentMethod: payrollPaymentMethodSchema.nullable(),
  paymentReference: z.string().nullable(),
  disputedAt: payrollInstantSchema.nullable(),
  disputeReason: z.string().nullable(),
  cancelledAt: payrollInstantSchema.nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  hasSnapshot: z.boolean(),
  snapshotHash: z.string().nullable(),
  replacesPayslipId: payrollUuidSchema.nullable(),
  rowVersion: z.number().int(),
  updatedAt: payrollInstantSchema,
});
export const payrollPayslipPageDtoSchema = z.object({ items: z.array(payrollPayslipDtoSchema), total: z.number().int() });

export const payrollAdjustmentDtoSchema = z.object({
  id: payrollUuidSchema,
  kind: payrollAdjustmentKindSchema,
  amount: z.number().int(),
  label: z.string(),
  reason: z.string().nullable(),
  createdByName: z.string(),
  createdAt: payrollInstantSchema,
});

export const payrollEventDtoSchema = z.object({
  id: payrollUuidSchema,
  action: z.string(),
  reason: z.string().nullable(),
  actorName: z.string(),
  occurredAt: payrollInstantSchema,
  oldValues: z.unknown().nullable(),
  newValues: z.unknown().nullable(),
});

export const payrollPayslipDetailDtoSchema = z.object({
  payslip: payrollPayslipDtoSchema,
  lines: z.array(payrollLineDtoSchema),
  adjustments: z.array(payrollAdjustmentDtoSchema),
  events: z.array(payrollEventDtoSchema),
  calcDetails: z.record(z.unknown()),
});

export const payrollPayslipDataDtoSchema = z.object({
  final: z.boolean(),
  watermark: z.string().nullable(),
  status: payrollPayslipStatusSchema,
  snapshotHash: z.string().nullable(),
  intact: z.boolean().nullable(),
  document: z.record(z.unknown()),
  payment: z.object({ paidAt: payrollInstantSchema, paidByName: z.string(), method: payrollPaymentMethodSchema, reference: z.string().nullable() }).nullable(),
});

// ---------------------------------------------------------------------------
// Actions sur les bulletins
// ---------------------------------------------------------------------------

/**
 * Sélection d'une action de masse : identifiants EXPLICITES, ou `{ all: true, periodId }` calculé côté serveur.
 * Une liste vide ne vaut JAMAIS « tout » (refusée : `payroll.empty_selection`).
 */
export const payrollSelectionSchema = z.union([
  z.object({ payslipIds: z.array(payrollUuidSchema).max(500) }).strict(),
  z.object({ all: z.literal(true), periodId: payrollUuidSchema }).strict(),
]);

export const payrollApproveBodySchema = payrollSelectionSchema;
export const payrollPayBodySchema = z.union([
  z.object({ payslipIds: z.array(payrollUuidSchema).max(500), method: payrollPaymentMethodSchema, reference: z.string().trim().max(120).optional() }).strict(),
  z.object({ all: z.literal(true), periodId: payrollUuidSchema, method: payrollPaymentMethodSchema, reference: z.string().trim().max(120).optional() }).strict(),
]);
export const payrollReasonBodySchema = z.object({ reason: reasonSchema }).strict();
export const payrollAdjustBodySchema = z
  .object({
    add: z
      .array(
        z
          .object({
            kind: payrollAdjustmentKindSchema,
            amount: payrollPositiveAmountSchema,
            label: z.string().trim().min(1).max(160),
            reason: z.string().trim().max(500).nullish(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    remove: z.array(payrollUuidSchema).max(50).optional(),
  })
  .strict();

export const payrollBatchResultDtoSchema = z.object({
  done: z.array(payrollUuidSchema),
  unchanged: z.array(payrollUuidSchema),
  rejected: z.array(z.object({ payslipId: payrollUuidSchema, code: z.string(), message: z.string() })),
});

// ---------------------------------------------------------------------------
// Historique, rapports, masse salariale, espace enseignant
// ---------------------------------------------------------------------------

export const payrollHistoryQuerySchema = z.object({
  staffId: payrollUuidSchema.optional(),
  periodId: payrollUuidSchema.optional(),
  academicYearId: payrollUuidSchema.optional(),
  ...pageQueryShape,
});
export const payrollExportQuerySchema = z.object({
  staffId: payrollUuidSchema.optional(),
  periodId: payrollUuidSchema.optional(),
  academicYearId: payrollUuidSchema.optional(),
  source: payrollSourceFilterSchema.optional(),
});
export const payrollReportQuerySchema = z.object({
  periodId: payrollUuidSchema.optional(),
  academicYearId: payrollUuidSchema.optional(),
  staffId: payrollUuidSchema.optional(),
  from: payrollDateSchema.optional(),
  to: payrollDateSchema.optional(),
  source: payrollSourceFilterSchema.optional(),
});
export const payrollMassQuerySchema = z.object({ academicYearId: payrollUuidSchema.optional(), periodId: payrollUuidSchema.optional() });
export const payrollMyPayslipsQuerySchema = z.object({ ...pageQueryShape });

export const payrollSummaryRowDtoSchema = z.object({
  status: payrollPayslipStatusSchema,
  payslips: z.number().int(),
  total: z.number().int(),
  attendance: z.number().int(),
  session: z.number().int(),
  outOfHours: z.number().int(),
  filtered: z.number().int(),
});
export const payrollSummaryDtoSchema = z.object({
  rows: z.array(payrollSummaryRowDtoSchema),
  sources: z.array(z.object({ kind: payrollHourSourceSchema, minutes: z.number().int(), amount: z.number().int() })),
  filteredTotal: z.number().int(),
});

const massStatusSchema = z.object({ payslips: z.number().int(), total: z.number().int() });
export const payrollOwnerMassDtoSchema = z.object({
  periods: z.array(
    z.object({
      periodId: payrollUuidSchema,
      periodName: z.string(),
      startDate: payrollDateSchema,
      endDate: payrollDateSchema,
      academicYearId: payrollUuidSchema,
      byStatus: z.record(massStatusSchema),
      counted: massStatusSchema,
      apart: z.object({ cancelled: massStatusSchema, disputed: massStatusSchema }),
    }),
  ),
  counted: massStatusSchema,
});
