/**
 * Contrats du module `schoollife` — vie scolaire (routes `/api/v1/schoollife/*`, événements `schoollife.*`).
 * Écrits avant les routes (ADR-001 règle 6) ; le client web typé (`apps/web/src/platform/v2/schoollife.ts`) s'appuie dessus.
 *
 * Conventions (ADR-007, module-conventions.md, spec 006 §5.2) :
 *  - IDENTIFIANTS : UUID. Élèves, inscriptions, classes, établissements, années, tuteurs : références SANS clé étrangère
 *    (vérifiées par des ports vers `academic`, `people`, `attendance`, `notifications`).
 *  - L'ÉLÈVE n'est jamais fourni par le client pour une mesure, une note ou une convocation : il est DÉRIVÉ de l'inscription
 *    (`enrollmentId`) par le port `academic`. Même règle pour l'établissement et l'année.
 *  - L'HUMAIN DÉCIDE : déclarant, proposant, validateur, notifieur, auteur, convocateur = l'utilisateur de la session
 *    (jamais un champ de la requête) ; la base refuse un job ou le système.
 *  - TYPES D'ÉVÉNEMENTS, GRAVITÉS, BARÈMES : des DONNÉES d'établissement (vides par défaut) ; seule la FAMILLE (`kind`) est
 *    une énumération car elle pilote les tables. Aucun catalogue de fautes, aucune valeur réglementaire ici.
 *  - CONFIDENTIALITÉ : `STANDARD` < `RESTRICTED` < `CONFIDENTIAL`, appliquée par la fonction SQL unique
 *    `schoollife.audience_may_see` ; un élément confidentiel est MASQUÉ (`masked: true`) dans les listes et ne se lit que par
 *    `POST /confidential-reads` (motif obligatoire, lecture journalisée).
 *  - Messages utilisateur en français ; codes d'erreur stables `schoollife.*`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const schoollifeUuidSchema = z.string().uuid();
export const schoollifeDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Date inexistante.");
export const schoollifeInstantSchema = z.string().datetime({ offset: true });
export const schoollifeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, "Code attendu : majuscules, chiffres et _ (40 max).");
const text = (min: number, max: number, label = "Le texte") => z.string().trim().min(min, `${label} doit faire au moins ${min} caractères.`).max(max);
const permissionKeySchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Clé de permission attendue (ressource.action).");

export const SCHOOLLIFE_KINDS = ["INCIDENT", "SANCTION", "WARNING", "ENCOURAGEMENT", "TEMP_EXCLUSION", "OBSERVATION"] as const;
export const schoollifeKindSchema = z.enum(SCHOOLLIFE_KINDS);
export type SchoolLifeKind = z.infer<typeof schoollifeKindSchema>;
export const SCHOOLLIFE_MEASURE_KINDS = ["SANCTION", "WARNING", "TEMP_EXCLUSION"] as const;
export const schoollifeMeasureKindSchema = z.enum(SCHOOLLIFE_MEASURE_KINDS);
export const SCHOOLLIFE_NOTE_KINDS = ["ENCOURAGEMENT", "OBSERVATION"] as const;
export const schoollifeNoteKindSchema = z.enum(SCHOOLLIFE_NOTE_KINDS);

export const SCHOOLLIFE_CONFIDENTIALITY_LEVELS = ["STANDARD", "RESTRICTED", "CONFIDENTIAL"] as const;
export const schoollifeConfidentialitySchema = z.enum(SCHOOLLIFE_CONFIDENTIALITY_LEVELS);
export type SchoolLifeConfidentiality = z.infer<typeof schoollifeConfidentialitySchema>;

/** Audiences de la règle unique `audience_may_see` : familles et habilitation du personnel. */
export const SCHOOLLIFE_AUDIENCES = ["GUARDIAN", "STUDENT", "STAFF_STANDARD", "STAFF_RESTRICTED", "STAFF_CONFIDENTIAL"] as const;
export const schoollifeAudienceSchema = z.enum(SCHOOLLIFE_AUDIENCES);
export type SchoolLifeAudience = z.infer<typeof schoollifeAudienceSchema>;

export const SCHOOLLIFE_INCIDENT_STATUSES = ["DECLARED", "UNDER_REVIEW", "CONFIRMED", "DISMISSED", "CLOSED"] as const;
export const schoollifeIncidentStatusSchema = z.enum(SCHOOLLIFE_INCIDENT_STATUSES);
export const SCHOOLLIFE_MEASURE_STATUSES = ["PROPOSED", "VALIDATED", "NOTIFIED", "EXECUTED", "APPEALED", "REVOKED", "REJECTED", "CANCELLED"] as const;
export const schoollifeMeasureStatusSchema = z.enum(SCHOOLLIFE_MEASURE_STATUSES);
export const SCHOOLLIFE_APPEAL_STATUSES = ["FILED", "UPHELD", "OVERTURNED", "WITHDRAWN"] as const;
export const schoollifeAppealStatusSchema = z.enum(SCHOOLLIFE_APPEAL_STATUSES);
export const SCHOOLLIFE_CONVOCATION_STATUSES = ["DRAFT", "SENT", "ACKNOWLEDGED", "HELD", "NO_SHOW", "CANCELLED", "RESCHEDULED"] as const;
export const schoollifeConvocationStatusSchema = z.enum(SCHOOLLIFE_CONVOCATION_STATUSES);
export const SCHOOLLIFE_CONVOCATION_REASONS = ["DISCIPLINE", "ABSENCES", "ACADEMIC", "HEALTH", "OTHER"] as const;
export const schoollifeConvocationReasonSchema = z.enum(SCHOOLLIFE_CONVOCATION_REASONS);
export const SCHOOLLIFE_INVOLVEMENT_ROLES = ["AUTHOR", "VICTIM", "WITNESS", "OTHER"] as const;
export const schoollifeInvolvementRoleSchema = z.enum(SCHOOLLIFE_INVOLVEMENT_ROLES);
export const SCHOOLLIFE_NOTE_VISIBILITIES = ["STAFF_ONLY", "GUARDIANS", "STUDENT_AND_GUARDIANS"] as const;
export const schoollifeNoteVisibilitySchema = z.enum(SCHOOLLIFE_NOTE_VISIBILITIES);
export const SCHOOLLIFE_NOTE_STATUSES = ["ACTIVE", "WITHDRAWN"] as const;
export const SCHOOLLIFE_SCALE_STATUSES = ["DRAFT", "ACTIVE", "RETIRED"] as const;
export const schoollifeScaleStatusSchema = z.enum(SCHOOLLIFE_SCALE_STATUSES);
export const SCHOOLLIFE_RESET_SCOPES = ["PERIOD", "YEAR", "NEVER"] as const;
export const schoollifeResetScopeSchema = z.enum(SCHOOLLIFE_RESET_SCOPES);
export const SCHOOLLIFE_SCALE_SOURCES = ["regulation", "institution", "placeholder"] as const;
export const schoollifeScaleSourceSchema = z.enum(SCHOOLLIFE_SCALE_SOURCES);
export const SCHOOLLIFE_MOVEMENT_SOURCES = ["MEASURE", "NOTE", "MANUAL_ADJUSTMENT"] as const;
export const schoollifeMovementSourceSchema = z.enum(SCHOOLLIFE_MOVEMENT_SOURCES);
export const SCHOOLLIFE_EFFECT_STATUSES = ["AWAITING_HUMAN", "APPLIED", "FAILED", "SKIPPED", "REVERTED"] as const;
export const schoollifeEffectStatusSchema = z.enum(SCHOOLLIFE_EFFECT_STATUSES);
export const SCHOOLLIFE_EFFECT_STUDENT_STATUSES = ["SUSPENDED", "EXCLUDED"] as const;
export const schoollifeEffectStudentStatusSchema = z.enum(SCHOOLLIFE_EFFECT_STUDENT_STATUSES);
export const SCHOOLLIFE_ENTITY_KINDS = ["INCIDENT", "MEASURE", "NOTE", "CONVOCATION"] as const;
export const schoollifeEntityKindSchema = z.enum(SCHOOLLIFE_ENTITY_KINDS);
export type SchoolLifeEntityKind = z.infer<typeof schoollifeEntityKindSchema>;

/** Booléen de requête : « true » / « false » (jamais `z.coerce.boolean()` : « false » y vaudrait vrai). */
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
} as const;

// ---------------------------------------------------------------------------
// Paramètres : réglages, gravités, types d'événements (DONNÉES d'établissement)
// ---------------------------------------------------------------------------

export const schoollifeSettingsInputSchema = z
  .object({
    institutionId: schoollifeUuidSchema,
    conductPointsEnabled: z.boolean().optional(),
    confidentialReadRequiresPurpose: z.boolean().optional(),
    /** Durée de conservation en jours ; `null` = non définie (aucune durée légale codée : question ouverte). */
    retentionDays: z.number().int().min(1).nullable().optional(),
    /** Rappel d'une convocation N heures avant l'échéance (1 à 720) ; `null` = aucun rappel (VIDE par défaut, aucune valeur imposée). */
    convocationReminderHours: z.number().int().min(1).max(720).nullable().optional(),
    /** Avis neutre aux tuteurs au début et à la fin d'une exclusion temporaire (éteint par défaut). */
    exclusionBoundaryNotices: z.boolean().optional(),
  })
  .strict();
export type SchoolLifeSettingsInput = z.infer<typeof schoollifeSettingsInputSchema>;

export const schoollifeSettingsDtoSchema = z.object({
  institutionId: schoollifeUuidSchema,
  conductPointsEnabled: z.boolean(),
  confidentialReadRequiresPurpose: z.boolean(),
  retentionDays: z.number().int().nullable(),
  convocationReminderHours: z.number().int().nullable(),
  exclusionBoundaryNotices: z.boolean(),
});
export type SchoolLifeSettingsDto = z.infer<typeof schoollifeSettingsDtoSchema>;

export const schoollifeSeverityInputSchema = z
  .object({ code: schoollifeCodeSchema, label: text(1, 120, "Le libellé"), rank: z.number().int().min(1).max(1000), active: z.boolean().default(true) })
  .strict();
export type SchoolLifeSeverityInput = z.infer<typeof schoollifeSeverityInputSchema>;
export const schoollifeSeverityDtoSchema = z.object({ id: schoollifeUuidSchema, code: z.string(), label: z.string(), rank: z.number().int(), active: z.boolean() });
export type SchoolLifeSeverityDto = z.infer<typeof schoollifeSeverityDtoSchema>;

export const schoollifeEventTypeInputSchema = z
  .object({
    code: schoollifeCodeSchema,
    label: text(1, 160, "Le libellé"),
    kind: schoollifeKindSchema,
    defaultSeverityCode: schoollifeCodeSchema.nullable().optional(),
    requiresValidation: z.boolean().default(false),
    requiresFourEyes: z.boolean().default(false),
    approverPermission: permissionKeySchema.nullable().optional(),
    notifyGuardians: z.boolean().default(false),
    visibleToGuardians: z.boolean().default(true),
    confidentialityDefault: schoollifeConfidentialitySchema.default("STANDARD"),
    requiresDates: z.boolean().optional(),
    appealable: z.boolean().default(false),
    isPlaceholder: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export type SchoolLifeEventTypeInput = z.infer<typeof schoollifeEventTypeInputSchema>;
export const schoollifeEventTypeDtoSchema = z.object({
  id: schoollifeUuidSchema,
  code: z.string(),
  label: z.string(),
  kind: schoollifeKindSchema,
  defaultSeverityCode: z.string().nullable(),
  requiresValidation: z.boolean(),
  requiresFourEyes: z.boolean(),
  approverPermission: z.string().nullable(),
  notifyGuardians: z.boolean(),
  visibleToGuardians: z.boolean(),
  confidentialityDefault: schoollifeConfidentialitySchema,
  requiresDates: z.boolean(),
  appealable: z.boolean(),
  isPlaceholder: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type SchoolLifeEventTypeDto = z.infer<typeof schoollifeEventTypeDtoSchema>;

export const schoollifeReferenceDtoSchema = z.object({
  settings: z.array(schoollifeSettingsDtoSchema),
  severityLevels: z.array(schoollifeSeverityDtoSchema),
  eventTypes: z.array(schoollifeEventTypeDtoSchema),
});
export type SchoolLifeReferenceDto = z.infer<typeof schoollifeReferenceDtoSchema>;

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export const schoollifeInvolvementInputSchema = z
  .object({ enrollmentId: schoollifeUuidSchema, role: schoollifeInvolvementRoleSchema, statement: text(1, 2000).optional() })
  .strict();
export type SchoolLifeInvolvementInput = z.infer<typeof schoollifeInvolvementInputSchema>;

export const schoollifeIncidentCreateSchema = z
  .object({
    typeId: schoollifeUuidSchema,
    severityCode: schoollifeCodeSchema.optional(),
    occurredAt: schoollifeInstantSchema,
    location: text(1, 200).optional(),
    description: text(5, 4000, "La description"),
    contextNote: text(1, 2000).optional(),
    confidentiality: schoollifeConfidentialitySchema.optional(),
    attendanceSessionId: schoollifeUuidSchema.optional(),
    /** Établissement et année : déduits de la première implication ; requis seulement sans implication. */
    institutionId: schoollifeUuidSchema.optional(),
    academicYearId: schoollifeUuidSchema.optional(),
    involvements: z.array(schoollifeInvolvementInputSchema).max(50).default([]),
    /**
     * Clé d'idempotence de la saisie (générée par le client, 8 à 100 caractères `A-Za-z0-9_.:-`) : rejouer la MÊME saisie avec la même clé
     * renvoie l'incident déjà créé (aucun doublon, aucun second événement) ; la réutiliser avec un autre contenu est refusé (409).
     * L'en-tête `Idempotency-Key` est équivalent. Prévu pour le rejeu d'une saisie rapide faite hors ligne.
     */
    clientKey: z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/, "La clé d'idempotence contient 8 à 100 caractères (lettres, chiffres, _ . : -).").optional(),
  })
  .strict()
  .refine((v) => v.involvements.length > 0 || (v.institutionId !== undefined && v.academicYearId !== undefined), {
    message: "Désignez au moins un élève impliqué, ou précisez l'établissement et l'année.",
    path: ["involvements"],
  });
export type SchoolLifeIncidentCreate = z.infer<typeof schoollifeIncidentCreateSchema>;

export const schoollifeIncidentReviewSchema = z.object({ assignedTo: schoollifeUuidSchema.optional() }).strict();
export const schoollifeIncidentResolveSchema = z.object({ resolutionNote: text(5, 2000, "La note de résolution") }).strict();
export const schoollifeIncidentConfirmSchema = z.object({}).strict();
export const schoollifeIncidentRaiseConfidentialitySchema = z.object({ confidentiality: schoollifeConfidentialitySchema }).strict();

export const schoollifeIncidentListQuerySchema = z
  .object({
    status: schoollifeIncidentStatusSchema.optional(),
    studentId: schoollifeUuidSchema.optional(),
    classroomId: schoollifeUuidSchema.optional(),
    from: schoollifeDateSchema.optional(),
    to: schoollifeDateSchema.optional(),
    ...pageQuery,
  })
  .strict();

export const schoollifeInvolvementDtoSchema = z.object({
  id: schoollifeUuidSchema,
  enrollmentId: schoollifeUuidSchema,
  studentId: schoollifeUuidSchema,
  studentName: z.string().nullable(),
  role: schoollifeInvolvementRoleSchema,
  /** Déclaration de l'élève : réservée à la lecture confidentielle / instruction ; `null` si masquée. */
  statement: z.string().nullable(),
});

export const schoollifeIncidentDtoSchema = z.object({
  id: schoollifeUuidSchema,
  masked: z.boolean(),
  typeId: schoollifeUuidSchema,
  typeLabel: z.string().nullable(),
  severityCode: z.string().nullable(),
  occurredAt: schoollifeInstantSchema,
  status: schoollifeIncidentStatusSchema,
  confidentiality: schoollifeConfidentialitySchema,
  institutionId: schoollifeUuidSchema,
  academicYearId: schoollifeUuidSchema,
  reportedBy: schoollifeUuidSchema,
  reportedByName: z.string(),
  assignedTo: schoollifeUuidSchema.nullable(),
  /** Champs de contenu : `null` quand l'élément est masqué. */
  location: z.string().nullable(),
  description: z.string().nullable(),
  contextNote: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  involvements: z.array(schoollifeInvolvementDtoSchema),
  createdAt: schoollifeInstantSchema,
  closedAt: schoollifeInstantSchema.nullable(),
});
export type SchoolLifeIncidentDto = z.infer<typeof schoollifeIncidentDtoSchema>;

// ---------------------------------------------------------------------------
// Mesures (sanctions, avertissements, exclusions temporaires) et recours
// ---------------------------------------------------------------------------

export const schoollifeMeasureProposeSchema = z
  .object({
    enrollmentId: schoollifeUuidSchema,
    typeId: schoollifeUuidSchema,
    incidentId: schoollifeUuidSchema.optional(),
    severityCode: schoollifeCodeSchema.optional(),
    reason: text(5, 2000, "Le motif"),
    startsOn: schoollifeDateSchema.optional(),
    endsOn: schoollifeDateSchema.optional(),
    confidentiality: schoollifeConfidentialitySchema.optional(),
    visibleToGuardians: z.boolean().optional(),
  })
  .strict();
export type SchoolLifeMeasureProposeInput = z.infer<typeof schoollifeMeasureProposeSchema>;
export const schoollifeMeasureValidateSchema = z.object({ note: text(1, 2000).optional() }).strict();
export const schoollifeMeasureRejectSchema = z.object({ note: text(5, 2000, "Le motif du rejet") }).strict();
export const schoollifeMeasureCancelSchema = z.object({ reason: text(5, 2000, "Le motif d'annulation") }).strict();
export const schoollifeMeasureRevokeSchema = z.object({ reason: text(10, 2000, "Le motif de révocation") }).strict();
export const schoollifeMeasureNotifySchema = z.object({}).strict();
export const schoollifeMeasureExecuteSchema = z.object({}).strict();

export const schoollifeMeasureListQuerySchema = z
  .object({
    status: schoollifeMeasureStatusSchema.optional(),
    kind: schoollifeMeasureKindSchema.optional(),
    studentId: schoollifeUuidSchema.optional(),
    classroomId: schoollifeUuidSchema.optional(),
    /** Seulement les mesures proposées (file de validation). */
    pendingOnly: boolQuery.optional(),
    /** Seulement les exclusions en vigueur à cette date. */
    activeOn: schoollifeDateSchema.optional(),
    ...pageQuery,
  })
  .strict();

export const schoollifeAppealFileSchema = z.object({ reason: text(10, 2000, "Le motif du recours") }).strict();
export const schoollifeAppealDecideSchema = z.object({ decisionNote: text(10, 2000, "La motivation de la décision") }).strict();
export const schoollifeAppealWithdrawSchema = z.object({}).strict();

export const schoollifeAppealDtoSchema = z.object({
  id: schoollifeUuidSchema,
  measureId: schoollifeUuidSchema,
  filedByName: z.string(),
  filedAt: schoollifeInstantSchema,
  reason: z.string(),
  status: schoollifeAppealStatusSchema,
  decidedByName: z.string().nullable(),
  decidedAt: schoollifeInstantSchema.nullable(),
  decisionNote: z.string().nullable(),
});
export type SchoolLifeAppealDto = z.infer<typeof schoollifeAppealDtoSchema>;

export const schoollifeMeasureDtoSchema = z.object({
  id: schoollifeUuidSchema,
  masked: z.boolean(),
  institutionId: schoollifeUuidSchema,
  academicYearId: schoollifeUuidSchema,
  enrollmentId: schoollifeUuidSchema,
  studentId: schoollifeUuidSchema,
  studentName: z.string().nullable(),
  classroomId: schoollifeUuidSchema.nullable(),
  typeId: schoollifeUuidSchema,
  typeLabel: z.string().nullable(),
  kind: schoollifeMeasureKindSchema,
  incidentId: schoollifeUuidSchema.nullable(),
  severityCode: z.string().nullable(),
  reason: z.string().nullable(),
  startsOn: schoollifeDateSchema.nullable(),
  endsOn: schoollifeDateSchema.nullable(),
  status: schoollifeMeasureStatusSchema,
  confidentiality: schoollifeConfidentialitySchema,
  visibleToGuardians: z.boolean(),
  requiresValidation: z.boolean(),
  requiresFourEyes: z.boolean(),
  appealable: z.boolean(),
  proposedBy: schoollifeUuidSchema,
  proposedByName: z.string(),
  proposedAt: schoollifeInstantSchema,
  validatedByName: z.string().nullable(),
  validatedAt: schoollifeInstantSchema.nullable(),
  validationNote: z.string().nullable(),
  notifiedAt: schoollifeInstantSchema.nullable(),
  executedAt: schoollifeInstantSchema.nullable(),
  revokedAt: schoollifeInstantSchema.nullable(),
  revokedReason: z.string().nullable(),
  cancelReason: z.string().nullable(),
  appeals: z.array(schoollifeAppealDtoSchema),
});
export type SchoolLifeMeasureDto = z.infer<typeof schoollifeMeasureDtoSchema>;

export const schoollifeEffectDtoSchema = z.object({
  id: schoollifeUuidSchema,
  measureId: schoollifeUuidSchema,
  studentId: schoollifeUuidSchema,
  effectKind: z.literal("STUDENT_STATUS_REQUEST"),
  status: schoollifeEffectStatusSchema,
  appliedStatus: schoollifeEffectStudentStatusSchema.nullable(),
  lastError: z.string().nullable(),
  appliedAt: schoollifeInstantSchema.nullable(),
  skippedReason: z.string().nullable(),
  revertReason: z.string().nullable(),
  createdAt: schoollifeInstantSchema,
});
export type SchoolLifeEffectDto = z.infer<typeof schoollifeEffectDtoSchema>;
export const schoollifeEffectApplySchema = z.object({ status: schoollifeEffectStudentStatusSchema }).strict();
export const schoollifeEffectSkipSchema = z.object({ reason: text(5, 1000, "Le motif") }).strict();
export const schoollifeEffectRevertSchema = z.object({ reason: text(5, 1000, "Le motif") }).strict();
export const schoollifeEffectListQuerySchema = z.object({ status: schoollifeEffectStatusSchema.optional(), measureId: schoollifeUuidSchema.optional(), ...pageQuery }).strict();

// ---------------------------------------------------------------------------
// Encouragements et observations
// ---------------------------------------------------------------------------

export const schoollifeNoteCreateSchema = z
  .object({
    enrollmentId: schoollifeUuidSchema,
    typeId: schoollifeUuidSchema,
    body: text(1, 2000, "Le texte"),
    occurredOn: schoollifeDateSchema,
    visibility: schoollifeNoteVisibilitySchema.default("STAFF_ONLY"),
    confidentiality: schoollifeConfidentialitySchema.optional(),
  })
  .strict();
export type SchoolLifeNoteCreate = z.infer<typeof schoollifeNoteCreateSchema>;
export const schoollifeNoteWithdrawSchema = z.object({ reason: text(5, 1000, "Le motif") }).strict();
export const schoollifeNoteListQuerySchema = z
  .object({ studentId: schoollifeUuidSchema.optional(), kind: schoollifeNoteKindSchema.optional(), classroomId: schoollifeUuidSchema.optional(), ...pageQuery })
  .strict();
export const schoollifeNoteDtoSchema = z.object({
  id: schoollifeUuidSchema,
  masked: z.boolean(),
  enrollmentId: schoollifeUuidSchema,
  studentId: schoollifeUuidSchema,
  studentName: z.string().nullable(),
  typeId: schoollifeUuidSchema,
  typeLabel: z.string().nullable(),
  kind: schoollifeNoteKindSchema,
  body: z.string().nullable(),
  occurredOn: schoollifeDateSchema,
  visibility: schoollifeNoteVisibilitySchema,
  confidentiality: schoollifeConfidentialitySchema,
  authorId: schoollifeUuidSchema,
  authorName: z.string(),
  status: z.enum(SCHOOLLIFE_NOTE_STATUSES),
  withdrawnReason: z.string().nullable(),
  createdAt: schoollifeInstantSchema,
});
export type SchoolLifeNoteDto = z.infer<typeof schoollifeNoteDtoSchema>;

// ---------------------------------------------------------------------------
// Convocations
// ---------------------------------------------------------------------------

export const schoollifeConvocationCreateSchema = z
  .object({
    enrollmentId: schoollifeUuidSchema,
    /** Tuteurs convoqués ; par défaut tous les tuteurs liés de l'élève. */
    guardianIds: z.array(schoollifeUuidSchema).min(1).max(10).optional(),
    reasonKind: schoollifeConvocationReasonSchema,
    reason: text(5, 2000, "Le motif"),
    relatedMeasureId: schoollifeUuidSchema.optional(),
    relatedIncidentId: schoollifeUuidSchema.optional(),
    scheduledAt: schoollifeInstantSchema,
    location: text(1, 200).optional(),
    confidentiality: schoollifeConfidentialitySchema.optional(),
  })
  .strict();
export type SchoolLifeConvocationCreate = z.infer<typeof schoollifeConvocationCreateSchema>;
export const schoollifeConvocationSendSchema = z.object({ channels: z.array(z.enum(["EMAIL", "SMS", "WHATSAPP", "PUSH", "IN_APP"])).min(1).max(5).default(["IN_APP", "EMAIL"]) }).strict();
/** Le tuteur qui accuse réception est CELUI du compte connecté ; `guardianId`, s'il est fourni, doit être le sien. */
export const schoollifeConvocationAcknowledgeSchema = z.object({ guardianId: schoollifeUuidSchema.optional() }).strict();
export const schoollifeConvocationHoldSchema = z.object({ outcomeNote: text(1, 2000).optional() }).strict();
export const schoollifeConvocationNoShowSchema = z.object({ outcomeNote: text(1, 2000).optional() }).strict();
export const schoollifeConvocationCancelSchema = z.object({ reason: text(5, 1000, "Le motif d'annulation") }).strict();
export const schoollifeConvocationRescheduleSchema = z.object({ scheduledAt: schoollifeInstantSchema, location: text(1, 200).optional() }).strict();
export const schoollifeConvocationListQuerySchema = z
  .object({ status: schoollifeConvocationStatusSchema.optional(), studentId: schoollifeUuidSchema.optional(), upcomingOnly: boolQuery.optional(), ...pageQuery })
  .strict();
export const schoollifeConvocationDtoSchema = z.object({
  id: schoollifeUuidSchema,
  masked: z.boolean(),
  enrollmentId: schoollifeUuidSchema,
  studentId: schoollifeUuidSchema,
  studentName: z.string().nullable(),
  guardianIds: z.array(schoollifeUuidSchema),
  reasonKind: schoollifeConvocationReasonSchema,
  reason: z.string().nullable(),
  relatedMeasureId: schoollifeUuidSchema.nullable(),
  relatedIncidentId: schoollifeUuidSchema.nullable(),
  scheduledAt: schoollifeInstantSchema,
  location: z.string().nullable(),
  status: schoollifeConvocationStatusSchema,
  convenedByName: z.string(),
  sentAt: schoollifeInstantSchema.nullable(),
  acknowledgedAt: schoollifeInstantSchema.nullable(),
  heldAt: schoollifeInstantSchema.nullable(),
  outcomeNote: z.string().nullable(),
  cancelReason: z.string().nullable(),
  rescheduledFromId: schoollifeUuidSchema.nullable(),
  confidentiality: schoollifeConfidentialitySchema,
});
export type SchoolLifeConvocationDto = z.infer<typeof schoollifeConvocationDtoSchema>;

// ---------------------------------------------------------------------------
// Barèmes de points de conduite (PARAMÈTRES figés) et registre
// ---------------------------------------------------------------------------

export const schoollifeScaleCreateSchema = z
  .object({
    institutionId: schoollifeUuidSchema,
    code: schoollifeCodeSchema,
    label: text(1, 160, "Le libellé"),
    gradeLevelId: schoollifeUuidSchema.nullable().optional(),
    initialPoints: z.number().int().min(-100_000).max(100_000),
    minPoints: z.number().int().min(-100_000).max(100_000).nullable().optional(),
    maxPoints: z.number().int().min(-100_000).max(100_000).nullable().optional(),
    resetScope: schoollifeResetScopeSchema,
    effectiveFrom: schoollifeDateSchema,
    effectiveTo: schoollifeDateSchema.nullable().optional(),
    sourceKind: schoollifeScaleSourceSchema.default("institution"),
  })
  .strict();
export type SchoolLifeScaleCreate = z.infer<typeof schoollifeScaleCreateSchema>;
export const schoollifeScaleItemsSchema = z
  .object({ items: z.array(z.object({ eventTypeId: schoollifeUuidSchema, pointsDelta: z.number().int().refine((n) => n !== 0, "La valeur ne peut pas être nulle.") }).strict()).max(500) })
  .strict();
export const schoollifeScaleActivateSchema = z.object({}).strict();
export const schoollifeScaleRetireSchema = z.object({ effectiveTo: schoollifeDateSchema.optional() }).strict();
export const schoollifeScaleDtoSchema = z.object({
  id: schoollifeUuidSchema,
  institutionId: schoollifeUuidSchema,
  code: z.string(),
  label: z.string(),
  gradeLevelId: schoollifeUuidSchema.nullable(),
  initialPoints: z.number().int(),
  minPoints: z.number().int().nullable(),
  maxPoints: z.number().int().nullable(),
  resetScope: schoollifeResetScopeSchema,
  effectiveFrom: schoollifeDateSchema,
  effectiveTo: schoollifeDateSchema.nullable(),
  status: schoollifeScaleStatusSchema,
  sourceKind: schoollifeScaleSourceSchema,
  /** Un barème de démonstration n'est jamais réglementaire : l'écran l'affiche comme tel. */
  isPlaceholder: z.boolean(),
  items: z.array(z.object({ eventTypeId: schoollifeUuidSchema, eventTypeLabel: z.string().nullable(), pointsDelta: z.number().int() })),
});
export type SchoolLifeScaleDto = z.infer<typeof schoollifeScaleDtoSchema>;

export const schoollifeManualAdjustmentSchema = z
  .object({
    enrollmentId: schoollifeUuidSchema,
    scaleId: schoollifeUuidSchema,
    delta: z.number().int().refine((n) => n !== 0, "La valeur ne peut pas être nulle.").refine((n) => Math.abs(n) <= 100_000),
    reason: text(3, 1000, "Le motif"),
    academicPeriodId: schoollifeUuidSchema.optional(),
  })
  .strict();
export type SchoolLifeManualAdjustment = z.infer<typeof schoollifeManualAdjustmentSchema>;
export const schoollifeConductQuerySchema = z.object({ academicYearId: schoollifeUuidSchema.optional(), periodId: schoollifeUuidSchema.optional() }).strict();
export const schoollifeConductMovementDtoSchema = z.object({
  id: schoollifeUuidSchema,
  scaleId: schoollifeUuidSchema,
  delta: z.number().int(),
  reason: z.string(),
  sourceKind: schoollifeMovementSourceSchema,
  sourceId: schoollifeUuidSchema.nullable(),
  reversesId: schoollifeUuidSchema.nullable(),
  academicPeriodId: schoollifeUuidSchema.nullable(),
  createdAt: schoollifeInstantSchema,
});
export const schoollifeConductDtoSchema = z.object({
  studentId: schoollifeUuidSchema,
  enabled: z.boolean(),
  /** Le solde est une AIDE : la note de conduite du bulletin reste une saisie humaine dans `assess`. */
  balance: z.object({ scaleId: schoollifeUuidSchema, scaleCode: z.string(), scaleLabel: z.string(), isPlaceholder: z.boolean(), points: z.number().int(), enrollmentId: schoollifeUuidSchema }).nullable(),
  movements: z.array(schoollifeConductMovementDtoSchema),
});
export type SchoolLifeConductDto = z.infer<typeof schoollifeConductDtoSchema>;

// ---------------------------------------------------------------------------
// Lectures confidentielles (journalisées)
// ---------------------------------------------------------------------------

export const schoollifeConfidentialReadSchema = z
  .object({ entityKind: schoollifeEntityKindSchema, entityId: schoollifeUuidSchema, purpose: text(5, 500, "Le motif de lecture").optional() })
  .strict();
export type SchoolLifeConfidentialReadInput = z.infer<typeof schoollifeConfidentialReadSchema>;
export const schoollifeConfidentialReadsQuerySchema = z.object({ entityKind: schoollifeEntityKindSchema.optional(), entityId: schoollifeUuidSchema.optional(), ...pageQuery }).strict();
export const schoollifeConfidentialReadDtoSchema = z.object({
  id: schoollifeUuidSchema,
  entityKind: schoollifeEntityKindSchema,
  entityId: schoollifeUuidSchema,
  readerUserId: schoollifeUuidSchema,
  purpose: z.string(),
  occurredAt: schoollifeInstantSchema,
});

// ---------------------------------------------------------------------------
// Dossier de vie scolaire, synthèse de classe, tableau de bord, portails
// ---------------------------------------------------------------------------

export const schoollifeLifeQuerySchema = z.object({ academicYearId: schoollifeUuidSchema.optional(), from: schoollifeDateSchema.optional(), to: schoollifeDateSchema.optional() }).strict();

export const schoollifeLifeEventDtoSchema = z.object({
  id: schoollifeUuidSchema,
  entityKind: z.enum(["INCIDENT", "MEASURE", "NOTE", "CONVOCATION", "APPEAL", "SCALE"]),
  entityId: schoollifeUuidSchema,
  action: z.enum(["CREATED", "STATUS_CHANGED"]),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  actorKind: z.string().nullable(),
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  occurredAt: schoollifeInstantSchema,
});

export const schoollifeAbsenceRowDtoSchema = z.object({
  recordId: schoollifeUuidSchema,
  sessionDate: schoollifeDateSchema,
  statusCode: z.string(),
  excused: z.boolean(),
  countedMinutes: z.number().int().nullable(),
  minutesLate: z.number().int().nullable(),
});
export type SchoolLifeAbsenceRowDto = z.infer<typeof schoollifeAbsenceRowDtoSchema>;

/** Vue sur `attendance` : lecture seule, jamais copiée ni stockée par `schoollife`. */
export const schoollifeAttendanceViewDtoSchema = z.object({
  available: z.boolean(),
  absences: z.array(schoollifeAbsenceRowDtoSchema),
  summary: z.object({ absentCount: z.number().int(), excusedCount: z.number().int(), lateCount: z.number().int() }).nullable(),
});
export type SchoolLifeAttendanceViewDto = z.infer<typeof schoollifeAttendanceViewDtoSchema>;

export const schoollifeStudentLifeDtoSchema = z.object({
  studentId: schoollifeUuidSchema,
  studentName: z.string().nullable(),
  /** Inscription vivante la plus récente : les saisies (mesure, note, convocation) partent de l'inscription, jamais de l'élève seul. */
  enrollmentId: schoollifeUuidSchema.nullable(),
  /** Habilitation effective de l'appelant : pilote l'affichage (masques, bouton « lire (motif) »). */
  clearance: z.enum(["STANDARD", "RESTRICTED", "CONFIDENTIAL"]),
  incidents: z.array(schoollifeIncidentDtoSchema),
  measures: z.array(schoollifeMeasureDtoSchema),
  notes: z.array(schoollifeNoteDtoSchema),
  convocations: z.array(schoollifeConvocationDtoSchema),
  conduct: schoollifeConductDtoSchema,
  attendance: schoollifeAttendanceViewDtoSchema,
  history: z.array(schoollifeLifeEventDtoSchema),
});
export type SchoolLifeStudentLifeDto = z.infer<typeof schoollifeStudentLifeDtoSchema>;

export const schoollifeClassroomSummaryQuerySchema = z.object({ periodId: schoollifeUuidSchema.optional() }).strict();
export const schoollifeClassroomSummaryDtoSchema = z.object({
  classroomId: schoollifeUuidSchema,
  students: z.array(
    z.object({
      studentId: schoollifeUuidSchema,
      enrollmentId: schoollifeUuidSchema,
      studentName: z.string().nullable(),
      incidents: z.number().int(),
      measures: z.number().int(),
      warnings: z.number().int(),
      encouragements: z.number().int(),
      observations: z.number().int(),
      excludedToday: z.boolean(),
    }),
  ),
});
export type SchoolLifeClassroomSummaryDto = z.infer<typeof schoollifeClassroomSummaryDtoSchema>;

export const schoollifeDashboardQuerySchema = z.object({ institutionId: schoollifeUuidSchema.optional(), classroomId: schoollifeUuidSchema.optional() }).strict();
export const schoollifeDashboardDtoSchema = z.object({
  openIncidents: z.number().int(),
  measuresToValidate: z.number().int(),
  activeExclusions: z.number().int(),
  convocationsToHold: z.number().int(),
  effectsAwaitingHuman: z.number().int(),
  recentIncidents: z.array(schoollifeIncidentDtoSchema),
  pendingMeasures: z.array(schoollifeMeasureDtoSchema),
  upcomingConvocations: z.array(schoollifeConvocationDtoSchema),
});
export type SchoolLifeDashboardDto = z.infer<typeof schoollifeDashboardDtoSchema>;

/** Portails : ce que `audience_may_see` autorise pour une famille ou un élève (jamais d'incident brut, jamais de confidentiel). */
export const schoollifeFamilyItemDtoSchema = z.object({
  id: schoollifeUuidSchema,
  entityKind: z.enum(["MEASURE", "NOTE", "CONVOCATION"]),
  title: z.string(),
  kind: z.string(),
  status: z.string(),
  occurredOn: schoollifeDateSchema.nullable(),
  startsOn: schoollifeDateSchema.nullable(),
  endsOn: schoollifeDateSchema.nullable(),
  scheduledAt: schoollifeInstantSchema.nullable(),
  location: z.string().nullable(),
  /** Texte partageable (motif de la mesure notifiée, corps de la note partagée, motif de la convocation). */
  text: z.string().nullable(),
  appealable: z.boolean(),
  /** Recours déjà déposé sur la mesure (famille : dépôt par `POST /measures/:id/appeals`). */
  appealStatus: schoollifeAppealStatusSchema.nullable(),
  canAcknowledge: z.boolean(),
});
export const schoollifeFamilyLifeDtoSchema = z.object({ studentId: schoollifeUuidSchema, studentName: z.string().nullable(), items: z.array(schoollifeFamilyItemDtoSchema) });
export type SchoolLifeFamilyLifeDto = z.infer<typeof schoollifeFamilyLifeDtoSchema>;
export type SchoolLifeFamilyItemDto = z.infer<typeof schoollifeFamilyItemDtoSchema>;

// ---------------------------------------------------------------------------
// Événements (outbox, payload `{ v: 1, … }`) — jamais de description, de motif ni de déclaration d'élève
// ---------------------------------------------------------------------------

const ev = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });
const measureEv = ev({ measureId: schoollifeUuidSchema, enrollmentId: schoollifeUuidSchema, studentId: schoollifeUuidSchema, kind: schoollifeMeasureKindSchema, typeId: schoollifeUuidSchema, severityCode: z.string().nullable(), startsOn: schoollifeDateSchema.nullable(), endsOn: schoollifeDateSchema.nullable(), confidentiality: schoollifeConfidentialitySchema, visibleToGuardians: z.boolean() });
const incidentEv = ev({ incidentId: schoollifeUuidSchema, typeId: schoollifeUuidSchema, status: schoollifeIncidentStatusSchema, confidentiality: schoollifeConfidentialitySchema, studentIds: z.array(schoollifeUuidSchema) });
const convocationEv = ev({ convocationId: schoollifeUuidSchema, enrollmentId: schoollifeUuidSchema, studentId: schoollifeUuidSchema, reasonKind: schoollifeConvocationReasonSchema, scheduledAt: schoollifeInstantSchema });
const effectEv = ev({ effectId: schoollifeUuidSchema, measureId: schoollifeUuidSchema, studentId: schoollifeUuidSchema, appliedStatus: schoollifeEffectStudentStatusSchema.nullable() });

export const schoollifeEventPayloadSchemas = {
  "schoollife.incident.declared": incidentEv,
  "schoollife.incident.status_changed": incidentEv.extend({ fromStatus: schoollifeIncidentStatusSchema }),
  "schoollife.measure.proposed": measureEv,
  "schoollife.measure.validated": measureEv,
  "schoollife.measure.notified": measureEv,
  "schoollife.measure.executed": measureEv,
  "schoollife.measure.revoked": measureEv,
  "schoollife.measure.rejected": measureEv,
  "schoollife.measure.cancelled": measureEv,
  "schoollife.appeal.filed": ev({ appealId: schoollifeUuidSchema, measureId: schoollifeUuidSchema, studentId: schoollifeUuidSchema }),
  "schoollife.appeal.decided": ev({ appealId: schoollifeUuidSchema, measureId: schoollifeUuidSchema, studentId: schoollifeUuidSchema, outcome: z.enum(["UPHELD", "OVERTURNED", "WITHDRAWN"]) }),
  "schoollife.note.created": ev({ noteId: schoollifeUuidSchema, enrollmentId: schoollifeUuidSchema, studentId: schoollifeUuidSchema, kind: schoollifeNoteKindSchema, typeId: schoollifeUuidSchema, visibility: schoollifeNoteVisibilitySchema, confidentiality: schoollifeConfidentialitySchema }),
  "schoollife.note.withdrawn": ev({ noteId: schoollifeUuidSchema, studentId: schoollifeUuidSchema, kind: schoollifeNoteKindSchema }),
  "schoollife.convocation.sent": convocationEv,
  "schoollife.convocation.acknowledged": convocationEv,
  "schoollife.convocation.held": convocationEv,
  "schoollife.convocation.missed": convocationEv,
  "schoollife.convocation.cancelled": convocationEv,
  "schoollife.conduct.movement_recorded": ev({ movementId: schoollifeUuidSchema, scaleId: schoollifeUuidSchema, enrollmentId: schoollifeUuidSchema, studentId: schoollifeUuidSchema, delta: z.number().int(), sourceKind: schoollifeMovementSourceSchema, reversal: z.boolean() }),
  "schoollife.exclusion_effect.requested": effectEv,
  "schoollife.exclusion_effect.applied": effectEv,
  "schoollife.exclusion_effect.skipped": effectEv,
  "schoollife.exclusion_effect.reverted": effectEv,
  "schoollife.confidential.accessed": ev({ entityKind: schoollifeEntityKindSchema, entityId: schoollifeUuidSchema }),
} as const;
export type SchoolLifeEventType = keyof typeof schoollifeEventPayloadSchemas;
export const SCHOOLLIFE_EVENT_TYPES = Object.keys(schoollifeEventPayloadSchemas) as SchoolLifeEventType[];
