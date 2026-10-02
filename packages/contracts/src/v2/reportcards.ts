/**
 * Contrats du module `reportcards` (routes `/api/v1/reportcards/*`, vérification publique, événements
 * `reportcards.*`). Écrits avant les routes (ADR-001 règle 6) ; le web (émission, liste, « Mes bulletins », page de
 * vérification) est typé à partir de ces schémas.
 *
 * Principes (spec 013) :
 *  - un bulletin est un SNAPSHOT IMMUABLE de résultats déjà calculés et clôturés (module `results`) : valeurs
 *    exactes ET d'affichage, version de règle, trace d'explicabilité, branding et signataires RÉSOLUS à l'émission.
 *    Le schéma `reportcard/1` ci-dessous est la forme exacte du JSON haché et signé ;
 *  - NOMBRES : toute valeur décimale (note, coefficient, crédits) est une CHAÎNE décimale (« 12.50 »). Le snapshot ne
 *    contient que chaînes, entiers sûrs, booléens et `null` (jamais de flottant) : la canonisation JSON qui sert au
 *    hash est ainsi identique en TypeScript et en SQL (`reportcards.canonical_json`) ;
 *  - RÉFÉRENCES inter-modules (élève, inscription, classe, période, année) : UUID SANS clé étrangère ;
 *  - DATES calendaires `AAAA-MM-JJ` ; INSTANTS ISO 8601 UTC (`...Z`) ;
 *  - AUCUN libellé d'établissement ni nom de personne par défaut : tout vient des données du tenant ;
 *  - messages utilisateur en français ; codes d'erreur stables `reportcards.*`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const reportcardsUuidSchema = z.string().uuid();

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const reportcardsDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine(isRealDate, "Date inexistante.");
export const reportcardsInstantSchema = z.string().datetime({ offset: true });
/** Nombre décimal exact écrit en chaîne (jamais de flottant dans un snapshot). */
export const reportcardsDecimalSchema = z.string().regex(/^-?\d{1,12}(\.\d{1,6})?$/, "Nombre décimal attendu (ex. 12.50).");
const safeInt = z.number().int().min(-9_007_199_254_740_991).max(9_007_199_254_740_991);
const nonNegInt = safeInt.min(0);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const codeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, "Code attendu : majuscules, chiffres et _ (40 max).");
const label = (max = 200) => z.string().trim().min(1).max(max);
const optText = (max = 200) => z.string().max(max).nullable();

export const REPORTCARDS_DOCUMENT_KINDS = ["REPORT_CARD", "TRANSCRIPT"] as const;
export const reportcardsDocumentKindSchema = z.enum(REPORTCARDS_DOCUMENT_KINDS);
export type ReportcardsDocumentKind = z.infer<typeof reportcardsDocumentKindSchema>;

/** Natures de documents que le registre de gabarits connaît (019 et 032 réutilisent le rendu). */
export const REPORTCARDS_TEMPLATE_DOCUMENT_KINDS = [
  "REPORT_CARD",
  "TRANSCRIPT",
  "DIPLOMA",
  "ATTESTATION_SUCCESS",
  "ATTESTATION_AUTHENTICITY",
  "PAYSLIP",
  "RECEIPT",
] as const;
export const reportcardsTemplateDocumentKindSchema = z.enum(REPORTCARDS_TEMPLATE_DOCUMENT_KINDS);

export const REPORTCARDS_SCOPES = ["PERIOD", "YEAR", "CUMULATIVE"] as const;
export const reportcardsScopeSchema = z.enum(REPORTCARDS_SCOPES);

export const REPORTCARDS_STATUSES = ["ISSUED", "PUBLISHED", "SUPERSEDED", "REVOKED"] as const;
export const reportcardsStatusSchema = z.enum(REPORTCARDS_STATUSES);
export type ReportcardsStatus = z.infer<typeof reportcardsStatusSchema>;

export const REPORTCARDS_RENDER_STATUSES = ["PENDING", "RENDERING", "RENDERED", "FAILED"] as const;
export const reportcardsRenderStatusSchema = z.enum(REPORTCARDS_RENDER_STATUSES);

export const REPORTCARDS_BATCH_STATUSES = ["PENDING", "SNAPSHOTTING", "RENDERING", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"] as const;
export const reportcardsBatchStatusSchema = z.enum(REPORTCARDS_BATCH_STATUSES);

export const REPORTCARDS_PACKS = ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL", "CORE"] as const;
export const reportcardsPackSchema = z.enum(REPORTCARDS_PACKS);

export const REPORTCARDS_BATCH_OUTCOMES = ["ISSUED", "EXCLUDED", "FAILED"] as const;
export const reportcardsBatchOutcomeSchema = z.enum(REPORTCARDS_BATCH_OUTCOMES);

/** Gabarits livrés par la plateforme (modèles génériques ; les modèles officiels s'ajoutent par versions). */
export const REPORTCARDS_BUILTIN_TEMPLATE_KEYS = [
  "primary-bulletin",
  "secondary-bulletin",
  "higher-bulletin-credits",
  "higher-bulletin-coef",
  "transcript-credits",
] as const;
export const reportcardsTemplateKeySchema = z.string().regex(/^[a-z][a-z0-9-]*$/).max(60);

/** Résultat d'une vérification publique. */
export const REPORTCARDS_VERIFICATION_STATUSES = ["AUTHENTIC", "SUPERSEDED", "REVOKED", "INVALID", "UNKNOWN"] as const;
export const reportcardsVerificationStatusSchema = z.enum(REPORTCARDS_VERIFICATION_STATUSES);

/** Code de vérification : 128 bits en base32 (RFC 4648, sans remplissage) = 26 caractères. Opaque et non devinable. */
export const REPORTCARDS_VERIFICATION_CODE_RE = /^[A-Z2-7]{26}$/;
export const reportcardsVerificationCodeSchema = z.string().regex(REPORTCARDS_VERIFICATION_CODE_RE);

// ---------------------------------------------------------------------------
// Snapshot `reportcard/1` (JSON haché, signé et rendu — forme EXACTE)
// ---------------------------------------------------------------------------

export const REPORTCARD_SNAPSHOT_SCHEMA_V1 = "reportcard/1" as const;

export const reportcardSnapshotMetaSchema = z
  .object({
    schema: z.literal(REPORTCARD_SNAPSHOT_SCHEMA_V1),
    kind: reportcardsDocumentKindSchema,
    scope: reportcardsScopeSchema,
    version: z.number().int().min(1),
    provisional: z.boolean(),
    issuedAt: reportcardsInstantSchema,
    issuedBy: z.object({ id: reportcardsUuidSchema.nullable(), name: label(160) }).strict(),
    locale: z.literal("fr"),
    /** Intitulé du document (utilisé par la vérification publique et le titre du PDF). */
    title: label(200),
  })
  .strict();

export const reportcardSnapshotStudentSchema = z
  .object({
    id: reportcardsUuidSchema,
    lastName: label(120),
    firstNames: z.string().max(160),
    matricule: optText(60),
    birthDate: reportcardsDateSchema.nullable(),
    birthPlace: optText(120),
    gender: optText(30),
    nationality: optText(80),
    /** Valeur issue des résultats (module results), pas d'un texte libre. */
    repeating: z.boolean().nullable(),
  })
  .strict();

export const reportcardSnapshotEnrollmentSchema = z
  .object({
    id: reportcardsUuidSchema.nullable(),
    classroomId: reportcardsUuidSchema.nullable(),
    classroomLabel: optText(120),
    levelLabel: optText(120),
    programLabel: optText(160),
    academicYearId: reportcardsUuidSchema.nullable(),
    academicYearLabel: label(60),
    periodId: reportcardsUuidSchema.nullable(),
    periodLabel: optText(120),
    /** Effectif de la classe pour la période. */
    classSize: nonNegInt.nullable(),
  })
  .strict();

export const reportcardSnapshotInstitutionSchema = z
  .object({
    legalName: label(200),
    shortName: optText(60),
    headerLeft: z.array(z.string().max(160)).max(8),
    headerRight: z.array(z.string().max(160)).max(8),
    address: optText(300),
    phone: optText(60),
    email: optText(160),
    website: optText(160),
    registrationRef: optText(120),
    /** Clés d'objets `StoragePort` (jamais d'image dans le snapshot). */
    logoKey: optText(300),
    emblemKey: optText(300),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
    footerText: optText(500),
    brandingVersion: z.number().int().min(1),
  })
  .strict();

export const REPORTCARD_LINE_LEVELS = ["SECTION", "UE", "ECUE", "SUBJECT", "COMPETENCY"] as const;
export const reportcardSnapshotLineSchema = z
  .object({
    level: z.enum(REPORTCARD_LINE_LEVELS),
    code: z.string().min(1).max(64),
    label: label(200),
    parentCode: z.string().max(64).nullable(),
    category: z.string().max(64).nullable(),
    coefficient: reportcardsDecimalSchema.nullable(),
    credits: reportcardsDecimalSchema.nullable(),
    /** Valeur EXACTE (décimale). */
    exact: reportcardsDecimalSchema.nullable(),
    /** Valeur d'AFFICHAGE (arrondie, formatée par les règles — jamais recalculée au rendu). */
    display: z.string().max(40).nullable(),
    /** Valeur d'affichage de « moyenne × coefficient » (si le gabarit l'imprime). */
    weighted: z.string().max(40).nullable(),
    rank: nonNegInt.nullable(),
    rankOf: nonNegInt.nullable(),
    /** Code d'état (VALIDATED, NOT_VALIDATED, RESIT, DEBT…) ; libellé dans `labels`. */
    state: z.string().max(40).nullable(),
    /** Session d'obtention (1 = normale, 2 = rattrapage). */
    session: z.number().int().min(1).max(9).nullable(),
    mention: z.string().max(40).nullable(),
    appreciation: optText(500),
    /** Relevé cumulé : libellé de la période d'origine de la ligne. */
    periodLabel: optText(120),
  })
  .strict();

export const reportcardSnapshotSummarySchema = z
  .object({
    averageExact: reportcardsDecimalSchema.nullable(),
    averageDisplay: z.string().max(40).nullable(),
    rank: nonNegInt.nullable(),
    classSize: nonNegInt.nullable(),
    classAverageDisplay: z.string().max(40).nullable(),
    mention: z.string().max(40).nullable(),
    decisionCode: z.string().max(60).nullable(),
    decisionOutcome: z.string().max(40).nullable(),
    creditsAcquired: reportcardsDecimalSchema.nullable(),
    creditsRequired: reportcardsDecimalSchema.nullable(),
    totalCoefficient: reportcardsDecimalSchema.nullable(),
    weightedTotal: z.string().max(40).nullable(),
    distinctions: z.array(z.string().max(120)).max(10),
  })
  .strict();

/** Bilan annuel / de cycle quand il existe (ex. rappel S1, S2, moyenne annuelle). */
export const reportcardSnapshotAnnualSchema = z
  .object({
    rows: z.array(z.object({ label: label(120), display: z.string().max(40).nullable(), weight: z.string().max(20).nullable() }).strict()).max(12),
    averageDisplay: z.string().max(40).nullable(),
    rank: nonNegInt.nullable(),
    classSize: nonNegInt.nullable(),
    decisionCode: z.string().max(60).nullable(),
  })
  .strict();

export const reportcardSnapshotAttendanceSchema = z
  .object({
    justifiedMinutes: nonNegInt,
    unjustifiedMinutes: nonNegInt,
    lateCount: nonNegInt,
  })
  .strict();

export const reportcardSnapshotDeliberationSchema = z
  .object({
    /** Date RÉELLE du conseil / jury (jamais la date d'impression). */
    heldOn: reportcardsDateSchema,
    nature: z.enum(["COUNCIL", "JURY"]),
  })
  .strict();

export const reportcardSnapshotSignatorySchema = z
  .object({
    slot: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
    slotLabel: label(80),
    name: label(160),
    title: optText(160),
    jobFunction: optText(300),
    signatureKey: optText(300),
  })
  .strict();

export const reportcardSnapshotRulesSchema = z
  .object({
    ruleSetCode: label(80),
    ruleVersionNo: z.number().int().min(1),
    ruleVersionId: reportcardsUuidSchema,
    definitionHash: hex64,
    contractId: label(80),
    engineVersion: label(40),
    resultsStateId: reportcardsUuidSchema,
    resultsVersion: z.number().int().min(1),
    closureHash: hex64,
  })
  .strict();

export const reportcardSnapshotTemplateSchema = z
  .object({
    key: reportcardsTemplateKeySchema,
    version: z.number().int().min(1),
    configVersion: z.number().int().min(1),
    options: z.record(z.union([z.string(), safeInt, z.boolean(), z.array(z.string()), z.null()])),
  })
  .strict();

export const reportcardSnapshotSchema = z
  .object({
    meta: reportcardSnapshotMetaSchema,
    student: reportcardSnapshotStudentSchema,
    enrollment: reportcardSnapshotEnrollmentSchema,
    institution: reportcardSnapshotInstitutionSchema,
    results: z
      .object({
        lines: z.array(reportcardSnapshotLineSchema).max(1500),
        summary: reportcardSnapshotSummarySchema,
        annual: reportcardSnapshotAnnualSchema.nullable(),
      })
      .strict(),
    attendance: reportcardSnapshotAttendanceSchema.nullable(),
    deliberation: reportcardSnapshotDeliberationSchema.nullable(),
    appreciations: z.object({ general: optText(1000) }).strict(),
    signatories: z.array(reportcardSnapshotSignatorySchema).max(8),
    rules: reportcardSnapshotRulesSchema,
    template: reportcardSnapshotTemplateSchema,
    /** Table code → libellé (mentions, décisions, états) extraite du `label_map` de la version de règle. */
    labels: z.record(z.string().max(200)),
  })
  .strict();
export type ReportcardSnapshot = z.infer<typeof reportcardSnapshotSchema>;
export type ReportcardSnapshotLine = z.infer<typeof reportcardSnapshotLineSchema>;

/** Trace d'explicabilité de chaque ligne `FINAL` (couverte par le hash). Que des chaînes, entiers, booléens, null. */
const explainScalar = z.union([z.string().max(500), safeInt, z.boolean(), z.null()]);
export const reportcardExplainEntrySchema = z
  .object({
    lineCode: z.string().min(1).max(64),
    rules: z
      .array(
        z
          .object({
            key: z.string().min(1).max(80),
            position: nonNegInt,
            inputs: z.record(explainScalar),
            output: explainScalar,
          })
          .strict(),
      )
      .max(60),
  })
  .strict();
export const reportcardExplainSchema = z.array(reportcardExplainEntrySchema).max(1500);
export type ReportcardExplain = z.infer<typeof reportcardExplainSchema>;

// ---------------------------------------------------------------------------
// Identité (branding), signataires, gabarits
// ---------------------------------------------------------------------------

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur attendue au format #RRGGBB.");
const lines = z.array(z.string().trim().min(1).max(160)).max(8);

export const reportcardsPutBrandingBodySchema = z
  .object({
    institutionId: reportcardsUuidSchema.nullish(),
    legalName: label(200),
    shortName: z.string().trim().max(60).nullish(),
    headerLeft: lines.default([]),
    headerRight: lines.default([]),
    address: z.string().trim().max(300).nullish(),
    phone: z.string().trim().max(60).nullish(),
    email: z.string().trim().max(160).nullish(),
    website: z.string().trim().max(160).nullish(),
    registrationRef: z.string().trim().max(120).nullish(),
    logoObjectKey: z.string().max(300).nullish(),
    emblemObjectKey: z.string().max(300).nullish(),
    primaryColor: hexColor.nullish(),
    secondaryColor: hexColor.nullish(),
    footerText: z.string().trim().max(500).nullish(),
  })
  .strict();

export const reportcardsBrandingDtoSchema = z.object({
  id: reportcardsUuidSchema,
  institutionId: reportcardsUuidSchema.nullable(),
  version: z.number().int().min(1),
  isCurrent: z.boolean(),
  legalName: z.string(),
  shortName: z.string().nullable(),
  headerLeft: z.array(z.string()),
  headerRight: z.array(z.string()),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  registrationRef: z.string().nullable(),
  logoObjectKey: z.string().nullable(),
  emblemObjectKey: z.string().nullable(),
  primaryColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  footerText: z.string().nullable(),
  createdAt: reportcardsInstantSchema,
});

export const reportcardsCreateSignatoryBodySchema = z
  .object({
    institutionId: reportcardsUuidSchema.nullish(),
    fullName: z.string().trim().min(2).max(160),
    title: z.string().trim().max(160).nullish(),
    jobFunction: z.string().trim().max(300).nullish(),
    signatureObjectKey: z.string().max(300).nullish(),
    staffId: reportcardsUuidSchema.nullish(),
    validFrom: reportcardsDateSchema.nullish(),
    validTo: reportcardsDateSchema.nullish(),
  })
  .strict();
export const reportcardsPatchSignatoryBodySchema = reportcardsCreateSignatoryBodySchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict();

export const reportcardsSignatoryDtoSchema = z.object({
  id: reportcardsUuidSchema,
  institutionId: reportcardsUuidSchema.nullable(),
  fullName: z.string(),
  title: z.string().nullable(),
  jobFunction: z.string().nullable(),
  signatureObjectKey: z.string().nullable(),
  staffId: reportcardsUuidSchema.nullable(),
  active: z.boolean(),
  validFrom: reportcardsDateSchema.nullable(),
  validTo: reportcardsDateSchema.nullable(),
  createdAt: reportcardsInstantSchema,
  updatedAt: reportcardsInstantSchema,
});

/** Dépôt d'une image (logo, emblème, signature) par URL signée : le client téléverse directement dans le stockage. */
export const reportcardsAssetUploadBodySchema = z
  .object({ kind: z.enum(["logo", "emblem", "signature"]), contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]) })
  .strict();
export const reportcardsAssetUploadDtoSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string(),
  method: z.literal("PUT"),
  headers: z.record(z.string()),
  expiresAt: reportcardsInstantSchema,
  maxBytes: z.number().int(),
});
export const reportcardsKeyParamsSchema = z.object({ keyId: z.string().regex(/^[a-z0-9-]{6,40}$/) });

export const reportcardsSignatureSlotSchema = z.object({
  slot: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
  label: label(80),
  required: z.boolean(),
});

export const reportcardsTemplateDtoSchema = z.object({
  key: reportcardsTemplateKeySchema,
  version: z.number().int().min(1),
  documentKind: reportcardsTemplateDocumentKindSchema,
  pack: reportcardsPackSchema,
  snapshotSchema: z.string(),
  title: z.string(),
  optionsSchema: z.record(z.unknown()),
  signatureSlots: z.array(reportcardsSignatureSlotSchema),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  contentHash: hex64.nullable(),
  publishedAt: reportcardsInstantSchema.nullable(),
});

/** Corps d'un gabarit plateforme (super-admin) : validé à la publication (liste noire de balises / URLs). */
export const reportcardsPublishPlatformTemplateBodySchema = z
  .object({
    key: reportcardsTemplateKeySchema,
    documentKind: reportcardsTemplateDocumentKindSchema,
    pack: reportcardsPackSchema,
    title: label(160),
    body: z.string().min(1).max(200_000),
    css: z.string().max(100_000).default(""),
    optionsSchema: z.record(z.unknown()).default({ type: "object", properties: {}, additionalProperties: false }),
    signatureSlots: z.array(reportcardsSignatureSlotSchema).max(8).default([]),
    snapshotSchema: z.literal(REPORTCARD_SNAPSHOT_SCHEMA_V1).default(REPORTCARD_SNAPSHOT_SCHEMA_V1),
  })
  .strict();

export const reportcardsPutTemplateConfigBodySchema = z
  .object({
    institutionId: reportcardsUuidSchema.nullish(),
    documentKind: reportcardsDocumentKindSchema,
    pack: reportcardsPackSchema,
    templateKey: reportcardsTemplateKeySchema,
    /** Absent = dernière version publiée du gabarit. */
    templateVersion: z.number().int().min(1).optional(),
    options: z.record(z.unknown()).default({}),
    signatureAssignments: z.array(z.object({ slot: z.string(), signatoryId: reportcardsUuidSchema }).strict()).max(8).default([]),
  })
  .strict();

export const reportcardsTemplateConfigDtoSchema = z.object({
  id: reportcardsUuidSchema,
  institutionId: reportcardsUuidSchema.nullable(),
  documentKind: reportcardsDocumentKindSchema,
  pack: reportcardsPackSchema,
  templateKey: z.string(),
  templateVersion: z.number().int(),
  configVersion: z.number().int(),
  isCurrent: z.boolean(),
  options: z.record(z.unknown()),
  signatureAssignments: z.array(z.object({ slot: z.string(), signatoryId: reportcardsUuidSchema })),
  createdAt: reportcardsInstantSchema,
});

export const reportcardsTemplateConfigQuerySchema = z.object({
  institutionId: reportcardsUuidSchema.optional(),
  documentKind: reportcardsDocumentKindSchema.optional(),
  history: z.coerce.boolean().optional(),
});

export const reportcardsPreviewBodySchema = z
  .object({
    documentKind: reportcardsDocumentKindSchema,
    pack: reportcardsPackSchema,
    institutionId: reportcardsUuidSchema.nullish(),
    /** Configuration à prévisualiser sans l'enregistrer (défaut : la configuration courante). */
    templateKey: reportcardsTemplateKeySchema.optional(),
    templateVersion: z.number().int().min(1).optional(),
    options: z.record(z.unknown()).optional(),
    /** `true` : rend aussi un PDF (si le moteur de rendu est disponible dans ce processus). */
    pdf: z.boolean().default(false),
  })
  .strict();

export const reportcardsPreviewDtoSchema = z.object({
  html: z.string(),
  pdfBase64: z.string().nullable(),
  templateKey: z.string(),
  templateVersion: z.number().int(),
});

export const reportcardsSettingsBodySchema = z
  .object({
    blockIfUnpaid: z.boolean().optional(),
    requireDeliberation: z.boolean().optional(),
    /** Politique de vérification publique (Q-31) : `false` = statut, nature, établissement, intitulé, date seulement. */
    verificationShowsMention: z.boolean().optional(),
  })
  .strict();
export const reportcardsSettingsDtoSchema = z.object({
  blockIfUnpaid: z.boolean(),
  requireDeliberation: z.boolean(),
  verificationShowsMention: z.boolean(),
  updatedAt: reportcardsInstantSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Émission : contrôle préalable, lots, bulletins
// ---------------------------------------------------------------------------

export const reportcardsPreflightQuerySchema = z.object({
  classroomId: reportcardsUuidSchema,
  academicPeriodId: reportcardsUuidSchema,
  kind: reportcardsDocumentKindSchema.default("REPORT_CARD"),
  provisional: z.coerce.boolean().default(false),
});

export const reportcardsPreflightIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  blocking: z.boolean(),
  /** Lien de correction (route web). */
  fixHref: z.string().nullable(),
});
export const reportcardsPreflightDtoSchema = z.object({
  ok: z.boolean(),
  issues: z.array(reportcardsPreflightIssueSchema),
  resultsVersion: z.number().int().nullable(),
  enrollments: z.object({ total: z.number().int(), eligible: z.number().int(), excluded: z.number().int() }),
});

export const reportcardsCreateBatchBodySchema = z
  .object({
    classroomId: reportcardsUuidSchema,
    academicPeriodId: reportcardsUuidSchema,
    kind: reportcardsDocumentKindSchema.default("REPORT_CARD"),
    enrollmentIds: z.array(reportcardsUuidSchema).min(1).max(2000).optional(),
    provisional: z.boolean().default(false),
    /** Si fourni : les bulletins dont les résultats ont changé sont réémis (nouvelle version) avec ce motif. */
    reissueReason: z.string().trim().min(5).max(500).optional(),
    /** Défaut : dérivée de (classe, période, nature, version des résultats, provisoire). */
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .strict();

export const reportcardsBatchItemDtoSchema = z.object({
  enrollmentId: reportcardsUuidSchema,
  outcome: reportcardsBatchOutcomeSchema,
  reasonCode: z.string().nullable(),
  message: z.string().nullable(),
  reportCardId: reportcardsUuidSchema.nullable(),
});
export const reportcardsBatchDtoSchema = z.object({
  id: reportcardsUuidSchema,
  documentKind: reportcardsDocumentKindSchema,
  classroomId: reportcardsUuidSchema,
  academicPeriodId: reportcardsUuidSchema.nullable(),
  resultsVersion: z.number().int(),
  provisional: z.boolean(),
  status: reportcardsBatchStatusSchema,
  total: z.number().int(),
  issued: z.number().int(),
  excluded: z.number().int(),
  failed: z.number().int(),
  rendered: z.number().int(),
  combinedPdfReady: z.boolean(),
  requestedAt: reportcardsInstantSchema,
  finishedAt: reportcardsInstantSchema.nullable(),
  items: z.array(reportcardsBatchItemDtoSchema).optional(),
});

export const reportcardsListQuerySchema = z.object({
  classroomId: reportcardsUuidSchema.optional(),
  academicPeriodId: reportcardsUuidSchema.optional(),
  studentId: reportcardsUuidSchema.optional(),
  status: reportcardsStatusSchema.optional(),
  kind: reportcardsDocumentKindSchema.optional(),
  /** Seulement la dernière version non remplacée. */
  live: z.coerce.boolean().optional(),
  needsReissue: z.coerce.boolean().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const reportcardsReportCardDtoSchema = z.object({
  id: reportcardsUuidSchema,
  documentKind: reportcardsDocumentKindSchema,
  scope: reportcardsScopeSchema,
  studentId: reportcardsUuidSchema,
  enrollmentId: reportcardsUuidSchema.nullable(),
  classroomId: reportcardsUuidSchema.nullable(),
  academicYearId: reportcardsUuidSchema.nullable(),
  academicPeriodId: reportcardsUuidSchema.nullable(),
  version: z.number().int(),
  status: reportcardsStatusSchema,
  provisional: z.boolean(),
  title: z.string(),
  studentName: z.string(),
  snapshotHash: hex64,
  verificationCode: reportcardsVerificationCodeSchema,
  signingKeyId: z.string(),
  issuedAt: reportcardsInstantSchema,
  publishedAt: reportcardsInstantSchema.nullable(),
  withdrawnAt: reportcardsInstantSchema.nullable(),
  supersededAt: reportcardsInstantSchema.nullable(),
  supersedesId: reportcardsUuidSchema.nullable(),
  revokedAt: reportcardsInstantSchema.nullable(),
  renderStatus: reportcardsRenderStatusSchema,
  resultsVersion: z.number().int(),
  templateKey: z.string(),
  templateVersion: z.number().int(),
  needsReissue: z.boolean().nullable(),
});
export const reportcardsReportCardPageDtoSchema = z.object({
  items: z.array(reportcardsReportCardDtoSchema),
  nextCursor: z.string().nullable(),
});

/** Détail : snapshot SANS la trace (route `explain` à part). */
export const reportcardsReportCardDetailDtoSchema = reportcardsReportCardDtoSchema.extend({
  snapshot: reportcardSnapshotSchema,
  renders: z.array(
    z.object({
      id: reportcardsUuidSchema,
      status: reportcardsRenderStatusSchema,
      pdfHash: hex64.nullable(),
      sizeBytes: z.number().int().nullable(),
      pages: z.number().int().nullable(),
      attempts: z.number().int(),
      error: z.string().nullable(),
      requestedAt: reportcardsInstantSchema,
      finishedAt: reportcardsInstantSchema.nullable(),
    }),
  ),
});
export const reportcardsExplainDtoSchema = z.object({
  reportCardId: reportcardsUuidSchema,
  snapshotHash: hex64,
  explain: reportcardExplainSchema,
});

export const reportcardsIdParamsSchema = z.object({ id: reportcardsUuidSchema });
export const reportcardsChildParamsSchema = z.object({ studentId: reportcardsUuidSchema });
export const reportcardsClassPeriodParamsSchema = z.object({ id: reportcardsUuidSchema, pid: reportcardsUuidSchema });
export const reportcardsReasonBodySchema = z.object({ reason: z.string().trim().min(5, "Le motif doit faire au moins 5 caractères.").max(500) }).strict();
export const reportcardsReissueBodySchema = reportcardsReasonBodySchema;
export const reportcardsPublishBatchBodySchema = z
  .object({ reportCardIds: z.array(reportcardsUuidSchema).min(1).max(2000).optional(), batchId: reportcardsUuidSchema.optional() })
  .strict()
  .refine((b) => b.reportCardIds !== undefined || b.batchId !== undefined, "Fournissez reportCardIds ou batchId.");
export const reportcardsPublishResultDtoSchema = z.object({
  published: z.number().int(),
  alreadyPublished: z.number().int(),
  skipped: z.array(z.object({ reportCardId: reportcardsUuidSchema, reason: z.string() })),
});

export const reportcardsCreateTranscriptBodySchema = z
  .object({
    studentId: reportcardsUuidSchema,
    /** Années ou périodes couvertes (au moins une) ; sinon tout l'historique FINAL de l'élève. */
    academicYearIds: z.array(reportcardsUuidSchema).max(12).optional(),
  })
  .strict();

export const reportcardsDownloadDtoSchema = z.object({
  url: z.string().url().or(z.string().startsWith("memory://")),
  expiresAt: reportcardsInstantSchema,
  fileName: z.string(),
  contentType: z.literal("application/pdf"),
  sizeBytes: z.number().int().nullable(),
  pdfHash: hex64.nullable(),
});

export const reportcardsFamilyListQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

// ---------------------------------------------------------------------------
// Vérification publique (sans authentification)
// ---------------------------------------------------------------------------

/**
 * Réponse publique : AUCUNE note, AUCUNE date de naissance, AUCUNE adresse, AUCUN nom d'élève. `mention` n'apparaît que si
 * le tenant l'a explicitement activée (Q-31). Un code inexistant ou mal formé reçoit EXACTEMENT la même réponse.
 */
export const reportcardsPublicVerificationDtoSchema = z.object({
  status: reportcardsVerificationStatusSchema,
  documentKind: reportcardsTemplateDocumentKindSchema.nullable(),
  institutionName: z.string().nullable(),
  title: z.string().nullable(),
  issuedAt: reportcardsInstantSchema.nullable(),
  mention: z.string().nullable(),
  /** `SUPERSEDED` : date d'émission de la version plus récente (sans son contenu). */
  supersededByIssuedAt: reportcardsInstantSchema.nullable(),
  revokedAt: reportcardsInstantSchema.nullable(),
  keyId: z.string().nullable(),
  /** Empreinte SHA-256 de la clé publique (hex) : permet de vérifier la signature hors ligne. */
  keyFingerprint: hex64.nullable(),
  /** Hash du snapshot signé et signature (base64) : suffisants pour une vérification hors ligne avec la clé publique. */
  snapshotHash: hex64.nullable(),
  signature: z.string().nullable(),
  message: z.string(),
});

export const reportcardsPublicVerifyParamsSchema = z.object({ code: z.string().max(64) });

export const reportcardsFileVerificationDtoSchema = z.object({
  match: z.boolean(),
  status: reportcardsVerificationStatusSchema.nullable(),
  institutionName: z.string().nullable(),
  title: z.string().nullable(),
  issuedAt: reportcardsInstantSchema.nullable(),
  message: z.string(),
});

export const reportcardsPublicKeysDtoSchema = z.object({
  keys: z.array(
    z.object({
      keyId: z.string(),
      algorithm: z.literal("Ed25519"),
      /** Clé publique SPKI DER en base64. */
      publicKey: z.string(),
      fingerprint: hex64,
      status: z.enum(["ACTIVE", "RETIRED"]),
      createdAt: reportcardsInstantSchema,
      retiredAt: reportcardsInstantSchema.nullable(),
    }),
  ),
  /** Format du message signé, pour la vérification hors ligne. */
  signedMessage: z.literal("ed-rc/v1 NUL snapshot_hash NUL verification_code NUL issued_at(ISO UTC)"),
});

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

const v1 = z.literal(1);
export const reportcardsEventPayloadSchemas = {
  /** Remplace `reportcards.report_card.issued` de la spec : déclenche le rendu PDF dans le worker. */
  "reportcards.snapshot.created": z
    .object({
      v: v1,
      reportCardId: reportcardsUuidSchema,
      enrollmentId: reportcardsUuidSchema.nullable(),
      studentId: reportcardsUuidSchema,
      periodId: reportcardsUuidSchema.nullable(),
      kind: reportcardsDocumentKindSchema,
      version: z.number().int().min(1),
      snapshotHash: hex64,
      batchId: reportcardsUuidSchema.nullable(),
      provisional: z.boolean(),
    })
    .strict(),
  "reportcards.report_card.render_requested": z.object({ v: v1, reportCardId: reportcardsUuidSchema }).strict(),
  "reportcards.report_card.rendered": z
    .object({ v: v1, reportCardId: reportcardsUuidSchema, renderId: reportcardsUuidSchema, pdfHash: hex64, sizeBytes: z.number().int().min(1), batchId: reportcardsUuidSchema.nullable() })
    .strict(),
  "reportcards.report_card.render_failed": z
    .object({ v: v1, reportCardId: reportcardsUuidSchema, renderId: reportcardsUuidSchema, error: z.string().max(500), batchId: reportcardsUuidSchema.nullable() })
    .strict(),
  "reportcards.report_card.published": z.object({ v: v1, reportCardId: reportcardsUuidSchema, studentId: reportcardsUuidSchema, version: z.number().int().min(1) }).strict(),
  "reportcards.report_card.withdrawn": z.object({ v: v1, reportCardId: reportcardsUuidSchema, studentId: reportcardsUuidSchema, version: z.number().int().min(1) }).strict(),
  "reportcards.report_card.superseded": z
    .object({ v: v1, reportCardId: reportcardsUuidSchema, newReportCardId: reportcardsUuidSchema, studentId: reportcardsUuidSchema, reason: z.string() })
    .strict(),
  "reportcards.report_card.revoked": z.object({ v: v1, reportCardId: reportcardsUuidSchema, studentId: reportcardsUuidSchema, reason: z.string() }).strict(),
  "reportcards.batch.completed": z
    .object({ v: v1, batchId: reportcardsUuidSchema, issued: z.number().int(), excluded: z.number().int(), failed: z.number().int() })
    .strict(),
  "reportcards.integrity.mismatch": z.object({ v: v1, reportCardId: reportcardsUuidSchema, expectedHash: hex64, actualHash: hex64, reason: z.enum(["HASH", "SIGNATURE"]) }).strict(),
  // Documents officiels d'autres modules (reçu de paiement, bulletin de paie) : scellés puis rendus dans le worker.
  "reportcards.official_document.render_requested": z.object({ v: v1, documentId: reportcardsUuidSchema, documentKind: z.enum(["RECEIPT", "PAYSLIP"]), sourceId: reportcardsUuidSchema }).strict(),
  "reportcards.official_document.rendered": z
    .object({ v: v1, documentId: reportcardsUuidSchema, documentKind: z.enum(["RECEIPT", "PAYSLIP"]), sourceId: reportcardsUuidSchema, pdfHash: hex64, sizeBytes: z.number().int().min(1) })
    .strict(),
  "reportcards.official_document.render_failed": z
    .object({ v: v1, documentId: reportcardsUuidSchema, documentKind: z.enum(["RECEIPT", "PAYSLIP"]), sourceId: reportcardsUuidSchema, error: z.string().max(500) })
    .strict(),
} as const;
export type ReportcardsEventType = keyof typeof reportcardsEventPayloadSchemas;
