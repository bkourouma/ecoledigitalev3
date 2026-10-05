/**
 * Contrats du module `admissions` (routes `/api/v1/admissions/*` et `/api/v1/admissions/public/*`, événements
 * `admissions.*`) — spec v2/007-admissions : workflow PERSONNALISABLE par établissement (étapes rattachées aux huit statuts
 * canoniques), campagnes et capacités, prospects, candidatures, pièces, entretiens, décisions journalisées, offres, liste
 * d'attente, doublons, formulaire public, anonymisation.
 *
 * Conventions :
 *  - Les HUIT statuts canoniques (`ADMISSION_STATUSES`) sont le contrat stable (événements, statistiques) ; une ÉTAPE est une
 *    donnée de l'établissement, rattachée à un statut ; le statut d'un dossier est DÉRIVÉ de son étape.
 *  - IDENTIFIANTS : UUID. Établissement, année, niveau, classe, élève, inscription, facture : références SANS clé étrangère,
 *    vérifiées par les ports du module.
 *  - AUCUNE donnée personnelle (nom, naissance, contact) dans un événement, un audit ou une réponse publique : identifiants et
 *    codes seulement.
 *  - Messages utilisateur en français ; codes d'erreur stables `admissions.*`.
 *  - Réponses PUBLIQUES : liste blanche stricte (voir `admissionsPublic*`). Aucune capacité, aucun effectif, aucune place restante.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const admissionsUuidSchema = z.string().uuid();
export const admissionsInstantSchema = z.string().datetime({ offset: true });
export const admissionsDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date attendue au format AAAA-MM-JJ.");
export const admissionsCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Code en majuscules, chiffres et « _ » (2 à 40 caractères).");
export const admissionsGradeCodeSchema = z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/, "Code de niveau invalide.");
export const admissionsPermissionKeySchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Clé de permission invalide (ex. admission.decide).");

/** Les huit statuts canoniques du PRD §9 : contrat stable des événements et des statistiques. */
export const ADMISSION_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "MISSING_DOCUMENT", "ACCEPTED", "REJECTED", "WAITLISTED", "ENROLLED"] as const;
export const admissionStatusSchema = z.enum(ADMISSION_STATUSES);
export type AdmissionStatus = z.infer<typeof admissionStatusSchema>;

export const ADMISSION_CLOSURE_KINDS = ["REJECTED_BY_SCHOOL", "WITHDRAWN_BY_FAMILY", "OFFER_EXPIRED", "NO_SHOW", "DUPLICATE"] as const;
export const admissionClosureKindSchema = z.enum(ADMISSION_CLOSURE_KINDS);
export type AdmissionClosureKind = z.infer<typeof admissionClosureKindSchema>;

export const ADMISSION_DECISION_KINDS = ["ACCEPT", "REJECT", "WAITLIST", "WITHDRAW", "RECONSIDER"] as const;
export const admissionDecisionKindSchema = z.enum(ADMISSION_DECISION_KINDS);
export type AdmissionDecisionKind = z.infer<typeof admissionDecisionKindSchema>;

export const ADMISSION_FUNDING_TYPES = ["PRIVATE", "STATE_ASSIGNED", "SCHOLARSHIP", "COMPANY", "STAFF_CHILD", "OTHER"] as const;
export const admissionFundingTypeSchema = z.enum(ADMISSION_FUNDING_TYPES);

export const ADMISSION_CAPACITY_POLICIES = ["HARD", "SOFT", "NONE"] as const;
export const ADMISSION_DUPLICATE_POLICIES = ["BLOCK", "WARN", "OFF"] as const;
export const ADMISSION_WAITLIST_PROMOTIONS = ["MANUAL", "AUTO"] as const;
export const ADMISSION_WORKFLOW_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const ADMISSION_CAMPAIGN_STATUSES = ["DRAFT", "OPEN", "CLOSED", "ARCHIVED"] as const;
export const ADMISSION_PROSPECT_STATUSES = ["NEW", "CONTACTED", "CONVERTED", "LOST"] as const;
export const ADMISSION_CREATED_VIA = ["PUBLIC_FORM", "STAFF", "IMPORT", "PROSPECT"] as const;
export const ADMISSION_DOCUMENT_STATUSES = ["MISSING", "SUBMITTED", "ACCEPTED", "REJECTED"] as const;
export const ADMISSION_INTERVIEW_KINDS = ["TEST", "INTERVIEW"] as const;
export const ADMISSION_INTERVIEW_STATUSES = ["SCHEDULED", "DONE", "NO_SHOW", "CANCELLED"] as const;
export const ADMISSION_INTERVIEW_RESULTS = ["PASSED", "FAILED", "NOT_APPLICABLE"] as const;
export const ADMISSION_OFFER_STATUSES = ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"] as const;
export const ADMISSION_DUPLICATE_KINDS = ["APPLICATION", "STUDENT", "PROSPECT"] as const;
export const ADMISSION_DUPLICATE_STATUSES = ["OPEN", "CONFIRMED_DUPLICATE", "DISMISSED"] as const;
export const ADMISSION_CONSENT_KINDS = ["DATA_PROCESSING", "PHOTO", "ADMISSION_TERMS", "COMMUNICATIONS"] as const;
export const ADMISSION_CONSENT_VIAS = ["PUBLIC_FORM", "STAFF_ON_BEHALF", "PAPER"] as const;
export const ADMISSION_NOTIFICATION_CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as const;
export const ADMISSION_NOTIFICATION_STATUSES = ["QUEUED", "SENT", "FAILED", "SKIPPED"] as const;
export const ADMISSION_GENDERS = ["FEMALE", "MALE"] as const;

export const admissionCapacityPolicySchema = z.enum(ADMISSION_CAPACITY_POLICIES);
export const admissionDuplicatePolicySchema = z.enum(ADMISSION_DUPLICATE_POLICIES);
export const admissionWaitlistPromotionSchema = z.enum(ADMISSION_WAITLIST_PROMOTIONS);
export const admissionWorkflowStatusSchema = z.enum(ADMISSION_WORKFLOW_STATUSES);
export const admissionCampaignStatusSchema = z.enum(ADMISSION_CAMPAIGN_STATUSES);
export const admissionProspectStatusSchema = z.enum(ADMISSION_PROSPECT_STATUSES);
export const admissionCreatedViaSchema = z.enum(ADMISSION_CREATED_VIA);
export const admissionDocumentStatusSchema = z.enum(ADMISSION_DOCUMENT_STATUSES);
export const admissionInterviewKindSchema = z.enum(ADMISSION_INTERVIEW_KINDS);
export const admissionInterviewStatusSchema = z.enum(ADMISSION_INTERVIEW_STATUSES);
export const admissionInterviewResultSchema = z.enum(ADMISSION_INTERVIEW_RESULTS);
export const admissionOfferStatusSchema = z.enum(ADMISSION_OFFER_STATUSES);
export const admissionDuplicateKindSchema = z.enum(ADMISSION_DUPLICATE_KINDS);
export const admissionDuplicateStatusSchema = z.enum(ADMISSION_DUPLICATE_STATUSES);
export const admissionConsentKindSchema = z.enum(ADMISSION_CONSENT_KINDS);
export const admissionConsentViaSchema = z.enum(ADMISSION_CONSENT_VIAS);
export const admissionNotificationChannelSchema = z.enum(ADMISSION_NOTIFICATION_CHANNELS);
export const admissionNotificationStatusSchema = z.enum(ADMISSION_NOTIFICATION_STATUSES);
export const admissionGenderSchema = z.enum(ADMISSION_GENDERS);

const label = (max = 200) => z.string().trim().min(1, "Libellé obligatoire.").max(max);
const note = (max = 2000) => z.string().trim().max(max);
const phone = z.string().trim().min(6).max(24);
const email = z.string().trim().toLowerCase().max(200).regex(/^[^@\s]+@[^@\s]+$/, "Adresse e-mail invalide.");

/** Plafonds de bon sens (repris par les CHECK SQL et par le schéma strict du formulaire public). */
export const ADMISSION_LIMITS = Object.freeze({
  nameMax: 100,
  guardiansMax: 4,
  extraKeysMax: 10,
  extraValueMax: 300,
  pageSizeMax: 100,
  boardCardsPerStage: 50,
  trackingCodeLength: 16,
  consentRequiredKind: "DATA_PROCESSING",
});

// ---------------------------------------------------------------------------
// Paramètres et données d'établissement
// ---------------------------------------------------------------------------

export const admissionsInstitutionQuerySchema = z.object({ institutionId: admissionsUuidSchema.optional() });

export const admissionsSettingsDtoSchema = z.object({
  institutionId: admissionsUuidSchema,
  publicFormEnabled: z.boolean(),
  capacityPolicy: admissionCapacityPolicySchema,
  duplicatePolicy: admissionDuplicatePolicySchema,
  waitlistEnabled: z.boolean(),
  consentRequired: z.boolean(),
  consentTextVersion: z.string().nullable(),
  offerValidityDays: z.number().int(),
  paymentDeadlineDays: z.number().int().nullable(),
  waitlistPromotion: admissionWaitlistPromotionSchema,
  minimumFormSeconds: z.number().int(),
  captchaRequired: z.boolean(),
  submissionsPer10Min: z.number().int(),
  rejectedRetentionMonths: z.number().int().nullable(),
  applicationNumberPattern: z.string(),
  /** Slug opaque du lien public (null tant qu'aucun lien n'a été créé). */
  publicFormSlug: z.string().nullable(),
  publicFormLinkEnabled: z.boolean(),
});
export type AdmissionsSettingsDto = z.infer<typeof admissionsSettingsDtoSchema>;

export const admissionsUpdateSettingsBodySchema = z
  .object({
    institutionId: admissionsUuidSchema.optional(),
    publicFormEnabled: z.boolean().optional(),
    capacityPolicy: admissionCapacityPolicySchema.optional(),
    duplicatePolicy: admissionDuplicatePolicySchema.optional(),
    waitlistEnabled: z.boolean().optional(),
    consentRequired: z.boolean().optional(),
    consentTextVersion: z.string().trim().min(1).max(20).nullable().optional(),
    offerValidityDays: z.number().int().min(1).max(365).optional(),
    paymentDeadlineDays: z.number().int().min(1).max(365).nullable().optional(),
    waitlistPromotion: admissionWaitlistPromotionSchema.optional(),
    minimumFormSeconds: z.number().int().min(0).max(600).optional(),
    captchaRequired: z.boolean().optional(),
    submissionsPer10Min: z.number().int().min(1).max(1000).optional(),
    rejectedRetentionMonths: z.number().int().min(1).max(240).nullable().optional(),
    applicationNumberPattern: z.string().trim().min(3).max(60).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).filter((k) => k !== "institutionId").length > 0, "Aucune modification.");
export type AdmissionsUpdateSettingsBody = z.infer<typeof admissionsUpdateSettingsBodySchema>;

export const admissionsPublicLinkBodySchema = z
  .object({ institutionId: admissionsUuidSchema.optional(), enabled: z.boolean().optional(), rotate: z.boolean().optional() })
  .strict();

export const admissionsPriorityClassDtoSchema = z.object({ id: admissionsUuidSchema, code: admissionsCodeSchema, label: z.string(), rank: z.number().int(), active: z.boolean() });
export type AdmissionsPriorityClassDto = z.infer<typeof admissionsPriorityClassDtoSchema>;
export const admissionsUpsertPriorityClassBodySchema = z
  .object({ institutionId: admissionsUuidSchema.optional(), code: admissionsCodeSchema, label: label(120), rank: z.number().int().min(1).max(1000), active: z.boolean().optional() })
  .strict();

export const admissionsDecisionReasonDtoSchema = z.object({ id: admissionsUuidSchema, code: admissionsCodeSchema, kind: admissionDecisionKindSchema, label: z.string(), active: z.boolean() });
export type AdmissionsDecisionReasonDto = z.infer<typeof admissionsDecisionReasonDtoSchema>;
export const admissionsUpsertDecisionReasonBodySchema = z
  .object({ institutionId: admissionsUuidSchema.optional(), code: admissionsCodeSchema, kind: admissionDecisionKindSchema, label: label(200), active: z.boolean().optional() })
  .strict();

export const admissionsConsentTextDtoSchema = z.object({
  id: admissionsUuidSchema,
  kind: admissionConsentKindSchema,
  version: z.string(),
  language: z.string(),
  body: z.string(),
  publishedAt: admissionsInstantSchema,
  retiredAt: admissionsInstantSchema.nullable(),
});
export type AdmissionsConsentTextDto = z.infer<typeof admissionsConsentTextDtoSchema>;
export const admissionsPublishConsentTextBodySchema = z
  .object({
    institutionId: admissionsUuidSchema.optional(),
    kind: admissionConsentKindSchema,
    version: z.string().regex(/^[A-Za-z0-9._-]{1,20}$/, "Version : lettres, chiffres, « . », « _ » ou « - » (20 max)."),
    language: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("fr"),
    body: z.string().trim().min(20, "Le texte doit comporter au moins 20 caractères.").max(20000),
  })
  .strict();

export const admissionsDocumentRequirementDtoSchema = z.object({
  id: admissionsUuidSchema,
  code: admissionsCodeSchema,
  label: z.string(),
  gradeLevelCode: z.string().nullable(),
  appliesToFunding: admissionFundingTypeSchema.nullable(),
  required: z.boolean(),
  acceptsMime: z.array(z.string()),
  maxSizeKb: z.number().int(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type AdmissionsDocumentRequirementDto = z.infer<typeof admissionsDocumentRequirementDtoSchema>;
export const ADMISSION_ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export const admissionsUpsertDocumentRequirementBodySchema = z
  .object({
    institutionId: admissionsUuidSchema.optional(),
    code: admissionsCodeSchema,
    label: label(160),
    gradeLevelCode: admissionsGradeCodeSchema.nullable().optional(),
    appliesToFunding: admissionFundingTypeSchema.nullable().optional(),
    required: z.boolean().optional(),
    acceptsMime: z.array(z.enum(ADMISSION_ACCEPTED_MIME)).min(1).max(4).optional(),
    maxSizeKb: z.number().int().min(1).max(51200).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const admissionsStageDtoSchema = z.object({
  id: admissionsUuidSchema,
  code: admissionsCodeSchema,
  label: z.string(),
  canonicalStatus: admissionStatusSchema,
  ordinal: z.number().int(),
  isInitial: z.boolean(),
  isTerminal: z.boolean(),
  holdsSeat: z.boolean(),
  requiresConsent: z.boolean(),
  requiresDocumentsComplete: z.boolean(),
  requiresInterviewDone: z.boolean(),
  requiresDecision: z.boolean(),
  createsEnrollment: z.boolean(),
  closureKind: admissionClosureKindSchema.nullable(),
  slaHours: z.number().int().nullable(),
  notifyTemplateCode: z.string().nullable(),
});
export type AdmissionsStageDto = z.infer<typeof admissionsStageDtoSchema>;

export const admissionsTransitionDtoSchema = z.object({
  id: admissionsUuidSchema,
  fromStageId: admissionsUuidSchema,
  toStageId: admissionsUuidSchema,
  permissionKey: z.string(),
  requiresReason: z.boolean(),
  isAutomatic: z.boolean(),
});
export type AdmissionsTransitionDto = z.infer<typeof admissionsTransitionDtoSchema>;

export const admissionsWorkflowDtoSchema = z.object({
  id: admissionsUuidSchema,
  institutionId: admissionsUuidSchema,
  code: admissionsCodeSchema,
  version: z.number().int(),
  label: z.string(),
  educationLevelCode: z.string().nullable(),
  status: admissionWorkflowStatusSchema,
  publishedAt: admissionsInstantSchema.nullable(),
  stages: z.array(admissionsStageDtoSchema),
  transitions: z.array(admissionsTransitionDtoSchema),
});
export type AdmissionsWorkflowDto = z.infer<typeof admissionsWorkflowDtoSchema>;

export const admissionsWorkflowSummaryDtoSchema = admissionsWorkflowDtoSchema.omit({ stages: true, transitions: true }).extend({ stageCount: z.number().int() });
export type AdmissionsWorkflowSummaryDto = z.infer<typeof admissionsWorkflowSummaryDtoSchema>;

/** Défaut relevé par la validation à la publication (le code est celui de la base). */
export const admissionsWorkflowDefectSchema = z.object({ code: z.string(), message: z.string(), stages: z.array(z.string()).optional() });
export type AdmissionsWorkflowDefect = z.infer<typeof admissionsWorkflowDefectSchema>;

export const admissionsCreateWorkflowBodySchema = z
  .object({
    institutionId: admissionsUuidSchema.optional(),
    code: admissionsCodeSchema,
    label: label(160),
    educationLevelCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/).nullable().optional(),
    /** `TEMPLATE` : modèle livré en donnée ; `COPY` : copie d'un workflow existant (`fromWorkflowId`) ; `EMPTY`. */
    from: z.enum(["TEMPLATE", "COPY", "EMPTY"]).default("TEMPLATE"),
    fromWorkflowId: admissionsUuidSchema.optional(),
  })
  .strict()
  .refine((v) => v.from !== "COPY" || v.fromWorkflowId, { message: "Le workflow à copier est obligatoire.", path: ["fromWorkflowId"] });
export type AdmissionsCreateWorkflowBody = z.infer<typeof admissionsCreateWorkflowBodySchema>;

export const admissionsUpdateWorkflowBodySchema = z
  .object({ label: label(160).optional(), educationLevelCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/).nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");

const stageInputSchema = z
  .object({
    code: admissionsCodeSchema,
    label: label(120),
    canonicalStatus: admissionStatusSchema,
    ordinal: z.number().int().min(1).max(200),
    isInitial: z.boolean().default(false),
    isTerminal: z.boolean().default(false),
    holdsSeat: z.boolean().default(false),
    requiresConsent: z.boolean().default(false),
    requiresDocumentsComplete: z.boolean().default(false),
    requiresInterviewDone: z.boolean().default(false),
    requiresDecision: z.boolean().default(false),
    createsEnrollment: z.boolean().default(false),
    closureKind: admissionClosureKindSchema.nullable().default(null),
    slaHours: z.number().int().min(1).max(8760).nullable().default(null),
    notifyTemplateCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).nullable().default(null),
  })
  .strict();
export const admissionsReplaceStagesBodySchema = z.object({ stages: z.array(stageInputSchema).min(1).max(60) }).strict();
export type AdmissionsReplaceStagesBody = z.infer<typeof admissionsReplaceStagesBodySchema>;

const transitionInputSchema = z
  .object({
    fromStage: admissionsCodeSchema,
    toStage: admissionsCodeSchema,
    permissionKey: admissionsPermissionKeySchema,
    requiresReason: z.boolean().default(false),
    isAutomatic: z.boolean().default(false),
  })
  .strict();
export const admissionsReplaceTransitionsBodySchema = z.object({ transitions: z.array(transitionInputSchema).max(300) }).strict();
export type AdmissionsReplaceTransitionsBody = z.infer<typeof admissionsReplaceTransitionsBodySchema>;

export const admissionsPublishWorkflowResultSchema = z.object({ workflow: admissionsWorkflowDtoSchema });

// ---------------------------------------------------------------------------
// Campagnes et capacités
// ---------------------------------------------------------------------------

export const admissionsCapacityDtoSchema = z.object({
  id: admissionsUuidSchema,
  gradeLevelCode: z.string(),
  programId: admissionsUuidSchema.nullable(),
  seats: z.number().int(),
  waitlistLimit: z.number().int().nullable(),
  seatsLeft: z.number().int().nullable(),
  waitlistCount: z.number().int(),
});
export type AdmissionsCapacityDto = z.infer<typeof admissionsCapacityDtoSchema>;

export const admissionsCampaignDtoSchema = z.object({
  id: admissionsUuidSchema,
  institutionId: admissionsUuidSchema,
  academicYearId: admissionsUuidSchema,
  code: z.string(),
  label: z.string(),
  workflowId: admissionsUuidSchema,
  opensAt: admissionsInstantSchema,
  closesAt: admissionsInstantSchema,
  status: admissionCampaignStatusSchema,
  capacities: z.array(admissionsCapacityDtoSchema),
});
export type AdmissionsCampaignDto = z.infer<typeof admissionsCampaignDtoSchema>;

export const admissionsCreateCampaignBodySchema = z
  .object({
    institutionId: admissionsUuidSchema.optional(),
    academicYearId: admissionsUuidSchema,
    code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/, "Code de campagne invalide."),
    label: label(160),
    workflowId: admissionsUuidSchema,
    opensAt: admissionsInstantSchema,
    closesAt: admissionsInstantSchema,
  })
  .strict();
export type AdmissionsCreateCampaignBody = z.infer<typeof admissionsCreateCampaignBodySchema>;

export const admissionsUpdateCampaignBodySchema = z
  .object({ label: label(160).optional(), workflowId: admissionsUuidSchema.optional(), opensAt: admissionsInstantSchema.optional(), closesAt: admissionsInstantSchema.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");

export const admissionsReplaceCapacitiesBodySchema = z
  .object({
    capacities: z
      .array(
        z
          .object({
            gradeLevelCode: admissionsGradeCodeSchema,
            programId: admissionsUuidSchema.nullable().optional(),
            seats: z.number().int().min(0).max(100000),
            waitlistLimit: z.number().int().min(0).max(100000).nullable().optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type AdmissionsReplaceCapacitiesBody = z.infer<typeof admissionsReplaceCapacitiesBodySchema>;

export const admissionsListCampaignsQuerySchema = z.object({ institutionId: admissionsUuidSchema.optional(), status: admissionCampaignStatusSchema.optional() });

// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

export const admissionsProspectDtoSchema = z.object({
  id: admissionsUuidSchema,
  institutionId: admissionsUuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  interestedGradeLevelCode: z.string().nullable(),
  sourceChannel: z.string(),
  referrerLabel: z.string().nullable(),
  status: admissionProspectStatusSchema,
  lostReason: z.string().nullable(),
  assignedTo: admissionsUuidSchema.nullable(),
  convertedApplicationId: admissionsUuidSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: admissionsInstantSchema,
});
export type AdmissionsProspectDto = z.infer<typeof admissionsProspectDtoSchema>;

export const admissionsCreateProspectBodySchema = z
  .object({
    institutionId: admissionsUuidSchema.optional(),
    firstName: label(ADMISSION_LIMITS.nameMax),
    lastName: label(ADMISSION_LIMITS.nameMax),
    contactPhone: phone.nullable().optional(),
    contactEmail: email.nullable().optional(),
    interestedGradeLevelCode: admissionsGradeCodeSchema.nullable().optional(),
    sourceChannel: admissionsCodeSchema.default("WALK_IN"),
    referrerLabel: label(120).nullable().optional(),
    notes: note().nullable().optional(),
    assignedTo: admissionsUuidSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => v.contactPhone || v.contactEmail, { message: "Un moyen de contact (téléphone ou e-mail) est obligatoire.", path: ["contactPhone"] });
export type AdmissionsCreateProspectBody = z.infer<typeof admissionsCreateProspectBodySchema>;

export const admissionsUpdateProspectBodySchema = z
  .object({
    firstName: label(ADMISSION_LIMITS.nameMax).optional(),
    lastName: label(ADMISSION_LIMITS.nameMax).optional(),
    contactPhone: phone.nullable().optional(),
    contactEmail: email.nullable().optional(),
    interestedGradeLevelCode: admissionsGradeCodeSchema.nullable().optional(),
    referrerLabel: label(120).nullable().optional(),
    notes: note().nullable().optional(),
    assignedTo: admissionsUuidSchema.nullable().optional(),
    status: z.enum(["NEW", "CONTACTED", "LOST"]).optional(),
    lostReason: label(300).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type AdmissionsUpdateProspectBody = z.infer<typeof admissionsUpdateProspectBodySchema>;

export const admissionsListProspectsQuerySchema = z.object({
  institutionId: admissionsUuidSchema.optional(),
  status: admissionProspectStatusSchema.optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(ADMISSION_LIMITS.pageSizeMax).default(30),
});

export const admissionsConvertProspectBodySchema = z
  .object({
    campaignId: admissionsUuidSchema,
    birthDate: admissionsDateSchema,
    desiredGradeLevelCode: admissionsGradeCodeSchema,
    applicantFirstName: label(ADMISSION_LIMITS.nameMax),
    applicantLastName: label(ADMISSION_LIMITS.nameMax).optional(),
    guardianRelationshipCode: admissionsCodeSchema.default("OTHER"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Candidatures
// ---------------------------------------------------------------------------

const guardianInputSchema = z
  .object({
    relationshipCode: admissionsCodeSchema,
    firstName: label(ADMISSION_LIMITS.nameMax),
    lastName: label(ADMISSION_LIMITS.nameMax),
    phone: phone.nullable().optional(),
    email: email.nullable().optional(),
    profession: label(120).nullable().optional(),
    isPrimary: z.boolean().default(false),
    isFinancialResponsible: z.boolean().default(false),
    canConsent: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.phone || v.email, { message: "Un moyen de contact (téléphone ou e-mail) est obligatoire pour chaque tuteur.", path: ["phone"] });
export type AdmissionsGuardianInput = z.infer<typeof guardianInputSchema>;
export { guardianInputSchema as admissionsGuardianInputSchema };

const applicantFields = {
  applicantFirstName: label(ADMISSION_LIMITS.nameMax),
  applicantLastName: label(ADMISSION_LIMITS.nameMax),
  applicantBirthDate: admissionsDateSchema,
  applicantBirthPlace: label(120).nullable().optional(),
  applicantGender: admissionGenderSchema.nullable().optional(),
  applicantNationality: z.string().trim().length(2).toUpperCase().nullable().optional(),
  previousSchool: label(160).nullable().optional(),
  previousGradeLevelCode: admissionsGradeCodeSchema.nullable().optional(),
  isRepeating: z.boolean().default(false),
  desiredGradeLevelCode: admissionsGradeCodeSchema,
  desiredProgramId: admissionsUuidSchema.nullable().optional(),
  fundingTypeRequested: admissionFundingTypeSchema.default("PRIVATE"),
  assignmentReference: label(100).nullable().optional(),
  priorityClassCode: admissionsCodeSchema.nullable().optional(),
  sourceChannel: admissionsCodeSchema.default("WALK_IN"),
  referrerLabel: label(120).nullable().optional(),
};

export const admissionsCreateApplicationBodySchema = z
  .object({
    campaignId: admissionsUuidSchema,
    prospectId: admissionsUuidSchema.nullable().optional(),
    ...applicantFields,
    guardians: z.array(guardianInputSchema).min(1, "Au moins un tuteur est obligatoire.").max(ADMISSION_LIMITS.guardiansMax),
    extra: z.record(z.string().max(60), z.string().max(ADMISSION_LIMITS.extraValueMax)).default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fundingTypeRequested === "STATE_ASSIGNED" && !v.assignmentReference) {
      ctx.addIssue({ code: "custom", path: ["assignmentReference"], message: "La référence d'affectation est obligatoire pour un élève affecté par l'État." });
    }
    if (v.guardians.filter((g) => g.isPrimary).length > 1) ctx.addIssue({ code: "custom", path: ["guardians"], message: "Un seul tuteur principal." });
  });
export type AdmissionsCreateApplicationBody = z.infer<typeof admissionsCreateApplicationBodySchema>;

export const admissionsUpdateApplicationBodySchema = z
  .object({
    applicantFirstName: label(ADMISSION_LIMITS.nameMax).optional(),
    applicantLastName: label(ADMISSION_LIMITS.nameMax).optional(),
    applicantBirthDate: admissionsDateSchema.optional(),
    applicantBirthPlace: label(120).nullable().optional(),
    applicantGender: admissionGenderSchema.nullable().optional(),
    applicantNationality: z.string().trim().length(2).toUpperCase().nullable().optional(),
    previousSchool: label(160).nullable().optional(),
    previousGradeLevelCode: admissionsGradeCodeSchema.nullable().optional(),
    isRepeating: z.boolean().optional(),
    desiredGradeLevelCode: admissionsGradeCodeSchema.optional(),
    desiredProgramId: admissionsUuidSchema.nullable().optional(),
    fundingTypeRequested: admissionFundingTypeSchema.optional(),
    assignmentReference: label(100).nullable().optional(),
    priorityClassCode: admissionsCodeSchema.nullable().optional(),
    sourceChannel: admissionsCodeSchema.optional(),
    referrerLabel: label(120).nullable().optional(),
    /** Version lue par l'écran : refus `409` si le dossier a changé entre-temps. */
    rowVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).filter((k) => k !== "rowVersion").length > 0, "Aucune modification.");
export type AdmissionsUpdateApplicationBody = z.infer<typeof admissionsUpdateApplicationBodySchema>;

export const admissionsGuardianDtoSchema = z.object({
  id: admissionsUuidSchema,
  relationshipCode: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  profession: z.string().nullable(),
  isPrimary: z.boolean(),
  isFinancialResponsible: z.boolean(),
  canConsent: z.boolean(),
});
export type AdmissionsGuardianDto = z.infer<typeof admissionsGuardianDtoSchema>;

export const admissionsConsentDtoSchema = z.object({
  id: admissionsUuidSchema,
  guardianId: admissionsUuidSchema,
  kind: admissionConsentKindSchema,
  textVersion: z.string(),
  givenAt: admissionsInstantSchema,
  givenVia: admissionConsentViaSchema,
  withdrawnAt: admissionsInstantSchema.nullable(),
});
export type AdmissionsConsentDto = z.infer<typeof admissionsConsentDtoSchema>;

export const admissionsApplicationDocumentDtoSchema = z.object({
  requirementId: admissionsUuidSchema,
  requirementCode: z.string(),
  requirementLabel: z.string(),
  required: z.boolean(),
  applicable: z.boolean(),
  status: admissionDocumentStatusSchema,
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  attempts: z.number().int(),
  rejectionReason: z.string().nullable(),
  submittedAt: admissionsInstantSchema.nullable(),
  reviewedAt: admissionsInstantSchema.nullable(),
});
export type AdmissionsApplicationDocumentDto = z.infer<typeof admissionsApplicationDocumentDtoSchema>;

export const admissionsInterviewDtoSchema = z.object({
  id: admissionsUuidSchema,
  kind: admissionInterviewKindSchema,
  scheduledAt: admissionsInstantSchema,
  venue: z.string().nullable(),
  status: admissionInterviewStatusSchema,
  conductedByStaffId: admissionsUuidSchema.nullable(),
  score: z.string().nullable(),
  scaleMax: z.string().nullable(),
  resultCode: admissionInterviewResultSchema.nullable(),
  notes: z.string().nullable(),
});
export type AdmissionsInterviewDto = z.infer<typeof admissionsInterviewDtoSchema>;

export const admissionsOfferDtoSchema = z.object({
  id: admissionsUuidSchema,
  status: admissionOfferStatusSchema,
  gradeLevelCode: z.string(),
  classroomId: admissionsUuidSchema.nullable(),
  issuedAt: admissionsInstantSchema,
  expiresAt: admissionsInstantSchema,
  respondedAt: admissionsInstantSchema.nullable(),
  respondedByGuardianId: admissionsUuidSchema.nullable(),
  conditions: z.string().nullable(),
});
export type AdmissionsOfferDto = z.infer<typeof admissionsOfferDtoSchema>;

export const admissionsDuplicateDtoSchema = z.object({
  id: admissionsUuidSchema,
  matchedKind: admissionDuplicateKindSchema,
  matchedId: admissionsUuidSchema,
  score: z.number().int(),
  reasons: z.array(z.string()),
  status: admissionDuplicateStatusSchema,
  reviewedAt: admissionsInstantSchema.nullable(),
});
export type AdmissionsDuplicateDto = z.infer<typeof admissionsDuplicateDtoSchema>;

export const admissionsApplicationSummaryDtoSchema = z.object({
  id: admissionsUuidSchema,
  applicationNumber: z.string(),
  campaignId: admissionsUuidSchema,
  stageId: admissionsUuidSchema,
  stageCode: z.string(),
  stageLabel: z.string(),
  status: admissionStatusSchema,
  applicantFirstName: z.string(),
  applicantLastName: z.string(),
  desiredGradeLevelCode: z.string(),
  fundingTypeRequested: z.string(),
  priorityClassCode: z.string().nullable(),
  sourceChannel: z.string(),
  createdVia: admissionCreatedViaSchema,
  submittedAt: admissionsInstantSchema.nullable(),
  updatedAt: admissionsInstantSchema,
  stageEnteredAt: admissionsInstantSchema.nullable(),
  slaHours: z.number().int().nullable(),
  overdue: z.boolean(),
  anonymized: z.boolean(),
});
export type AdmissionsApplicationSummaryDto = z.infer<typeof admissionsApplicationSummaryDtoSchema>;

export const admissionsAllowedTransitionDtoSchema = z.object({
  transitionId: admissionsUuidSchema,
  toStageId: admissionsUuidSchema,
  toStageCode: z.string(),
  toStageLabel: z.string(),
  toStatus: admissionStatusSchema,
  permissionKey: z.string(),
  requiresReason: z.boolean(),
  requiresDecision: z.boolean(),
  createsEnrollment: z.boolean(),
  isAutomatic: z.boolean(),
  /** Types de décision acceptés lorsque l'étape visée exige une décision formelle. */
  decisionKind: admissionDecisionKindSchema.nullable(),
});
export type AdmissionsAllowedTransitionDto = z.infer<typeof admissionsAllowedTransitionDtoSchema>;

export const admissionsApplicationDetailDtoSchema = admissionsApplicationSummaryDtoSchema.extend({
  institutionId: admissionsUuidSchema,
  workflowId: admissionsUuidSchema,
  applicantBirthDate: admissionsDateSchema,
  applicantBirthPlace: z.string().nullable(),
  applicantGender: admissionGenderSchema.nullable(),
  applicantNationality: z.string().nullable(),
  previousSchool: z.string().nullable(),
  previousGradeLevelCode: z.string().nullable(),
  isRepeating: z.boolean(),
  desiredProgramId: admissionsUuidSchema.nullable(),
  assignmentReference: z.string().nullable(),
  referrerLabel: z.string().nullable(),
  prospectId: admissionsUuidSchema.nullable(),
  capacityOverrideReason: z.string().nullable(),
  waitlistEnteredAt: admissionsInstantSchema.nullable(),
  decidedAt: admissionsInstantSchema.nullable(),
  closedAt: admissionsInstantSchema.nullable(),
  closureKind: admissionClosureKindSchema.nullable(),
  studentId: admissionsUuidSchema.nullable(),
  enrollmentId: admissionsUuidSchema.nullable(),
  invoiceId: admissionsUuidSchema.nullable(),
  enrollmentConfirmedAt: admissionsInstantSchema.nullable(),
  enrolledAt: admissionsInstantSchema.nullable(),
  rowVersion: z.number().int(),
  guardians: z.array(admissionsGuardianDtoSchema),
  consents: z.array(admissionsConsentDtoSchema),
  documents: z.array(admissionsApplicationDocumentDtoSchema),
  missingDocuments: z.array(z.string()),
  interviews: z.array(admissionsInterviewDtoSchema),
  offers: z.array(admissionsOfferDtoSchema),
  duplicates: z.array(admissionsDuplicateDtoSchema),
  seatsLeft: z.number().int().nullable(),
  hasValidConsent: z.boolean(),
  allowedTransitions: z.array(admissionsAllowedTransitionDtoSchema),
  extra: z.record(z.string(), z.unknown()),
});
export type AdmissionsApplicationDetailDto = z.infer<typeof admissionsApplicationDetailDtoSchema>;

export const admissionsApplicationCreatedDtoSchema = z.object({ id: admissionsUuidSchema, applicationNumber: z.string(), duplicates: z.number().int() });

export const admissionsListApplicationsQuerySchema = z.object({
  campaignId: admissionsUuidSchema.optional(),
  status: admissionStatusSchema.optional(),
  stage: admissionsCodeSchema.optional(),
  grade: admissionsGradeCodeSchema.optional(),
  q: z.string().trim().max(120).optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(ADMISSION_LIMITS.pageSizeMax).default(30),
});
export type AdmissionsListApplicationsQuery = z.infer<typeof admissionsListApplicationsQuerySchema>;

export const admissionsApplicationListDtoSchema = z.object({
  items: z.array(admissionsApplicationSummaryDtoSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const admissionsBoardQuerySchema = z.object({ campaignId: admissionsUuidSchema, grade: admissionsGradeCodeSchema.optional() });
export const admissionsBoardDtoSchema = z.object({
  campaignId: admissionsUuidSchema,
  workflowId: admissionsUuidSchema,
  columns: z.array(
    z.object({
      stage: admissionsStageDtoSchema,
      total: z.number().int(),
      cards: z.array(admissionsApplicationSummaryDtoSchema),
    }),
  ),
  transitions: z.array(admissionsTransitionDtoSchema),
});
export type AdmissionsBoardDto = z.infer<typeof admissionsBoardDtoSchema>;

export const admissionsTransitionBodySchema = z.object({ toStageId: admissionsUuidSchema, reason: z.string().trim().min(3).max(1000).optional(), rowVersion: z.number().int().min(1).optional() }).strict();
export type AdmissionsTransitionBody = z.infer<typeof admissionsTransitionBodySchema>;

export const admissionsDecisionBodySchema = z
  .object({
    toStageId: admissionsUuidSchema,
    kind: admissionDecisionKindSchema,
    reasonCode: admissionsCodeSchema.optional(),
    reasonText: z.string().trim().max(2000).optional(),
    conditions: z.string().trim().max(2000).optional(),
    overrideCapacity: z.boolean().default(false),
    rowVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.kind === "REJECT" || v.kind === "WITHDRAW") && !v.reasonCode) ctx.addIssue({ code: "custom", path: ["reasonCode"], message: "Un refus ou un retrait cite un motif codé." });
    if (v.overrideCapacity && (v.reasonText ?? "").trim().length < 10) ctx.addIssue({ code: "custom", path: ["reasonText"], message: "Un dépassement de capacité exige un motif d'au moins 10 caractères." });
  });
export type AdmissionsDecisionBody = z.infer<typeof admissionsDecisionBodySchema>;

export const admissionsHistoryDtoSchema = z.object({
  transitions: z.array(
    z.object({
      id: admissionsUuidSchema,
      fromStageId: admissionsUuidSchema.nullable(),
      toStageId: admissionsUuidSchema,
      fromStatus: z.string().nullable(),
      toStatus: z.string(),
      fromStageLabel: z.string().nullable(),
      toStageLabel: z.string(),
      actorId: admissionsUuidSchema.nullable(),
      actorKind: z.enum(["USER", "SYSTEM", "APPLICANT"]),
      occurredAt: admissionsInstantSchema,
    }),
  ),
  decisions: z.array(
    z.object({
      id: admissionsUuidSchema,
      kind: admissionDecisionKindSchema,
      fromStageId: admissionsUuidSchema,
      toStageId: admissionsUuidSchema,
      reasonCode: z.string().nullable(),
      reasonLabel: z.string().nullable(),
      reasonText: z.string().nullable(),
      conditions: z.string().nullable(),
      overrideCapacity: z.boolean(),
      decidedByName: z.string(),
      decidedAt: admissionsInstantSchema,
    }),
  ),
});
export type AdmissionsHistoryDto = z.infer<typeof admissionsHistoryDtoSchema>;

// Pièces ----------------------------------------------------------------------------------------------------------------

export const admissionsReviewDocumentBodySchema = z
  .object({ decision: z.enum(["ACCEPT", "REJECT"]), reason: z.string().trim().min(3).max(500).optional() })
  .strict()
  .refine((v) => v.decision === "ACCEPT" || v.reason, { message: "Un rejet exige un motif.", path: ["reason"] });

export const admissionsUploadDocumentFieldsSchema = z.object({ requirementId: admissionsUuidSchema });

// Entretiens ------------------------------------------------------------------------------------------------------------

export const admissionsCreateInterviewBodySchema = z
  .object({
    kind: admissionInterviewKindSchema,
    scheduledAt: admissionsInstantSchema,
    venue: label(160).nullable().optional(),
    conductedByStaffId: admissionsUuidSchema.nullable().optional(),
  })
  .strict();
export const admissionsUpdateInterviewBodySchema = z
  .object({
    scheduledAt: admissionsInstantSchema.optional(),
    venue: label(160).nullable().optional(),
    conductedByStaffId: admissionsUuidSchema.nullable().optional(),
    status: admissionInterviewStatusSchema.optional(),
    score: z.number().min(0).max(100000).nullable().optional(),
    scaleMax: z.number().gt(0).max(100000).nullable().optional(),
    resultCode: admissionInterviewResultSchema.nullable().optional(),
    notes: note().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type AdmissionsUpdateInterviewBody = z.infer<typeof admissionsUpdateInterviewBodySchema>;

// Offres ----------------------------------------------------------------------------------------------------------------

export const admissionsIssueOfferBodySchema = z
  .object({ classroomId: admissionsUuidSchema.optional(), gradeLevelCode: admissionsGradeCodeSchema.optional(), conditions: z.string().trim().max(2000).optional(), validityDays: z.number().int().min(1).max(365).optional() })
  .strict();
export type AdmissionsIssueOfferBody = z.infer<typeof admissionsIssueOfferBodySchema>;

export const admissionsIssueOfferResultDtoSchema = z.object({
  offer: admissionsOfferDtoSchema,
  /** Lien de réponse à usage unique : montré UNE fois au personnel (seule l'empreinte est conservée). */
  responseToken: z.string(),
  guardianId: admissionsUuidSchema.nullable(),
  notified: z.enum(["SENT", "QUEUED", "SKIPPED", "FAILED"]),
});

export const admissionsWithdrawOfferBodySchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const admissionsAcceptOnBehalfBodySchema = z
  .object({ guardianId: admissionsUuidSchema, evidenceRef: z.string().trim().min(3).max(300), classroomId: admissionsUuidSchema.optional() })
  .strict();
export const admissionsAcceptOfferResultDtoSchema = z.object({
  applicationId: admissionsUuidSchema,
  offerId: admissionsUuidSchema,
  studentId: admissionsUuidSchema,
  enrollmentId: admissionsUuidSchema,
  invoiceId: admissionsUuidSchema.nullable(),
  stageId: admissionsUuidSchema,
  status: admissionStatusSchema,
  replayed: z.boolean(),
});
export type AdmissionsAcceptOfferResultDto = z.infer<typeof admissionsAcceptOfferResultDtoSchema>;

// Doublons --------------------------------------------------------------------------------------------------------------

export const admissionsResolveDuplicateBodySchema = z.object({ resolution: z.enum(["CONFIRMED_DUPLICATE", "DISMISSED"]) }).strict();

// Consentement par le personnel -----------------------------------------------------------------------------------------

export const admissionsRecordConsentBodySchema = z
  .object({
    guardianId: admissionsUuidSchema,
    kind: admissionConsentKindSchema.default("DATA_PROCESSING"),
    textVersion: z.string().min(1).max(20),
    givenVia: z.enum(["STAFF_ON_BEHALF", "PAPER"]),
    evidenceRef: z.string().trim().min(3).max(300),
  })
  .strict();
export const admissionsWithdrawConsentBodySchema = z.object({ consentId: admissionsUuidSchema, reason: z.string().trim().min(3).max(500) }).strict();

// Anonymisation, export -------------------------------------------------------------------------------------------------

export const admissionsAnonymizeBodySchema = z.object({ reason: z.string().trim().min(10, "Motif d'au moins 10 caractères.").max(500) }).strict();

// Liste d'attente -------------------------------------------------------------------------------------------------------

export const admissionsWaitlistQuerySchema = z.object({ campaignId: admissionsUuidSchema, grade: admissionsGradeCodeSchema });
export const admissionsWaitlistDtoSchema = z.object({
  campaignId: admissionsUuidSchema,
  grade: z.string(),
  seatsLeft: z.number().int().nullable(),
  waitlistLimit: z.number().int().nullable(),
  entries: z.array(
    z.object({
      queuePosition: z.number().int(),
      applicationId: admissionsUuidSchema,
      applicationNumber: z.string(),
      applicantFirstName: z.string(),
      applicantLastName: z.string(),
      priorityClassCode: z.string().nullable(),
      priorityLabel: z.string().nullable(),
      priorityRank: z.number().int().nullable(),
      /** Ancienneté (date d'entrée en liste) : information affichée, ne détermine plus l'ordre (Q-A03). */
      waitlistEnteredAt: admissionsInstantSchema,
      /** Rang DÉCIDÉ par la direction (1 = premier) ; `null` = « à classer » (aucune décision encore). */
      manualRank: z.number().int().min(1).nullable(),
    }),
  ),
  /** Derniers classements / déplacements de rang (trace), du plus récent au plus ancien. */
  changes: z.array(
    z.object({
      id: admissionsUuidSchema,
      applicationId: admissionsUuidSchema,
      kind: z.enum(["RANKED", "MOVED"]),
      fromRank: z.number().int().nullable(),
      toRank: z.number().int().nullable(),
      reason: z.string().nullable(),
      actorId: admissionsUuidSchema.nullable(),
      occurredAt: admissionsInstantSchema,
    }),
  ),
});
export type AdmissionsWaitlistDto = z.infer<typeof admissionsWaitlistDtoSchema>;
/** Réordonnancement MANUEL de la liste d'attente (Q-A03) : la liste complète, dans l'ordre voulu par la direction. */
export const admissionsWaitlistReorderBodySchema = z
  .object({
    campaignId: admissionsUuidSchema,
    grade: admissionsGradeCodeSchema,
    orderedApplicationIds: z.array(admissionsUuidSchema).min(1).max(5000),
    reason: z.string().trim().min(3, "Motif d'au moins 3 caractères.").max(500).optional(),
  })
  .strict();
export type AdmissionsWaitlistReorderBody = z.infer<typeof admissionsWaitlistReorderBodySchema>;
export const admissionsWaitlistReorderResultDtoSchema = z.object({ count: z.number().int(), changed: z.number().int() });
export const admissionsPromoteBodySchema = z
  .object({ campaignId: admissionsUuidSchema, grade: admissionsGradeCodeSchema, classroomId: admissionsUuidSchema.optional(), applicationId: admissionsUuidSchema.optional() })
  .strict();
export const admissionsPromoteResultDtoSchema = z.object({ promoted: z.boolean(), applicationId: admissionsUuidSchema.nullable(), reason: z.string().nullable(), offerId: admissionsUuidSchema.nullable(), responseToken: z.string().nullable() });

// Rapports --------------------------------------------------------------------------------------------------------------

export const admissionsReportQuerySchema = z.object({ campaignId: admissionsUuidSchema, grade: admissionsGradeCodeSchema.optional() });
export const admissionsFunnelDtoSchema = z.object({
  campaignId: admissionsUuidSchema,
  byStatus: z.array(z.object({ status: admissionStatusSchema, count: z.number().int() })),
  byGrade: z.array(z.object({ grade: z.string(), status: admissionStatusSchema, count: z.number().int() })),
  conversion: z.array(z.object({ from: admissionStatusSchema, to: admissionStatusSchema, count: z.number().int(), rate: z.number().nullable() })),
  received: z.number().int(),
  processed: z.number().int(),
  averageProcessingHours: z.number().nullable(),
  processingBuckets: z.array(z.object({ bucket: z.enum(["LT_24H", "D1_3", "D3_7", "GT_7D"]), count: z.number().int() })),
  weekly: z.array(z.object({ weekStart: admissionsDateSchema, received: z.number().int() })),
});
export type AdmissionsFunnelDto = z.infer<typeof admissionsFunnelDtoSchema>;
export const admissionsCapacityReportDtoSchema = z.object({
  campaignId: admissionsUuidSchema,
  rows: z.array(z.object({ gradeLevelCode: z.string(), seats: z.number().int().nullable(), seatsLeft: z.number().int().nullable(), waitlist: z.number().int(), held: z.number().int(), configured: z.boolean() })),
});
export const admissionsSlaReportDtoSchema = z.object({
  campaignId: admissionsUuidSchema,
  rows: z.array(z.object({ stageCode: z.string(), stageLabel: z.string(), slaHours: z.number().int().nullable(), inStage: z.number().int(), overdue: z.number().int(), averageHours: z.number().nullable() })),
});
export const admissionsSourcesReportDtoSchema = z.object({ campaignId: admissionsUuidSchema, rows: z.array(z.object({ sourceChannel: z.string(), received: z.number().int(), enrolled: z.number().int() })) });
export const admissionsRejectionsReportDtoSchema = z.object({ campaignId: admissionsUuidSchema, rows: z.array(z.object({ reasonCode: z.string().nullable(), label: z.string().nullable(), count: z.number().int() })) });

// ---------------------------------------------------------------------------
// Formulaire public (sans authentification) — LISTE BLANCHE de champs
// ---------------------------------------------------------------------------

/** Jeton de formulaire : opaque, à usage unique. */
export const admissionsPublicSlugSchema = z.string().regex(/^[a-z0-9]{16,40}$/);

export const admissionsPublicFormDtoSchema = z
  .object({
    institutionName: z.string(),
    grades: z.array(z.object({ code: z.string(), label: z.string() })),
    documents: z.array(z.object({ code: z.string(), label: z.string(), required: z.boolean(), acceptsMime: z.array(z.string()), maxSizeKb: z.number().int() })),
    relationships: z.array(z.object({ code: z.string(), label: z.string() })),
    consent: z.object({ kind: admissionConsentKindSchema, version: z.string(), language: z.string(), body: z.string() }),
    antiSpam: z.object({ minimumFormSeconds: z.number().int(), captchaRequired: z.boolean(), honeypotField: z.string() }),
    formToken: z.string(),
  })
  .strict();
export type AdmissionsPublicFormDto = z.infer<typeof admissionsPublicFormDtoSchema>;

/** Nom du champ leurre : invisible pour une personne, rempli par un robot. */
export const ADMISSIONS_HONEYPOT_FIELD = "website";

export const admissionsPublicSubmitBodySchema = z
  .object({
    formToken: z.string().min(20).max(200),
    [ADMISSIONS_HONEYPOT_FIELD]: z.string().max(200).optional(),
    captchaToken: z.string().max(4000).optional(),
    applicantFirstName: label(ADMISSION_LIMITS.nameMax),
    applicantLastName: label(ADMISSION_LIMITS.nameMax),
    applicantBirthDate: admissionsDateSchema,
    applicantBirthPlace: label(120).optional(),
    applicantGender: admissionGenderSchema.optional(),
    applicantNationality: z.string().trim().length(2).toUpperCase().optional(),
    previousSchool: label(160).optional(),
    previousGradeLevelCode: admissionsGradeCodeSchema.optional(),
    isRepeating: z.boolean().default(false),
    desiredGradeLevelCode: admissionsGradeCodeSchema,
    fundingTypeRequested: admissionFundingTypeSchema.default("PRIVATE"),
    assignmentReference: label(100).optional(),
    guardians: z.array(guardianInputSchema).min(1).max(ADMISSION_LIMITS.guardiansMax),
    /** Texte de consentement accepté : version affichée, par un tuteur habilité (indice dans `guardians`). */
    consent: z.object({ accepted: z.literal(true, { errorMap: () => ({ message: "Le consentement parental est obligatoire." }) }), textVersion: z.string().min(1).max(20), guardianIndex: z.number().int().min(0).max(ADMISSION_LIMITS.guardiansMax - 1) }).strict(),
  })
  .strict();
export type AdmissionsPublicSubmitBody = z.infer<typeof admissionsPublicSubmitBodySchema>;

/** Réponse NEUTRE d'un dépôt : le code de suivi et un message ; rien ne révèle un doublon ni un effectif. */
export const admissionsPublicSubmitResultDtoSchema = z.object({ trackingCode: z.string(), message: z.string() }).strict();
export type AdmissionsPublicSubmitResultDto = z.infer<typeof admissionsPublicSubmitResultDtoSchema>;

export const admissionsPublicTrackBodySchema = z.object({ school: admissionsPublicSlugSchema, trackingCode: z.string().trim().min(8).max(40) }).strict();
export const ADMISSION_PUBLIC_PHASES = ["RECEIVED", "UNDER_REVIEW", "DOCUMENTS_NEEDED", "OFFER_PENDING", "WAITLISTED", "ENROLLMENT_IN_PROGRESS", "ENROLLED", "CLOSED"] as const;
export const admissionsPublicTrackDtoSchema = z
  .object({
    phase: z.enum(ADMISSION_PUBLIC_PHASES),
    phaseLabel: z.string(),
    missingDocuments: z.array(z.object({ requirementId: admissionsUuidSchema, label: z.string(), rejected: z.boolean(), reason: z.string().nullable() })),
    offer: z.object({ expiresAt: admissionsInstantSchema }).nullable(),
    closureLabel: z.string().nullable(),
    updatedAt: admissionsInstantSchema,
  })
  .strict();
export type AdmissionsPublicTrackDto = z.infer<typeof admissionsPublicTrackDtoSchema>;

export const admissionsPublicOfferViewBodySchema = z.object({ school: admissionsPublicSlugSchema, token: z.string().min(20).max(200) }).strict();
export const admissionsPublicOfferViewDtoSchema = z
  .object({ institutionName: z.string(), gradeLabel: z.string(), classroomLabel: z.string().nullable(), expiresAt: admissionsInstantSchema, conditions: z.string().nullable(), status: admissionOfferStatusSchema })
  .strict();
export const admissionsPublicOfferRespondBodySchema = z.object({ school: admissionsPublicSlugSchema, token: z.string().min(20).max(200), accept: z.boolean(), guardianId: admissionsUuidSchema.optional() }).strict();
export const admissionsPublicOfferRespondDtoSchema = z.object({ status: z.enum(["ACCEPTED", "DECLINED"]), message: z.string() }).strict();

// ---------------------------------------------------------------------------
// Vues complémentaires (réponses de l'API du personnel)
// ---------------------------------------------------------------------------

export const admissionsWorkflowViewDtoSchema = admissionsWorkflowDtoSchema.extend({ defects: z.array(admissionsWorkflowDefectSchema) });
export type AdmissionsWorkflowViewDto = z.infer<typeof admissionsWorkflowViewDtoSchema>;

export const admissionsLookupsDtoSchema = z.object({
  institutions: z.array(z.object({ id: admissionsUuidSchema, name: z.string() })),
  gradeLevels: z.array(z.object({ code: z.string(), label: z.string() })),
  relationships: z.array(z.object({ code: z.string(), label: z.string() })),
});
export type AdmissionsLookupsDto = z.infer<typeof admissionsLookupsDtoSchema>;

export const admissionsClassroomDtoSchema = z.object({ id: admissionsUuidSchema, label: z.string(), institutionId: admissionsUuidSchema, academicYearId: admissionsUuidSchema, gradeLevelCode: z.string(), open: z.boolean() });
export const admissionsClassroomListDtoSchema = z.object({ items: z.array(admissionsClassroomDtoSchema) });

export const admissionsInitializeResultDtoSchema = z.object({ workflowId: admissionsUuidSchema, workflowCreated: z.boolean(), reasonsCreated: z.number().int() });
export const admissionsDocumentUrlDtoSchema = z.object({ url: z.string(), expiresAt: admissionsInstantSchema });
export const admissionsDeletedDtoSchema = z.object({ deleted: z.literal(true) });
export const admissionsAnonymizeResultDtoSchema = z.object({ anonymized: z.literal(true), applicationId: admissionsUuidSchema });
export const admissionsCreatedProspectConversionDtoSchema = z.object({ applicationId: admissionsUuidSchema, applicationNumber: z.string() });
export const admissionsDocumentListDtoSchema = z.object({ items: z.array(admissionsApplicationDocumentDtoSchema) });
export const admissionsInterviewListDtoSchema = z.object({ items: z.array(admissionsInterviewDtoSchema) });
export const admissionsDuplicateListDtoSchema = z.object({ items: z.array(admissionsDuplicateDtoSchema) });
export const admissionsProspectListDtoSchema = z.object({ items: z.array(admissionsProspectDtoSchema), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
export const admissionsCampaignListDtoSchema = z.object({ items: z.array(admissionsCampaignDtoSchema) });
export const admissionsWorkflowListDtoSchema = z.object({ items: z.array(admissionsWorkflowSummaryDtoSchema) });
export const admissionsPriorityClassListDtoSchema = z.object({ items: z.array(admissionsPriorityClassDtoSchema) });
export const admissionsDecisionReasonListDtoSchema = z.object({ items: z.array(admissionsDecisionReasonDtoSchema) });
export const admissionsConsentTextListDtoSchema = z.object({ items: z.array(admissionsConsentTextDtoSchema) });
export const admissionsDocumentRequirementListDtoSchema = z.object({ items: z.array(admissionsDocumentRequirementDtoSchema) });
export const admissionsExportDtoSchema = z.object({
  exportedAt: admissionsInstantSchema,
  application: admissionsApplicationDetailDtoSchema,
  history: admissionsHistoryDtoSchema,
  notifications: z.array(z.object({ templateCode: z.string(), channel: z.string(), status: z.string(), queuedAt: admissionsInstantSchema })),
});

// ---------------------------------------------------------------------------
// Événements (payload `{ v: 1, … }`, sans donnée personnelle)
// ---------------------------------------------------------------------------

const appRef = { applicationId: admissionsUuidSchema, campaignId: admissionsUuidSchema, institutionId: admissionsUuidSchema, gradeLevelCode: z.string() };
export const admissionsApplicationSubmittedEventSchema = z.object({ v: z.literal(1), ...appRef, via: admissionCreatedViaSchema });
export const admissionsApplicationStatusChangedEventSchema = z.object({
  v: z.literal(1),
  ...appRef,
  fromStatus: admissionStatusSchema.nullable(),
  toStatus: admissionStatusSchema,
  fromStageId: admissionsUuidSchema.nullable(),
  stageId: admissionsUuidSchema,
  stageCode: z.string(),
});
export const admissionsDecisionRecordedEventSchema = z.object({ v: z.literal(1), ...appRef, decisionId: admissionsUuidSchema, kind: admissionDecisionKindSchema, reasonCode: z.string().nullable() });
export const admissionsOfferEventSchema = z.object({ v: z.literal(1), ...appRef, offerId: admissionsUuidSchema, classroomId: admissionsUuidSchema.nullable() });
export const admissionsApplicationEnrolledEventSchema = z.object({ v: z.literal(1), ...appRef, studentId: admissionsUuidSchema, enrollmentId: admissionsUuidSchema });
export const admissionsWaitlistPromotedEventSchema = z.object({ v: z.literal(1), ...appRef, offerId: admissionsUuidSchema.nullable(), auto: z.boolean() });
export const admissionsWaitlistReorderedEventSchema = z.object({
  v: z.literal(1),
  campaignId: admissionsUuidSchema,
  institutionId: admissionsUuidSchema,
  gradeLevelCode: z.string(),
  count: z.number().int(),
  changed: z.number().int(),
});
export const admissionsProspectConvertedEventSchema = z.object({ v: z.literal(1), prospectId: admissionsUuidSchema, applicationId: admissionsUuidSchema, institutionId: admissionsUuidSchema });
export const admissionsApplicationAnonymizedEventSchema = z.object({ v: z.literal(1), ...appRef });

/**
 * Entretiens et tests d'admission : identifiants, type, instants. AUCUN nom, lieu libre, note ni résultat (l'examinateur est un
 * identifiant de personnel). `scheduledAt` = instant planifié (ISO 8601) ; `previousScheduledAt` seulement pour un report.
 */
export const admissionsInterviewScheduledEventSchema = z.object({
  v: z.literal(1),
  ...appRef,
  interviewId: admissionsUuidSchema,
  kind: admissionInterviewKindSchema,
  scheduledAt: admissionsInstantSchema,
  conductedByStaffId: admissionsUuidSchema.nullable(),
});
export const admissionsInterviewRescheduledEventSchema = admissionsInterviewScheduledEventSchema.extend({ previousScheduledAt: admissionsInstantSchema });
export const admissionsInterviewCancelledEventSchema = admissionsInterviewScheduledEventSchema;

export const admissionsAttachToStudentFileBodySchema = z.object({ categoryId: admissionsUuidSchema }).strict();
export type AdmissionsAttachToStudentFileBody = z.infer<typeof admissionsAttachToStudentFileBodySchema>;
export const admissionsAttachToStudentFileResultDtoSchema = z.object({
  attached: z.number().int().min(0),
  failed: z.number().int().min(0),
  items: z.array(
    z.object({
      requirementId: admissionsUuidSchema,
      outcome: z.enum(["ATTACHED", "ALREADY_PRESENT", "FAILED"]),
      documentRef: admissionsUuidSchema.nullable(),
      /** Code stable de l'échec (jamais un message amont). */
      code: z.string().nullable(),
    }),
  ),
});
export type AdmissionsAttachToStudentFileResultDto = z.infer<typeof admissionsAttachToStudentFileResultDtoSchema>;

export const admissionsEventPayloadSchemas = {
  "admissions.application.submitted": admissionsApplicationSubmittedEventSchema,
  "admissions.application.status_changed": admissionsApplicationStatusChangedEventSchema,
  "admissions.decision.recorded": admissionsDecisionRecordedEventSchema,
  "admissions.offer.issued": admissionsOfferEventSchema,
  "admissions.offer.accepted": admissionsOfferEventSchema,
  "admissions.offer.declined": admissionsOfferEventSchema,
  "admissions.offer.expired": admissionsOfferEventSchema,
  "admissions.offer.withdrawn": admissionsOfferEventSchema,
  "admissions.application.enrolled": admissionsApplicationEnrolledEventSchema,
  "admissions.waitlist.promoted": admissionsWaitlistPromotedEventSchema,
  "admissions.waitlist.reordered": admissionsWaitlistReorderedEventSchema,
  "admissions.prospect.converted": admissionsProspectConvertedEventSchema,
  "admissions.application.anonymized": admissionsApplicationAnonymizedEventSchema,
  "admissions.interview.scheduled": admissionsInterviewScheduledEventSchema,
  "admissions.interview.rescheduled": admissionsInterviewRescheduledEventSchema,
  "admissions.interview.cancelled": admissionsInterviewCancelledEventSchema,
} as const;

// Événements CONSOMMÉS (charge utile minimale lue par les abonnés ; tout champ inconnu est ignoré)
export const admissionsConsumedEnrollmentEventSchema = z.object({ enrollmentId: admissionsUuidSchema, studentId: admissionsUuidSchema.optional(), status: z.string().optional() }).passthrough();
export const admissionsConsumedInstitutionCreatedSchema = z.object({ institutionId: admissionsUuidSchema }).passthrough();
/**
 * Résultat d'examen transmis par `examinations` (Q-E18 : « admis / non admis » ET MOYENNE, CEPE -> admission en 6e). Produit seulement pour
 * les types d'examen qui le demandent ; aucun nom ni date de naissance. `revision` ordonne une correction approuvée après transmission.
 */
export const admissionsConsumedExamResultSchema = z
  .object({
    sessionId: admissionsUuidSchema,
    candidateId: admissionsUuidSchema,
    resultId: admissionsUuidSchema,
    studentId: admissionsUuidSchema,
    institutionId: admissionsUuidSchema,
    // Lecture TOLÉRANTE (convention des charges consommées) : la validité des codes, de l'issue et de la moyenne est contrôlée par le cas
    // d'usage (`recordTransmittedResult`), qui ignore avec un avertissement une charge hors contrat au lieu de la rejouer sans fin.
    examTypeCode: z.string().min(1),
    sessionYear: z.number().int(),
    outcome: z.string().min(1),
    admitted: z.boolean(),
    average: z.string().nullable(),
    revision: z.number().int().min(1),
  })
  .passthrough();
export type AdmissionsConsumedExamResult = z.infer<typeof admissionsConsumedExamResultSchema>;

/** Résultats d'examen d'un dossier. La MOYENNE n'est rendue qu'avec `admission.exam_result.read` (lecture tracée) ; sinon masquée. */
export const admissionsExamResultDtoSchema = z.object({
  id: admissionsUuidSchema,
  examTypeCode: z.string(),
  sessionYear: z.number().int(),
  outcome: z.enum(["ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"]),
  admitted: z.boolean(),
  average: z.string().nullable(),
  /** Une moyenne existe mais l'appelant n'est pas habilité à la lire. */
  averageHidden: z.boolean(),
  /** Lien avec le dossier : l'élève du dossier, ou un rapprochement confirmé par une personne. */
  matchedBy: z.enum(["STUDENT", "CONFIRMED_DUPLICATE"]),
  receivedAt: z.string(),
});
export const admissionsExamResultsDtoSchema = z.object({ canSeeAverage: z.boolean(), items: z.array(admissionsExamResultDtoSchema) });
export type AdmissionsExamResultsDto = z.infer<typeof admissionsExamResultsDtoSchema>;

// ---------------------------------------------------------------------------
// Codes d'erreur stables (liste du contrat ; les déclencheurs SQL lèvent les mêmes codes)
// ---------------------------------------------------------------------------

export const ADMISSIONS_ERROR_CODES = [
  "admissions.invalid_input",
  "admissions.forbidden",
  "admissions.port_unavailable",
  "admissions.not_found",
  "admissions.institution_required",
  "admissions.institution_unknown",
  "admissions.workflow_not_found",
  "admissions.workflow_not_draft",
  "admissions.workflow_initial",
  "admissions.workflow_missing_status",
  "admissions.workflow_enrolled",
  "admissions.workflow_creates_enrollment",
  "admissions.workflow_decision_missing",
  "admissions.workflow_terminal_exit",
  "admissions.workflow_dead_end",
  "admissions.workflow_unreachable",
  "admissions.workflow_enrolled_entry",
  "admissions.workflow_published_immutable",
  "admissions.workflow_conflict",
  "admissions.campaign_workflow_not_published",
  "admissions.campaign_workflow_frozen",
  "admissions.campaign_closed",
  "admissions.campaign_transition",
  "admissions.application_initial_stage",
  "admissions.transition_not_allowed",
  "admissions.consent_missing",
  "admissions.documents_incomplete",
  "admissions.interview_missing",
  "admissions.decision_missing",
  "admissions.decision_stale",
  "admissions.decision_kind_mismatch",
  "admissions.offer_not_accepted",
  "admissions.enrollment_missing",
  "admissions.duplicates_pending",
  "admissions.capacity_full",
  "admissions.capacity_override_reason",
  "admissions.waitlist_full",
  "admissions.waitlist_order_stale",
  "admissions.application_frozen_after_enrollment",
  "admissions.application_anonymized",
  "admissions.application_enrolled_final",
  "admissions.anonymize_forbidden",
  "admissions.offer_expired",
  "admissions.offer_not_pending",
  "admissions.offer_exists",
  "admissions.offer_invalid_token",
  "admissions.applicant_gender_required",
  "admissions.duplicate_application",
  "admissions.permission_denied",
  "admissions.reason_required",
  "admissions.version_conflict",
  "admissions.public_form_closed",
  "admissions.public_rate_limited",
  "admissions.consent_text_missing",
  "admissions.rate_limited",
  "admissions.file_rejected",
] as const;
