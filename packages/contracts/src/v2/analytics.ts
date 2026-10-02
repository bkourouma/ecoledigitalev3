/**
 * Contrats du module `analytics` (routes `/api/v1/analytics/*`, spec v2/025 — tableaux de bord de direction et du
 * propriétaire). Écrits avant les routes ; le client web (`apps/web/src/platform/v2/analytics.ts`) en est typé.
 *
 * Conventions :
 *  - TOUTE réponse porte `meta` : `asOf` (instant de la dernière vérification des sources), `stale`, `gaps` (ce qui
 *    manque, jamais un zéro qui passerait pour une mesure) et le périmètre appliqué ;
 *  - MONTANTS : entiers de l'unité de la devise (XOF : le franc) ; TAUX : points de base entiers (1 % = 100) ou `null`
 *    quand le dénominateur est nul (« non mesurable », jamais 0 %) ;
 *  - DÉCIMAUX de résultats (moyennes) : nombres à 2 décimales, présentés tels que lus des résultats FINAL de `results`
 *    (aucune formule de moyenne, de rang, de crédit ou de décision dans `analytics`) ;
 *  - DATES `AAAA-MM-JJ`, INSTANTS ISO 8601 UTC, IDENTIFIANTS UUID.
 */
import { z } from "zod";

export const analyticsUuidSchema = z.string().uuid();
export const analyticsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
export const analyticsInstantSchema = z.string().datetime({ offset: true });
export const analyticsAmountSchema = z.number().int().safe();
export const analyticsBpsSchema = z.number().int().min(0).max(1_000_000).nullable();

export const ANALYTICS_REFRESH_KINDS = ["REBUILD", "CALENDAR", "ENROLLMENT", "RESULTS", "ATTENDANCE", "STAFF_PRESENCE", "FINANCE", "COLLECTIONS", "CASH", "PAYROLL", "TEACHING_LOAD", "ADMISSIONS", "SCHOOLLIFE"] as const;
export const analyticsRefreshKindSchema = z.enum(ANALYTICS_REFRESH_KINDS);
export type AnalyticsRefreshKind = z.infer<typeof analyticsRefreshKindSchema>;

export const ANALYTICS_READING_STATUSES = ["good", "warning", "critical", "neutral"] as const;
export const analyticsReadingStatusSchema = z.enum(ANALYTICS_READING_STATUSES);
export type AnalyticsReadingStatus = z.infer<typeof analyticsReadingStatusSchema>;

// ---------------------------------------------------------------------------
// Périmètre et méta
// ---------------------------------------------------------------------------

/** Filtres communs : établissement / campus / année / période (et dates pour les séries temporelles). */
export const analyticsScopeQuerySchema = z.object({
  institutionId: analyticsUuidSchema.optional(),
  campusId: analyticsUuidSchema.optional(),
  yearId: analyticsUuidSchema.optional(),
  periodId: analyticsUuidSchema.optional(),
  classroomId: analyticsUuidSchema.optional(),
  from: analyticsDateSchema.optional(),
  to: analyticsDateSchema.optional(),
});
export type AnalyticsScopeQuery = z.infer<typeof analyticsScopeQuerySchema>;

export const ANALYTICS_GAP_REASONS = ["NOT_WIRED", "FAILED", "NEVER_COMPUTED", "MODULE_MISSING"] as const;
export const analyticsGapSchema = z.object({
  source: z.string(),
  reason: z.enum(ANALYTICS_GAP_REASONS),
  message: z.string(),
});
export type AnalyticsGap = z.infer<typeof analyticsGapSchema>;

export const analyticsMetaSchema = z.object({
  /** Plus ancienne vérification parmi les sources utilisées (par genre : la plus récente passe), ou `null` si aucune. */
  asOf: analyticsInstantSchema.nullable(),
  /** `true` si `asOf` dépasse le délai de fraîcheur de l'établissement (ou n'existe pas). */
  stale: z.boolean(),
  sources: z.record(analyticsInstantSchema.nullable()),
  gaps: z.array(analyticsGapSchema),
  scope: z.object({
    institutionId: analyticsUuidSchema.nullable(),
    campusId: analyticsUuidSchema.nullable(),
    yearId: analyticsUuidSchema.nullable(),
    periodId: analyticsUuidSchema.nullable(),
    from: analyticsDateSchema.nullable(),
    to: analyticsDateSchema.nullable(),
  }),
});
export type AnalyticsMeta = z.infer<typeof analyticsMetaSchema>;

export const analyticsEnvelope = <T extends z.ZodTypeAny>(data: T) => z.object({ meta: analyticsMetaSchema, data });

// ---------------------------------------------------------------------------
// Référentiel des filtres
// ---------------------------------------------------------------------------

export const analyticsScopesDataSchema = z.object({
  institutions: z.array(z.object({ id: analyticsUuidSchema, label: z.string() })),
  campuses: z.array(z.object({ id: analyticsUuidSchema, institutionId: analyticsUuidSchema.nullable(), label: z.string() })),
  years: z.array(z.object({ id: analyticsUuidSchema, institutionId: analyticsUuidSchema, code: z.string(), label: z.string(), startsOn: analyticsDateSchema, endsOn: analyticsDateSchema, status: z.string(), isCurrent: z.boolean() })),
  periods: z.array(z.object({ id: analyticsUuidSchema, yearId: analyticsUuidSchema, code: z.string(), label: z.string(), ordinal: z.number().int(), startsOn: analyticsDateSchema, endsOn: analyticsDateSchema, status: z.string() })),
  classrooms: z.array(z.object({ id: analyticsUuidSchema, yearId: analyticsUuidSchema, institutionId: analyticsUuidSchema, campusId: analyticsUuidSchema.nullable(), name: z.string(), gradeLevelCode: z.string(), gradeLevelLabel: z.string() })),
  defaultYearId: analyticsUuidSchema.nullable(),
});
export type AnalyticsScopesData = z.infer<typeof analyticsScopesDataSchema>;

// ---------------------------------------------------------------------------
// Vue d'ensemble de la direction
// ---------------------------------------------------------------------------

export const analyticsOverviewDataSchema = z.object({
  headcount: z.object({ inSchooling: z.number().int(), total: z.number().int(), classrooms: z.number().int() }),
  attendanceToday: z.object({
    day: analyticsDateSchema,
    recordsCount: z.number().int(),
    presentCount: z.number().int(),
    absentCount: z.number().int(),
    lateCount: z.number().int(),
    rateBps: analyticsBpsSchema,
    status: analyticsReadingStatusSchema,
    measured: z.boolean(),
  }),
  results: z.object({
    periodId: analyticsUuidSchema.nullable(),
    periodLabel: z.string().nullable(),
    generalAverage: z.number().nullable(),
    cohortSize: z.number().int(),
    validatedCount: z.number().int(),
    validationRateBps: analyticsBpsSchema,
    measured: z.boolean(),
    demonstration: z.boolean(),
  }),
  staffToday: z.object({ day: analyticsDateSchema, present: z.number().int(), absent: z.number().int(), onLeave: z.number().int(), measured: z.boolean() }),
});
export type AnalyticsOverviewData = z.infer<typeof analyticsOverviewDataSchema>;

// ---------------------------------------------------------------------------
// Effectifs, répartitions, admissions
// ---------------------------------------------------------------------------

const countRow = z.object({ key: z.string(), label: z.string(), count: z.number().int(), inSchooling: z.number().int() });

export const analyticsEnrollmentDataSchema = z.object({
  totals: z.object({ total: z.number().int(), inSchooling: z.number().int(), repeaters: z.number().int(), repeaterRateBps: analyticsBpsSchema }),
  byStatus: z.array(countRow),
  bySex: z.array(countRow),
  byGradeLevel: z.array(countRow),
  byFunding: z.array(countRow),
  byCampus: z.array(countRow),
  byClassroom: z.array(z.object({ classroomId: analyticsUuidSchema, name: z.string(), gradeLevelLabel: z.string(), count: z.number().int(), inSchooling: z.number().int(), male: z.number().int(), female: z.number().int() })),
  admissions: z.object({
    created: z.number().int(),
    confirmed: z.number().int(),
    cancelled: z.number().int(),
    confirmationRateBps: analyticsBpsSchema,
    bySource: z.array(z.object({ sourceKind: z.string(), created: z.number().int(), confirmed: z.number().int() })),
    monthly: z.array(z.object({ month: z.string(), created: z.number().int(), confirmed: z.number().int() })),
  }),
});
export type AnalyticsEnrollmentData = z.infer<typeof analyticsEnrollmentDataSchema>;

// ---------------------------------------------------------------------------
// Présences et assiduité
// ---------------------------------------------------------------------------

const attendanceCounts = {
  recordsCount: z.number().int(),
  presentCount: z.number().int(),
  absentCount: z.number().int(),
  excusedCount: z.number().int(),
  lateCount: z.number().int(),
  absentMinutes: z.number().int(),
  rateBps: analyticsBpsSchema,
};

export const analyticsAttendanceDataSchema = z.object({
  range: z.object({ from: analyticsDateSchema, to: analyticsDateSchema }),
  totals: z.object({ ...attendanceCounts, sessionsCount: z.number().int(), status: analyticsReadingStatusSchema }),
  byDay: z.array(z.object({ day: analyticsDateSchema, ...attendanceCounts })),
  byClassroom: z.array(z.object({ classroomId: analyticsUuidSchema, name: z.string(), gradeLevelLabel: z.string(), ...attendanceCounts, status: analyticsReadingStatusSchema })),
  staff: z.object({
    byDay: z.array(z.object({ day: analyticsDateSchema, present: z.number().int(), absent: z.number().int(), onLeave: z.number().int() })),
    measured: z.boolean(),
  }),
});
export type AnalyticsAttendanceData = z.infer<typeof analyticsAttendanceDataSchema>;

// ---------------------------------------------------------------------------
// Pédagogie : résultats FINAL
// ---------------------------------------------------------------------------

export const analyticsResultsQuerySchema = analyticsScopeQuerySchema.extend({
  gradeLevelCode: z.string().min(1).max(40).optional(),
  /** Échelle d'AFFICHAGE de l'histogramme (jamais un seuil de réussite). */
  scaleMax: z.coerce.number().positive().max(1000).optional(),
  binWidth: z.coerce.number().positive().max(1000).optional(),
});
export type AnalyticsResultsQuery = z.infer<typeof analyticsResultsQuerySchema>;

const resultStats = {
  count: z.number().int(),
  average: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  validatedCount: z.number().int(),
  validationRateBps: analyticsBpsSchema,
};

export const analyticsResultsDataSchema = z.object({
  totals: z.object({ ...resultStats, classPeriodsFinal: z.number().int(), classPeriodsNotFinal: z.number().int() }),
  byClassroom: z.array(z.object({ classroomId: analyticsUuidSchema, name: z.string(), gradeLevelLabel: z.string(), ...resultStats })),
  bySubject: z.array(z.object({ nodeId: analyticsUuidSchema, code: z.string(), label: z.string(), level: z.string(), ...resultStats, resitEligibleCount: z.number().int(), session2Count: z.number().int() })),
  byPeriod: z.array(z.object({ periodId: analyticsUuidSchema, label: z.string(), ordinal: z.number().int(), ...resultStats, demonstration: z.boolean() })),
  rulesSource: z.object({ demonstration: z.boolean(), finalClassPeriods: z.number().int(), placeholderClassPeriods: z.number().int(), unknownClassPeriods: z.number().int() }),
  distribution: z.object({ scaleMax: z.number(), binWidth: z.number(), bins: z.array(z.object({ index: z.number().int(), from: z.number(), to: z.number(), count: z.number().int() })) }),
  decisions: z.object({
    period: z.array(z.object({ code: z.string(), outcome: z.string().nullable(), count: z.number().int() })),
    year: z.array(z.object({ code: z.string(), outcome: z.string().nullable(), count: z.number().int() })),
  }),
});
export type AnalyticsResultsData = z.infer<typeof analyticsResultsDataSchema>;

export const analyticsTeachingLoadDataSchema = z.object({
  yearId: analyticsUuidSchema.nullable(),
  rows: z.array(z.object({ staffId: analyticsUuidSchema, displayName: z.string(), status: z.string().nullable(), plannedHours: z.number(), classroomCount: z.number().int(), contractualHoursPerWeek: z.number().nullable() })),
  totals: z.object({ staffCount: z.number().int(), plannedHours: z.number() }),
});
export type AnalyticsTeachingLoadData = z.infer<typeof analyticsTeachingLoadDataSchema>;

// ---------------------------------------------------------------------------
// Finance : scolarité et trésorerie
// ---------------------------------------------------------------------------

const money = analyticsAmountSchema;
const receivableCore = {
  invoiceCount: z.number().int(),
  billed: money,
  credited: money,
  collected: money,
  outstanding: money,
  overdue: money,
  collectionRateBps: analyticsBpsSchema,
};

export const analyticsFinanceSummaryDataSchema = z.object({
  currency: z.string().length(3).nullable(),
  asOfDate: analyticsDateSchema.nullable(),
  summary: z
    .object({ ...receivableCore, netBilled: money, overdueInvoiceCount: z.number().int(), unallocated: money, status: analyticsReadingStatusSchema })
    .nullable(),
  byClassroom: z.array(z.object({ groupKey: z.string(), label: z.string().nullable(), learnerCount: z.number().int(), ...receivableCore })),
});
export type AnalyticsFinanceSummaryData = z.infer<typeof analyticsFinanceSummaryDataSchema>;

export const analyticsReceivablesQuerySchema = analyticsScopeQuerySchema.extend({
  by: z.enum(["class", "learner"]).default("class"),
  onlyOutstanding: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AnalyticsReceivablesQuery = z.infer<typeof analyticsReceivablesQuerySchema>;

export const analyticsReceivablesDataSchema = z.object({
  by: z.enum(["class", "learner"]),
  currency: z.string().length(3).nullable(),
  total: z.number().int(),
  rows: z.array(
    z.object({
      id: z.string(),
      label: z.string().nullable(),
      groupLabel: z.string().nullable(),
      learnerCount: z.number().int(),
      oldestOverdueDate: analyticsDateSchema.nullable(),
      ...receivableCore,
    }),
  ),
});
export type AnalyticsReceivablesData = z.infer<typeof analyticsReceivablesDataSchema>;

export const analyticsCollectionsQuerySchema = z.object({
  from: analyticsDateSchema.optional(),
  to: analyticsDateSchema.optional(),
  granularity: z.enum(["day", "week", "month"]).default("month"),
});
export type AnalyticsCollectionsQuery = z.infer<typeof analyticsCollectionsQuerySchema>;

export const analyticsCollectionsDataSchema = z.object({
  currency: z.string().length(3).nullable(),
  granularity: z.enum(["day", "week", "month"]),
  range: z.object({ from: analyticsDateSchema, to: analyticsDateSchema }),
  points: z.array(z.object({ bucket: analyticsDateSchema, collected: money, refunded: money, net: money, paymentCount: z.number().int() })),
  totals: z.object({ collected: money, refunded: money, net: money, paymentCount: z.number().int() }),
});
export type AnalyticsCollectionsData = z.infer<typeof analyticsCollectionsDataSchema>;

export const ANALYTICS_AGING_BUCKETS = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_PLUS"] as const;
export const analyticsAgedDataSchema = z.object({
  currency: z.string().length(3).nullable(),
  asOfDate: analyticsDateSchema.nullable(),
  buckets: z.array(z.object({ bucket: z.enum(ANALYTICS_AGING_BUCKETS), amount: money, invoiceCount: z.number().int() })),
  total: money,
  learners: z.array(
    z.object({
      learnerId: analyticsUuidSchema,
      learnerName: z.string().nullable(),
      notDue: money,
      d1_30: money,
      d31_60: money,
      d61_90: money,
      d91_plus: money,
      total: money,
    }),
  ),
});
export type AnalyticsAgedData = z.infer<typeof analyticsAgedDataSchema>;

export const analyticsCashDataSchema = z.object({
  currency: z.string().length(3).nullable(),
  totals: z.object({ sessions: z.number().int(), closed: z.number().int(), withVariance: z.number().int(), netVariance: money, absoluteVariance: money }),
  sessions: z.array(
    z.object({
      sessionId: analyticsUuidSchema,
      registerId: analyticsUuidSchema.nullable(),
      cashierId: analyticsUuidSchema.nullable(),
      status: z.enum(["OPEN", "CLOSED"]),
      openedAt: analyticsInstantSchema.nullable(),
      closedAt: analyticsInstantSchema.nullable(),
      openingFloat: money,
      expected: money.nullable(),
      counted: money.nullable(),
      variance: money.nullable(),
    }),
  ),
});
export type AnalyticsCashData = z.infer<typeof analyticsCashDataSchema>;

// ---------------------------------------------------------------------------
// Paie (sensible : MFA) et charges
// ---------------------------------------------------------------------------

export const analyticsPayrollDataSchema = z.object({
  currency: z.string().length(3).nullable(),
  periods: z.array(
    z.object({
      periodId: analyticsUuidSchema,
      name: z.string(),
      startsOn: analyticsDateSchema,
      endsOn: analyticsDateSchema,
      yearId: analyticsUuidSchema.nullable(),
      byStatus: z.record(z.object({ payslips: z.number().int(), total: money })),
      counted: z.object({ payslips: z.number().int(), total: money }),
      cancelled: z.object({ payslips: z.number().int(), total: money }),
      disputed: z.object({ payslips: z.number().int(), total: money }),
    }),
  ),
  counted: z.object({ payslips: z.number().int(), total: money }),
});
export type AnalyticsPayrollData = z.infer<typeof analyticsPayrollDataSchema>;

export const analyticsChargesDataSchema = z.object({
  available: z.boolean(),
  reason: z.enum(["MODULE_MISSING"]).nullable(),
  message: z.string(),
});
export type AnalyticsChargesData = z.infer<typeof analyticsChargesDataSchema>;

// ---------------------------------------------------------------------------
// Fraîcheur, réglages, reconstruction, export
// ---------------------------------------------------------------------------

export const analyticsFreshnessDataSchema = z.object({
  states: z.array(
    z.object({
      kind: analyticsRefreshKindSchema,
      scopeKey: z.string(),
      lastSuccessAt: analyticsInstantSchema.nullable(),
      lastAttemptAt: analyticsInstantSchema.nullable(),
      lastStatus: z.enum(["OK", "FAILED", "UNAVAILABLE"]),
      rowsWritten: z.number().int(),
      durationMs: z.number().int(),
      lastError: z.string().nullable(),
    }),
  ),
  queue: z.record(z.number().int()),
  staleAfterSeconds: z.number().int(),
});
export type AnalyticsFreshnessData = z.infer<typeof analyticsFreshnessDataSchema>;

const bpsSetting = z.number().int().min(0).max(10_000);
export const analyticsSettingsSchema = z.object({
  collectionGoodBps: bpsSetting,
  collectionWarningBps: bpsSetting,
  attendanceGoodBps: bpsSetting,
  attendanceWarningBps: bpsSetting,
  staleAfterSeconds: z.number().int().min(60).max(604_800),
});
export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;

export const analyticsSettingsUpdateSchema = analyticsSettingsSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Au moins un réglage est attendu.");
export type AnalyticsSettingsUpdate = z.infer<typeof analyticsSettingsUpdateSchema>;

export const analyticsSettingsDataSchema = analyticsSettingsSchema.extend({ source: z.enum(["DEFAULT", "TENANT"]) });
export type AnalyticsSettingsData = z.infer<typeof analyticsSettingsDataSchema>;

export const analyticsRebuildBodySchema = z.object({ reason: z.string().trim().max(200).optional() });
export const analyticsRebuildResponseSchema = z.object({ requested: z.literal(true), requestId: z.string().nullable(), queued: z.boolean() });
export type AnalyticsRebuildResponse = z.infer<typeof analyticsRebuildResponseSchema>;

export const ANALYTICS_EXPORT_DATASETS = [
  "enrollment-by-classroom",
  "results-by-classroom",
  "results-by-subject",
  "attendance-by-day",
  "attendance-by-classroom",
  "receivables-by-classroom",
  "receivables-by-learner",
  "collections",
  "aged-balance",
  "cash-sessions",
  "payroll-mass",
  "teaching-load",
  "admissions-funnel",
  "schoollife-summary",
  "alerts-history",
] as const;
export const analyticsExportDatasetSchema = z.enum(ANALYTICS_EXPORT_DATASETS);
export type AnalyticsExportDataset = z.infer<typeof analyticsExportDatasetSchema>;

/** Événements publiés par le module (charges utiles versionnées). */
export const ANALYTICS_EVENTS = {
  snapshotRefreshed: "analytics.snapshot.refreshed",
  rebuildRequested: "analytics.rebuild.requested",
  rebuildCompleted: "analytics.rebuild.completed",
  alertRaised: "analytics.alert.raised",
  alertAcknowledged: "analytics.alert.acknowledged",
  alertResolved: "analytics.alert.resolved",
} as const;

/** Permissions du module (aussi déclarées par le manifeste ; le web s'en sert pour `usePermission`). */
export const ANALYTICS_PERMISSIONS = {
  read: "analytics.read",
  pedagogy: "analytics.pedagogy.read",
  attendance: "analytics.attendance.read",
  finance: "analytics.finance.read",
  treasury: "analytics.treasury.read",
  payroll: "analytics.payroll.read",
  charges: "analytics.charges.read",
  export: "analytics.export",
  settings: "analytics.settings.manage",
  rebuild: "analytics.rebuild",
  admissions: "analytics.admissions.read",
  schoollife: "analytics.schoollife.read",
  alertsRead: "analytics.alerts.read",
  alertsAcknowledge: "analytics.alerts.acknowledge",
  alertsManage: "analytics.alerts.manage",
} as const;

export const ANALYTICS_FEATURES = { direction: "analytics.direction", payroll: "analytics.payroll-insights" } as const;

// ---------------------------------------------------------------------------
// Partie B (spec 025) : provenance des règles, entonnoir d'admission, vie scolaire agrégée, comparaisons, alertes
// ---------------------------------------------------------------------------

/**
 * Provenance des règles des résultats FINAL lus : `demonstration` = au moins une (classe, période) lue repose sur un jeu de
 * règles de DÉMONSTRATION (`placeholder`) : l'écran affiche un bandeau « règles de démonstration » et aucun chiffre n'est
 * présenté comme officiel. `unknownClassPeriods` : provenance non lisible (jamais comptée comme officielle).
 */
export const analyticsRulesSourceSchema = z.object({
  demonstration: z.boolean(),
  finalClassPeriods: z.number().int(),
  placeholderClassPeriods: z.number().int(),
  unknownClassPeriods: z.number().int(),
});
export type AnalyticsRulesSource = z.infer<typeof analyticsRulesSourceSchema>;

// --- Entonnoir d'admission --------------------------------------------------------------------------------------------

export const ANALYTICS_ADMISSION_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "MISSING_DOCUMENT", "ACCEPTED", "REJECTED", "WAITLISTED", "ENROLLED"] as const;

export const analyticsAdmissionsFunnelQuerySchema = z.object({ institutionId: analyticsUuidSchema.optional(), yearId: analyticsUuidSchema.optional() });
export type AnalyticsAdmissionsFunnelQuery = z.infer<typeof analyticsAdmissionsFunnelQuerySchema>;

export const analyticsAdmissionsFunnelDataSchema = z.object({
  /**
   * Répartition À CE JOUR des dossiers par statut canonique (position actuelle, pas un historique de passages) : hors brouillons,
   * `submitted` = tous les dossiers déposés, `accepted` = acceptés + inscrits, `enrolled` = inscrits.
   */
  totals: z.object({
    applications: z.number().int(),
    submitted: z.number().int(),
    accepted: z.number().int(),
    enrolled: z.number().int(),
    rejected: z.number().int(),
    waitlisted: z.number().int(),
    acceptanceRateBps: analyticsBpsSchema,
    enrollmentRateBps: analyticsBpsSchema,
    seats: z.number().int().nullable(),
    seatsLeft: z.number().int().nullable(),
  }),
  byStatus: z.array(z.object({ status: z.enum(ANALYTICS_ADMISSION_STATUSES), count: z.number().int() })),
  campaigns: z.array(
    z.object({
      campaignId: analyticsUuidSchema,
      institutionId: analyticsUuidSchema,
      yearId: analyticsUuidSchema.nullable(),
      code: z.string(),
      label: z.string(),
      status: z.string(),
      seats: z.number().int().nullable(),
      seatsLeft: z.number().int().nullable(),
      applications: z.number().int(),
      stages: z.array(z.object({ code: z.string(), label: z.string(), canonicalStatus: z.enum(ANALYTICS_ADMISSION_STATUSES), ordinal: z.number().int(), isTerminal: z.boolean(), applications: z.number().int() })),
    }),
  ),
});
export type AnalyticsAdmissionsFunnelData = z.infer<typeof analyticsAdmissionsFunnelDataSchema>;

// --- Vie scolaire agrégée ----------------------------------------------------------------------------------------------

export const ANALYTICS_SCHOOLLIFE_INDICATORS = ["OPEN_INCIDENTS", "MEASURES_TO_VALIDATE", "ACTIVE_EXCLUSIONS", "CONVOCATIONS_TO_HOLD"] as const;
export const analyticsSchoolLifeDataSchema = z.object({
  /** Comptages de la confidentialité STANDARD uniquement : jamais d'élève, de motif ni d'élément restreint ou confidentiel. */
  scopeConfidentiality: z.literal("STANDARD"),
  institutionId: analyticsUuidSchema.nullable(),
  indicators: z.array(z.object({ indicator: z.enum(ANALYTICS_SCHOOLLIFE_INDICATORS), value: z.number().int().nullable(), measured: z.boolean() })),
});
export type AnalyticsSchoolLifeData = z.infer<typeof analyticsSchoolLifeDataSchema>;

// --- Comparaisons entre périodes ou années ---------------------------------------------------------------------------

export const ANALYTICS_COMPARISON_DOMAINS = ["enrollment", "attendance", "results", "finance"] as const;
export const analyticsComparisonDomainSchema = z.enum(ANALYTICS_COMPARISON_DOMAINS);
export type AnalyticsComparisonDomain = z.infer<typeof analyticsComparisonDomainSchema>;

/**
 * Comparaison d'un indicateur entre une référence (`baseline`) et une cible (`target`) :
 *  - enrollment, finance : deux ANNÉES (`baselineYearId`, `targetYearId`) ;
 *  - results : deux PÉRIODES (`baselinePeriodId`, `targetPeriodId`, éventuellement d'années différentes) ;
 *  - attendance : deux FENÊTRES de dates (`baselineFrom`..`baselineTo`, `targetFrom`..`targetTo`).
 * Les filtres établissement / campus s'appliquent aux deux côtés.
 */
export const analyticsCompareQuerySchema = z
  .object({
    institutionId: analyticsUuidSchema.optional(),
    campusId: analyticsUuidSchema.optional(),
    baselineYearId: analyticsUuidSchema.optional(),
    targetYearId: analyticsUuidSchema.optional(),
    baselinePeriodId: analyticsUuidSchema.optional(),
    targetPeriodId: analyticsUuidSchema.optional(),
    baselineFrom: analyticsDateSchema.optional(),
    baselineTo: analyticsDateSchema.optional(),
    targetFrom: analyticsDateSchema.optional(),
    targetTo: analyticsDateSchema.optional(),
  })
  .strict();
export type AnalyticsCompareQuery = z.infer<typeof analyticsCompareQuerySchema>;

export const ANALYTICS_COMPARISON_UNITS = ["COUNT", "BPS", "AMOUNT", "DECIMAL"] as const;
const comparisonSide = z.object({ label: z.string(), yearId: analyticsUuidSchema.nullable(), periodId: analyticsUuidSchema.nullable(), from: analyticsDateSchema.nullable(), to: analyticsDateSchema.nullable(), demonstration: z.boolean() });
export const analyticsComparisonDataSchema = z.object({
  domain: analyticsComparisonDomainSchema,
  currency: z.string().length(3).nullable(),
  baseline: comparisonSide,
  target: comparisonSide,
  metrics: z.array(
    z.object({
      key: z.string(),
      unit: z.enum(ANALYTICS_COMPARISON_UNITS),
      baseline: z.number().nullable(),
      target: z.number().nullable(),
      /** cible - référence ; `null` si l'une des deux mesures manque (jamais un zéro inventé). */
      delta: z.number().nullable(),
      /** Variation relative en points de base ; `null` si la référence est nulle ou absente. */
      changeBps: z.number().int().nullable(),
    }),
  ),
});
export type AnalyticsComparisonData = z.infer<typeof analyticsComparisonDataSchema>;

// --- Alertes configurables ---------------------------------------------------------------------------------------------

/** Indicateurs surveillables (catalogue : `domain/alert-metrics.ts`). Aucun ne porte de donnée d'élève. */
export const ANALYTICS_ALERT_METRICS = [
  "ATTENDANCE_RATE",
  "COLLECTION_RATE",
  "OVERDUE_AMOUNT",
  "VALIDATION_RATE",
  "ENROLLMENT_IN_SCHOOLING",
  "CASH_VARIANCE",
  "SCHOOLLIFE_OPEN_INCIDENTS",
  "SCHOOLLIFE_MEASURES_TO_VALIDATE",
] as const;
export const analyticsAlertMetricSchema = z.enum(ANALYTICS_ALERT_METRICS);
export type AnalyticsAlertMetric = z.infer<typeof analyticsAlertMetricSchema>;

export const ANALYTICS_ALERT_UNITS = ["BPS", "AMOUNT", "COUNT"] as const;
export const ANALYTICS_ALERT_COMPARATORS = ["BELOW", "ABOVE"] as const;
export const ANALYTICS_ALERT_FREQUENCIES = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY"] as const;
export const analyticsAlertFrequencySchema = z.enum(ANALYTICS_ALERT_FREQUENCIES);
export const ANALYTICS_ALERT_SEVERITIES = ["WARNING", "CRITICAL"] as const;
export const analyticsAlertSeveritySchema = z.enum(ANALYTICS_ALERT_SEVERITIES);
export type AnalyticsAlertSeverity = z.infer<typeof analyticsAlertSeveritySchema>;
export const ANALYTICS_ALERT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;
export const analyticsAlertStatusSchema = z.enum(ANALYTICS_ALERT_STATUSES);
export type AnalyticsAlertStatus = z.infer<typeof analyticsAlertStatusSchema>;
export const ANALYTICS_ALERT_OUTCOMES = ["OK", "WARNING", "CRITICAL", "NOT_MEASURED", "SOURCE_UNAVAILABLE"] as const;

export const ANALYTICS_ALERT_LIMITS = { recipientRolesMax: 8, labelMin: 3, labelMax: 120, noteMax: 500, windowMax: 365 } as const;
const alertRoleKey = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, "Clé de rôle attendue : minuscules, chiffres et _.");
const alertThreshold = z.number().int().safe();

const alertRuleFields = {
  label: z.string().trim().min(ANALYTICS_ALERT_LIMITS.labelMin).max(ANALYTICS_ALERT_LIMITS.labelMax),
  metric: analyticsAlertMetricSchema,
  /** Seuils dans l'UNITÉ de l'indicateur : points de base (1 % = 100), unités mineures de la monnaie, nombre. */
  warningValue: alertThreshold.nullable().optional(),
  criticalValue: alertThreshold.nullable().optional(),
  /** Fenêtre glissante en jours (indicateurs fenêtrés : présence, écarts de caisse). */
  windowDays: z.number().int().min(1).max(ANALYTICS_ALERT_LIMITS.windowMax).nullable().optional(),
  institutionId: analyticsUuidSchema.nullable().optional(),
  campusId: analyticsUuidSchema.nullable().optional(),
  recipientRoles: z.array(alertRoleKey).min(1).max(ANALYTICS_ALERT_LIMITS.recipientRolesMax),
  frequency: analyticsAlertFrequencySchema.default("DAILY"),
  enabled: z.boolean().default(true),
};

export const analyticsAlertRuleCreateSchema = z
  .object(alertRuleFields)
  .strict()
  .refine((v) => v.warningValue != null || v.criticalValue != null, { message: "Au moins un seuil (attention ou critique) est attendu.", path: ["warningValue"] });
export type AnalyticsAlertRuleCreate = z.infer<typeof analyticsAlertRuleCreateSchema>;

export const analyticsAlertRuleUpdateSchema = z
  .object({ ...alertRuleFields, rowVersion: z.number().int().min(1) })
  .strict()
  .refine((v) => v.warningValue != null || v.criticalValue != null, { message: "Au moins un seuil (attention ou critique) est attendu.", path: ["warningValue"] });
export type AnalyticsAlertRuleUpdate = z.infer<typeof analyticsAlertRuleUpdateSchema>;

export const analyticsAlertMetricInfoSchema = z.object({
  metric: analyticsAlertMetricSchema,
  label: z.string(),
  unit: z.enum(ANALYTICS_ALERT_UNITS),
  comparator: z.enum(ANALYTICS_ALERT_COMPARATORS),
  permission: z.string(),
  windowed: z.boolean(),
  defaultWindowDays: z.number().int().nullable(),
  /** Indicateur suivi par campus (finance) : un établissement à plusieurs campus doit en désigner un. */
  campusScoped: z.boolean(),
});
export const analyticsAlertMetricsDataSchema = z.object({ metrics: z.array(analyticsAlertMetricInfoSchema) });
export type AnalyticsAlertMetricsData = z.infer<typeof analyticsAlertMetricsDataSchema>;

export const analyticsAlertRuleSchema = z.object({
  id: analyticsUuidSchema,
  label: z.string(),
  metric: analyticsAlertMetricSchema,
  comparator: z.enum(ANALYTICS_ALERT_COMPARATORS),
  unit: z.enum(ANALYTICS_ALERT_UNITS),
  warningValue: z.number().nullable(),
  criticalValue: z.number().nullable(),
  windowDays: z.number().int().nullable(),
  institutionId: analyticsUuidSchema.nullable(),
  campusId: analyticsUuidSchema.nullable(),
  recipientRoles: z.array(z.string()),
  frequency: analyticsAlertFrequencySchema,
  enabled: z.boolean(),
  rowVersion: z.number().int(),
  lastEvaluatedAt: analyticsInstantSchema.nullable(),
  lastOutcome: z.enum(ANALYTICS_ALERT_OUTCOMES).nullable(),
  lastValue: z.number().nullable(),
  createdAt: analyticsInstantSchema,
  updatedAt: analyticsInstantSchema,
});
export type AnalyticsAlertRule = z.infer<typeof analyticsAlertRuleSchema>;
export const analyticsAlertRulesDataSchema = z.object({ rules: z.array(analyticsAlertRuleSchema) });
export type AnalyticsAlertRulesData = z.infer<typeof analyticsAlertRulesDataSchema>;

export const analyticsAlertsQuerySchema = z.object({
  status: analyticsAlertStatusSchema.optional(),
  severity: analyticsAlertSeveritySchema.optional(),
  metric: analyticsAlertMetricSchema.optional(),
  ruleId: analyticsUuidSchema.optional(),
  from: analyticsDateSchema.optional(),
  to: analyticsDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AnalyticsAlertsQuery = z.infer<typeof analyticsAlertsQuerySchema>;

export const analyticsAlertSchema = z.object({
  id: analyticsUuidSchema,
  ruleId: analyticsUuidSchema,
  ruleLabel: z.string(),
  metric: analyticsAlertMetricSchema,
  unit: z.enum(ANALYTICS_ALERT_UNITS),
  comparator: z.enum(ANALYTICS_ALERT_COMPARATORS),
  severity: analyticsAlertSeveritySchema,
  status: analyticsAlertStatusSchema,
  value: z.number(),
  threshold: z.number(),
  currency: z.string().nullable(),
  institutionId: analyticsUuidSchema.nullable(),
  campusId: analyticsUuidSchema.nullable(),
  raisedAt: analyticsInstantSchema,
  lastSeenAt: analyticsInstantSchema,
  asOf: analyticsInstantSchema.nullable(),
  notifyCount: z.number().int(),
  lastNotifiedAt: analyticsInstantSchema.nullable(),
  acknowledgedAt: analyticsInstantSchema.nullable(),
  acknowledgementNote: z.string().nullable(),
  resolvedAt: analyticsInstantSchema.nullable(),
  resolvedValue: z.number().nullable(),
});
export type AnalyticsAlert = z.infer<typeof analyticsAlertSchema>;

export const analyticsAlertsDataSchema = z.object({
  total: z.number().int(),
  counts: z.object({ open: z.number().int(), acknowledged: z.number().int(), resolved: z.number().int() }),
  alerts: z.array(analyticsAlertSchema),
});
export type AnalyticsAlertsData = z.infer<typeof analyticsAlertsDataSchema>;

export const analyticsAlertDetailSchema = analyticsAlertSchema.extend({
  notifications: z.array(z.object({ id: analyticsUuidSchema, reason: z.enum(["RAISED", "ESCALATED", "REMINDER"]), severity: analyticsAlertSeveritySchema, value: z.number(), recipientRoles: z.array(z.string()), emittedAt: analyticsInstantSchema })),
});
export type AnalyticsAlertDetail = z.infer<typeof analyticsAlertDetailSchema>;

export const analyticsAlertAcknowledgeBodySchema = z.object({ note: z.string().trim().max(ANALYTICS_ALERT_LIMITS.noteMax).optional() }).strict();
export type AnalyticsAlertAcknowledgeBody = z.infer<typeof analyticsAlertAcknowledgeBodySchema>;

/** Charge de `analytics.alert.raised` : consommée par `notifications` (alerte interne ; ni élève, ni nom, ni contenu libre). */
export const analyticsAlertRaisedPayloadSchema = z.object({
  v: z.literal(1),
  alertId: analyticsUuidSchema,
  ruleId: analyticsUuidSchema,
  metric: analyticsAlertMetricSchema,
  /** Libellé NEUTRE de l'indicateur (catalogue), jamais saisi librement. */
  metricLabel: z.string().max(120),
  severity: analyticsAlertSeveritySchema,
  reason: z.enum(["RAISED", "ESCALATED", "REMINDER"]),
  unit: z.enum(ANALYTICS_ALERT_UNITS),
  comparator: z.enum(ANALYTICS_ALERT_COMPARATORS),
  value: z.number().int().safe(),
  threshold: z.number().int().safe(),
  currency: z.string().length(3).nullable(),
  recipientRoles: z.array(alertRoleKey).min(1).max(ANALYTICS_ALERT_LIMITS.recipientRolesMax),
  /** Créneau de fréquence de cette notification (clé de dédoublonnage côté notifications). */
  dedupeKey: z.string().max(200),
  institutionId: analyticsUuidSchema.nullable(),
  campusId: analyticsUuidSchema.nullable(),
});
export type AnalyticsAlertRaisedPayload = z.infer<typeof analyticsAlertRaisedPayloadSchema>;

export const analyticsAlertAcknowledgedPayloadSchema = z.object({ v: z.literal(1), alertId: analyticsUuidSchema, ruleId: analyticsUuidSchema, acknowledgedBy: analyticsUuidSchema.nullable() });
export const analyticsAlertResolvedPayloadSchema = z.object({ v: z.literal(1), alertId: analyticsUuidSchema, ruleId: analyticsUuidSchema, metric: analyticsAlertMetricSchema, resolvedValue: z.number().int().safe() });

/** Charges des événements publiés (contrôlées par `apps/api/test/events-contracts`). */
export const analyticsEventPayloadSchemas = {
  "analytics.alert.raised": analyticsAlertRaisedPayloadSchema,
  "analytics.alert.acknowledged": analyticsAlertAcknowledgedPayloadSchema,
  "analytics.alert.resolved": analyticsAlertResolvedPayloadSchema,
} as const;
