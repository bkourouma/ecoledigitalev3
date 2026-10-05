/**
 * Contrats du module `examinations` (routes `/api/v1/examinations/*`, événements `examinations.*`) — spec v2/018-examinations :
 * moteur d'examens générique (CEPE, BEPC, BAC, BTS = DONNÉES), sessions à définition figée, candidats, éligibilité par règle,
 * numéro de candidat sans trou, centres et répartition, examens blancs calculés par règle, résultats officiels IMPORTÉS ou
 * SAISIS (jamais calculés), révisions à quatre yeux, statistiques, exports paramétrables, documents scellés.
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID. Élève, inscription, classe, évaluation `assess`, établissement : références SANS clé étrangère
 *    vérifiées par les ports du module.
 *  - NOMBRES EXACTS (coefficient, barème, note, moyenne, total) : CHAÎNES décimales (`"14.5"`), jamais de flottant.
 *  - DATES calendaires `AAAA-MM-JJ` ; INSTANTS ISO 8601 avec fuseau.
 *  - AUCUNE note, moyenne ni identité d'élève dans un événement. Messages utilisateur en français ; codes d'erreur stables
 *    `examinations.*` (`EXAMINATIONS_ERROR_CODES`).
 *  - Les formats d'export et d'import ne citent que des champs d'une LISTE BLANCHE (aucune expression libre).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const examUuidSchema = z.string().uuid();
export const examDateSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date attendue au format AAAA-MM-JJ.");
export const examInstantSchema = z.string().datetime({ offset: true });
/** Décimal exact positif : jusqu'à 6 chiffres entiers et 3 décimales. */
export const examDecimalSchema = z.string().regex(/^\d{1,6}(\.\d{1,3})?$/, "Nombre décimal attendu (ex. 14.5).");

export const EXAM_SOURCE_KINDS = ["regulation", "institution", "platform", "placeholder"] as const;
export const examSourceKindSchema = z.enum(EXAM_SOURCE_KINDS);
export type ExamSourceKind = z.infer<typeof examSourceKindSchema>;

export const EXAM_SESSION_KINDS = ["OFFICIAL", "MOCK"] as const;
export const examSessionKindSchema = z.enum(EXAM_SESSION_KINDS);
export type ExamSessionKind = z.infer<typeof examSessionKindSchema>;

export const EXAM_ATTEMPT_KINDS = ["NORMAL", "MAKEUP"] as const;
export const examAttemptKindSchema = z.enum(EXAM_ATTEMPT_KINDS);

export const EXAM_SESSION_STATUSES = ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "IN_PROGRESS", "RESULTS_ENTERED", "PUBLISHED", "ARCHIVED"] as const;
export const examSessionStatusSchema = z.enum(EXAM_SESSION_STATUSES);
export type ExamSessionStatus = z.infer<typeof examSessionStatusSchema>;

export const EXAM_REGISTRATION_STATUSES = ["DRAFT", "PRE_REGISTERED", "REGISTERED", "WITHDRAWN"] as const;
export const examRegistrationStatusSchema = z.enum(EXAM_REGISTRATION_STATUSES);
export type ExamRegistrationStatus = z.infer<typeof examRegistrationStatusSchema>;

export const EXAM_ELIGIBILITY_STATUSES = ["NOT_EVALUATED", "ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"] as const;
export const examEligibilityStatusSchema = z.enum(EXAM_ELIGIBILITY_STATUSES);
export type ExamEligibilityStatus = z.infer<typeof examEligibilityStatusSchema>;

export const EXAM_OUTCOMES = ["PENDING", "ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"] as const;
export const examOutcomeSchema = z.enum(EXAM_OUTCOMES);
export type ExamOutcome = z.infer<typeof examOutcomeSchema>;

export const EXAM_RESULT_CODES = ["ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"] as const;
export const examResultCodeSchema = z.enum(EXAM_RESULT_CODES);
export type ExamResultCode = z.infer<typeof examResultCodeSchema>;

export const EXAM_SCORE_STATUSES = ["ENTERED", "ABSENT", "EXCUSED", "MALPRACTICE"] as const;
export const examScoreStatusSchema = z.enum(EXAM_SCORE_STATUSES);
export type ExamScoreStatus = z.infer<typeof examScoreStatusSchema>;

export const EXAM_PIECE_STATUSES = ["MISSING", "SUBMITTED", "ACCEPTED", "REJECTED"] as const;
export const examPieceStatusSchema = z.enum(EXAM_PIECE_STATUSES);

export const EXAM_DOCUMENT_KINDS = ["CONVOCATION", "ATTESTATION_REUSSITE", "RELEVE_NOTES"] as const;
export const examDocumentKindSchema = z.enum(EXAM_DOCUMENT_KINDS);
export type ExamDocumentKind = z.infer<typeof examDocumentKindSchema>;

export const EXAM_BATCH_KINDS = ["OFFICIAL_NUMBERS", "SCORES", "RESULTS"] as const;
export const examBatchKindSchema = z.enum(EXAM_BATCH_KINDS);
export type ExamBatchKind = z.infer<typeof examBatchKindSchema>;

export const EXAM_EXPORT_KINDS = ["CANDIDATE_LIST", "CENTER_ASSIGNMENTS", "RESULTS", "STATISTICS"] as const;
export const examExportKindSchema = z.enum(EXAM_EXPORT_KINDS);
export type ExamExportKind = z.infer<typeof examExportKindSchema>;

export const EXAM_FILE_FORMATS = ["CSV", "XLSX", "FIXED_WIDTH", "JSON"] as const;
export const examFileFormatSchema = z.enum(EXAM_FILE_FORMATS);
export const EXAM_ENCODINGS = ["UTF-8", "ISO-8859-1", "WINDOWS-1252"] as const;
export const examEncodingSchema = z.enum(EXAM_ENCODINGS);
export const EXAM_DELIMITERS = [",", ";", "\t", "|"] as const;
export const examDelimiterSchema = z.enum(EXAM_DELIMITERS);
export const EXAM_FORMAT_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export const examFormatStatusSchema = z.enum(EXAM_FORMAT_STATUSES);

export const EXAM_COUNT_GROUPS = ["ALL", "INSTITUTION", "TRACK", "SEX", "GRADE"] as const;
export const examCountGroupSchema = z.enum(EXAM_COUNT_GROUPS);
export type ExamCountGroup = z.infer<typeof examCountGroupSchema>;

/** Liste blanche des champs sources d'une colonne d'export (identique à `examinations.valid_export_columns`). */
export const EXAM_EXPORT_SOURCES = [
  "candidate.number",
  "candidate.official_number",
  "candidate.last_name",
  "candidate.first_name",
  "candidate.birth_date",
  "candidate.birth_place",
  "candidate.sex",
  "candidate.track",
  "candidate.grade_level",
  "candidate.institution",
  "candidate.status",
  "candidate.identifier.cepe_code",
  "candidate.identifier.national_id",
  "assignment.center_code",
  "assignment.center_name",
  "assignment.room_code",
  "assignment.seat_number",
  "assignment.table_number",
  "result.code",
  "result.average",
  "result.rank",
  "result.mention",
  "result.total_points",
  "paper.score",
  "stat.group",
  "stat.registered",
  "stat.present",
  "stat.admitted",
  "stat.failed",
  "stat.absent",
  "stat.excluded",
  "stat.deferred",
  "stat.rate",
  "constant",
] as const;
export const EXAM_EXPORT_TRANSFORMS = ["none", "upper", "lower", "date_iso", "date_dmy", "sex_fm", "decimal_comma", "pad_left_8"] as const;
export const EXAM_IMPORT_TARGETS = [
  "key.candidate_number",
  "key.official_number",
  "key.cepe_code",
  "key.national_id",
  "identifier.official_number",
  "result.code",
  "result.average",
  "result.rank",
  "result.mention",
  "result.total_points",
  "paper.score",
  "paper.status",
] as const;

const codeOf = (pattern: RegExp) => z.string().regex(pattern);
export const examCodeSchema = codeOf(/^[A-Z][A-Z0-9_]{1,19}$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

// ---------------------------------------------------------------------------
// Types d'examens et données de référence
// ---------------------------------------------------------------------------

export const examCreateTypeBodySchema = z
  .object({
    code: examCodeSchema,
    label: text(200),
    educationLevelCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/),
    gradeLevelCode: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/).nullable().optional(),
    resultContractId: z.string().regex(/^[a-z][a-z0-9-]*@[0-9]+$/).optional(),
    candidateNumberPattern: z.string().min(3).max(60).optional(),
    sourceKind: examSourceKindSchema.default("institution"),
    sourceReference: optText(500),
  })
  .strict();
export type ExamCreateTypeBody = z.infer<typeof examCreateTypeBodySchema>;

export const examUpdateTypeBodySchema = z
  .object({
    label: text(200).optional(),
    gradeLevelCode: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/).nullable().optional(),
    candidateNumberPattern: z.string().min(3).max(60).optional(),
    sourceReference: optText(500),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .strict();

export const examCreateTrackBodySchema = z
  .object({ code: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,19}$/), label: text(200), sourceKind: examSourceKindSchema.default("institution") })
  .strict();
export const examUpdateTrackBodySchema = z.object({ label: text(200).optional(), active: z.boolean().optional() }).strict();

export const examCreatePaperBodySchema = z
  .object({
    trackCode: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,19}$/).nullable().optional(),
    code: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,29}$/),
    label: text(200),
    coefficient: examDecimalSchema.refine((v) => Number(v) > 0, "Le coefficient doit être strictement positif."),
    scaleMax: examDecimalSchema.refine((v) => Number(v) > 0, "Le barème doit être strictement positif."),
    isOptional: z.boolean().default(false),
    ordinal: z.number().int().min(1).max(999),
    sourceKind: examSourceKindSchema.default("institution"),
  })
  .strict();
export const examUpdatePaperBodySchema = z
  .object({
    label: text(200).optional(),
    coefficient: examDecimalSchema.refine((v) => Number(v) > 0).optional(),
    scaleMax: examDecimalSchema.refine((v) => Number(v) > 0).optional(),
    isOptional: z.boolean().optional(),
    ordinal: z.number().int().min(1).max(999).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const examCreateRequirementBodySchema = z
  .object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), label: text(200), required: z.boolean().default(true), sortOrder: z.number().int().min(0).max(999).default(0), sourceKind: examSourceKindSchema.default("institution") })
  .strict();
export const examUpdateRequirementBodySchema = z.object({ label: text(200).optional(), required: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional(), active: z.boolean().optional() }).strict();

/** Modèles de pack disponibles : pour l'instant le pack du primaire (CEPE FICTIF). */
export const EXAM_PACK_TEMPLATES = ["PRIMARY"] as const;
export const examInstantiatePackBodySchema = z.object({ pack: z.enum(EXAM_PACK_TEMPLATES) }).strict();

// ---------------------------------------------------------------------------
// Centres, salles
// ---------------------------------------------------------------------------

export const examCreateCenterBodySchema = z
  .object({ code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/), name: text(200), kind: z.enum(["OWN", "HOST"]), authorityCode: optText(60), locality: optText(120) })
  .strict();
export const examUpdateCenterBodySchema = z.object({ name: text(200).optional(), authorityCode: optText(60), locality: optText(120), status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).strict();
export const examCreateRoomBodySchema = z.object({ code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,19}$/), label: optText(120), capacity: z.number().int().min(1).max(5000) }).strict();
export const examUpdateRoomBodySchema = z.object({ label: optText(120), capacity: z.number().int().min(1).max(5000).optional(), active: z.boolean().optional() }).strict();

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const examCreateSessionBodySchema = z
  .object({
    examTypeId: examUuidSchema,
    institutionId: examUuidSchema,
    academicYearId: examUuidSchema.nullable().optional(),
    code: z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/),
    label: text(200),
    sessionKind: examSessionKindSchema.default("OFFICIAL"),
    attemptKind: examAttemptKindSchema.default("NORMAL"),
    sessionYear: z.number().int().min(2000).max(2200),
    mockOfSessionId: examUuidSchema.nullable().optional(),
    registrationOpensOn: examDateSchema.nullable().optional(),
    registrationClosesOn: examDateSchema.nullable().optional(),
    startsOn: examDateSchema.nullable().optional(),
    endsOn: examDateSchema.nullable().optional(),
    sourceKind: examSourceKindSchema.optional(),
  })
  .strict();
export type ExamCreateSessionBody = z.infer<typeof examCreateSessionBodySchema>;

export const examUpdateSessionBodySchema = z
  .object({
    label: text(200).optional(),
    academicYearId: examUuidSchema.nullable().optional(),
    attemptKind: examAttemptKindSchema.optional(),
    registrationOpensOn: examDateSchema.nullable().optional(),
    registrationClosesOn: examDateSchema.nullable().optional(),
    startsOn: examDateSchema.nullable().optional(),
    endsOn: examDateSchema.nullable().optional(),
  })
  .strict();

export const examSessionListQuerySchema = z
  .object({
    status: examSessionStatusSchema.optional(),
    sessionKind: examSessionKindSchema.optional(),
    examTypeId: examUuidSchema.optional(),
    institutionId: examUuidSchema.optional(),
    sessionYear: z.coerce.number().int().min(2000).max(2200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const examTransitionBodySchema = z.object({ to: examSessionStatusSchema }).strict();

// ---------------------------------------------------------------------------
// Candidats
// ---------------------------------------------------------------------------

export const examCreateCandidateBodySchema = z
  .object({ studentId: examUuidSchema, enrollmentId: examUuidSchema, trackCode: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,19}$/).nullable().optional() })
  .strict();
export const examFromClassroomBodySchema = z.object({ classroomId: examUuidSchema, trackCode: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,19}$/).nullable().optional() }).strict();
export const examUpdateCandidateBodySchema = z.object({ trackCode: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,19}$/).nullable() }).strict();
export const examWithdrawBodySchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export const examRegisterBatchBodySchema = z.object({ candidateIds: z.array(examUuidSchema).min(1).max(1000) }).strict();

export const examCandidateListQuerySchema = z
  .object({
    registrationStatus: examRegistrationStatusSchema.optional(),
    eligibilityStatus: examEligibilityStatusSchema.optional(),
    outcome: examOutcomeSchema.optional(),
    trackCode: z.string().optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
  })
  .strict();

/** Évaluer l'éligibilité : par la RÈGLE (`EVALUATE`), saisie manuelle avec auteur si AUCUNE règle n'est épinglée (`MANUAL`), ou dérogation motivée (`OVERRIDE`). */
export const examEligibilityBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("EVALUATE") }).strict(),
  z.object({ mode: z.literal("MANUAL"), result: z.enum(["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"]), reasons: z.array(z.string().trim().min(1).max(60)).max(20).default([]) }).strict(),
  z.object({ mode: z.literal("OVERRIDE"), reason: z.string().trim().min(10).max(500) }).strict(),
]);
export type ExamEligibilityBody = z.infer<typeof examEligibilityBodySchema>;

export const examPieceActionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SUBMIT"), documentRef: examUuidSchema }).strict(),
  /** Candidat LIBRE seulement (Q-E15) : pièce présentée et vue sur place (aucun document de la GED d'un élève) ; reste à relire. */
  z.object({ action: z.literal("SIGHT"), note: z.string().trim().min(1).max(300).optional() }).strict(),
  z.object({ action: z.literal("ACCEPT") }).strict(),
  z.object({ action: z.literal("REJECT"), rejectionReason: z.string().trim().min(3).max(500) }).strict(),
]);
export type ExamPieceActionBody = z.infer<typeof examPieceActionBodySchema>;

// --- Candidat libre (Q-E15) : identité saisie ou importée, sans dossier élève ---------------------------------------------------

const phoneSchema = z.string().trim().min(4).max(40).regex(/^[0-9+()\-. ]+$/, "Numéro de téléphone invalide.");
const emailSchema = z.string().trim().min(3).max(200).email();
const personNameSchema = z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f]+$/, "Caractères de contrôle interdits.");

/** Identité figée à l'inscription : nom, prénoms, naissance, sexe (comme l'état civil d'un élève). */
export const examExternalIdentitySchema = z
  .object({
    lastName: personNameSchema,
    firstName: personNameSchema,
    birthDate: examDateSchema,
    birthPlace: z.string().trim().min(1).max(120).nullable().optional(),
    sex: z.enum(["F", "M"]),
  })
  .strict();

/** Données restreintes du candidat libre + faits d'éligibilité fournis par saisie (la règle les consomme telles quelles). */
export const examExternalProfileInputSchema = z
  .object({
    contactPhone: phoneSchema.nullable().optional(),
    contactEmail: emailSchema.nullable().optional(),
    addressLine: z.string().trim().min(1).max(300).nullable().optional(),
    idPieceKind: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).nullable().optional(),
    idPieceNumber: z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001f]+$/).nullable().optional(),
    guardianName: personNameSchema.nullable().optional(),
    guardianRelation: z.string().trim().min(1).max(60).nullable().optional(),
    guardianPhone: phoneSchema.nullable().optional(),
    guardianEmail: emailSchema.nullable().optional(),
    /** L'établissement ne connaît pas sa scolarité : « est-il dans la classe d'examen ? » est une déclaration. */
    declaredInExamGrade: z.boolean(),
    declaredPriorAttempts: z.number().int().min(0).max(50).default(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Boolean(v.idPieceKind) !== Boolean(v.idPieceNumber)) ctx.addIssue({ code: "custom", path: ["idPieceNumber"], message: "Type et numéro de la pièce d'identité vont ensemble." });
    if (!v.contactPhone && !v.contactEmail && !v.guardianPhone && !v.guardianEmail) ctx.addIssue({ code: "custom", path: ["contactPhone"], message: "Au moins un moyen de contact (candidat ou tuteur) est requis." });
  });

export const examCreateExternalCandidateBodySchema = z
  .object({ identity: examExternalIdentitySchema, profile: examExternalProfileInputSchema, trackCode: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,19}$/).nullable().optional() })
  .strict();
/** Import (saisie en lot, p. ex. d'un fichier de l'autorité ou de l'établissement) : une transaction par ligne, un refus n'annule pas les autres. */
export const examExternalBatchBodySchema = z
  .object({ source: z.enum(["ENTERED", "IMPORTED"]).default("IMPORTED"), items: z.array(examCreateExternalCandidateBodySchema).min(1).max(500) })
  .strict();
export const examUpdateExternalCandidateBodySchema = z
  .object({ identity: examExternalIdentitySchema.optional(), profile: examExternalProfileInputSchema })
  .strict();
export const examAnonymizeBodySchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();

export const examIdentifierBodySchema = z
  .object({ kind: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), value: z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001f]+$/, "Caractères de contrôle interdits.") })
  .strict();

// ---------------------------------------------------------------------------
// Centres de la session et répartition
// ---------------------------------------------------------------------------

export const examSessionCentersBodySchema = z.object({ centerIds: z.array(examUuidSchema).max(200) }).strict();
export const examAutoAssignBodySchema = z.object({ centerIds: z.array(examUuidSchema).max(200).optional(), reassign: z.boolean().default(false) }).strict();
export const examAssignBodySchema = z
  .object({ centerId: examUuidSchema, roomId: examUuidSchema, seatNumber: z.number().int().min(1).max(5000).optional(), tableNumber: optText(30) })
  .strict();

// ---------------------------------------------------------------------------
// Notes, résultats
// ---------------------------------------------------------------------------

export const examScoreItemSchema = z
  .object({ candidateId: examUuidSchema, paperId: examUuidSchema, status: examScoreStatusSchema.default("ENTERED"), score: examDecimalSchema.nullable().optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === "ENTERED" && (v.score === null || v.score === undefined)) ctx.addIssue({ code: "custom", path: ["score"], message: "Une note saisie porte une valeur." });
    if (v.status !== "ENTERED" && v.score !== null && v.score !== undefined) ctx.addIssue({ code: "custom", path: ["score"], message: "Une absence ou une fraude n'a pas de valeur." });
  });
export const examBulkScoresBodySchema = z.object({ items: z.array(examScoreItemSchema).min(1).max(2000) }).strict();
export type ExamBulkScoresBody = z.infer<typeof examBulkScoresBodySchema>;

export const examResultItemSchema = z
  .object({
    candidateId: examUuidSchema,
    resultCode: examResultCodeSchema,
    average: z.string().regex(/^\d{1,4}(\.\d{1,3})?$/).nullable().optional(),
    totalPoints: z.string().regex(/^\d{1,6}(\.\d{1,3})?$/).nullable().optional(),
    rank: z.number().int().min(1).max(1_000_000).nullable().optional(),
    mentionCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (["ABSENT", "EXCLUDED", "DEFERRED"].includes(v.resultCode) && (v.average != null || v.rank != null || v.mentionCode != null)) {
      ctx.addIssue({ code: "custom", path: ["resultCode"], message: "Un absent, exclu ou ajourné n'a ni moyenne, ni rang, ni mention." });
    }
  });
export const examBulkResultsBodySchema = z.object({ items: z.array(examResultItemSchema).min(1).max(2000) }).strict();
export type ExamBulkResultsBody = z.infer<typeof examBulkResultsBodySchema>;

export const examResultListQuerySchema = z
  .object({ resultCode: examResultCodeSchema.optional(), status: z.enum(["DRAFT", "PUBLISHED"]).optional(), q: z.string().trim().min(1).max(100).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(50) })
  .strict();

// ---------------------------------------------------------------------------
// Révisions (quatre yeux)
// ---------------------------------------------------------------------------

export const examResultRevisionBodySchema = z
  .object({
    resultCode: examResultCodeSchema,
    average: z.string().regex(/^\d{1,4}(\.\d{1,3})?$/).nullable().optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export const examScoreRevisionBodySchema = z
  .object({ status: examScoreStatusSchema, score: examDecimalSchema.nullable().optional(), reason: z.string().trim().min(10).max(500) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === "ENTERED" && (v.score === null || v.score === undefined)) ctx.addIssue({ code: "custom", path: ["score"], message: "Une note saisie porte une valeur." });
    if (v.status !== "ENTERED" && v.score != null) ctx.addIssue({ code: "custom", path: ["score"], message: "Une absence n'a pas de valeur." });
  });
export const examRejectRevisionBodySchema = z.object({ note: z.string().trim().min(5).max(500) }).strict();
export const examRevisionListQuerySchema = z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).strict();

// ---------------------------------------------------------------------------
// Examens blancs
// ---------------------------------------------------------------------------

export const examMockLinkBodySchema = z.object({ paperId: examUuidSchema, classroomId: examUuidSchema, assessmentId: examUuidSchema }).strict();

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export const examCreateImportBodySchema = z
  .object({
    kind: examBatchKindSchema,
    formatId: examUuidSchema,
    fileName: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f/\\]+$/, "Nom de fichier invalide."),
    /** Contenu du fichier en base64 (5 Mio au plus après décodage). */
    contentBase64: z.string().min(1).max(7_200_000),
  })
  .strict();
export type ExamCreateImportBody = z.infer<typeof examCreateImportBodySchema>;
export const examImportRowsQuerySchema = z.object({ status: z.enum(["OK", "ERROR", "SKIPPED"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100) }).strict();

const examExportColumnSchema = z
  .object({
    header: z.string().trim().min(1).max(80),
    source: z.enum(EXAM_EXPORT_SOURCES),
    transform: z.enum(EXAM_EXPORT_TRANSFORMS).optional(),
    paper: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,29}$/).optional(),
    width: z.number().int().min(1).max(500).optional(),
    value: z.string().max(200).optional(),
  })
  .strict();
export type ExamExportColumnDto = z.infer<typeof examExportColumnSchema>;

export const examCreateExportFormatBodySchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    label: text(200),
    examTypeId: examUuidSchema.nullable().optional(),
    kind: examExportKindSchema,
    fileFormat: examFileFormatSchema,
    encoding: examEncodingSchema.default("UTF-8"),
    delimiter: examDelimiterSchema.nullable().optional(),
    columns: z.array(examExportColumnSchema).min(1).max(60),
    sourceKind: examSourceKindSchema.default("institution"),
    sourceReference: optText(500),
  })
  .strict();
export type ExamCreateExportFormatBody = z.infer<typeof examCreateExportFormatBodySchema>;
export const examUpdateExportFormatBodySchema = examCreateExportFormatBodySchema.omit({ code: true }).partial().strict();

const examImportColumnSchema = z
  .object({ header: z.string().trim().min(1).max(80), target: z.enum(EXAM_IMPORT_TARGETS), paper: z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,29}$/).optional() })
  .strict();
export const examCreateImportFormatBodySchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    label: text(200),
    examTypeId: examUuidSchema.nullable().optional(),
    kind: examBatchKindSchema,
    encoding: examEncodingSchema.default("UTF-8"),
    delimiter: examDelimiterSchema.default(";"),
    decimalSeparator: z.enum([".", ","]).default("."),
    hasHeader: z.boolean().default(true),
    columns: z.array(examImportColumnSchema).min(2).max(60),
    valueMap: z.record(z.enum(["result.code", "paper.status"]), z.record(z.string().max(60), z.string().max(40))).default({}),
    sourceKind: examSourceKindSchema.default("institution"),
    sourceReference: optText(500),
  })
  .strict();
export type ExamCreateImportFormatBody = z.infer<typeof examCreateImportFormatBodySchema>;
export const examUpdateImportFormatBodySchema = examCreateImportFormatBodySchema.omit({ code: true }).partial().strict();

export const examRunExportBodySchema = z
  .object({ formatId: examUuidSchema, filters: z.object({ trackCode: z.string().optional(), registrationStatus: examRegistrationStatusSchema.optional(), groupBy: examCountGroupSchema.optional() }).strict().default({}) })
  .strict();

// ---------------------------------------------------------------------------
// Statistiques, documents
// ---------------------------------------------------------------------------

export const examStatisticsQuerySchema = z.object({ groupBy: examCountGroupSchema.default("ALL"), compare: z.enum(["previous_year", "mock"]).optional() }).strict();

export const examIssueDocumentBodySchema = z.object({ kind: examDocumentKindSchema }).strict();
export const examIssueBatchBodySchema = z.object({ kind: examDocumentKindSchema, candidateIds: z.array(examUuidSchema).min(1).max(1000).optional() }).strict();
export const examRevokeDocumentBodySchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
export const examIssuedDocumentListQuerySchema = z.object({ kind: examDocumentKindSchema.optional(), status: z.enum(["REQUESTED", "ISSUED", "REVOKED"]).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100) }).strict();

// ---------------------------------------------------------------------------
// Réponses (schémas lus et validés par le client typé du web)
// ---------------------------------------------------------------------------

const decStr = z.string();
const nullableStr = z.string().nullable();

export const examPageSchema = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
export interface ExamPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export const examItemsSchema = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

export const examTypeDtoSchema = z.object({
  id: examUuidSchema,
  code: z.string(),
  label: z.string(),
  educationLevelCode: z.string(),
  gradeLevelCode: nullableStr,
  resultContractId: z.string(),
  candidateNumberPattern: z.string(),
  sourceKind: examSourceKindSchema,
  sourceReference: nullableStr,
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  /** Vrai si les données du type sont des valeurs FICTIVES de démonstration (bandeau « Règles de démonstration »). */
  placeholder: z.boolean(),
});
export type ExamTypeDto = z.infer<typeof examTypeDtoSchema>;
export const examTrackDtoSchema = z.object({ id: examUuidSchema, code: z.string(), label: z.string(), sourceKind: examSourceKindSchema, active: z.boolean() });
export type ExamTrackDto = z.infer<typeof examTrackDtoSchema>;
export const examPaperDtoSchema = z.object({
  id: examUuidSchema,
  trackCode: nullableStr,
  code: z.string(),
  label: z.string(),
  coefficient: decStr,
  scaleMax: decStr,
  isOptional: z.boolean(),
  ordinal: z.number().int(),
  sourceKind: examSourceKindSchema,
  active: z.boolean(),
});
export type ExamPaperDto = z.infer<typeof examPaperDtoSchema>;
export const examRequirementDtoSchema = z.object({ id: examUuidSchema, code: z.string(), label: z.string(), required: z.boolean(), sortOrder: z.number().int(), sourceKind: examSourceKindSchema, active: z.boolean() });
export type ExamRequirementDto = z.infer<typeof examRequirementDtoSchema>;
export const examTypeDetailDtoSchema = examTypeDtoSchema.extend({ tracks: z.array(examTrackDtoSchema), papers: z.array(examPaperDtoSchema), requirements: z.array(examRequirementDtoSchema) });
export type ExamTypeDetailDto = z.infer<typeof examTypeDetailDtoSchema>;

export const examRoomDtoSchema = z.object({ id: examUuidSchema, centerId: examUuidSchema, code: z.string(), label: nullableStr, capacity: z.number().int(), active: z.boolean() });
export type ExamRoomDto = z.infer<typeof examRoomDtoSchema>;
export const examCenterDtoSchema = z.object({
  id: examUuidSchema,
  code: z.string(),
  name: z.string(),
  kind: z.enum(["OWN", "HOST"]),
  authorityCode: nullableStr,
  locality: nullableStr,
  status: z.enum(["ACTIVE", "INACTIVE"]),
  rooms: z.array(examRoomDtoSchema).optional(),
});
export type ExamCenterDto = z.infer<typeof examCenterDtoSchema>;

export const examSessionProgressDtoSchema = z.object({ index: z.number().int(), total: z.number().int(), percent: z.number().int(), next: examSessionStatusSchema.nullable(), allowedNext: z.array(examSessionStatusSchema) });
export type ExamSessionProgressDto = z.infer<typeof examSessionProgressDtoSchema>;
export const examSessionDtoSchema = z.object({
  id: examUuidSchema,
  examTypeId: examUuidSchema,
  examTypeCode: z.string(),
  examTypeLabel: z.string(),
  institutionId: examUuidSchema,
  academicYearId: examUuidSchema.nullable(),
  code: z.string(),
  label: z.string(),
  sessionKind: examSessionKindSchema,
  attemptKind: examAttemptKindSchema,
  sessionYear: z.number().int(),
  mockOfSessionId: examUuidSchema.nullable(),
  registrationOpensOn: nullableStr,
  registrationClosesOn: nullableStr,
  startsOn: nullableStr,
  endsOn: nullableStr,
  status: examSessionStatusSchema,
  definitionLockedAt: nullableStr,
  ruleVersionRef: examUuidSchema.nullable(),
  sourceKind: examSourceKindSchema,
  /** Règles ou données de DÉMONSTRATION en usage : le client affiche le bandeau et le filigrane. */
  demoRules: z.boolean(),
  progress: examSessionProgressDtoSchema,
  createdAt: z.string(),
});
export type ExamSessionDto = z.infer<typeof examSessionDtoSchema>;
export const examSessionCountsDtoSchema = z.object({ candidates: z.number().int(), registered: z.number().int(), withdrawn: z.number().int(), eligible: z.number().int(), withResult: z.number().int(), published: z.number().int(), assigned: z.number().int() });
export type ExamSessionCountsDto = z.infer<typeof examSessionCountsDtoSchema>;
export const examSessionDetailDtoSchema = examSessionDtoSchema.extend({
  tracks: z.array(z.object({ id: examUuidSchema, code: z.string(), label: z.string() })),
  papers: z.array(z.object({ id: examUuidSchema, trackCode: nullableStr, code: z.string(), label: z.string(), coefficient: decStr, scaleMax: decStr, isOptional: z.boolean(), ordinal: z.number().int(), sourceKind: examSourceKindSchema })),
  counts: examSessionCountsDtoSchema,
  /** Raisons qui bloquent chaque transition possible (vide = aucune raison connue ; la base reste juge). */
  blockers: z.record(z.array(z.string())),
});
export type ExamSessionDetailDto = z.infer<typeof examSessionDetailDtoSchema>;

export const examCandidateDtoSchema = z.object({
  id: examUuidSchema,
  sessionId: examUuidSchema,
  /** `null` pour un candidat LIBRE (sans dossier élève, Q-E15). */
  studentId: examUuidSchema.nullable(),
  candidateKind: z.enum(["STUDENT", "EXTERNAL"]).default("STUDENT"),
  /** Identité du candidat libre anonymisée (droit à l'effacement) : nom neutre, année de naissance seule. */
  anonymized: z.boolean().default(false),
  enrollmentId: examUuidSchema.nullable(),
  gradeLevelCode: nullableStr,
  trackCode: nullableStr,
  lastName: nullableStr,
  firstName: nullableStr,
  birthDate: nullableStr,
  birthPlace: nullableStr,
  sex: z.enum(["F", "M"]).nullable(),
  registrationStatus: examRegistrationStatusSchema,
  eligibilityStatus: examEligibilityStatusSchema,
  outcome: examOutcomeSchema,
  candidateNumber: nullableStr,
  officialNumber: nullableStr,
  registeredAt: nullableStr,
  withdrawnReason: nullableStr,
  /** Codes des pièces obligatoires non acceptées (vide = dossier complet). */
  missingPieces: z.array(z.string()),
  /** Nom d'affichage tiré de l'état civil figé, sinon de l'annuaire (jamais enregistré hors du candidat). */
  displayName: nullableStr,
  rowVersion: z.number().int(),
});
export type ExamCandidateDto = z.infer<typeof examCandidateDtoSchema>;
/** Profil RESTREINT d'un candidat libre (permission `exam.external.read`, lecture auditée). */
export const examExternalProfileDtoSchema = z.object({
  candidateId: examUuidSchema,
  contactPhone: nullableStr,
  contactEmail: nullableStr,
  addressLine: nullableStr,
  idPieceKind: nullableStr,
  idPieceNumber: nullableStr,
  guardianName: nullableStr,
  guardianRelation: nullableStr,
  guardianPhone: nullableStr,
  guardianEmail: nullableStr,
  declaredInExamGrade: z.boolean(),
  declaredPriorAttempts: z.number().int(),
  dataSource: z.enum(["ENTERED", "IMPORTED"]),
  anonymizedAt: nullableStr,
});
export type ExamExternalProfileDto = z.infer<typeof examExternalProfileDtoSchema>;
export const examExternalBatchReportSchema = z.object({
  created: z.array(z.object({ index: z.number().int(), candidateId: examUuidSchema })),
  failed: z.array(z.object({ index: z.number().int(), code: z.string(), message: z.string() })),
});
export const examEligibilityCheckDtoSchema = z.object({
  id: examUuidSchema,
  result: z.enum(["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"]),
  reasons: z.array(z.string()),
  ruleVersionRef: examUuidSchema.nullable(),
  evaluatedBy: examUuidSchema.nullable(),
  evaluatedAt: z.string(),
  overridden: z.boolean(),
  overrideReason: nullableStr,
});
export type ExamEligibilityCheckDto = z.infer<typeof examEligibilityCheckDtoSchema>;
export const examPieceDtoSchema = z.object({ requirementId: examUuidSchema, code: z.string(), label: z.string(), required: z.boolean(), status: examPieceStatusSchema, documentRef: examUuidSchema.nullable(), presentationKind: z.enum(["DOCUMENT", "SIGHTED"]).default("DOCUMENT"), sightedNote: nullableStr.default(null), rejectionReason: nullableStr, reviewedAt: nullableStr });
export type ExamPieceDto = z.infer<typeof examPieceDtoSchema>;
export const examPiecesDtoSchema = z.object({ pieces: z.array(examPieceDtoSchema), missing: z.array(z.string()) });
export const examIdentifierDtoSchema = z.object({ id: examUuidSchema, kind: z.string(), value: z.string(), source: z.enum(["MANUAL", "IMPORT", "MIGRATION"]) });
export type ExamIdentifierDto = z.infer<typeof examIdentifierDtoSchema>;
export const examAssignmentDtoSchema = z.object({
  candidateId: examUuidSchema,
  candidateNumber: nullableStr,
  displayName: nullableStr,
  centerId: examUuidSchema,
  centerCode: z.string(),
  centerName: z.string(),
  roomId: examUuidSchema,
  roomCode: z.string(),
  seatNumber: z.number().int(),
  tableNumber: nullableStr,
});
export type ExamAssignmentDto = z.infer<typeof examAssignmentDtoSchema>;
export const examHistoryDtoSchema = z.object({ id: examUuidSchema, kind: z.string(), fromValue: nullableStr, toValue: nullableStr, reason: nullableStr, actorId: examUuidSchema.nullable(), occurredAt: z.string() });
export type ExamHistoryDto = z.infer<typeof examHistoryDtoSchema>;
export const examScoreDtoSchema = z.object({ id: examUuidSchema, candidateId: examUuidSchema, paperId: examUuidSchema, status: examScoreStatusSchema, score: nullableStr, source: z.enum(["MANUAL", "IMPORT", "ASSESS"]) });
export type ExamScoreDto = z.infer<typeof examScoreDtoSchema>;
export const examResultDtoSchema = z.object({
  id: examUuidSchema,
  sessionId: examUuidSchema,
  candidateId: examUuidSchema,
  candidateNumber: nullableStr,
  displayName: nullableStr,
  resultCode: examResultCodeSchema,
  average: nullableStr,
  totalPoints: nullableStr,
  rank: z.number().int().nullable(),
  mentionCode: nullableStr,
  source: z.enum(["IMPORTED", "ENTERED", "COMPUTED"]),
  ruleVersionRef: examUuidSchema.nullable(),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  publishedAt: nullableStr,
});
export type ExamResultDto = z.infer<typeof examResultDtoSchema>;
export const examIssuedDocumentDtoSchema = z.object({
  id: examUuidSchema,
  sessionId: examUuidSchema,
  candidateId: examUuidSchema,
  candidateNumber: nullableStr,
  kind: examDocumentKindSchema,
  version: z.number().int(),
  status: z.enum(["REQUESTED", "ISSUED", "REVOKED"]),
  officialDocumentId: examUuidSchema.nullable(),
  issuedAt: nullableStr,
  revokedReason: nullableStr,
  createdAt: z.string(),
});
export type ExamIssuedDocumentDto = z.infer<typeof examIssuedDocumentDtoSchema>;
export const examCandidateDetailDtoSchema = z.object({
  candidate: examCandidateDtoSchema,
  eligibilityChecks: z.array(examEligibilityCheckDtoSchema),
  pieces: z.array(examPieceDtoSchema),
  identifiers: z.array(examIdentifierDtoSchema),
  assignment: examAssignmentDtoSchema.nullable(),
  history: z.array(examHistoryDtoSchema),
  scores: z.array(examScoreDtoSchema),
  result: examResultDtoSchema.nullable(),
  documents: z.array(examIssuedDocumentDtoSchema),
});
export type ExamCandidateDetailDto = z.infer<typeof examCandidateDetailDtoSchema>;

export const examBatchDtoSchema = z.object({
  id: examUuidSchema,
  sessionId: examUuidSchema,
  kind: examBatchKindSchema,
  fileName: z.string(),
  sha256: z.string(),
  formatCode: nullableStr,
  rowCount: z.number().int(),
  okCount: z.number().int(),
  errorCount: z.number().int(),
  status: z.enum(["UPLOADED", "VALIDATED", "APPLIED", "REJECTED"]),
  uploadedBy: examUuidSchema,
  appliedAt: nullableStr,
  createdAt: z.string(),
});
export type ExamBatchDto = z.infer<typeof examBatchDtoSchema>;
export const examImportRowDtoSchema = z.object({ id: examUuidSchema, lineNo: z.number().int(), status: z.enum(["OK", "ERROR", "SKIPPED"]), errorCode: nullableStr, candidateNumber: nullableStr, payload: z.record(z.unknown()) });
export type ExamImportRowDto = z.infer<typeof examImportRowDtoSchema>;
export const examBatchDetailDtoSchema = z.object({ batch: examBatchDtoSchema, rows: examPageSchema(examImportRowDtoSchema) });
export const examValidateReportDtoSchema = z.object({ batch: examBatchDtoSchema, fileError: nullableStr, ignoredHeaders: z.array(z.string()), errorsByCode: z.record(z.number().int()) });
export type ExamValidateReportDto = z.infer<typeof examValidateReportDtoSchema>;
export const examImportFormatDtoSchema = z.object({
  id: examUuidSchema,
  code: z.string(),
  version: z.number().int(),
  label: z.string(),
  examTypeId: examUuidSchema.nullable(),
  kind: examBatchKindSchema,
  encoding: z.string(),
  delimiter: z.string(),
  decimalSeparator: z.enum([".", ","]),
  hasHeader: z.boolean(),
  columns: z.array(z.object({ header: z.string(), target: z.string(), paper: z.string().optional() })),
  valueMap: z.record(z.record(z.string())),
  status: examFormatStatusSchema,
  sourceKind: examSourceKindSchema,
  sourceReference: nullableStr,
  placeholder: z.boolean(),
});
export type ExamImportFormatDto = z.infer<typeof examImportFormatDtoSchema>;
export const examExportColumnDtoSchema = z.object({ header: z.string(), source: z.string(), transform: z.string().optional(), paper: z.string().optional(), width: z.number().int().optional(), value: z.string().optional() });
export const examExportFormatDtoSchema = z.object({
  id: examUuidSchema,
  code: z.string(),
  version: z.number().int(),
  label: z.string(),
  examTypeId: examUuidSchema.nullable(),
  kind: examExportKindSchema,
  fileFormat: examFileFormatSchema,
  encoding: z.string(),
  delimiter: nullableStr,
  columns: z.array(examExportColumnDtoSchema),
  status: examFormatStatusSchema,
  sourceKind: examSourceKindSchema,
  sourceReference: nullableStr,
  placeholder: z.boolean(),
});
export type ExamExportFormatDto = z.infer<typeof examExportFormatDtoSchema>;
export const examExportRunDtoSchema = z.object({
  id: examUuidSchema,
  sessionId: examUuidSchema,
  formatId: examUuidSchema,
  formatCode: nullableStr,
  formatVersion: z.number().int(),
  status: z.enum(["RUNNING", "DONE", "FAILED"]),
  rowCount: z.number().int().nullable(),
  fileSha256: nullableStr,
  errorCode: nullableStr,
  requestedBy: examUuidSchema,
  createdAt: z.string(),
  completedAt: nullableStr,
});
export type ExamExportRunDto = z.infer<typeof examExportRunDtoSchema>;
export const examExportDownloadDtoSchema = z.object({ url: z.string(), expiresAt: z.string(), fileName: z.string(), contentType: z.string(), sha256: z.string(), rowCount: z.number().int() });

export const examRevisionRequestDtoSchema = z.object({
  id: examUuidSchema,
  sessionId: examUuidSchema,
  targetKind: z.enum(["SCORE", "RESULT"]),
  scoreId: examUuidSchema.nullable(),
  resultId: examUuidSchema.nullable(),
  candidateId: examUuidSchema.nullable(),
  candidateNumber: nullableStr,
  proposed: z.record(z.unknown()),
  current: z.record(z.unknown()),
  reason: z.string(),
  requestedBy: examUuidSchema,
  requestedAt: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  decidedBy: examUuidSchema.nullable(),
  decidedAt: nullableStr,
  decisionNote: nullableStr,
});
export type ExamRevisionRequestDto = z.infer<typeof examRevisionRequestDtoSchema>;

export const examStatisticsGroupDtoSchema = z.object({
  groupKey: z.string(),
  registered: z.number().int(),
  present: z.number().int(),
  admitted: z.number().int(),
  failed: z.number().int(),
  absent: z.number().int(),
  excluded: z.number().int(),
  deferred: z.number().int(),
  /** Taux calculé PAR LA RÈGLE `taux_reussite` (décimal exact), `null` si indisponible. */
  rate: nullableStr,
});
export type ExamStatisticsGroupDto = z.infer<typeof examStatisticsGroupDtoSchema>;
export const examStatisticsDtoSchema = z.object({
  sessionId: examUuidSchema,
  groupBy: examCountGroupSchema,
  groups: z.array(examStatisticsGroupDtoSchema),
  total: examStatisticsGroupDtoSchema,
  rateAvailable: z.boolean(),
  /** Explication quand le taux n'est pas calculé (aucune règle épinglée, règle indisponible). */
  rateNote: nullableStr,
  demoRules: z.boolean(),
  compare: z.object({ label: z.string(), sessionId: examUuidSchema, groups: z.array(examStatisticsGroupDtoSchema), total: examStatisticsGroupDtoSchema }).nullable().optional(),
});
export type ExamStatisticsDto = z.infer<typeof examStatisticsDtoSchema>;

export const examLinkDtoSchema = z.object({ id: examUuidSchema, paperId: examUuidSchema, paperCode: z.string(), classroomId: examUuidSchema, assessmentId: examUuidSchema, linkedAt: z.string() });
export type ExamLinkDto = z.infer<typeof examLinkDtoSchema>;

export const examFamilyExamDtoSchema = z.object({
  candidateId: examUuidSchema,
  studentId: examUuidSchema,
  displayName: nullableStr,
  sessionId: examUuidSchema,
  sessionLabel: z.string(),
  examTypeCode: z.string(),
  examTypeLabel: z.string(),
  sessionYear: z.number().int(),
  sessionKind: examSessionKindSchema,
  registrationStatus: examRegistrationStatusSchema,
  candidateNumber: nullableStr,
  startsOn: nullableStr,
  /** Place attribuée (convocation) : centre, salle, place. */
  assignment: z.object({ centerName: z.string(), roomCode: z.string(), seatNumber: z.number().int() }).nullable(),
  /** Issue : visible UNIQUEMENT une fois le résultat publié, jamais la moyenne ni les notes. */
  outcome: examOutcomeSchema.nullable(),
  documents: z.array(examIssuedDocumentDtoSchema),
  demoRules: z.boolean(),
});
export type ExamFamilyExamDto = z.infer<typeof examFamilyExamDtoSchema>;

// Rapports d'opérations en lot et vues de lecture composées
export const examFromClassroomReportSchema = z.object({ created: z.number().int(), skipped: z.array(z.object({ studentId: examUuidSchema, reason: z.string() })), failed: z.array(z.object({ studentId: examUuidSchema, code: z.string(), message: z.string() })) });
export const examRegisterBatchReportSchema = z.object({ registered: z.array(z.object({ candidateId: examUuidSchema, candidateNumber: nullableStr })), failed: z.array(z.object({ candidateId: examUuidSchema, code: z.string(), message: z.string() })) });
export const examEvaluateAllReportSchema = z.object({ evaluated: z.number().int(), byResult: z.record(z.number().int()), failed: z.array(z.object({ candidateId: examUuidSchema, code: z.string(), message: z.string() })) });
export const examEvaluateOneResultSchema = z.object({ candidate: examCandidateDtoSchema, check: examEligibilityCheckDtoSchema });
export const examBulkScoresReportSchema = z.object({ saved: z.number().int(), unchanged: z.number().int(), failed: z.array(z.object({ index: z.number().int(), candidateId: examUuidSchema, paperId: examUuidSchema, code: z.string(), message: z.string() })) });
export const examBulkResultsReportSchema = z.object({ saved: z.number().int(), failed: z.array(z.object({ index: z.number().int(), candidateId: examUuidSchema, code: z.string(), message: z.string() })) });
export const examScoreMatrixSchema = z.object({
  sessionId: examUuidSchema,
  papers: z.array(z.object({ id: examUuidSchema, code: z.string(), label: z.string(), trackCode: nullableStr, scaleMax: decStr, ordinal: z.number().int() })),
  rows: z.array(z.object({ candidateId: examUuidSchema, candidateNumber: nullableStr, displayName: nullableStr, trackCode: nullableStr, scores: z.record(z.object({ id: examUuidSchema, status: examScoreStatusSchema, score: nullableStr, source: z.string() })) })),
});
export type ExamScoreMatrixDto = z.infer<typeof examScoreMatrixSchema>;
export const examAssignmentsOverviewSchema = z.object({
  centerIds: z.array(examUuidSchema),
  centers: z.array(examCenterDtoSchema),
  rooms: z.array(z.object({ roomId: examUuidSchema, centerId: examUuidSchema, centerCode: z.string(), centerName: z.string(), code: z.string(), capacity: z.number().int(), active: z.boolean(), used: z.number().int() })),
  assignments: z.array(examAssignmentDtoSchema),
  registered: z.number().int(),
  unassigned: z.number().int(),
  capacity: z.number().int(),
  frozen: z.boolean(),
});
export type ExamAssignmentsOverviewDto = z.infer<typeof examAssignmentsOverviewSchema>;
export const examAutoAssignReportSchema = z.object({ assigned: z.number().int(), alreadyAssigned: z.number().int(), capacity: z.number().int() });
export const examImportFromAssessReportSchema = z.object({ saved: z.number().int(), unchanged: z.number().int(), noCandidate: z.number().int(), skipped: z.number().int(), failed: z.array(z.object({ candidateId: examUuidSchema, paperId: examUuidSchema, code: z.string(), message: z.string() })) });
export const examComputeMockReportSchema = z.object({ computed: z.number().int(), skippedPublished: z.number().int(), failed: z.array(z.object({ candidateId: examUuidSchema, code: z.string(), message: z.string() })), ruleVersionId: examUuidSchema, ruleSetCode: z.string(), demoRules: z.boolean() });
export const examIssueBatchReportSchema = z.object({ issued: z.number().int(), skipped: z.array(z.object({ candidateId: examUuidSchema, reason: z.string() })), failed: z.array(z.object({ candidateId: examUuidSchema, code: z.string(), message: z.string() })) });
export const examPackReportSchema = z.object({ pack: z.string(), notice: z.string(), createdTypes: z.array(z.string()), existingTypes: z.array(z.string()), createdExportFormats: z.array(z.string()), createdImportFormats: z.array(z.string()) });
export const examSessionInstantiateSchema = z.object({ session: examSessionDtoSchema, paperCount: z.number().int() });

export const EXAMINATIONS_ERROR_CODES = [
  "examinations.invalid_input", "examinations.forbidden", "examinations.port_unavailable", "examinations.not_found", "examinations.type_not_found",
  "examinations.session_not_found", "examinations.candidate_not_found", "examinations.center_not_found", "examinations.room_not_found",
  "examinations.paper_not_found", "examinations.track_not_found", "examinations.requirement_not_found", "examinations.format_not_found",
  "examinations.batch_not_found", "examinations.result_not_found", "examinations.score_not_found", "examinations.request_not_found",
  "examinations.document_not_found", "examinations.export_not_found", "examinations.code_taken", "examinations.type_archived",
  "examinations.definition_locked", "examinations.definition_not_locked", "examinations.no_papers", "examinations.session_transition",
  "examinations.session_archived", "examinations.session_identity_immutable", "examinations.session_initial_state",
  "examinations.session_registration_closed", "examinations.mock_target_invalid", "examinations.results_incomplete",
  "examinations.candidate_institution", "examinations.candidate_initial_state", "examinations.candidate_identity_immutable",
  "examinations.candidate_number_immutable", "examinations.candidate_snapshot_frozen", "examinations.candidate_transition",
  "examinations.candidate_withdrawn", "examinations.candidate_not_registered", "examinations.candidate_duplicate", "examinations.outcome_derived",
  "examinations.eligibility_derived", "examinations.not_eligible", "examinations.documents_incomplete", "examinations.withdraw_after_results",
  "examinations.identity_incomplete", "examinations.enrollment_mismatch", "examinations.track_unknown", "examinations.identifier_taken",
  "examinations.no_rule_version", "examinations.rule_evaluation_failed", "examinations.manual_eligibility_refused",
  "examinations.piece_document_unknown", "examinations.piece_review_invalid", "examinations.center_not_in_session",
  "examinations.assignment_frozen", "examinations.room_inactive", "examinations.seat_beyond_capacity", "examinations.seat_taken",
  "examinations.no_capacity", "examinations.center_in_use", "examinations.scores_closed", "examinations.scores_frozen",
  "examinations.score_above_scale", "examinations.score_revision_required", "examinations.paper_not_for_track", "examinations.results_closed",
  "examinations.official_not_computed", "examinations.mock_not_imported", "examinations.mock_results_computed", "examinations.result_published",
  "examinations.result_revision_required", "examinations.result_initial_state", "examinations.revision_not_needed",
  "examinations.revision_request_closed", "examinations.revision_same_person", "examinations.revision_pending", "examinations.revision_no_change",
  "examinations.batch_closed", "examinations.batch_transition", "examinations.batch_duplicate", "examinations.batch_has_errors",
  "examinations.batch_not_validated", "examinations.file_empty", "examinations.file_too_large", "examinations.file_unreadable",
  "examinations.format_not_published", "examinations.format_kind_mismatch", "examinations.links_mock_only", "examinations.links_frozen",
  "examinations.assessment_unknown", "examinations.assessment_scale_mismatch", "examinations.assessment_not_mock",
  "examinations.assessment_classroom_mismatch", "examinations.mock_only", "examinations.no_links", "examinations.format_invalid",
  "examinations.format_published_immutable", "examinations.format_transition", "examinations.format_identity_immutable",
  "examinations.export_closed", "examinations.export_failed", "examinations.attestation_requires_admission",
  "examinations.convocation_requires_assignment", "examinations.document_revoked", "examinations.document_issued",
  "examinations.document_already_live", "examinations.revoke_reason_required", "examinations.mock_no_official_document",
  "examinations.group_unknown", "examinations.rate_limited",
  "examinations.external_only", "examinations.external_official_only", "examinations.candidate_anonymized", "examinations.piece_mode_mismatch",
  "examinations.external_profile_incomplete",
] as const;

// ---------------------------------------------------------------------------
// Événements publiés (charge utile : AUCUNE note, moyenne ni identité)
// ---------------------------------------------------------------------------

const v1 = z.literal(1);
const candidateKindSchema = z.enum(["STUDENT", "EXTERNAL"]);
const sessionRef = { v: v1, sessionId: examUuidSchema, institutionId: examUuidSchema, examTypeCode: z.string() };

export const examinationsEventPayloadSchemas = {
  "examinations.session.opened": z.object({ ...sessionRef }).strict(),
  "examinations.session.registration_closed": z.object({ ...sessionRef, registeredCount: z.number().int().min(0) }).strict(),
  "examinations.session.results_published": z.object({ ...sessionRef, sessionKind: examSessionKindSchema, publishedCount: z.number().int().min(0) }).strict(),
  "examinations.session.archived": z.object({ ...sessionRef }).strict(),
  /** `studentId` est `null` pour un candidat LIBRE (Q-E15) : aucune identité (nom, naissance, contact) ne figure jamais dans l'événement. */
  "examinations.candidate.registered": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema.nullable(), candidateKind: candidateKindSchema, institutionId: examUuidSchema, candidateNumber: z.string() }).strict(),
  "examinations.candidate.withdrawn": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema.nullable(), candidateKind: candidateKindSchema, reasonCode: z.enum(["MANUAL", "ENROLLMENT_WITHDRAWN"]) }).strict(),
  "examinations.eligibility.evaluated": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, result: z.enum(["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"]), reasonCodes: z.array(z.string()), mode: z.enum(["RULE", "MANUAL", "OVERRIDE"]) }).strict(),
  /** Issue seule (Q-E18) : ni note, ni moyenne, ni rang. Consommé par 006/007 pour l'admission en 6e. */
  "examinations.result.published": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema.nullable(), candidateKind: candidateKindSchema, institutionId: examUuidSchema, examTypeCode: z.string(), sessionYear: z.number().int(), outcome: examResultCodeSchema }).strict(),
  "examinations.result.revised": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, resultId: examUuidSchema, fromOutcome: examResultCodeSchema, toOutcome: examResultCodeSchema }).strict(),
  "examinations.revision.requested": z.object({ v: v1, sessionId: examUuidSchema, requestId: examUuidSchema, targetKind: z.enum(["SCORE", "RESULT"]) }).strict(),
  "examinations.revision.rejected": z.object({ v: v1, sessionId: examUuidSchema, requestId: examUuidSchema, targetKind: z.enum(["SCORE", "RESULT"]) }).strict(),
  "examinations.import.applied": z.object({ v: v1, sessionId: examUuidSchema, batchId: examUuidSchema, kind: examBatchKindSchema, rowCount: z.number().int().min(0), sha256: z.string() }).strict(),
  "examinations.document.issued": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema.nullable(), candidateKind: candidateKindSchema, documentId: examUuidSchema, kind: examDocumentKindSchema, version: z.number().int().min(1) }).strict(),
  "examinations.document.revoked": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, documentId: examUuidSchema, kind: examDocumentKindSchema, version: z.number().int().min(1) }).strict(),
  "examinations.export.completed": z.object({ v: v1, sessionId: examUuidSchema, exportId: examUuidSchema, formatCode: z.string(), rowCount: z.number().int().min(0), sha256: z.string() }).strict(),
} as const;
export type ExaminationsEventType = keyof typeof examinationsEventPayloadSchemas;

/** Événement consommé : retrait d'une inscription (lu par l'abonné de retrait automatique). */
export const examinationsConsumedEnrollmentWithdrawnSchema = z.object({ enrollmentId: examUuidSchema, studentId: examUuidSchema.optional() }).passthrough();
