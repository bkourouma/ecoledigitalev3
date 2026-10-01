/**
 * Contrats du module `assess` (routes `/api/v1/assess/*`, événements `assess.*`) — spec v2/011.
 * Écrits avant les routes (ADR-001 règle 6) ; la grille de saisie web/mobile (spec 029) est typée à partir d'eux.
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID. Classe, nœud de curriculum, période, année, inscription, élève, enseignant (personnel) :
 *    références SANS clé étrangère vers les modules academic / people.
 *  - NOTES : valeurs DÉCIMALES EXACTES, jamais de flottant. En entrée un nombre JSON ou une chaîne (`12.5`, 3 décimales au
 *    plus) ; en sortie toujours une chaîne décimale (`"12.500"`). Aucun arrondi à la saisie.
 *  - ÉTATS D'ENTRÉE : `ENTERED` (seul porteur d'un score), `ABSENT_EXCUSED`, `ABSENT_UNEXCUSED`, `EXEMPT`, `NOT_GRADED`.
 *    Une absence n'est PAS un zéro : c'est la règle de calcul (module `rules`) qui décide.
 *  - SAISIE EN LOT idempotente : en-tête `Idempotency-Key` (rejouer le même lot n'écrit rien) et `rowVersion` par ligne
 *    (le second de deux lots concurrents reçoit 409 `assess.stale_grade`).
 *  - Aucun seuil, aucune formule : les moyennes, rangs et mentions sont calculés par le module `results` via `rules`.
 *  - Messages utilisateur en français ; codes d'erreur stables `assess.*`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const assessUuidSchema = z.string().uuid();
export const assessCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Code attendu : majuscules, chiffres et _ (2 à 32 caractères).");

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const assessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine(isRealDate, "Date inexistante.");
export const assessInstantSchema = z.string().datetime({ offset: true });

/** Chaîne décimale non négative à 3 décimales au plus (`12`, `12.5`, `0.125`). */
export const assessDecimalStringSchema = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, "Valeur décimale attendue (3 décimales au plus).");

/** Entrée de note : nombre JSON ou chaîne décimale ; normalisée en chaîne (jamais d'arrondi, jamais d'exposant). */
export const assessScoreInputSchema = z.union([z.number(), z.string()]).transform((value, ctx): string => {
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, "") : "") : value.trim();
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Une note a 3 décimales au plus." });
    return z.NEVER;
  }
  if (!/^\d{1,5}(\.\d{1,3})?$/.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Note invalide : valeur décimale positive attendue (3 décimales au plus)." });
    return z.NEVER;
  }
  return text;
});

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const reasonText = (min: number, max = 500) => z.string().trim().min(min, `Le motif doit faire au moins ${min} caractères.`).max(max);

export const ASSESS_ENTRY_STATUSES = ["ENTERED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED", "EXEMPT", "NOT_GRADED"] as const;
export const assessEntryStatusSchema = z.enum(ASSESS_ENTRY_STATUSES);
export type AssessEntryStatus = z.infer<typeof assessEntryStatusSchema>;

/** Circuit de validation d'une feuille de notes (`PUBLISHED` est terminal ; `CANCELLED` sort du circuit). */
export const ASSESS_STATUSES = ["DRAFT", "SUBMITTED", "REVIEWED", "APPROVED", "PUBLISHED", "CANCELLED"] as const;
export const assessStatusSchema = z.enum(ASSESS_STATUSES);
export type AssessStatus = z.infer<typeof assessStatusSchema>;

export const ASSESS_SESSIONS = [1, 2] as const;
export const assessSessionNoSchema = z.union([z.literal(1), z.literal(2)]);

export const ASSESS_PUBLICATION_MODES = ["MANUAL", "AUTO_ON_APPROVAL"] as const;
export const assessPublicationModeSchema = z.enum(ASSESS_PUBLICATION_MODES);

export const ASSESS_REVISION_KINDS = ["CORRECTION", "ADDITION", "REMOVAL"] as const;
export const assessRevisionKindSchema = z.enum(ASSESS_REVISION_KINDS);
export const ASSESS_REVISION_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "APPLIED"] as const;
export const assessRevisionStatusSchema = z.enum(ASSESS_REVISION_STATUSES);

const limitQuery = z.coerce.number().int().min(1).max(200);
const pageQuery = { limit: limitQuery.optional(), cursor: z.string().min(1).max(200).optional() };
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

export const assessIdParamsSchema = z.object({ id: assessUuidSchema }).strict();
export const assessChildParamsSchema = z.object({ studentId: assessUuidSchema }).strict();

// ---------------------------------------------------------------------------
// Types d'évaluation et réglages
// ---------------------------------------------------------------------------

export const assessTypeCreateBodySchema = z
  .object({
    code: assessCodeSchema,
    label: text(1, 80),
    /** Groupe lu par les règles / par `results` (ex. `CONTINUOUS`, `EXAM`) : une DONNÉE du tenant. */
    aggregationGroup: assessCodeSchema,
    defaultScaleMax: assessDecimalStringSchema.optional(),
    defaultWeight: assessDecimalStringSchema.optional(),
    publicationMode: assessPublicationModeSchema.optional(),
    visibleToStudents: z.boolean().optional(),
    allowsSession2: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type AssessTypeCreateBody = z.infer<typeof assessTypeCreateBodySchema>;

export const assessTypeUpdateBodySchema = z
  .object({
    label: text(1, 80).optional(),
    aggregationGroup: assessCodeSchema.optional(),
    defaultScaleMax: assessDecimalStringSchema.optional(),
    defaultWeight: assessDecimalStringSchema.optional(),
    publicationMode: assessPublicationModeSchema.optional(),
    visibleToStudents: z.boolean().optional(),
    allowsSession2: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification fournie.");

export const assessTypeDtoSchema = z.object({
  id: assessUuidSchema,
  code: assessCodeSchema,
  label: z.string(),
  aggregationGroup: assessCodeSchema,
  defaultScaleMax: z.string(),
  defaultWeight: z.string(),
  publicationMode: assessPublicationModeSchema,
  visibleToStudents: z.boolean(),
  allowsSession2: z.boolean(),
  isSystem: z.boolean(),
  templateKey: z.string().nullable(),
  position: z.number().int(),
  active: z.boolean(),
});
export type AssessTypeDto = z.infer<typeof assessTypeDtoSchema>;

export const assessSettingsUpdateBodySchema = z
  .object({
    requireSeparateReviewer: z.boolean().optional(),
    requireSeparateApprover: z.boolean().optional(),
    maxScoreDecimals: z.number().int().min(0).max(3).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification fournie.");
export const assessSettingsDtoSchema = z.object({
  requireSeparateReviewer: z.boolean(),
  requireSeparateApprover: z.boolean(),
  maxScoreDecimals: z.number().int(),
  lateGradePolicy: z.literal("REVISION"),
  updatedAt: assessInstantSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Évaluations
// ---------------------------------------------------------------------------

const assessmentFields = {
  typeId: assessUuidSchema,
  classroomId: assessUuidSchema,
  curriculumNodeId: assessUuidSchema,
  academicPeriodId: assessUuidSchema,
  title: text(1, 160),
  assessedOn: assessDateSchema,
  /** Barème (défaut : celui du type). */
  scaleMax: assessDecimalStringSchema.optional(),
  weight: assessDecimalStringSchema.optional(),
  sessionNo: assessSessionNoSchema.optional(),
} as const;

export const assessmentCreateBodySchema = z
  .object({
    ...assessmentFields,
    /** Enseignant (personnel) : par défaut celui du demandeur ; un tiers exige `assessment.manage`. */
    teacherId: assessUuidSchema.optional(),
  })
  .strict();
export type AssessmentCreateBody = z.infer<typeof assessmentCreateBodySchema>;

export const assessmentBulkCreateBodySchema = z
  .object({
    typeId: assessUuidSchema,
    academicPeriodId: assessUuidSchema,
    title: text(1, 160),
    assessedOn: assessDateSchema,
    scaleMax: assessDecimalStringSchema.optional(),
    weight: assessDecimalStringSchema.optional(),
    sessionNo: assessSessionNoSchema.optional(),
    targets: z
      .array(z.object({ classroomId: assessUuidSchema, curriculumNodeId: assessUuidSchema, teacherId: assessUuidSchema.optional() }).strict())
      .min(1)
      .max(50),
  })
  .strict();

export const assessmentUpdateBodySchema = z
  .object({
    typeId: assessUuidSchema.optional(),
    title: text(1, 160).optional(),
    assessedOn: assessDateSchema.optional(),
    scaleMax: assessDecimalStringSchema.optional(),
    weight: assessDecimalStringSchema.optional(),
    sessionNo: assessSessionNoSchema.optional(),
    curriculumNodeId: assessUuidSchema.optional(),
    academicPeriodId: assessUuidSchema.optional(),
    /** Reprise par un remplaçant (transfert tracé). */
    teacherId: assessUuidSchema.optional(),
    rowVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).filter((k) => k !== "rowVersion").length > 0, "Aucune modification fournie.");

export const assessListAssessmentsQuerySchema = z
  .object({
    classroomId: assessUuidSchema.optional(),
    academicPeriodId: assessUuidSchema.optional(),
    curriculumNodeId: assessUuidSchema.optional(),
    teacherId: assessUuidSchema.optional(),
    status: assessStatusSchema.optional(),
    sessionNo: z.coerce.number().int().min(1).max(2).optional(),
    mine: boolQuery.optional(),
    ...pageQuery,
  })
  .strict();

export const assessmentDtoSchema = z.object({
  id: assessUuidSchema,
  typeId: assessUuidSchema,
  typeCode: assessCodeSchema.nullable(),
  aggregationGroup: assessCodeSchema.nullable(),
  classroomId: assessUuidSchema,
  curriculumNodeId: assessUuidSchema,
  academicPeriodId: assessUuidSchema,
  academicYearId: assessUuidSchema,
  teacherId: assessUuidSchema,
  title: z.string(),
  assessedOn: assessDateSchema,
  scaleMax: z.string(),
  weight: z.string(),
  sessionNo: assessSessionNoSchema,
  status: assessStatusSchema,
  submittedAt: assessInstantSchema.nullable(),
  submittedBy: assessUuidSchema.nullable(),
  reviewedAt: assessInstantSchema.nullable(),
  reviewedBy: assessUuidSchema.nullable(),
  approvedAt: assessInstantSchema.nullable(),
  approvedBy: assessUuidSchema.nullable(),
  publishedAt: assessInstantSchema.nullable(),
  publishedBy: assessUuidSchema.nullable(),
  cancelledAt: assessInstantSchema.nullable(),
  cancelReason: z.string().nullable(),
  fourEyesWaived: z.boolean(),
  returnComment: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: assessInstantSchema,
});
export type AssessmentDto = z.infer<typeof assessmentDtoSchema>;

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const assessGradeEntrySchema = z
  .object({
    enrollmentId: assessUuidSchema,
    /** Obligatoire pour `ENTERED`, interdit sinon. */
    score: assessScoreInputSchema.nullish(),
    entryStatus: assessEntryStatusSchema.optional(),
    comment: z.string().trim().max(500).nullish(),
    /** Version de la ligne lue par le client (détection d'écrasement silencieux) ; absente pour une nouvelle ligne. */
    rowVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const status = e.entryStatus ?? (e.score !== undefined && e.score !== null ? "ENTERED" : undefined);
    if (status === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entryStatus"], message: "Fournissez une note ou un état d'entrée." });
    else if (status === "ENTERED" && (e.score === undefined || e.score === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["score"], message: "Une note saisie exige une valeur." });
    else if (status !== "ENTERED" && e.score !== undefined && e.score !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["score"], message: "Seul l'état « noté » porte une valeur : une absence n'est pas un zéro." });
  });
export type AssessGradeEntry = z.infer<typeof assessGradeEntrySchema>;

/** Saisie en lot (≤ 500 lignes), tout ou rien. */
export const assessSaveGradesBodySchema = z
  .object({
    entries: z.array(assessGradeEntrySchema).min(1).max(500),
  })
  .strict()
  .refine((b) => new Set(b.entries.map((e) => e.enrollmentId)).size === b.entries.length, "Une inscription ne peut figurer qu'une fois dans le lot.");
export type AssessSaveGradesBody = z.infer<typeof assessSaveGradesBodySchema>;
export const assessIdempotencyKeySchema = z.string().trim().min(8).max(100);

export const assessGradeDtoSchema = z.object({
  id: assessUuidSchema,
  assessmentId: assessUuidSchema,
  enrollmentId: assessUuidSchema,
  studentId: assessUuidSchema,
  score: z.string().nullable(),
  entryStatus: assessEntryStatusSchema,
  comment: z.string().nullable(),
  status: assessStatusSchema,
  rowVersion: z.number().int(),
  enteredAt: assessInstantSchema.nullable(),
  /** Mention « corrigée le … » (élève) : date de la dernière révision appliquée. */
  correctedAt: assessInstantSchema.nullable(),
});
export type AssessGradeDto = z.infer<typeof assessGradeDtoSchema>;

export const assessGradeSheetDtoSchema = z.object({ assessment: assessmentDtoSchema, grades: z.array(assessGradeDtoSchema) });

export const assessSaveGradesResultDtoSchema = z.object({
  assessmentId: assessUuidSchema,
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  /** `true` : la clé d'idempotence avait déjà été jouée ; le résultat enregistré est renvoyé tel quel. */
  replayed: z.boolean(),
  grades: z.array(assessGradeDtoSchema),
});

// ---------------------------------------------------------------------------
// Circuit de validation
// ---------------------------------------------------------------------------

export const assessTransitionBodySchema = z
  .object({
    to: z.enum(["SUBMITTED", "REVIEWED", "APPROVED", "PUBLISHED", "DRAFT"]),
    /** Obligatoire pour un retour à `DRAFT`. */
    comment: z.string().trim().max(1000).optional(),
    rowVersion: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((b) => b.to !== "DRAFT" || (b.comment?.length ?? 0) >= 5, { path: ["comment"], message: "Un retour en brouillon exige un commentaire (5 caractères au moins)." });
export type AssessTransitionBody = z.infer<typeof assessTransitionBodySchema>;

export const assessCancelBodySchema = z.object({ reason: reasonText(10) }).strict();

// ---------------------------------------------------------------------------
// Révisions
// ---------------------------------------------------------------------------

export const assessRevisionRequestBodySchema = z
  .object({
    newScore: assessScoreInputSchema.nullish(),
    newEntryStatus: assessEntryStatusSchema.optional(),
    reason: reasonText(10),
  })
  .strict()
  .superRefine((b, ctx) => {
    const status = b.newEntryStatus ?? (b.newScore !== undefined && b.newScore !== null ? "ENTERED" : undefined);
    if (status === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newEntryStatus"], message: "Fournissez la nouvelle note ou le nouvel état d'entrée." });
    else if (status === "ENTERED" && (b.newScore === undefined || b.newScore === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newScore"], message: "Une note saisie exige une valeur." });
    else if (status !== "ENTERED" && b.newScore !== undefined && b.newScore !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newScore"], message: "Seul l'état « noté » porte une valeur." });
  });

/** Ajout d'un élève absent de la feuille publiée. */
export const assessAdditionRequestBodySchema = z
  .object({
    enrollmentId: assessUuidSchema,
    newScore: assessScoreInputSchema.nullish(),
    newEntryStatus: assessEntryStatusSchema.optional(),
    reason: reasonText(10),
  })
  .strict();

export const assessRevisionDecisionBodySchema = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
export const assessRejectRevisionBodySchema = z.object({ comment: reasonText(5, 1000) }).strict();

export const assessListRevisionsQuerySchema = z
  .object({
    status: assessRevisionStatusSchema.optional(),
    assessmentId: assessUuidSchema.optional(),
    classroomId: assessUuidSchema.optional(),
    ...pageQuery,
  })
  .strict();

export const assessRevisionDtoSchema = z.object({
  id: assessUuidSchema,
  assessmentId: assessUuidSchema,
  gradeId: assessUuidSchema.nullable(),
  enrollmentId: assessUuidSchema,
  kind: assessRevisionKindSchema,
  oldScore: z.string().nullable(),
  oldEntryStatus: assessEntryStatusSchema.nullable(),
  newScore: z.string().nullable(),
  newEntryStatus: assessEntryStatusSchema.nullable(),
  reason: z.string(),
  requestedBy: assessUuidSchema,
  requestedByName: z.string(),
  requestedAt: assessInstantSchema,
  status: assessRevisionStatusSchema,
  decidedBy: assessUuidSchema.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: assessInstantSchema.nullable(),
  decisionComment: z.string().nullable(),
  fourEyesWaived: z.boolean(),
  appliedAt: assessInstantSchema.nullable(),
  batchId: assessUuidSchema.nullable(),
});
export type AssessRevisionDto = z.infer<typeof assessRevisionDtoSchema>;

export const assessGradeHistoryDtoSchema = z.object({
  gradeId: assessUuidSchema,
  assessmentId: assessUuidSchema,
  enrollmentId: assessUuidSchema,
  current: assessGradeDtoSchema,
  assessmentStatusTrail: z.array(z.object({ status: assessStatusSchema, at: assessInstantSchema, by: assessUuidSchema.nullable() })),
  revisions: z.array(assessRevisionDtoSchema),
});

// ---------------------------------------------------------------------------
// Verrous de période
// ---------------------------------------------------------------------------

export const assessPeriodLockDtoSchema = z.object({
  id: assessUuidSchema,
  classroomId: assessUuidSchema,
  academicPeriodId: assessUuidSchema,
  lockedAt: assessInstantSchema,
  lockedBy: assessUuidSchema,
  lockReason: z.string().nullable(),
  lockedSessions: z.array(assessSessionNoSchema),
  releasedAt: assessInstantSchema.nullable(),
  releaseReason: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Lecture élève / tuteur
// ---------------------------------------------------------------------------

export const assessMyGradesQuerySchema = z
  .object({ academicPeriodId: assessUuidSchema.optional(), curriculumNodeId: assessUuidSchema.optional(), ...pageQuery })
  .strict();

export const assessPublishedGradeDtoSchema = z.object({
  gradeId: assessUuidSchema,
  assessmentId: assessUuidSchema,
  title: z.string(),
  typeLabel: z.string().nullable(),
  curriculumNodeId: assessUuidSchema,
  academicPeriodId: assessUuidSchema,
  assessedOn: assessDateSchema,
  sessionNo: assessSessionNoSchema,
  score: z.string().nullable(),
  entryStatus: assessEntryStatusSchema,
  scaleMax: z.string(),
  weight: z.string(),
  publishedAt: assessInstantSchema,
  correctedAt: assessInstantSchema.nullable(),
});
export const assessPublishedGradesPageDtoSchema = z.object({ items: z.array(assessPublishedGradeDtoSchema), nextCursor: z.string().nullable() });

// ---------------------------------------------------------------------------
// Événements publiés (outbox, `{ v: 1, … }`) — AUCUNE note dans les payloads (pas de donnée personnelle)
// ---------------------------------------------------------------------------

const ev = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });
const assessmentRef = {
  assessmentId: assessUuidSchema,
  classroomId: assessUuidSchema,
  academicPeriodId: assessUuidSchema,
  curriculumNodeId: assessUuidSchema,
  sessionNo: assessSessionNoSchema,
} as const;

export const assessEventPayloadSchemas = {
  "assess.assessment.created": ev({ ...assessmentRef, status: assessStatusSchema }),
  "assess.assessment.submitted": ev({ ...assessmentRef, status: assessStatusSchema }),
  "assess.assessment.reviewed": ev({ ...assessmentRef, status: assessStatusSchema }),
  "assess.assessment.approved": ev({ ...assessmentRef, status: assessStatusSchema }),
  "assess.assessment.returned": ev({ ...assessmentRef, status: assessStatusSchema, from: assessStatusSchema }),
  "assess.assessment.cancelled": ev({ ...assessmentRef, reason: z.string(), enrollmentIds: z.array(assessUuidSchema) }),
  "assess.grade.published": ev({ ...assessmentRef, enrollmentIds: z.array(assessUuidSchema), publishedAt: assessInstantSchema, visibleToStudents: z.boolean() }),
  "assess.grade.revised": ev({ ...assessmentRef, gradeId: assessUuidSchema, enrollmentId: assessUuidSchema, revisionId: assessUuidSchema, kind: assessRevisionKindSchema }),
  "assess.revision.requested": ev({ ...assessmentRef, revisionId: assessUuidSchema, enrollmentId: assessUuidSchema, kind: assessRevisionKindSchema, batchId: assessUuidSchema.nullable() }),
  "assess.revision.rejected": ev({ ...assessmentRef, revisionId: assessUuidSchema, enrollmentId: assessUuidSchema, kind: assessRevisionKindSchema }),
  "assess.period.locked": ev({ classroomId: assessUuidSchema, academicPeriodId: assessUuidSchema, lockedSessions: z.array(assessSessionNoSchema) }),
  "assess.period.unlocked": ev({ classroomId: assessUuidSchema, academicPeriodId: assessUuidSchema, lockedSessions: z.array(assessSessionNoSchema) }),
} as const;
export type AssessEventType = keyof typeof assessEventPayloadSchemas;
export const ASSESS_EVENT_TYPES = Object.keys(assessEventPayloadSchemas) as AssessEventType[];
