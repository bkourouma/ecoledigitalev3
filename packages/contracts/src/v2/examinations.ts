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
  z.object({ action: z.literal("ACCEPT") }).strict(),
  z.object({ action: z.literal("REJECT"), rejectionReason: z.string().trim().min(3).max(500) }).strict(),
]);
export type ExamPieceActionBody = z.infer<typeof examPieceActionBodySchema>;

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
// Réponses (formes lues par le client typé du web)
// ---------------------------------------------------------------------------

export interface ExamPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExamTypeDto {
  id: string;
  code: string;
  label: string;
  educationLevelCode: string;
  gradeLevelCode: string | null;
  resultContractId: string;
  candidateNumberPattern: string;
  sourceKind: ExamSourceKind;
  sourceReference: string | null;
  status: "ACTIVE" | "ARCHIVED";
  /** Vrai si les données du type sont des valeurs FICTIVES de démonstration (bandeau « Règles de démonstration »). */
  placeholder: boolean;
}
export interface ExamTrackDto { id: string; code: string; label: string; sourceKind: ExamSourceKind; active: boolean }
export interface ExamPaperDto {
  id: string;
  trackCode: string | null;
  code: string;
  label: string;
  coefficient: string;
  scaleMax: string;
  isOptional: boolean;
  ordinal: number;
  sourceKind: ExamSourceKind;
  active: boolean;
}
export interface ExamRequirementDto { id: string; code: string; label: string; required: boolean; sortOrder: number; sourceKind: ExamSourceKind; active: boolean }
export interface ExamTypeDetailDto extends ExamTypeDto {
  tracks: ExamTrackDto[];
  papers: ExamPaperDto[];
  requirements: ExamRequirementDto[];
}

export interface ExamCenterDto { id: string; code: string; name: string; kind: "OWN" | "HOST"; authorityCode: string | null; locality: string | null; status: "ACTIVE" | "INACTIVE"; rooms?: ExamRoomDto[] }
export interface ExamRoomDto { id: string; centerId: string; code: string; label: string | null; capacity: number; active: boolean }

export interface ExamSessionProgressDto {
  index: number;
  total: number;
  percent: number;
  next: ExamSessionStatus | null;
  allowedNext: ExamSessionStatus[];
}

export interface ExamSessionDto {
  id: string;
  examTypeId: string;
  examTypeCode: string;
  examTypeLabel: string;
  institutionId: string;
  academicYearId: string | null;
  code: string;
  label: string;
  sessionKind: ExamSessionKind;
  attemptKind: "NORMAL" | "MAKEUP";
  sessionYear: number;
  mockOfSessionId: string | null;
  registrationOpensOn: string | null;
  registrationClosesOn: string | null;
  startsOn: string | null;
  endsOn: string | null;
  status: ExamSessionStatus;
  definitionLockedAt: string | null;
  ruleVersionRef: string | null;
  sourceKind: ExamSourceKind;
  /** Règles ou données de DÉMONSTRATION en usage : le client affiche le bandeau et le filigrane. */
  demoRules: boolean;
  progress: ExamSessionProgressDto;
  createdAt: string;
}
export interface ExamSessionCountsDto { candidates: number; registered: number; withdrawn: number; eligible: number; withResult: number; published: number; assigned: number }
export interface ExamSessionDetailDto extends ExamSessionDto {
  tracks: Array<{ id: string; code: string; label: string }>;
  papers: Array<{ id: string; trackCode: string | null; code: string; label: string; coefficient: string; scaleMax: string; isOptional: boolean; ordinal: number; sourceKind: ExamSourceKind }>;
  counts: ExamSessionCountsDto;
  /** Raisons qui bloquent chaque transition possible (vide = aucune raison connue ; la base reste juge). */
  blockers: Partial<Record<ExamSessionStatus, string[]>>;
}

export interface ExamCandidateDto {
  id: string;
  sessionId: string;
  studentId: string;
  enrollmentId: string | null;
  gradeLevelCode: string | null;
  trackCode: string | null;
  lastName: string | null;
  firstName: string | null;
  birthDate: string | null;
  birthPlace: string | null;
  sex: "F" | "M" | null;
  registrationStatus: ExamRegistrationStatus;
  eligibilityStatus: ExamEligibilityStatus;
  outcome: ExamOutcome;
  candidateNumber: string | null;
  officialNumber: string | null;
  registeredAt: string | null;
  withdrawnReason: string | null;
  /** Codes des pièces obligatoires non acceptées (vide = dossier complet). */
  missingPieces: string[];
  /** Nom d'affichage tiré de l'état civil figé, sinon de l'annuaire (jamais enregistré hors du candidat). */
  displayName: string | null;
  rowVersion: number;
}

export interface ExamEligibilityCheckDto {
  id: string;
  result: "ELIGIBLE" | "INELIGIBLE" | "NEEDS_REVIEW";
  reasons: string[];
  ruleVersionRef: string | null;
  evaluatedBy: string | null;
  evaluatedAt: string;
  overridden: boolean;
  overrideReason: string | null;
}
export interface ExamPieceDto { requirementId: string; code: string; label: string; required: boolean; status: z.infer<typeof examPieceStatusSchema>; documentRef: string | null; rejectionReason: string | null; reviewedAt: string | null }
export interface ExamIdentifierDto { id: string; kind: string; value: string; source: "MANUAL" | "IMPORT" | "MIGRATION" }
export interface ExamAssignmentDto { candidateId: string; candidateNumber: string | null; displayName: string | null; centerId: string; centerCode: string; centerName: string; roomId: string; roomCode: string; seatNumber: number; tableNumber: string | null }
export interface ExamHistoryDto { id: string; kind: string; fromValue: string | null; toValue: string | null; reason: string | null; actorId: string | null; occurredAt: string }
export interface ExamScoreDto { id: string; candidateId: string; paperId: string; status: ExamScoreStatus; score: string | null; source: "MANUAL" | "IMPORT" | "ASSESS" }
export interface ExamResultDto {
  id: string;
  sessionId: string;
  candidateId: string;
  candidateNumber: string | null;
  displayName: string | null;
  resultCode: ExamResultCode;
  average: string | null;
  totalPoints: string | null;
  rank: number | null;
  mentionCode: string | null;
  source: "IMPORTED" | "ENTERED" | "COMPUTED";
  ruleVersionRef: string | null;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: string | null;
}
export interface ExamCandidateDetailDto {
  candidate: ExamCandidateDto;
  eligibilityChecks: ExamEligibilityCheckDto[];
  pieces: ExamPieceDto[];
  identifiers: ExamIdentifierDto[];
  assignment: ExamAssignmentDto | null;
  history: ExamHistoryDto[];
  scores: ExamScoreDto[];
  result: ExamResultDto | null;
  documents: ExamIssuedDocumentDto[];
}

export interface ExamBatchDto { id: string; sessionId: string; kind: ExamBatchKind; fileName: string; sha256: string; formatCode: string | null; rowCount: number; okCount: number; errorCount: number; status: "UPLOADED" | "VALIDATED" | "APPLIED" | "REJECTED"; uploadedBy: string; appliedAt: string | null; createdAt: string }
export interface ExamImportRowDto { id: string; lineNo: number; status: "OK" | "ERROR" | "SKIPPED"; errorCode: string | null; candidateNumber: string | null; payload: Record<string, unknown> }
export interface ExamImportFormatDto { id: string; code: string; version: number; label: string; examTypeId: string | null; kind: ExamBatchKind; encoding: string; delimiter: string; decimalSeparator: "." | ","; hasHeader: boolean; columns: Array<{ header: string; target: string; paper?: string }>; valueMap: Record<string, Record<string, string>>; status: "DRAFT" | "PUBLISHED" | "RETIRED"; sourceKind: ExamSourceKind; sourceReference: string | null; placeholder: boolean }
export interface ExamExportFormatDto { id: string; code: string; version: number; label: string; examTypeId: string | null; kind: ExamExportKind; fileFormat: z.infer<typeof examFileFormatSchema>; encoding: string; delimiter: string | null; columns: ExamExportColumnDto[]; status: "DRAFT" | "PUBLISHED" | "RETIRED"; sourceKind: ExamSourceKind; sourceReference: string | null; placeholder: boolean }
export interface ExamExportRunDto { id: string; sessionId: string; formatId: string; formatCode: string | null; formatVersion: number; status: "RUNNING" | "DONE" | "FAILED"; rowCount: number | null; fileSha256: string | null; errorCode: string | null; requestedBy: string; createdAt: string; completedAt: string | null }

export interface ExamRevisionRequestDto {
  id: string;
  sessionId: string;
  targetKind: "SCORE" | "RESULT";
  scoreId: string | null;
  resultId: string | null;
  candidateId: string | null;
  candidateNumber: string | null;
  proposed: Record<string, unknown>;
  current: Record<string, unknown>;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ExamStatisticsGroupDto { groupKey: string; registered: number; present: number; admitted: number; failed: number; absent: number; excluded: number; deferred: number; /** Taux calculé PAR LA RÈGLE `taux_reussite` (décimal exact), `null` si indisponible. */ rate: string | null }
export interface ExamStatisticsDto {
  sessionId: string;
  groupBy: ExamCountGroup;
  groups: ExamStatisticsGroupDto[];
  total: ExamStatisticsGroupDto;
  rateAvailable: boolean;
  /** Explication quand le taux n'est pas calculé (aucune règle épinglée, règle indisponible). */
  rateNote: string | null;
  demoRules: boolean;
  compare?: { label: string; sessionId: string; groups: ExamStatisticsGroupDto[]; total: ExamStatisticsGroupDto } | null;
}

export interface ExamIssuedDocumentDto { id: string; sessionId: string; candidateId: string; candidateNumber: string | null; kind: ExamDocumentKind; version: number; status: "REQUESTED" | "ISSUED" | "REVOKED"; officialDocumentId: string | null; issuedAt: string | null; revokedReason: string | null; createdAt: string }

export interface ExamLinkDto { id: string; paperId: string; paperCode: string; classroomId: string; assessmentId: string; linkedAt: string }

export interface ExamFamilyExamDto {
  candidateId: string;
  studentId: string;
  displayName: string | null;
  sessionId: string;
  sessionLabel: string;
  examTypeCode: string;
  examTypeLabel: string;
  sessionYear: number;
  sessionKind: ExamSessionKind;
  registrationStatus: ExamRegistrationStatus;
  candidateNumber: string | null;
  startsOn: string | null;
  /** Place attribuée (convocation) : centre, salle, place. */
  assignment: { centerName: string; roomCode: string; seatNumber: number } | null;
  /** Issue : visible UNIQUEMENT une fois le résultat publié, jamais la moyenne ni les notes. */
  outcome: ExamOutcome | null;
  documents: ExamIssuedDocumentDto[];
  demoRules: boolean;
}

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
] as const;

// ---------------------------------------------------------------------------
// Événements publiés (charge utile : AUCUNE note, moyenne ni identité)
// ---------------------------------------------------------------------------

const v1 = z.literal(1);
const sessionRef = { v: v1, sessionId: examUuidSchema, institutionId: examUuidSchema, examTypeCode: z.string() };

export const examinationsEventPayloadSchemas = {
  "examinations.session.opened": z.object({ ...sessionRef }).strict(),
  "examinations.session.registration_closed": z.object({ ...sessionRef, registeredCount: z.number().int().min(0) }).strict(),
  "examinations.session.results_published": z.object({ ...sessionRef, sessionKind: examSessionKindSchema, publishedCount: z.number().int().min(0) }).strict(),
  "examinations.session.archived": z.object({ ...sessionRef }).strict(),
  "examinations.candidate.registered": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema, institutionId: examUuidSchema, candidateNumber: z.string() }).strict(),
  "examinations.candidate.withdrawn": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema, reasonCode: z.enum(["MANUAL", "ENROLLMENT_WITHDRAWN"]) }).strict(),
  "examinations.eligibility.evaluated": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, result: z.enum(["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"]), reasonCodes: z.array(z.string()), mode: z.enum(["RULE", "MANUAL", "OVERRIDE"]) }).strict(),
  /** Issue seule (Q-E18) : ni note, ni moyenne, ni rang. Consommé par 006/007 pour l'admission en 6e. */
  "examinations.result.published": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema, institutionId: examUuidSchema, examTypeCode: z.string(), sessionYear: z.number().int(), outcome: examResultCodeSchema }).strict(),
  "examinations.result.revised": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, resultId: examUuidSchema, fromOutcome: examResultCodeSchema, toOutcome: examResultCodeSchema }).strict(),
  "examinations.revision.requested": z.object({ v: v1, sessionId: examUuidSchema, requestId: examUuidSchema, targetKind: z.enum(["SCORE", "RESULT"]) }).strict(),
  "examinations.revision.rejected": z.object({ v: v1, sessionId: examUuidSchema, requestId: examUuidSchema, targetKind: z.enum(["SCORE", "RESULT"]) }).strict(),
  "examinations.import.applied": z.object({ v: v1, sessionId: examUuidSchema, batchId: examUuidSchema, kind: examBatchKindSchema, rowCount: z.number().int().min(0), sha256: z.string() }).strict(),
  "examinations.document.issued": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, studentId: examUuidSchema, documentId: examUuidSchema, kind: examDocumentKindSchema, version: z.number().int().min(1) }).strict(),
  "examinations.document.revoked": z.object({ v: v1, sessionId: examUuidSchema, candidateId: examUuidSchema, documentId: examUuidSchema, kind: examDocumentKindSchema, version: z.number().int().min(1) }).strict(),
  "examinations.export.completed": z.object({ v: v1, sessionId: examUuidSchema, exportId: examUuidSchema, formatCode: z.string(), rowCount: z.number().int().min(0), sha256: z.string() }).strict(),
} as const;
export type ExaminationsEventType = keyof typeof examinationsEventPayloadSchemas;

/** Événement consommé : retrait d'une inscription (lu par l'abonné de retrait automatique). */
export const examinationsConsumedEnrollmentWithdrawnSchema = z.object({ enrollmentId: examUuidSchema, studentId: examUuidSchema.optional() }).passthrough();
