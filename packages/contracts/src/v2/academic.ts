/**
 * Contrats du module `academic` (routes `/api/v1/academic/*`) — cœur académique : années, périodes typées,
 * programmes, curriculum polymorphe versionné, classes, offres, inscriptions, registre des numéros.
 *
 * Conventions (ADR-007) :
 *  - IDENTIFIANTS : UUID ; CODES en anglais (majuscules), LIBELLÉS en français (donnée de pack ou de tenant) ;
 *  - DATES civiles `YYYY-MM-DD` (jamais d'heure locale) ; INSTANTS ISO-8601 UTC (`...Z`) ;
 *  - DÉCIMAUX (coefficient, crédits, volumes horaires) : CHAÎNES décimales exactes (`"2.5"`), jamais de flottant ;
 *    en entrée un nombre ou une chaîne est accepté, en sortie toujours une chaîne canonique ;
 *  - AUCUNE constante réglementaire : niveaux, types de périodes, grammaire du curriculum, types de financement et
 *    issues d'année sont de la donnée (modèles de pack) ;
 *  - toutes les entrées sont `strict` (champ inconnu refusé) ;
 *  - tous les noms exportés sont préfixés `academic` : `v2/index.ts` les réexporte tous.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations (source unique, importée par le domaine du module)
// ---------------------------------------------------------------------------

export const academicUuidSchema = z.string().uuid();
export const academicDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "Date calendaire inexistante.");
export const academicInstantSchema = z.string().datetime({ offset: true });
/** Décimal exact en entrée : nombre fini ou chaîne `^\d+(\.\d+)?$`. */
export const academicDecimalInputSchema = z.union([
  z.number().finite().nonnegative(),
  z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Décimal attendu (ex. 2 ou 2.5)."),
]);
export const academicDecimalSchema = z.string().regex(/^\d+(\.\d+)?$/);

export const ACADEMIC_PACKS = ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"] as const;
export const academicPackSchema = z.enum(ACADEMIC_PACKS);
export type AcademicPack = z.infer<typeof academicPackSchema>;

export const ACADEMIC_YEAR_STATUSES = ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as const;
export const academicYearStatusSchema = z.enum(ACADEMIC_YEAR_STATUSES);
export type AcademicYearStatus = z.infer<typeof academicYearStatusSchema>;

export const ACADEMIC_PERIOD_STATUSES = ["PLANNED", "OPEN", "GRADING_CLOSED", "CLOSED"] as const;
export const academicPeriodStatusSchema = z.enum(ACADEMIC_PERIOD_STATUSES);
export type AcademicPeriodStatus = z.infer<typeof academicPeriodStatusSchema>;

/** États qu'une classe peut porter de façon explicite dans une période. */
export const ACADEMIC_CLASSROOM_PERIOD_STATUSES = ["OPEN", "GRADING_CLOSED", "CLOSED"] as const;
export const academicClassroomPeriodStatusSchema = z.enum(ACADEMIC_CLASSROOM_PERIOD_STATUSES);
export type AcademicClassroomPeriodStatus = z.infer<typeof academicClassroomPeriodStatusSchema>;

export const ACADEMIC_PERIOD_KINDS = ["TEACHING_PERIOD", "EXAM_SESSION"] as const;
export const academicPeriodKindSchema = z.enum(ACADEMIC_PERIOD_KINDS);

export const ACADEMIC_FUNDING_CODES = ["PRIVATE", "STATE_ASSIGNED", "SCHOLARSHIP", "COMPANY", "STAFF_CHILD", "OTHER"] as const;
export const academicFundingCodeSchema = z.enum(ACADEMIC_FUNDING_CODES);
export type AcademicFundingCode = z.infer<typeof academicFundingCodeSchema>;

export const ACADEMIC_OUTCOME_KINDS = ["ADVANCE", "REPEAT", "REDIRECT", "EXIT"] as const;
export const academicOutcomeKindSchema = z.enum(ACADEMIC_OUTCOME_KINDS);
export type AcademicOutcomeKind = z.infer<typeof academicOutcomeKindSchema>;

export const ACADEMIC_CONFIRMATION_POLICIES = ["AUTO", "ON_REGISTRATION_FEE_PAID", "ON_FULL_PAYMENT", "MANUAL"] as const;
export const academicConfirmationPolicySchema = z.enum(ACADEMIC_CONFIRMATION_POLICIES);
export type AcademicConfirmationPolicy = z.infer<typeof academicConfirmationPolicySchema>;

export const ACADEMIC_COURSE_CONFIRMATION_POLICIES = ["AUTO", "ON_LINE_PAID", "MANUAL"] as const;
export const academicCourseConfirmationPolicySchema = z.enum(ACADEMIC_COURSE_CONFIRMATION_POLICIES);
export type AcademicCourseConfirmationPolicy = z.infer<typeof academicCourseConfirmationPolicySchema>;

export const ACADEMIC_PROGRAM_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const ACADEMIC_SUBJECT_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const ACADEMIC_VERSION_STATUSES = ["DRAFT", "PUBLISHED", "LOCKED", "ARCHIVED"] as const;
export const academicVersionStatusSchema = z.enum(ACADEMIC_VERSION_STATUSES);
export type AcademicVersionStatus = z.infer<typeof academicVersionStatusSchema>;
export const ACADEMIC_NODE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
/** Mode de saisie d'un nœud : moyenne d'évaluations (`COMPOSED`) ou note saisie directement (`DIRECT`, ex. conduite). */
export const ACADEMIC_GRADING_MODES = ["COMPOSED", "DIRECT"] as const;

export const ACADEMIC_CLASSROOM_KINDS = ["CLASS", "COHORT"] as const;
export const ACADEMIC_CLASSROOM_STATUSES = ["DRAFT", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"] as const;
export const academicClassroomStatusSchema = z.enum(ACADEMIC_CLASSROOM_STATUSES);
export type AcademicClassroomStatus = z.infer<typeof academicClassroomStatusSchema>;

export const ACADEMIC_OFFERING_STATUSES = ["DRAFT", "OPEN", "FULL", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const academicOfferingStatusSchema = z.enum(ACADEMIC_OFFERING_STATUSES);
export type AcademicOfferingStatus = z.infer<typeof academicOfferingStatusSchema>;

export const ACADEMIC_ENROLLMENT_MODES = ["CLASS", "A_LA_CARTE"] as const;
export const academicEnrollmentModeSchema = z.enum(ACADEMIC_ENROLLMENT_MODES);
export type AcademicEnrollmentMode = z.infer<typeof academicEnrollmentModeSchema>;

export const ACADEMIC_ENROLLMENT_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "COMPLETED", "WITHDRAWN", "TRANSFERRED_OUT", "CANCELLED"] as const;
export const academicEnrollmentStatusSchema = z.enum(ACADEMIC_ENROLLMENT_STATUSES);
export type AcademicEnrollmentStatus = z.infer<typeof academicEnrollmentStatusSchema>;

/** O-01 : comment une inscription a été confirmée (paiement des frais, automatiquement, ou à la main — éventuellement par dérogation). */
export const ACADEMIC_ENROLLMENT_CONFIRMATION_MODES = ["AUTO", "PAYMENT", "MANUAL", "OVERRIDE"] as const;
export const academicEnrollmentConfirmationModeSchema = z.enum(ACADEMIC_ENROLLMENT_CONFIRMATION_MODES);
export type AcademicEnrollmentConfirmationMode = z.infer<typeof academicEnrollmentConfirmationModeSchema>;

export const ACADEMIC_ENROLLMENT_SOURCE_KINDS = ["ADMISSION", "IMPORT", "MANUAL", "ROLLOVER", "ONLINE"] as const;
export const academicEnrollmentSourceKindSchema = z.enum(ACADEMIC_ENROLLMENT_SOURCE_KINDS);

export const ACADEMIC_COURSE_SOURCES = ["OPTION", "A_LA_CARTE", "CARRY_OVER", "RESIT"] as const;
export const academicCourseSourceSchema = z.enum(ACADEMIC_COURSE_SOURCES);
export type AcademicCourseSource = z.infer<typeof academicCourseSourceSchema>;

export const ACADEMIC_COURSE_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"] as const;
export const academicCourseStatusSchema = z.enum(ACADEMIC_COURSE_STATUSES);
export type AcademicCourseStatus = z.infer<typeof academicCourseStatusSchema>;

/** Nature logique d'une inscription à un cours dans le registre `course_registrations` (011/019). */
export const ACADEMIC_REGISTRATION_KINDS = ["REGULAR", "OPTION", "A_LA_CARTE", "CARRY_OVER", "RESIT"] as const;
export const academicRegistrationKindSchema = z.enum(ACADEMIC_REGISTRATION_KINDS);
export type AcademicRegistrationKind = z.infer<typeof academicRegistrationKindSchema>;

export const ACADEMIC_AMENDMENT_KINDS = ["NODE_ADDED", "NODE_REMOVED", "NODE_MOVED", "COEFFICIENT", "CREDITS", "MANDATORY", "PREREQUISITE", "OTHER"] as const;
export const academicAmendmentKindSchema = z.enum(ACADEMIC_AMENDMENT_KINDS);

export const ACADEMIC_HISTORY_KINDS = ["CREATED", "STATUS", "FUNDING", "PLACEMENT", "COURSE", "OUTCOME", "NOTE"] as const;
export const academicHistoryKindSchema = z.enum(ACADEMIC_HISTORY_KINDS);

/** Codes d'erreur d'éligibilité à une offre, dans l'ordre d'évaluation (AC5.1). */
export const ACADEMIC_ELIGIBILITY_CODES = [
  "academic.offering_not_open",
  "academic.period_closed",
  "academic.registration_window_closed",
  "academic.duplicate_enrollment",
  "academic.offering_full",
  "academic.prerequisites_unmet",
] as const;
export const academicEligibilityCodeSchema = z.enum(ACADEMIC_ELIGIBILITY_CODES);

// Formats de codes (identiques aux CHECK de la base).
const upperCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, "Code en majuscules (A-Z, 0-9, _), 40 caractères max.");
/** Contrat de calcul des résultats : `<code>@<version>` (ex. `credit-semester@1`, `coef-semester@1`). */
export const academicCalculationContractSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}@[0-9]{1,3}$/, "Contrat de calcul « code@version » attendu.");
const gradeCode = z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/, "Code en majuscules (A-Z, 0-9, _), 40 caractères max.");
const dottedCode = z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/, "Code en majuscules (A-Z, 0-9, _ . -), 40 caractères max.");
const yearCode = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z_./-]{0,19}$/, "Code d'année (ex. 2026-2027), 20 caractères max.");
const label = z.string().trim().min(1).max(200);
const reason = z.string().trim().min(5, "Motif de 5 caractères minimum.").max(500);
const note = z.string().trim().min(1).max(1000);
const uuidList = z.array(academicUuidSchema).max(500);
const boolQuery = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

export const academicIdParamsSchema = z.object({ id: academicUuidSchema }).strict();
export const academicClassroomPeriodParamsSchema = z.object({ id: academicUuidSchema, periodId: academicUuidSchema }).strict();
export const academicChildParamsSchema = z.object({ studentId: academicUuidSchema }).strict();

export const academicPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AcademicPageQuery = z.infer<typeof academicPageQuerySchema>;

export function academicPageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int().nonnegative(), page: z.number().int(), pageSize: z.number().int() });
}

// ---------------------------------------------------------------------------
// Référentiels (pilotés par les modèles de pack)
// ---------------------------------------------------------------------------

export const academicEducationLevelDtoSchema = z.object({
  id: academicUuidSchema,
  code: upperCode,
  label: z.string(),
  ordinal: z.number().int(),
  pack: academicPackSchema.nullable(),
  /** Contrat de calcul par défaut des programmes du cycle d'enseignement. */
  calculationContract: academicCalculationContractSchema.nullable(),
  active: z.boolean(),
});
export type AcademicEducationLevelDto = z.infer<typeof academicEducationLevelDtoSchema>;

export const academicGradeLevelDtoSchema = z.object({
  id: academicUuidSchema,
  educationLevelId: academicUuidSchema,
  code: gradeCode,
  label: z.string(),
  shortLabel: z.string().nullable(),
  ordinal: z.number().int(),
  nextGradeLevelId: academicUuidSchema.nullable(),
  isFinal: z.boolean(),
  /** Le niveau se conclut par un examen terminal. */
  terminalExamRequired: z.boolean(),
  active: z.boolean(),
});
export type AcademicGradeLevelDto = z.infer<typeof academicGradeLevelDtoSchema>;

export const academicPeriodTypeDtoSchema = z.object({
  id: academicUuidSchema,
  code: upperCode,
  label: z.string(),
  kind: academicPeriodKindSchema,
  active: z.boolean(),
});
export type AcademicPeriodTypeDto = z.infer<typeof academicPeriodTypeDtoSchema>;

export const academicPeriodPlanSlotSchema = z
  .object({
    type: upperCode,
    ordinal: z.number().int().min(1).max(99),
    label,
    /** Poids relatif dans la répartition de l'année (défaut 1 : parts égales). */
    weight: z.number().int().min(1).max(1000).optional(),
    /** Poids de la période dans la moyenne annuelle (défaut 1 : poids égaux) ; distinct de `weight`, qui répartit les dates. */
    averageWeight: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type AcademicPeriodPlanSlot = z.infer<typeof academicPeriodPlanSlotSchema>;

export const academicPeriodPlanDtoSchema = z.object({
  id: academicUuidSchema,
  code: upperCode,
  label: z.string(),
  slots: z.array(academicPeriodPlanSlotSchema),
  active: z.boolean(),
});
export type AcademicPeriodPlanDto = z.infer<typeof academicPeriodPlanDtoSchema>;

export const academicFundingTypeDtoSchema = z.object({
  id: academicUuidSchema,
  code: academicFundingCodeSchema,
  label: z.string(),
  requiresReference: z.boolean(),
  requiresFunder: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type AcademicFundingTypeDto = z.infer<typeof academicFundingTypeDtoSchema>;

export const academicEnrollmentOutcomeDtoSchema = z.object({
  id: academicUuidSchema,
  code: upperCode,
  label: z.string(),
  kind: academicOutcomeKindSchema,
  active: z.boolean(),
});
export type AcademicEnrollmentOutcomeDto = z.infer<typeof academicEnrollmentOutcomeDtoSchema>;

export const academicNodeTypeDtoSchema = z.object({
  id: academicUuidSchema,
  code: upperCode,
  label: z.string(),
  allowedParentCodes: z.array(z.string()).min(1),
  requiresGradeLevel: z.boolean(),
  requiresPeriodSlot: z.boolean(),
  requiresSubject: z.boolean(),
  allowsCoefficient: z.boolean(),
  allowsCredits: z.boolean(),
  creditsMustEqualChildren: z.boolean(),
  isEnrollable: z.boolean(),
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
});
export type AcademicNodeTypeDto = z.infer<typeof academicNodeTypeDtoSchema>;

export const academicSettingsDtoSchema = z.object({
  institutionId: academicUuidSchema,
  enrollmentConfirmationPolicy: academicConfirmationPolicySchema,
  courseConfirmationPolicy: academicCourseConfirmationPolicySchema,
  pendingHoldMinutes: z.number().int().positive().nullable(),
  registrationNumberPrefix: z.string().nullable(),
  registrationNumberPattern: z.string().nullable(),
});
export type AcademicSettingsDto = z.infer<typeof academicSettingsDtoSchema>;

export const academicUpdateSettingsBodySchema = z
  .object({
    enrollmentConfirmationPolicy: academicConfirmationPolicySchema.optional(),
    courseConfirmationPolicy: academicCourseConfirmationPolicySchema.optional(),
    pendingHoldMinutes: z.number().int().positive().max(525_600).nullable().optional(),
    registrationNumberPrefix: z.string().regex(/^[A-Z0-9]{1,12}$/).nullable().optional(),
    /** Motif du numéro d'inscription ; jetons `{PREFIX}` `{PROGRAM}` `{LEVEL}` `{YEAR}` `{STUDENT_SEQ:n}` (obligatoire). */
    registrationNumberPattern: z.string().min(3).max(80).nullable().optional(),
  })
  .strict();
export type AcademicUpdateSettingsBody = z.infer<typeof academicUpdateSettingsBodySchema>;

// Remplacement/ajout de référentiels (PUT /reference/*) : upsert PAR CODE, jamais de suppression.
export const academicPutEducationLevelsBodySchema = z
  .object({
    items: z.array(z.object({ code: upperCode, label, ordinal: z.number().int().min(0), pack: academicPackSchema.nullable().optional(), calculationContract: academicCalculationContractSchema.nullable().optional(), active: z.boolean().optional() }).strict()).min(1).max(100),
  })
  .strict();
export const academicPutGradeLevelsBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            code: gradeCode,
            label,
            shortLabel: z.string().trim().min(1).max(40).nullable().optional(),
            educationLevelCode: upperCode,
            ordinal: z.number().int().min(0),
            nextGradeLevelCode: gradeCode.nullable().optional(),
            isFinal: z.boolean().optional(),
            terminalExamRequired: z.boolean().optional(),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export const academicPutPeriodTypesBodySchema = z
  .object({ items: z.array(z.object({ code: upperCode, label, kind: academicPeriodKindSchema, active: z.boolean().optional() }).strict()).min(1).max(100) })
  .strict();
export const academicPutPeriodPlansBodySchema = z
  .object({ items: z.array(z.object({ code: upperCode, label, slots: z.array(academicPeriodPlanSlotSchema).min(1).max(24), active: z.boolean().optional() }).strict()).min(1).max(50) })
  .strict();
export const academicPutFundingTypesBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            code: academicFundingCodeSchema,
            label,
            requiresReference: z.boolean().optional(),
            requiresFunder: z.boolean().optional(),
            sortOrder: z.number().int().optional(),
            active: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const academicPutOutcomesBodySchema = z
  .object({ items: z.array(z.object({ code: upperCode, label, kind: academicOutcomeKindSchema, active: z.boolean().optional() }).strict()).min(1).max(50) })
  .strict();
export const academicPutNodeTypesBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            code: upperCode,
            label,
            allowedParentCodes: z.array(z.string().regex(/^(ROOT|[A-Z][A-Z0-9_]{0,39})$/)).min(1).max(20),
            requiresGradeLevel: z.boolean().optional(),
            requiresPeriodSlot: z.boolean().optional(),
            requiresSubject: z.boolean().optional(),
            allowsCoefficient: z.boolean().optional(),
            allowsCredits: z.boolean().optional(),
            creditsMustEqualChildren: z.boolean().optional(),
            isEnrollable: z.boolean().optional(),
            sortOrder: z.number().int().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const academicReferenceKindParamsSchema = z
  .object({ kind: z.enum(["education-levels", "grade-levels", "period-types", "period-plans", "funding-types", "enrollment-outcomes", "node-types"]) })
  .strict();
export type AcademicReferenceKind = z.infer<typeof academicReferenceKindParamsSchema>["kind"];

export const academicApplyTemplateBodySchema = z
  .object({
    pack: academicPackSchema.optional(),
    educationSystem: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const academicApplyTemplateResultSchema = z.object({
  institutionId: academicUuidSchema,
  pack: academicPackSchema,
  educationSystem: z.string(),
  templateVersion: z.number().int(),
  alreadyApplied: z.boolean(),
  created: z.record(z.number().int()),
  existing: z.record(z.number().int()),
  customizedKept: z.array(z.string()),
});
export type AcademicApplyTemplateResult = z.infer<typeof academicApplyTemplateResultSchema>;

// ---------------------------------------------------------------------------
// Années et périodes
// ---------------------------------------------------------------------------

export const academicYearDtoSchema = z.object({
  id: academicUuidSchema,
  institutionId: academicUuidSchema,
  code: z.string(),
  label: z.string(),
  startsOn: academicDateSchema,
  endsOn: academicDateSchema,
  status: academicYearStatusSchema,
  isCurrent: z.boolean(),
  openedAt: academicInstantSchema.nullable(),
  closedAt: academicInstantSchema.nullable(),
  archivedAt: academicInstantSchema.nullable(),
});
export type AcademicYearDto = z.infer<typeof academicYearDtoSchema>;

export const academicCreateYearBodySchema = z
  .object({
    institutionId: academicUuidSchema,
    code: yearCode,
    label,
    startsOn: academicDateSchema,
    /** Défaut : `startsOn` + 1 an − 1 jour (douze mois pleins). */
    endsOn: academicDateSchema.optional(),
  })
  .strict();
export type AcademicCreateYearBody = z.infer<typeof academicCreateYearBodySchema>;

export const academicUpdateYearBodySchema = z
  .object({ label: label.optional(), startsOn: academicDateSchema.optional(), endsOn: academicDateSchema.optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");

export const academicListYearsQuerySchema = z.object({
  institutionId: academicUuidSchema.optional(),
  status: academicYearStatusSchema.optional(),
});
export const academicCurrentYearQuerySchema = z.object({ institutionId: academicUuidSchema.optional() });
export const academicYearGapDtoSchema = z.object({
  institutionId: academicUuidSchema,
  previousYearId: academicUuidSchema,
  nextYearId: academicUuidSchema,
  gapDays: z.number().int(),
});
export const academicCloseYearBodySchema = z.object({ reason: reason.optional() }).strict();

export const academicPeriodDtoSchema = z.object({
  id: academicUuidSchema,
  academicYearId: academicUuidSchema,
  parentPeriodId: academicUuidSchema.nullable(),
  periodTypeCode: z.string(),
  ordinal: z.number().int(),
  code: z.string(),
  label: z.string(),
  startsOn: academicDateSchema,
  endsOn: academicDateSchema,
  status: academicPeriodStatusSchema,
  openedAt: academicInstantSchema.nullable(),
  gradingClosedAt: academicInstantSchema.nullable(),
  closedAt: academicInstantSchema.nullable(),
  closedBy: academicUuidSchema.nullable(),
  reopenedCount: z.number().int(),
  /** Poids de la période dans la moyenne annuelle (défaut 1). */
  averageWeight: z.number().int().optional(),
});
export type AcademicPeriodDto = z.infer<typeof academicPeriodDtoSchema>;

export const academicCreatePeriodBodySchema = z
  .object({
    periodTypeCode: upperCode,
    parentPeriodId: academicUuidSchema.nullable().optional(),
    ordinal: z.number().int().min(1).max(99),
    code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/),
    label,
    startsOn: academicDateSchema,
    endsOn: academicDateSchema,
  })
  .strict();
export type AcademicCreatePeriodBody = z.infer<typeof academicCreatePeriodBodySchema>;

export const academicUpdatePeriodBodySchema = z
  .object({ label: label.optional(), startsOn: academicDateSchema.optional(), endsOn: academicDateSchema.optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");

export const academicApplyPeriodPlanBodySchema = z.object({ planCode: upperCode }).strict();
export const academicReopenBodySchema = z.object({ reason }).strict();
export const academicResolvePeriodQuerySchema = z.object({
  institutionId: academicUuidSchema.optional(),
  date: academicDateSchema,
  type: upperCode.optional(),
});
export const academicEffectiveStateDtoSchema = z.object({
  classroomId: academicUuidSchema,
  periodId: academicUuidSchema,
  state: academicPeriodStatusSchema,
  explicit: z.boolean(),
});
export type AcademicEffectiveStateDto = z.infer<typeof academicEffectiveStateDtoSchema>;

// ---------------------------------------------------------------------------
// Programmes, niveaux couverts, matières
// ---------------------------------------------------------------------------

export const academicProgramDtoSchema = z.object({
  id: academicUuidSchema,
  institutionId: academicUuidSchema,
  educationLevelId: academicUuidSchema,
  parentProgramId: academicUuidSchema.nullable(),
  code: z.string(),
  label: z.string(),
  kindCode: z.string(),
  domainCode: z.string().nullable(),
  description: z.string().nullable(),
  durationMonths: z.number().int().nullable(),
  attributes: z.record(z.unknown()),
  status: z.enum(ACADEMIC_PROGRAM_STATUSES),
  /** Cycle conduisant à un diplôme (nœud de cycle de higher). */
  isCycle: z.boolean(),
  /** Contrat de calcul des résultats du programme (`credit-semester@1`…), ou `null` (celui du cycle d'enseignement). */
  calculationContract: academicCalculationContractSchema.nullable(),
  gradeLevelIds: z.array(academicUuidSchema),
});
export type AcademicProgramDto = z.infer<typeof academicProgramDtoSchema>;

export const academicCreateProgramBodySchema = z
  .object({
    institutionId: academicUuidSchema,
    educationLevelId: academicUuidSchema,
    parentProgramId: academicUuidSchema.nullable().optional(),
    code: dottedCode,
    label,
    kindCode: upperCode.optional(),
    domainCode: dottedCode.nullable().optional(),
    description: note.nullable().optional(),
    durationMonths: z.number().int().positive().max(240).nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    isCycle: z.boolean().optional(),
    calculationContract: academicCalculationContractSchema.nullable().optional(),
    gradeLevelIds: z.array(academicUuidSchema).max(30).optional(),
  })
  .strict();
export type AcademicCreateProgramBody = z.infer<typeof academicCreateProgramBodySchema>;

export const academicUpdateProgramBodySchema = z
  .object({
    label: label.optional(),
    kindCode: upperCode.optional(),
    domainCode: dottedCode.nullable().optional(),
    description: note.nullable().optional(),
    durationMonths: z.number().int().positive().max(240).nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    status: z.enum(ACADEMIC_PROGRAM_STATUSES).optional(),
    isCycle: z.boolean().optional(),
    calculationContract: academicCalculationContractSchema.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");

export const academicSetProgramGradeLevelsBodySchema = z.object({ gradeLevelIds: z.array(academicUuidSchema).min(1).max(30) }).strict();
export const academicListProgramsQuerySchema = z.object({
  institutionId: academicUuidSchema.optional(),
  status: z.enum(ACADEMIC_PROGRAM_STATUSES).optional(),
  educationLevelId: academicUuidSchema.optional(),
});

export const academicSubjectDtoSchema = z.object({
  id: academicUuidSchema,
  institutionId: academicUuidSchema.nullable(),
  code: z.string(),
  label: z.string(),
  shortLabel: z.string().nullable(),
  domainCode: z.string().nullable(),
  description: z.string().nullable(),
  attributes: z.record(z.unknown()),
  status: z.enum(ACADEMIC_SUBJECT_STATUSES),
});
export type AcademicSubjectDto = z.infer<typeof academicSubjectDtoSchema>;

export const academicCreateSubjectBodySchema = z
  .object({
    institutionId: academicUuidSchema.nullable().optional(),
    code: dottedCode,
    label,
    shortLabel: z.string().trim().min(1).max(40).nullable().optional(),
    domainCode: dottedCode.nullable().optional(),
    description: note.nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
  })
  .strict();
export type AcademicCreateSubjectBody = z.infer<typeof academicCreateSubjectBodySchema>;
export const academicUpdateSubjectBodySchema = z
  .object({
    label: label.optional(),
    shortLabel: z.string().trim().min(1).max(40).nullable().optional(),
    domainCode: dottedCode.nullable().optional(),
    description: note.nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    status: z.enum(ACADEMIC_SUBJECT_STATUSES).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");
export const academicListSubjectsQuerySchema = z.object({
  institutionId: academicUuidSchema.optional(),
  status: z.enum(ACADEMIC_SUBJECT_STATUSES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Curriculum
// ---------------------------------------------------------------------------

export const academicCurriculumVersionDtoSchema = z.object({
  id: academicUuidSchema,
  programId: academicUuidSchema,
  academicYearId: academicUuidSchema,
  status: academicVersionStatusSchema,
  clonedFromVersionId: academicUuidSchema.nullable(),
  publishedAt: academicInstantSchema.nullable(),
  publishedBy: academicUuidSchema.nullable(),
  lockedAt: academicInstantSchema.nullable(),
  note: z.string().nullable(),
  nodeCount: z.number().int().nonnegative(),
});
export type AcademicCurriculumVersionDto = z.infer<typeof academicCurriculumVersionDtoSchema>;

export const academicCurriculumNodeDtoSchema = z.object({
  id: academicUuidSchema,
  versionId: academicUuidSchema,
  parentId: academicUuidSchema.nullable(),
  nodeTypeCode: z.string(),
  lineageId: academicUuidSchema,
  subjectId: academicUuidSchema.nullable(),
  gradeLevelId: academicUuidSchema.nullable(),
  periodTypeCode: z.string().nullable(),
  periodOrdinal: z.number().int().nullable(),
  code: z.string(),
  label: z.string(),
  ordinal: z.number().int(),
  coefficient: academicDecimalSchema.nullable(),
  credits: academicDecimalSchema.nullable(),
  isMandatory: z.boolean(),
  isTransversal: z.boolean(),
  categoryCode: z.string().nullable(),
  /** Faits de calcul des résultats (module results). */
  gradingMode: z.enum(ACADEMIC_GRADING_MODES),
  resitAllowed: z.boolean(),
  countsInAverage: z.boolean(),
  sectionKey: z.string().nullable(),
  hoursTotal: academicDecimalSchema.nullable(),
  hoursLecture: academicDecimalSchema.nullable(),
  hoursTutorial: academicDecimalSchema.nullable(),
  hoursPractical: academicDecimalSchema.nullable(),
  attributes: z.record(z.unknown()),
  status: z.enum(ACADEMIC_NODE_STATUSES),
  /** Lignées des prérequis (logique ET). */
  prerequisiteLineageIds: z.array(academicUuidSchema),
});
export type AcademicCurriculumNodeDto = z.infer<typeof academicCurriculumNodeDtoSchema>;

export type AcademicCurriculumTreeNodeDto = AcademicCurriculumNodeDto & { children: AcademicCurriculumTreeNodeDto[] };
export const academicCurriculumTreeNodeDtoSchema: z.ZodType<AcademicCurriculumTreeNodeDto> = z.lazy(() =>
  academicCurriculumNodeDtoSchema.extend({ children: z.array(academicCurriculumTreeNodeDtoSchema) }),
);
export const academicCurriculumTreeDtoSchema = z.object({
  version: academicCurriculumVersionDtoSchema,
  roots: z.array(academicCurriculumTreeNodeDtoSchema),
});
export type AcademicCurriculumTreeDto = z.infer<typeof academicCurriculumTreeDtoSchema>;

export const academicListCurriculumVersionsQuerySchema = z.object({
  programId: academicUuidSchema.optional(),
  yearId: academicUuidSchema.optional(),
  status: academicVersionStatusSchema.optional(),
});

export const academicCreateCurriculumVersionBodySchema = z
  .object({
    programId: academicUuidSchema,
    academicYearId: academicUuidSchema,
    cloneFromVersionId: academicUuidSchema.optional(),
    note: note.optional(),
  })
  .strict();
export const academicCloneCurriculumBodySchema = z.object({ academicYearId: academicUuidSchema, note: note.optional() }).strict();

const nodeFields = {
  parentId: academicUuidSchema.nullable().optional(),
  nodeTypeCode: upperCode,
  code: dottedCode,
  label,
  subjectId: academicUuidSchema.nullable().optional(),
  gradeLevelId: academicUuidSchema.nullable().optional(),
  periodTypeCode: upperCode.nullable().optional(),
  periodOrdinal: z.number().int().min(1).max(99).nullable().optional(),
  ordinal: z.number().int().min(0).max(100_000).optional(),
  coefficient: academicDecimalInputSchema.nullable().optional(),
  credits: academicDecimalInputSchema.nullable().optional(),
  isMandatory: z.boolean().optional(),
  isTransversal: z.boolean().optional(),
  categoryCode: upperCode.nullable().optional(),
  gradingMode: z.enum(ACADEMIC_GRADING_MODES).optional(),
  resitAllowed: z.boolean().optional(),
  countsInAverage: z.boolean().optional(),
  sectionKey: upperCode.nullable().optional(),
  hoursTotal: academicDecimalInputSchema.nullable().optional(),
  hoursLecture: academicDecimalInputSchema.nullable().optional(),
  hoursTutorial: academicDecimalInputSchema.nullable().optional(),
  hoursPractical: academicDecimalInputSchema.nullable().optional(),
  attributes: z.record(z.unknown()).optional(),
  status: z.enum(ACADEMIC_NODE_STATUSES).optional(),
};
export const academicCreateNodeBodySchema = z.object(nodeFields).strict();
export type AcademicCreateNodeBody = z.infer<typeof academicCreateNodeBodySchema>;

const { nodeTypeCode: _nodeTypeCode, parentId: _parentId, ...updatableNodeFields } = nodeFields;
void _nodeTypeCode;
void _parentId;
export const academicUpdateNodeBodySchema = z
  .object({
    code: updatableNodeFields.code.optional(),
    label: updatableNodeFields.label.optional(),
    subjectId: updatableNodeFields.subjectId,
    gradeLevelId: updatableNodeFields.gradeLevelId,
    periodTypeCode: updatableNodeFields.periodTypeCode,
    periodOrdinal: updatableNodeFields.periodOrdinal,
    ordinal: updatableNodeFields.ordinal,
    coefficient: updatableNodeFields.coefficient,
    credits: updatableNodeFields.credits,
    isMandatory: updatableNodeFields.isMandatory,
    isTransversal: updatableNodeFields.isTransversal,
    categoryCode: updatableNodeFields.categoryCode,
    gradingMode: updatableNodeFields.gradingMode,
    resitAllowed: updatableNodeFields.resitAllowed,
    countsInAverage: updatableNodeFields.countsInAverage,
    sectionKey: updatableNodeFields.sectionKey,
    hoursTotal: updatableNodeFields.hoursTotal,
    hoursLecture: updatableNodeFields.hoursLecture,
    hoursTutorial: updatableNodeFields.hoursTutorial,
    hoursPractical: updatableNodeFields.hoursPractical,
    attributes: updatableNodeFields.attributes,
    status: updatableNodeFields.status,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");
export type AcademicUpdateNodeBody = z.infer<typeof academicUpdateNodeBodySchema>;

export const academicMoveNodeBodySchema = z.object({ parentId: academicUuidSchema.nullable(), ordinal: z.number().int().min(0).max(100_000).optional() }).strict();
export const academicSetPrerequisitesBodySchema = z.object({ requiredLineageIds: z.array(academicUuidSchema).max(50) }).strict();

export const academicValidationIssueSchema = z.object({
  severity: z.enum(["ERROR", "WARN"]),
  code: z.string(),
  nodeId: academicUuidSchema.nullable(),
  message: z.string(),
});
export type AcademicValidationIssue = z.infer<typeof academicValidationIssueSchema>;
export const academicValidationReportSchema = z.object({
  versionId: academicUuidSchema,
  valid: z.boolean(),
  errors: z.number().int(),
  warnings: z.number().int(),
  issues: z.array(academicValidationIssueSchema),
  stats: z.object({ nodes: z.number().int(), byType: z.record(z.number().int()) }),
});
export type AcademicValidationReport = z.infer<typeof academicValidationReportSchema>;

/** Opération d'un amendement de curriculum publié (`curriculum.amend`, sensible). */
export const academicAmendOperationSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("UPDATE_NODE"),
      nodeId: academicUuidSchema,
      patch: z
        .object({
          label: label.optional(),
          coefficient: academicDecimalInputSchema.nullable().optional(),
          credits: academicDecimalInputSchema.nullable().optional(),
          categoryCode: upperCode.nullable().optional(),
          gradingMode: z.enum(ACADEMIC_GRADING_MODES).optional(),
          resitAllowed: z.boolean().optional(),
          countsInAverage: z.boolean().optional(),
          sectionKey: upperCode.nullable().optional(),
          hoursTotal: academicDecimalInputSchema.nullable().optional(),
          hoursLecture: academicDecimalInputSchema.nullable().optional(),
          hoursTutorial: academicDecimalInputSchema.nullable().optional(),
          hoursPractical: academicDecimalInputSchema.nullable().optional(),
          isMandatory: z.boolean().optional(),
          status: z.enum(ACADEMIC_NODE_STATUSES).optional(),
        })
        .strict()
        .refine((b) => Object.keys(b).length > 0, "Aucune modification."),
    })
    .strict(),
  z.object({ op: z.literal("ADD_NODE"), node: academicCreateNodeBodySchema }).strict(),
  z.object({ op: z.literal("REMOVE_NODE"), nodeId: academicUuidSchema }).strict(),
  z.object({ op: z.literal("MOVE_NODE"), nodeId: academicUuidSchema, parentId: academicUuidSchema.nullable(), ordinal: z.number().int().min(0).optional() }).strict(),
  z.object({ op: z.literal("SET_PREREQUISITES"), nodeId: academicUuidSchema, requiredLineageIds: z.array(academicUuidSchema).max(50) }).strict(),
]);
export type AcademicAmendOperation = z.infer<typeof academicAmendOperationSchema>;
export const academicAmendBodySchema = z.object({ reason, operations: z.array(academicAmendOperationSchema).min(1).max(200) }).strict();
export type AcademicAmendBody = z.infer<typeof academicAmendBodySchema>;

export const academicAmendmentDtoSchema = z.object({
  id: academicUuidSchema,
  versionId: academicUuidSchema,
  nodeId: academicUuidSchema.nullable(),
  kind: academicAmendmentKindSchema,
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  reason: z.string(),
  amendedBy: academicUuidSchema,
  amendedAt: academicInstantSchema,
});
export type AcademicAmendmentDto = z.infer<typeof academicAmendmentDtoSchema>;

// ---------------------------------------------------------------------------
// Classes, offres
// ---------------------------------------------------------------------------

export const academicClassroomDtoSchema = z.object({
  id: academicUuidSchema,
  institutionId: academicUuidSchema,
  campusId: academicUuidSchema.nullable(),
  academicYearId: academicUuidSchema,
  programId: academicUuidSchema,
  gradeLevelId: academicUuidSchema,
  curriculumVersionId: academicUuidSchema.nullable(),
  kind: z.enum(ACADEMIC_CLASSROOM_KINDS),
  code: z.string(),
  name: z.string(),
  capacity: z.number().int().positive().nullable(),
  capacityIsHard: z.boolean(),
  status: academicClassroomStatusSchema,
  startsOn: academicDateSchema.nullable(),
  endsOn: academicDateSchema.nullable(),
  enrolledCount: z.number().int().nonnegative(),
});
export type AcademicClassroomDto = z.infer<typeof academicClassroomDtoSchema>;

export const academicCreateClassroomBodySchema = z
  .object({
    institutionId: academicUuidSchema,
    campusId: academicUuidSchema.nullable().optional(),
    academicYearId: academicUuidSchema,
    programId: academicUuidSchema,
    gradeLevelId: academicUuidSchema,
    curriculumVersionId: academicUuidSchema.nullable().optional(),
    kind: z.enum(ACADEMIC_CLASSROOM_KINDS).optional(),
    code: dottedCode,
    name: label,
    capacity: z.number().int().positive().max(10_000).nullable().optional(),
    capacityIsHard: z.boolean().optional(),
    startsOn: academicDateSchema.nullable().optional(),
    endsOn: academicDateSchema.nullable().optional(),
  })
  .strict();
export type AcademicCreateClassroomBody = z.infer<typeof academicCreateClassroomBodySchema>;

export const academicUpdateClassroomBodySchema = z
  .object({
    campusId: academicUuidSchema.nullable().optional(),
    curriculumVersionId: academicUuidSchema.nullable().optional(),
    name: label.optional(),
    code: dottedCode.optional(),
    capacity: z.number().int().positive().max(10_000).nullable().optional(),
    capacityIsHard: z.boolean().optional(),
    startsOn: academicDateSchema.nullable().optional(),
    endsOn: academicDateSchema.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");

export const academicListClassroomsQuerySchema = academicPageQuerySchema.extend({
  institutionId: academicUuidSchema.optional(),
  academicYearId: academicUuidSchema.optional(),
  programId: academicUuidSchema.optional(),
  gradeLevelId: academicUuidSchema.optional(),
  status: academicClassroomStatusSchema.optional(),
});
export const academicClassroomActionBodySchema = z.object({ reason: reason.optional() }).strict();

export const academicOfferingDtoSchema = z.object({
  id: academicUuidSchema,
  classroomId: academicUuidSchema,
  curriculumNodeId: academicUuidSchema,
  label: z.string(),
  startsOn: academicDateSchema,
  endsOn: academicDateSchema,
  registrationOpensAt: academicInstantSchema.nullable(),
  registrationClosesAt: academicInstantSchema.nullable(),
  capacity: z.number().int().positive().nullable(),
  status: academicOfferingStatusSchema,
  /** Places réservées (PENDING non expirées + CONFIRMED + COMPLETED). */
  heldPlaces: z.number().int().nonnegative(),
});
export type AcademicOfferingDto = z.infer<typeof academicOfferingDtoSchema>;

const registrationWindow = {
  registrationOpensAt: academicInstantSchema.nullable().optional(),
  registrationClosesAt: academicInstantSchema.nullable().optional(),
};
const windowRefine = (b: { registrationOpensAt?: string | null | undefined; registrationClosesAt?: string | null | undefined }) =>
  (b.registrationOpensAt == null) === (b.registrationClosesAt == null);
const WINDOW_MESSAGE = "Les deux bornes de la fenêtre d'inscription sont renseignées ensemble.";

export const academicCreateOfferingBodySchema = z
  .object({
    curriculumNodeId: academicUuidSchema,
    label: label.optional(),
    startsOn: academicDateSchema,
    endsOn: academicDateSchema,
    ...registrationWindow,
    capacity: z.number().int().positive().max(10_000).nullable().optional(),
  })
  .strict()
  .refine(windowRefine, WINDOW_MESSAGE);
export type AcademicCreateOfferingBody = z.infer<typeof academicCreateOfferingBodySchema>;

export const academicOpenPeriodOfferingsBodySchema = z
  .object({
    periodNodeId: academicUuidSchema,
    startsOn: academicDateSchema,
    endsOn: academicDateSchema,
    ...registrationWindow,
    capacity: z.number().int().positive().max(10_000).nullable().optional(),
    /** Ouvre directement les offres (`OPEN`, soumis à `OfferingReadinessGuard`) au lieu de `DRAFT`. */
    open: z.boolean().optional(),
  })
  .strict()
  .refine(windowRefine, WINDOW_MESSAGE);
export type AcademicOpenPeriodOfferingsBody = z.infer<typeof academicOpenPeriodOfferingsBodySchema>;

export const academicOpenPeriodOfferingsResultSchema = z.object({
  created: z.array(academicOfferingDtoSchema),
  existing: z.array(academicOfferingDtoSchema),
});

export const academicUpdateOfferingBodySchema = z
  .object({
    label: label.optional(),
    startsOn: academicDateSchema.optional(),
    endsOn: academicDateSchema.optional(),
    ...registrationWindow,
    capacity: z.number().int().positive().max(10_000).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");
export const academicReopenOfferingBodySchema = z
  .object({ reason, startsOn: academicDateSchema.optional(), endsOn: academicDateSchema, ...registrationWindow, status: z.enum(["OPEN", "IN_PROGRESS", "DRAFT"]).optional() })
  .strict()
  .refine(windowRefine, WINDOW_MESSAGE);
export const academicOfferingActionBodySchema = z.object({ reason: reason.optional() }).strict();

export const academicListOfferingsQuerySchema = z.object({
  status: academicOfferingStatusSchema.optional(),
  classroomId: academicUuidSchema.optional(),
});

export const academicEligibilityQuerySchema = z.object({ studentId: academicUuidSchema.optional() });
export const academicEligibilityWarningSchema = z.object({ code: z.string(), message: z.string(), requiresOverride: z.boolean() });
export const academicEligibilityDtoSchema = z.object({
  offeringId: academicUuidSchema,
  studentId: academicUuidSchema,
  eligible: z.boolean(),
  code: academicEligibilityCodeSchema.nullable(),
  message: z.string().nullable(),
  missingPrerequisiteLineageIds: z.array(academicUuidSchema),
  warnings: z.array(academicEligibilityWarningSchema),
  remainingPlaces: z.number().int().nullable(),
});
export type AcademicEligibilityDto = z.infer<typeof academicEligibilityDtoSchema>;

export const academicCatalogQuerySchema = z.object({
  institutionId: academicUuidSchema.optional(),
  programId: academicUuidSchema.optional(),
  studentId: academicUuidSchema.optional(),
});
export const academicCatalogItemDtoSchema = z.object({
  offering: academicOfferingDtoSchema,
  node: z.object({ id: academicUuidSchema, lineageId: academicUuidSchema, code: z.string(), label: z.string(), credits: academicDecimalSchema.nullable(), coefficient: academicDecimalSchema.nullable() }),
  classroomName: z.string(),
  programId: academicUuidSchema,
  remainingPlaces: z.number().int().nullable(),
  prerequisiteLineageIds: z.array(academicUuidSchema),
  eligibility: academicEligibilityDtoSchema.nullable(),
});
export type AcademicCatalogItemDto = z.infer<typeof academicCatalogItemDtoSchema>;

// ---------------------------------------------------------------------------
// Inscriptions
// ---------------------------------------------------------------------------

export const academicOverrideSchema = z.object({ reason }).strict();
export type AcademicOverride = z.infer<typeof academicOverrideSchema>;

export const academicEnrollmentDtoSchema = z.object({
  id: academicUuidSchema,
  institutionId: academicUuidSchema,
  campusId: academicUuidSchema.nullable(),
  academicYearId: academicUuidSchema,
  studentId: academicUuidSchema,
  classroomId: academicUuidSchema,
  mode: academicEnrollmentModeSchema,
  status: academicEnrollmentStatusSchema,
  registrationNumber: z.string().nullable(),
  enrolledOn: academicDateSchema,
  endedOn: academicDateSchema.nullable(),
  endReason: z.string().nullable(),
  isRepeating: z.boolean(),
  isTransferIn: z.boolean(),
  originSchool: z.string().nullable(),
  previousEnrollmentId: academicUuidSchema.nullable(),
  fundingType: z.string(),
  assignmentReference: z.string().nullable(),
  assignmentIssuedOn: academicDateSchema.nullable(),
  funderLabel: z.string().nullable(),
  fundingNotes: z.string().nullable(),
  outcomeCode: z.string().nullable(),
  outcomeDecidedAt: academicInstantSchema.nullable(),
  outcomeSourceRef: academicUuidSchema.nullable(),
  sourceKind: academicEnrollmentSourceKindSchema.nullable(),
  sourceRef: academicUuidSchema.nullable(),
  confirmedAt: academicInstantSchema.nullable(),
  /** O-01 : `null` tant que l'inscription n'est pas confirmée (ou si elle l'a été avant la migration 0710). */
  confirmationMode: academicEnrollmentConfirmationModeSchema.nullable().optional(),
  /** Motif de la dérogation (personnel de gestion seulement : jamais rendu aux familles). */
  confirmationReason: z.string().nullable().optional(),
  confirmedBy: academicUuidSchema.nullable().optional(),
  cancelledAt: academicInstantSchema.nullable(),
  createdAt: academicInstantSchema,
});
export type AcademicEnrollmentDto = z.infer<typeof academicEnrollmentDtoSchema>;

// --- Cumul de financements d'une inscription (O-04) ----------------------------------------------------------------
/** Part d'un financement : pourcentage (points de base, 1..10000) ou montant entier. Le reste est à la charge de la famille. */
export const academicFundingShareSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PERCENT"), bps: z.number().int().min(1).max(10_000) }).strict(),
  z.object({ kind: z.literal("AMOUNT"), amount: z.number().int().min(1), currency: z.enum(["XOF", "XAF", "EUR", "USD"]) }).strict(),
]);
export const academicFundingShareInputSchema = z
  .object({
    fundingType: academicFundingCodeSchema.exclude(["PRIVATE"]),
    share: academicFundingShareSchema,
    assignmentReference: z.string().trim().min(1).max(100).nullable().optional(),
    funderLabel: z.string().trim().min(1).max(200).nullable().optional(),
    notes: z.string().trim().min(1).max(1000).nullable().optional(),
  })
  .strict();
export const academicSetFundingsBodySchema = z
  .object({ shares: z.array(academicFundingShareInputSchema).max(6), reason: z.string().trim().min(5, "Motif de 5 caractères minimum.").max(500) })
  .strict();
export const academicEnrollmentFundingDtoSchema = z.object({
  id: academicUuidSchema,
  fundingType: z.string(),
  share: academicFundingShareSchema,
  assignmentReference: z.string().nullable(),
  funderLabel: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(["ACTIVE", "ENDED"]),
  createdAt: academicInstantSchema,
  endedAt: academicInstantSchema.nullable(),
});
export const academicEnrollmentFundingsDtoSchema = z.object({
  enrollmentId: academicUuidSchema,
  principalFundingType: z.string(),
  fundings: z.array(academicEnrollmentFundingDtoSchema),
  /** `null` : une part en montant intervient, le reste de la famille n'est connu qu'à la facturation. */
  familyRemainderBps: z.number().int().min(0).max(10_000).nullable(),
});
export type AcademicFundingShare = z.infer<typeof academicFundingShareSchema>;
export type AcademicEnrollmentFundingsDto = z.infer<typeof academicEnrollmentFundingsDtoSchema>;

/**
 * Libellés lisibles par la FAMILLE (`GET /academic/me/labels`, `GET /academic/children/:studentId/labels`) : classes, périodes
 * et matières (nœuds du curriculum) des inscriptions de l'élève, pour nommer les identifiants que portent les notes, résultats,
 * présences et séances. Lecture seule, permissions `enrollment.self.read` / `enrollment.child.read` + lien de tutelle ;
 * aucune donnée de gestion (pas de statut de publication, d'effectif ni de montant).
 */
export const academicFamilyLabelsDtoSchema = z.object({
  classrooms: z.array(z.object({ id: academicUuidSchema, name: z.string(), code: z.string(), academicYearId: academicUuidSchema })),
  periods: z.array(
    z.object({
      id: academicUuidSchema,
      academicYearId: academicUuidSchema,
      parentPeriodId: academicUuidSchema.nullable(),
      periodTypeCode: z.string(),
      ordinal: z.number().int(),
      code: z.string(),
      label: z.string(),
      startsOn: academicDateSchema,
      endsOn: academicDateSchema,
    }),
  ),
  nodes: z.array(
    z.object({
      id: academicUuidSchema,
      parentId: academicUuidSchema.nullable(),
      nodeTypeCode: z.string(),
      code: z.string(),
      label: z.string(),
      ordinal: z.number().int(),
      coefficient: z.string().nullable(),
      credits: z.string().nullable(),
      isTransversal: z.boolean(),
    }),
  ),
});
export type AcademicFamilyLabelsDto = z.infer<typeof academicFamilyLabelsDtoSchema>;

export const academicEnrollmentCourseDtoSchema = z.object({
  id: academicUuidSchema,
  enrollmentId: academicUuidSchema,
  curriculumNodeId: academicUuidSchema,
  offeringId: academicUuidSchema.nullable(),
  source: academicCourseSourceSchema,
  status: academicCourseStatusSchema,
  holdExpiresAt: academicInstantSchema.nullable(),
  requestedAt: academicInstantSchema,
  confirmedAt: academicInstantSchema.nullable(),
  completedAt: academicInstantSchema.nullable(),
  cancelledAt: academicInstantSchema.nullable(),
  cancelReason: z.string().nullable(),
  linePaidAt: academicInstantSchema.nullable(),
});
export type AcademicEnrollmentCourseDto = z.infer<typeof academicEnrollmentCourseDtoSchema>;

const fundingFields = {
  fundingType: academicFundingCodeSchema.optional(),
  assignmentReference: z.string().trim().min(1).max(100).nullable().optional(),
  assignmentIssuedOn: academicDateSchema.nullable().optional(),
  funderLabel: z.string().trim().min(1).max(200).nullable().optional(),
  fundingNotes: note.nullable().optional(),
};

export const academicEnrollStudentBodySchema = z
  .object({
    studentId: academicUuidSchema,
    classroomId: academicUuidSchema,
    mode: academicEnrollmentModeSchema.optional(),
    enrolledOn: academicDateSchema.optional(),
    ...fundingFields,
    isRepeating: z.boolean().optional(),
    isTransferIn: z.boolean().optional(),
    originSchool: z.string().trim().min(1).max(200).nullable().optional(),
    previousEnrollmentId: academicUuidSchema.nullable().optional(),
    sourceKind: academicEnrollmentSourceKindSchema.optional(),
    sourceRef: academicUuidSchema.nullable().optional(),
    /** Statut initial imposé par la politique de confirmation ; ignoré si absent. */
    note: note.optional(),
  })
  .strict();
export type AcademicEnrollStudentBody = z.infer<typeof academicEnrollStudentBodySchema>;

export const academicEnrollBulkBodySchema = z.object({ items: z.array(academicEnrollStudentBodySchema).min(1).max(500) }).strict();
export const academicEnrollBulkResultSchema = z.object({
  created: z.array(academicEnrollmentDtoSchema),
  skipped: z.array(z.object({ studentId: academicUuidSchema, classroomId: academicUuidSchema, enrollmentId: academicUuidSchema, reason: z.string() })),
  failed: z.array(z.object({ index: z.number().int(), studentId: academicUuidSchema, code: z.string(), message: z.string() })),
});
export type AcademicEnrollBulkResult = z.infer<typeof academicEnrollBulkResultSchema>;

export const academicListEnrollmentsQuerySchema = academicPageQuerySchema.extend({
  institutionId: academicUuidSchema.optional(),
  academicYearId: academicUuidSchema.optional(),
  classroomId: academicUuidSchema.optional(),
  studentId: academicUuidSchema.optional(),
  status: academicEnrollmentStatusSchema.optional(),
  mode: academicEnrollmentModeSchema.optional(),
  fundingType: academicFundingCodeSchema.optional(),
  registrationNumber: z.string().trim().min(1).max(80).optional(),
});

export const academicEnrollmentActionBodySchema = z.object({ reason: reason.optional() }).strict();
/** O-01 : confirmation manuelle ; le motif est obligatoire quand elle déroge à une politique liée au paiement (contrôlé par le cas d'usage). */
export const academicConfirmEnrollmentBodySchema = academicEnrollmentActionBodySchema;
export type AcademicConfirmEnrollmentBody = z.infer<typeof academicConfirmEnrollmentBodySchema>;
export const academicEnrollmentReasonBodySchema = z.object({ reason }).strict();
export const academicTransferBodySchema = z.object({ toClassroomId: academicUuidSchema, effectiveOn: academicDateSchema.optional(), reason }).strict();
export const academicChangeFundingBodySchema = z
  .object({
    fundingType: academicFundingCodeSchema,
    assignmentReference: z.string().trim().min(1).max(100).nullable().optional(),
    assignmentIssuedOn: academicDateSchema.nullable().optional(),
    funderLabel: z.string().trim().min(1).max(200).nullable().optional(),
    fundingNotes: note.nullable().optional(),
    reason,
  })
  .strict();
export const academicRecordOutcomeBodySchema = z
  .object({
    outcomeCode: upperCode,
    decisionRef: academicUuidSchema.nullable().optional(),
    targetGradeLevelId: academicUuidSchema.nullable().optional(),
    targetProgramId: academicUuidSchema.nullable().optional(),
    decidedAt: academicInstantSchema.optional(),
  })
  .strict();
export type AcademicRecordOutcomeBody = z.infer<typeof academicRecordOutcomeBodySchema>;

export const academicHistoryEntryDtoSchema = z.object({
  id: academicUuidSchema,
  enrollmentId: academicUuidSchema,
  kind: academicHistoryKindSchema,
  fromValue: z.unknown().nullable(),
  toValue: z.unknown().nullable(),
  reason: z.string().nullable(),
  actorId: academicUuidSchema.nullable(),
  occurredAt: academicInstantSchema,
});
export type AcademicHistoryEntryDto = z.infer<typeof academicHistoryEntryDtoSchema>;

export const academicPlacementDtoSchema = z.object({
  id: academicUuidSchema,
  enrollmentId: academicUuidSchema,
  classroomId: academicUuidSchema,
  startsOn: academicDateSchema,
  endsOn: academicDateSchema.nullable(),
  reason: z.string().nullable(),
});
export const academicEnrollmentDetailDtoSchema = z.object({
  enrollment: academicEnrollmentDtoSchema,
  courses: z.array(academicEnrollmentCourseDtoSchema),
  placements: z.array(academicPlacementDtoSchema),
});
export type AcademicEnrollmentDetailDto = z.infer<typeof academicEnrollmentDetailDtoSchema>;

export const academicAddCourseBodySchema = z
  .object({
    curriculumNodeId: academicUuidSchema.optional(),
    offeringId: academicUuidSchema.optional(),
    source: academicCourseSourceSchema.optional(),
    override: academicOverrideSchema.optional(),
  })
  .strict()
  .refine((b) => b.curriculumNodeId || b.offeringId, "Un nœud de curriculum ou une offre est requis.");
export type AcademicAddCourseBody = z.infer<typeof academicAddCourseBodySchema>;
export const academicCourseActionBodySchema = z.object({ reason: reason.optional(), outcomeRef: academicUuidSchema.nullable().optional(), completedAt: academicInstantSchema.optional() }).strict();
export const academicSelfEnrollBodySchema = z.object({}).strict();

export const academicRosterQuerySchema = z.object({ onDate: academicDateSchema.optional(), nodeId: academicUuidSchema.optional() });
export const academicRosterEntryDtoSchema = z.object({
  enrollmentId: academicUuidSchema,
  studentId: academicUuidSchema,
  mode: academicEnrollmentModeSchema,
  status: academicEnrollmentStatusSchema,
  registrationNumber: z.string().nullable(),
  fundingType: z.string(),
  isRepeating: z.boolean(),
  /** Pour une inscription à la carte (ou une sélection dans un nœud) : cours confirmés suivis. */
  confirmedNodeIds: z.array(academicUuidSchema),
});
export const academicRosterDtoSchema = z.object({
  classroomId: academicUuidSchema,
  onDate: academicDateSchema,
  items: z.array(academicRosterEntryDtoSchema),
});
export type AcademicRosterDto = z.infer<typeof academicRosterDtoSchema>;

// ---------------------------------------------------------------------------
// Lectures consommées par les autres modules (011, 012, 013, 019)
// ---------------------------------------------------------------------------

export const academicEnrollmentNodeViewSchema = z.object({
  nodeId: academicUuidSchema,
  lineageId: academicUuidSchema,
  parentId: academicUuidSchema.nullable(),
  nodeTypeCode: z.string(),
  code: z.string(),
  label: z.string(),
  subjectId: academicUuidSchema.nullable(),
  coefficient: academicDecimalSchema.nullable(),
  credits: academicDecimalSchema.nullable(),
  isMandatory: z.boolean(),
  isTransversal: z.boolean(),
  categoryCode: z.string().nullable(),
  periodTypeCode: z.string().nullable(),
  periodOrdinal: z.number().int().nullable(),
  registrationKind: academicRegistrationKindSchema,
  enrollmentCourseId: academicUuidSchema.nullable(),
});
export type AcademicEnrollmentNodeView = z.infer<typeof academicEnrollmentNodeViewSchema>;

export const academicCourseRegistrationDtoSchema = z.object({
  enrollmentId: academicUuidSchema,
  studentId: academicUuidSchema,
  nodeId: academicUuidSchema,
  lineageId: academicUuidSchema,
  kind: academicRegistrationKindSchema,
  status: academicCourseStatusSchema,
  enrollmentCourseId: academicUuidSchema.nullable(),
  offeringId: academicUuidSchema.nullable(),
});
export type AcademicCourseRegistrationDto = z.infer<typeof academicCourseRegistrationDtoSchema>;

export const academicRegisterCourseBodySchema = z
  .object({
    enrollmentId: academicUuidSchema,
    curriculumNodeId: academicUuidSchema,
    offeringId: academicUuidSchema.nullable().optional(),
    kind: z.enum(["OPTION", "CARRY_OVER", "RESIT"]),
    reason: reason.optional(),
  })
  .strict();

export const academicRuleContextNodeSchema = z.object({
  nodeId: academicUuidSchema,
  lineageId: academicUuidSchema,
  nodeTypeCode: z.string(),
  parentId: academicUuidSchema.nullable(),
  code: z.string(),
  subjectId: academicUuidSchema.nullable(),
  coefficient: academicDecimalSchema.nullable(),
  credits: academicDecimalSchema.nullable(),
  isMandatory: z.boolean(),
  isTransversal: z.boolean(),
  categoryCode: z.string().nullable(),
  periodTypeCode: z.string().nullable(),
  periodOrdinal: z.number().int().nullable(),
});
/** Faits fournis au moteur de règles : aucun nom à analyser. */
export const academicRuleContextSchema = z.object({
  enrollmentId: academicUuidSchema,
  studentId: academicUuidSchema,
  institutionId: academicUuidSchema,
  academicYearId: academicUuidSchema,
  classroomId: academicUuidSchema,
  pack: academicPackSchema.nullable(),
  educationLevel: z.object({ code: z.string(), ordinal: z.number().int() }),
  gradeLevel: z.object({ code: z.string(), ordinal: z.number().int(), isFinal: z.boolean(), nextGradeLevelCode: z.string().nullable() }),
  program: z.object({ code: z.string(), kindCode: z.string(), domainCode: z.string().nullable(), parentProgramCode: z.string().nullable() }),
  period: z
    .object({
      id: academicUuidSchema,
      typeCode: z.string(),
      kind: academicPeriodKindSchema.nullable(),
      ordinal: z.number().int(),
      /** Rang parmi les périodes sœurs de même type (1 = première). */
      rankInYear: z.number().int(),
      siblingsOfType: z.number().int(),
      parentTypeCode: z.string().nullable(),
      isLastOfType: z.boolean(),
      startsOn: academicDateSchema,
      endsOn: academicDateSchema,
      state: academicPeriodStatusSchema,
    })
    .nullable(),
  fundingType: z.string(),
  isRepeating: z.boolean(),
  nodes: z.array(academicRuleContextNodeSchema),
});
export type AcademicRuleContext = z.infer<typeof academicRuleContextSchema>;
export const academicRuleContextQuerySchema = z.object({ periodId: academicUuidSchema.optional() });

export const academicPrerequisiteStatusDtoSchema = z.object({
  satisfied: z.boolean(),
  missing: z.array(z.object({ lineageId: academicUuidSchema, nodeId: academicUuidSchema.nullable(), code: z.string().nullable(), label: z.string().nullable() })),
});

// ---------------------------------------------------------------------------
// Reconduction annuelle
// ---------------------------------------------------------------------------

export const academicRolloverBodySchema = z
  .object({
    toAcademicYearId: academicUuidSchema,
    /** Ne reconduit que ces classes sources (défaut : toutes les classes de l'année source). */
    classroomIds: uuidList.optional(),
    /** Classe de destination par défaut d'un niveau : sinon créée automatiquement. */
    createMissingClassrooms: z.boolean().optional(),
  })
  .strict();
export type AcademicRolloverBody = z.infer<typeof academicRolloverBodySchema>;
export const academicRolloverPreviewQuerySchema = z.object({ toAcademicYearId: academicUuidSchema, createMissingClassrooms: boolQuery.optional() });

export const academicRolloverAnomalySchema = z.object({
  code: z.enum(["outcome_missing", "next_level_missing", "curriculum_missing", "funding_to_reconfirm", "redirect_target_missing", "target_classroom_missing", "target_classroom_full", "enrollment_failed", "student_not_enrollable"]),
  enrollmentId: academicUuidSchema.nullable(),
  classroomId: academicUuidSchema.nullable(),
  message: z.string(),
});
export const academicRolloverPlanItemSchema = z.object({
  previousEnrollmentId: academicUuidSchema,
  studentId: academicUuidSchema,
  outcomeKind: academicOutcomeKindSchema,
  targetProgramId: academicUuidSchema,
  targetGradeLevelId: academicUuidSchema,
  isRepeating: z.boolean(),
  fundingType: z.string(),
  carriesFunding: z.boolean(),
});
export const academicRolloverPreviewDtoSchema = z.object({
  fromAcademicYearId: academicUuidSchema,
  toAcademicYearId: academicUuidSchema,
  classroomsToCreate: z.array(z.object({ programId: academicUuidSchema, gradeLevelId: academicUuidSchema, name: z.string(), code: z.string() })),
  enrollmentsToCreate: z.array(academicRolloverPlanItemSchema),
  alreadyRolledOver: z.number().int().nonnegative(),
  byOutcome: z.record(z.number().int()),
  anomalies: z.array(academicRolloverAnomalySchema),
});
export type AcademicRolloverPreviewDto = z.infer<typeof academicRolloverPreviewDtoSchema>;
export const academicRolloverReportDtoSchema = z.object({
  fromAcademicYearId: academicUuidSchema,
  toAcademicYearId: academicUuidSchema,
  classroomsCreated: z.number().int().nonnegative(),
  enrollmentsCreated: z.number().int().nonnegative(),
  alreadyRolledOver: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  anomalies: z.array(academicRolloverAnomalySchema),
});
export type AcademicRolloverReportDto = z.infer<typeof academicRolloverReportDtoSchema>;

// ---------------------------------------------------------------------------
// Assistant de reconduction (calendrier, curriculum, classes, offres, réinscriptions) : aperçu, exécution en tâche de
// fond avec progression, rapport. Les réinscriptions réutilisent `academicRollover*` ci-dessus.
// ---------------------------------------------------------------------------

/** Étapes de la reconduction, dans l'ordre d'exécution. */
export const ACADEMIC_ROLLOVER_STEPS = ["PERIODS", "HOLIDAYS", "CURRICULUM", "CLASSROOMS", "OFFERINGS", "ENROLLMENTS"] as const;
export const academicRolloverStepSchema = z.enum(ACADEMIC_ROLLOVER_STEPS);
export type AcademicRolloverStep = z.infer<typeof academicRolloverStepSchema>;

export const ACADEMIC_ROLLOVER_RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const;
export const academicRolloverRunStatusSchema = z.enum(ACADEMIC_ROLLOVER_RUN_STATUSES);
export type AcademicRolloverRunStatus = z.infer<typeof academicRolloverRunStatusSchema>;

export const ACADEMIC_ROLLOVER_STEP_STATUSES = ["PENDING", "RUNNING", "DONE", "SKIPPED", "FAILED"] as const;

const rolloverStepsInput = z.array(academicRolloverStepSchema).min(1).max(ACADEMIC_ROLLOVER_STEPS.length);

export const academicRolloverRunBodySchema = z
  .object({
    toAcademicYearId: academicUuidSchema,
    /** Étapes retenues (défaut : toutes). Une étape absente n'est ni prévisualisée ni exécutée. */
    steps: rolloverStepsInput.optional(),
    /** Ne reconduit que ces classes sources (défaut : toutes les classes de l'année source). */
    classroomIds: uuidList.optional(),
    /** Crée les classes de destination qui manquent pour les réinscriptions (défaut : oui). */
    createMissingClassrooms: z.boolean().optional(),
  })
  .strict();
export type AcademicRolloverRunBody = z.infer<typeof academicRolloverRunBodySchema>;

export const academicRolloverPlanQuerySchema = z
  .object({
    toAcademicYearId: academicUuidSchema,
    /** Étapes séparées par des virgules (ex. `PERIODS,CURRICULUM`) ; défaut : toutes. */
    steps: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (v === undefined || v.trim() === "") return undefined;
        const parts = v.split(",").map((s) => s.trim());
        const parsed = rolloverStepsInput.safeParse(parts);
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: "Étapes inconnues." });
          return z.NEVER;
        }
        return parsed.data;
      }),
    createMissingClassrooms: boolQuery.optional(),
  })
  .strict();
export type AcademicRolloverPlanQuery = z.infer<typeof academicRolloverPlanQuerySchema>;

/** Avertissement de l'aperçu ou du rapport : `code` stable, `step` = étape concernée (null = général). */
export const academicRolloverWarningSchema = z.object({
  code: z.enum([
    "target_year_has_periods",
    "target_year_has_classrooms",
    "target_year_has_curriculum",
    "target_year_not_empty",
    "periods_dates_clamped",
    "periods_source_missing",
    "holidays_not_recurring",
    "curriculum_source_missing",
    "curriculum_source_draft",
    "classrooms_source_missing",
    "offerings_need_curriculum",
    "offerings_feature_disabled",
    "promotion_decisions_missing",
    "conflict",
    "item_failed",
  ]),
  step: academicRolloverStepSchema.nullable(),
  message: z.string(),
});
export type AcademicRolloverWarning = z.infer<typeof academicRolloverWarningSchema>;

export const academicRolloverPlanDtoSchema = z.object({
  fromAcademicYearId: academicUuidSchema,
  toAcademicYearId: academicUuidSchema,
  steps: z.array(academicRolloverStepSchema),
  /** Une exécution est déjà en attente ou en cours pour ce couple d'années. */
  liveRunId: academicUuidSchema.nullable(),
  warnings: z.array(academicRolloverWarningSchema),
  periods: z.object({
    toCreate: z.array(z.object({ code: z.string(), parentCode: z.string().nullable(), periodTypeCode: z.string(), ordinal: z.number().int(), label: z.string(), startsOn: academicDateSchema, endsOn: academicDateSchema })),
    existing: z.number().int().nonnegative(),
  }),
  holidays: z.object({
    toCreate: z.array(z.object({ label: z.string(), kind: z.enum(["HOLIDAY", "BREAK", "CLOSURE"]), startsOn: academicDateSchema, endsOn: academicDateSchema })),
    existing: z.number().int().nonnegative(),
    /** Jours non annuels de l'année source : à ressaisir pour l'année cible (fêtes mobiles, fermetures ponctuelles). */
    notRecurring: z.number().int().nonnegative(),
  }),
  curriculum: z.object({
    items: z.array(
      z.object({
        programId: academicUuidSchema,
        programCode: z.string(),
        programLabel: z.string(),
        sourceVersionId: academicUuidSchema.nullable(),
        sourceStatus: z.enum(["DRAFT", "PUBLISHED", "LOCKED", "ARCHIVED"]).nullable(),
        nodeCount: z.number().int().nonnegative(),
        targetVersionId: academicUuidSchema.nullable(),
        action: z.enum(["CLONE", "EXISTS", "NO_SOURCE"]),
      }),
    ),
  }),
  classrooms: z.object({
    toCreate: z.array(z.object({ sourceClassroomId: academicUuidSchema, code: z.string(), name: z.string(), programId: academicUuidSchema, gradeLevelId: academicUuidSchema, capacity: z.number().int().nullable() })),
    existing: z.number().int().nonnegative(),
  }),
  offerings: z.object({ toCreate: z.number().int().nonnegative(), existing: z.number().int().nonnegative() }),
  /** Aperçu des réinscriptions (décisions de passage lues dans `results`) ; null si l'étape n'est pas retenue. */
  enrollments: academicRolloverPreviewDtoSchema.nullable(),
});
export type AcademicRolloverPlanDto = z.infer<typeof academicRolloverPlanDtoSchema>;

export const academicRolloverStepProgressSchema = z.object({
  key: academicRolloverStepSchema,
  status: z.enum(ACADEMIC_ROLLOVER_STEP_STATUSES),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  message: z.string().nullable(),
});
export const academicRolloverRunReportSchema = z.object({
  periodsCreated: z.number().int().nonnegative(),
  holidaysCreated: z.number().int().nonnegative(),
  curriculumVersionsCreated: z.number().int().nonnegative(),
  classroomsCreated: z.number().int().nonnegative(),
  offeringsCreated: z.number().int().nonnegative(),
  enrollmentsCreated: z.number().int().nonnegative(),
  alreadyRolledOver: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  warnings: z.array(academicRolloverWarningSchema),
  anomalies: z.array(academicRolloverAnomalySchema),
});
export type AcademicRolloverRunReport = z.infer<typeof academicRolloverRunReportSchema>;

export const academicRolloverRunDtoSchema = z.object({
  id: academicUuidSchema,
  institutionId: academicUuidSchema,
  fromAcademicYearId: academicUuidSchema,
  toAcademicYearId: academicUuidSchema,
  status: academicRolloverRunStatusSchema,
  steps: z.array(academicRolloverStepSchema),
  requestedBy: academicUuidSchema.nullable(),
  requestedAt: academicInstantSchema,
  startedAt: academicInstantSchema.nullable(),
  finishedAt: academicInstantSchema.nullable(),
  attempts: z.number().int().nonnegative(),
  progress: z.object({ stage: academicRolloverStepSchema.nullable(), steps: z.array(academicRolloverStepProgressSchema) }),
  report: academicRolloverRunReportSchema.nullable(),
  errorMessage: z.string().nullable(),
});
export type AcademicRolloverRunDto = z.infer<typeof academicRolloverRunDtoSchema>;

// ---------------------------------------------------------------------------
// Calendrier de l'établissement : jours fériés, vacances, fermetures (données de l'établissement : aucune date livrée)
// ---------------------------------------------------------------------------

export const ACADEMIC_HOLIDAY_KINDS = ["HOLIDAY", "BREAK", "CLOSURE"] as const;
export const academicHolidayKindSchema = z.enum(ACADEMIC_HOLIDAY_KINDS);
export type AcademicHolidayKind = z.infer<typeof academicHolidayKindSchema>;

export const academicHolidayDtoSchema = z.object({
  id: academicUuidSchema,
  institutionId: academicUuidSchema,
  label: z.string(),
  kind: academicHolidayKindSchema,
  startsOn: academicDateSchema,
  endsOn: academicDateSchema,
  /** Fête fixe : reportée à la même date civile par la reconduction annuelle. */
  recursYearly: z.boolean(),
  blocksTeaching: z.boolean(),
});
export type AcademicHolidayDto = z.infer<typeof academicHolidayDtoSchema>;

export const academicCreateHolidayBodySchema = z
  .object({
    institutionId: academicUuidSchema,
    label,
    kind: academicHolidayKindSchema.optional(),
    startsOn: academicDateSchema,
    /** Défaut : `startsOn` (un jour). */
    endsOn: academicDateSchema.optional(),
    recursYearly: z.boolean().optional(),
    blocksTeaching: z.boolean().optional(),
  })
  .strict();
export type AcademicCreateHolidayBody = z.infer<typeof academicCreateHolidayBodySchema>;

export const academicUpdateHolidayBodySchema = z
  .object({
    label: label.optional(),
    kind: academicHolidayKindSchema.optional(),
    startsOn: academicDateSchema.optional(),
    endsOn: academicDateSchema.optional(),
    recursYearly: z.boolean().optional(),
    blocksTeaching: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification.");
export type AcademicUpdateHolidayBody = z.infer<typeof academicUpdateHolidayBodySchema>;

export const academicListHolidaysQuerySchema = z
  .object({ institutionId: academicUuidSchema.optional(), from: academicDateSchema.optional(), to: academicDateSchema.optional() })
  .strict();
export type AcademicListHolidaysQuery = z.infer<typeof academicListHolidaysQuerySchema>;

// ---------------------------------------------------------------------------
// Calendrier national des jours fériés (O-10) : référence de plateforme, fêtes à date fixe seulement ; tout est « à confirmer »
// ---------------------------------------------------------------------------

export const academicNationalHolidayDtoSchema = z.object({
  code: z.string(),
  countryCode: z.string(),
  label: z.string(),
  /** `FIXED_DATE` : mois et jour renseignés ; `MOVABLE` : aucune date livrée, l'établissement la saisit chaque année. */
  recurrence: z.enum(["FIXED_DATE", "MOVABLE"]),
  month: z.number().int().min(1).max(12).nullable(),
  day: z.number().int().min(1).max(31).nullable(),
  sourceKind: z.enum(["placeholder", "regulation"]),
  sourceReference: z.string().nullable(),
  needsConfirmation: z.boolean(),
  note: z.string().nullable(),
  active: z.boolean(),
  /** Réglage de l'établissement (sans réglage : activé). */
  enabled: z.boolean(),
});
export type AcademicNationalHolidayDto = z.infer<typeof academicNationalHolidayDtoSchema>;

export const academicNationalHolidayCodeParamsSchema = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/) }).strict();
export const academicListNationalHolidaysQuerySchema = z.object({ institutionId: academicUuidSchema }).strict();
export type AcademicListNationalHolidaysQuery = z.infer<typeof academicListNationalHolidaysQuerySchema>;

export const academicSetNationalHolidayBodySchema = z.object({ institutionId: academicUuidSchema, enabled: z.boolean() }).strict();
export type AcademicSetNationalHolidayBody = z.infer<typeof academicSetNationalHolidayBodySchema>;

export const academicEffectiveHolidayDtoSchema = z.object({
  origin: z.enum(["NATIONAL", "INSTITUTION"]),
  ref: z.string(),
  label: z.string(),
  kind: academicHolidayKindSchema,
  startsOn: academicDateSchema,
  endsOn: academicDateSchema,
  blocksTeaching: z.boolean(),
  needsConfirmation: z.boolean(),
});
export type AcademicEffectiveHolidayDto = z.infer<typeof academicEffectiveHolidayDtoSchema>;

export const academicEffectiveHolidaysQuerySchema = z.object({ institutionId: academicUuidSchema, from: academicDateSchema, to: academicDateSchema }).strict();
export type AcademicEffectiveHolidaysQuery = z.infer<typeof academicEffectiveHolidaysQuerySchema>;

// ---------------------------------------------------------------------------
// Annuaire d'inscriptions pour la finance (conforme au port `EnrollmentDirectory` de finance)
// ---------------------------------------------------------------------------

export const academicEnrollmentRefDtoSchema = z.object({
  enrollmentId: academicUuidSchema,
  learnerId: academicUuidSchema,
  academicYear: z.string(),
  groupKey: z.string().nullable(),
  groupLabel: z.string().nullable(),
  institutionId: academicUuidSchema.nullable(),
  campusId: academicUuidSchema.nullable(),
  levelKey: z.string().nullable(),
  trackKey: z.string().nullable(),
  learnerType: z.string().nullable(),
  /** Additifs demandés à finance (spec 004 §7.4a). */
  fundingType: z.string().nullable(),
  fundingReference: z.string().nullable(),
  registrationNumber: z.string().nullable(),
});
export type AcademicEnrollmentRefDto = z.infer<typeof academicEnrollmentRefDtoSchema>;

// ---------------------------------------------------------------------------
// Événements (outbox) : payloads versionnés `{ v: 1, ... }`
// ---------------------------------------------------------------------------

const eventBase = {
  v: z.literal(1),
  institutionId: academicUuidSchema.nullable(),
  academicYearId: academicUuidSchema.nullable(),
};
/** Inscriptions, classes, offres : établissement et année sont TOUJOURS renseignés par le producteur. */
const scopedEventBase = { ...eventBase, institutionId: academicUuidSchema, academicYearId: academicUuidSchema };
const enrollmentEventBase = {
  ...scopedEventBase,
  enrollmentId: academicUuidSchema,
  studentId: academicUuidSchema,
  classroomId: academicUuidSchema,
};

/** Événements d'année : `institutionId` et `academicYearId` (= `yearId`) sont TOUJOURS renseignés (consommateurs : people, scheduling, payroll). */
export const academicYearEventPayloadSchema = z.object({
  ...eventBase,
  institutionId: academicUuidSchema,
  academicYearId: academicUuidSchema,
  yearId: academicUuidSchema,
  code: z.string(),
  status: academicYearStatusSchema,
});
export const academicPeriodEventPayloadSchema = z.object({
  ...eventBase,
  periodId: academicUuidSchema,
  periodTypeCode: z.string(),
  ordinal: z.number().int(),
  status: academicPeriodStatusSchema,
  previousStatus: academicPeriodStatusSchema.nullable(),
  reason: z.string().nullable(),
});
export const academicClassroomPeriodEventPayloadSchema = academicPeriodEventPayloadSchema.extend({ classroomId: academicUuidSchema });
export const academicCurriculumEventPayloadSchema = z.object({
  ...eventBase,
  versionId: academicUuidSchema,
  programId: academicUuidSchema,
  status: academicVersionStatusSchema,
  amendmentCount: z.number().int().nonnegative().optional(),
  reason: z.string().nullable().optional(),
});
export const academicClassroomEventPayloadSchema = z.object({
  ...scopedEventBase,
  classroomId: academicUuidSchema,
  programId: academicUuidSchema,
  gradeLevelId: academicUuidSchema,
  status: academicClassroomStatusSchema,
});
export const academicOfferingEventPayloadSchema = z.object({
  ...scopedEventBase,
  offeringId: academicUuidSchema,
  classroomId: academicUuidSchema,
  curriculumNodeId: academicUuidSchema,
  lineageId: academicUuidSchema.nullable(),
  status: academicOfferingStatusSchema,
  reason: z.string().nullable().optional(),
});
export const academicEnrollmentEventPayloadSchema = z.object({
  ...enrollmentEventBase,
  status: academicEnrollmentStatusSchema,
  previousStatus: academicEnrollmentStatusSchema.nullable(),
  mode: academicEnrollmentModeSchema,
  fundingType: z.string(),
  registrationNumber: z.string().nullable(),
  reason: z.string().nullable(),
  /** O-01 (additif) : présent sur `academic.enrollment.confirmed` — `PAYMENT`, `MANUAL` ou `OVERRIDE` (dérogation motivée). */
  confirmationMode: academicEnrollmentConfirmationModeSchema.optional(),
});
export const academicEnrollmentTransferredEventPayloadSchema = academicEnrollmentEventPayloadSchema.extend({
  fromClassroomId: academicUuidSchema,
  toClassroomId: academicUuidSchema,
  effectiveOn: academicDateSchema,
});
export const academicFundingChangedEventPayloadSchema = z.object({
  ...enrollmentEventBase,
  from: z.object({ fundingType: z.string(), assignmentReference: z.string().nullable() }),
  to: z.object({ fundingType: z.string(), assignmentReference: z.string().nullable() }),
  reason: z.string(),
  /** Additif (O-04) : cumul complet après le changement ; absent des émetteurs historiques. */
  fundings: z
    .array(
      z.object({
        fundingType: z.string(),
        shareKind: z.enum(["PERCENT", "AMOUNT"]),
        shareBps: z.number().int().nullable(),
        shareAmount: z.number().int().nullable(),
        currency: z.string().nullable(),
      }),
    )
    .optional(),
});
export const academicOutcomeEventPayloadSchema = z.object({
  ...enrollmentEventBase,
  outcomeCode: z.string(),
  outcomeKind: academicOutcomeKindSchema,
  decisionRef: academicUuidSchema.nullable(),
  targetGradeLevelId: academicUuidSchema.nullable(),
  targetProgramId: academicUuidSchema.nullable(),
});
export const academicEnrollmentCourseEventPayloadSchema = z.object({
  ...enrollmentEventBase,
  enrollmentCourseId: academicUuidSchema,
  curriculumNodeId: academicUuidSchema,
  lineageId: academicUuidSchema,
  offeringId: academicUuidSchema.nullable(),
  source: academicCourseSourceSchema,
  status: academicCourseStatusSchema,
  credits: academicDecimalSchema.nullable(),
  holdExpiresAt: academicInstantSchema.nullable(),
  reason: z.string().nullable().optional(),
});
export const academicRolloverEventPayloadSchema = z.object({
  v: z.literal(1),
  institutionId: academicUuidSchema.nullable(),
  fromAcademicYearId: academicUuidSchema,
  toAcademicYearId: academicUuidSchema,
  enrollmentsCreated: z.number().int().nonnegative(),
  classroomsCreated: z.number().int().nonnegative(),
  runId: academicUuidSchema.optional(),
});
/** `academic.rollover.requested` : l'assistant a enregistré une exécution ; le worker la reprend (abonné d'academic). */
export const academicRolloverRequestedEventPayloadSchema = z.object({
  v: z.literal(1),
  runId: academicUuidSchema,
  institutionId: academicUuidSchema,
  fromAcademicYearId: academicUuidSchema,
  toAcademicYearId: academicUuidSchema,
});
export const academicPaymentOrphanEventPayloadSchema = z.object({
  ...enrollmentEventBase,
  enrollmentCourseId: academicUuidSchema,
  invoiceId: academicUuidSchema,
  reason: z.string(),
});

/** Événements CONSOMMÉS par academic (payloads tolérants : seuls les champs lus sont déclarés). */
export const academicConsumedInstitutionCreatedSchema = z
  .object({ v: z.number().int(), institutionId: academicUuidSchema, pack: academicPackSchema, educationSystem: z.string() })
  .passthrough();
export type AcademicConsumedInstitutionCreated = z.infer<typeof academicConsumedInstitutionCreatedSchema>;

export const academicConsumedInvoicePaidSchema = z
  .object({
    v: z.number().int(),
    invoiceId: academicUuidSchema,
    learnerId: academicUuidSchema.optional(),
    /** Additifs demandés à finance (spec 004 §7.4b/d) : absents tant que finance ne les publie pas. */
    enrollmentId: academicUuidSchema.nullable().optional(),
    containsRegistrationFee: z.boolean().optional(),
    sourceRefs: z.array(z.object({ sourceRef: academicUuidSchema, category: z.string().optional() })).optional(),
  })
  .passthrough();
export type AcademicConsumedInvoicePaid = z.infer<typeof academicConsumedInvoicePaidSchema>;

/**
 * `people.student.status_changed` tel que people le publie (`peopleStudentStatusChangedPayloadSchema`) : le nouveau statut
 * est `toStatus` (et non `status`), l'ancien `fromStatus`, le motif codé `reasonCode` (jamais de texte libre).
 */
export const academicConsumedStudentStatusChangedSchema = z
  .object({ v: z.number().int(), studentId: academicUuidSchema, toStatus: z.string(), fromStatus: z.string().nullable().optional(), reasonCode: z.string().nullable().optional() })
  .passthrough();
export type AcademicConsumedStudentStatusChanged = z.infer<typeof academicConsumedStudentStatusChangedSchema>;

/** Schéma de charge utile de chaque événement PUBLIÉ par academic (validé par les tests ; utile aux consommateurs). */
export const academicEventPayloadSchemas = {
  "academic.year.opened": academicYearEventPayloadSchema,
  "academic.year.closed": academicYearEventPayloadSchema,
  "academic.year.archived": academicYearEventPayloadSchema,
  "academic.period.opened": academicPeriodEventPayloadSchema,
  "academic.period.grading_closed": academicPeriodEventPayloadSchema,
  "academic.period.closed": academicPeriodEventPayloadSchema,
  "academic.period.reopened": academicPeriodEventPayloadSchema,
  "academic.classroom_period.grading_closed": academicClassroomPeriodEventPayloadSchema,
  "academic.classroom_period.closed": academicClassroomPeriodEventPayloadSchema,
  "academic.classroom_period.reopened": academicClassroomPeriodEventPayloadSchema,
  "academic.curriculum.published": academicCurriculumEventPayloadSchema,
  "academic.curriculum.amended": academicCurriculumEventPayloadSchema,
  "academic.curriculum.locked": academicCurriculumEventPayloadSchema,
  "academic.classroom.created": academicClassroomEventPayloadSchema,
  "academic.classroom.activated": academicClassroomEventPayloadSchema,
  "academic.classroom.completed": academicClassroomEventPayloadSchema,
  "academic.classroom.cancelled": academicClassroomEventPayloadSchema,
  "academic.offering.opened": academicOfferingEventPayloadSchema,
  "academic.offering.full": academicOfferingEventPayloadSchema,
  "academic.offering.reopened": academicOfferingEventPayloadSchema,
  "academic.offering.started": academicOfferingEventPayloadSchema,
  "academic.offering.completed": academicOfferingEventPayloadSchema,
  "academic.offering.cancelled": academicOfferingEventPayloadSchema,
  "academic.enrollment.created": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.confirmed": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.suspended": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.resumed": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.withdrawn": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.cancelled": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.transferred": academicEnrollmentTransferredEventPayloadSchema,
  "academic.enrollment.completed": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.reopened": academicEnrollmentEventPayloadSchema,
  "academic.enrollment.funding_changed": academicFundingChangedEventPayloadSchema,
  "academic.enrollment.outcome_recorded": academicOutcomeEventPayloadSchema,
  "academic.enrollment_course.requested": academicEnrollmentCourseEventPayloadSchema,
  "academic.enrollment_course.confirmed": academicEnrollmentCourseEventPayloadSchema,
  "academic.enrollment_course.completed": academicEnrollmentCourseEventPayloadSchema,
  "academic.enrollment_course.cancelled": academicEnrollmentCourseEventPayloadSchema,
  "academic.enrollment_course.expired": academicEnrollmentCourseEventPayloadSchema,
  "academic.enrollment_course.payment_orphan": academicPaymentOrphanEventPayloadSchema,
  "academic.rollover.completed": academicRolloverEventPayloadSchema,
  "academic.rollover.requested": academicRolloverRequestedEventPayloadSchema,
} as const;
