/**
 * Contrats du module `results` (routes `/api/v1/results/*`, événements `results.*`) — spec v2/011.
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID, références SANS clé étrangère vers academic / people / assess / rules.
 *  - VALEURS : moyennes, crédits, coefficients = chaînes DÉCIMALES EXACTES (jamais de flottant) ; la valeur d'AFFICHAGE
 *    (`displayValue`) est distincte et jamais réinjectée dans un calcul.
 *  - DÉCISIONS, MENTIONS, STATUTS : des CODES anglais majuscules produits par les règles ; les libellés viennent du
 *    `label_map` de la version de règle (module rules). Aucune logique ne compare un libellé.
 *  - Aucune moyenne n'est saisie : seule voie manuelle = SURCHARGE justifiée, approuvée par un tiers, auditée.
 *  - Messages utilisateur en français ; codes d'erreur stables `results.*`.
 */
import { z } from "zod";

export const resultsUuidSchema = z.string().uuid();
export const resultsInstantSchema = z.string().datetime({ offset: true });
const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const resultsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.").refine(isRealDate, "Date inexistante.");
export const resultsDecimalSchema = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/, "Valeur décimale positive attendue.");
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const reasonText = (min: number, max = 1000) => z.string().trim().min(min, `Le motif doit faire au moins ${min} caractères.`).max(max);
const limitQuery = z.coerce.number().int().min(1).max(200);
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");

export const RESULTS_PERIOD_STATUSES = ["OPEN", "GRADING_LOCKED", "DELIBERATED", "CLOSED"] as const;
export const resultsPeriodStatusSchema = z.enum(RESULTS_PERIOD_STATUSES);
export const RESULTS_RESULT_STATUSES = ["DRAFT", "FINAL", "SUPERSEDED", "ERROR"] as const;
export const resultsResultStatusSchema = z.enum(RESULTS_RESULT_STATUSES);
export const RESULTS_LEVELS = ["ECUE", "SUBJECT", "UE", "SECTION", "PERIOD", "YEAR"] as const;
export const resultsLevelSchema = z.enum(RESULTS_LEVELS);
export const RESULTS_OUTCOMES = ["PROMOTED", "REPEAT", "PENDING", "EXAM_REFERRAL", "ADMITTED", "RESIT", "ADJOURNED", "OTHER"] as const;
export const resultsOutcomeSchema = z.enum(RESULTS_OUTCOMES);
export const RESULTS_REOPEN_KINDS = ["CORRECTION", "RESIT_SESSION"] as const;
export const resultsReopenKindSchema = z.enum(RESULTS_REOPEN_KINDS);

// ---------------------------------------------------------------------------
// Paramètres de route
// ---------------------------------------------------------------------------

export const resultsIdParamsSchema = z.object({ id: resultsUuidSchema }).strict();
export const resultsPeriodParamsSchema = z.object({ classroomId: resultsUuidSchema, periodId: resultsUuidSchema }).strict();
export const resultsEnrollmentPeriodParamsSchema = z.object({ enrollmentId: resultsUuidSchema, periodId: resultsUuidSchema }).strict();
export const resultsChildParamsSchema = z.object({ studentId: resultsUuidSchema }).strict();

// ---------------------------------------------------------------------------
// Cycle de période
// ---------------------------------------------------------------------------

export const resultsLockBodySchema = z
  .object({ force: z.boolean().optional(), reason: reasonText(10).optional() })
  .strict()
  .refine((b) => !b.force || b.reason, { path: ["reason"], message: "Un verrouillage forcé exige un motif." });
export const resultsDeliberateBodySchema = z.object({ confirmProposed: z.boolean().optional() }).strict();
export const resultsCloseBodySchema = z
  .object({ force: z.boolean().optional(), reason: reasonText(10).optional() })
  .strict()
  .refine((b) => !b.force || b.reason, { path: ["reason"], message: "Une clôture forcée exige un motif." });
export const resultsReopenBodySchema = z.object({ kind: resultsReopenKindSchema.default("CORRECTION"), reason: reasonText(10) }).strict();
export const resultsRecomputeBodySchema = z.object({ classroomId: resultsUuidSchema, periodId: resultsUuidSchema, enrollmentIds: z.array(resultsUuidSchema).max(2000).optional() }).strict();

export const resultsStateDtoSchema = z.object({
  id: resultsUuidSchema,
  classroomId: resultsUuidSchema,
  academicPeriodId: resultsUuidSchema.nullable(),
  academicYearId: resultsUuidSchema,
  scope: z.enum(["PERIOD", "YEAR"]),
  status: resultsPeriodStatusSchema,
  contractId: z.string(),
  ruleSetCode: z.string(),
  ruleVersionNo: z.number().int(),
  ruleVersionId: resultsUuidSchema,
  definitionHash: z.string(),
  pinnedAt: resultsInstantSchema,
  lockedAt: resultsInstantSchema.nullable(),
  deliberatedAt: resultsInstantSchema.nullable(),
  closedAt: resultsInstantSchema.nullable(),
  reopenCount: z.number().int(),
  lastReopenKind: resultsReopenKindSchema.nullable(),
  lastReopenReason: z.string().nullable(),
  resultsVersion: z.number().int(),
});
export type ResultsStateDto = z.infer<typeof resultsStateDtoSchema>;

// ---------------------------------------------------------------------------
// Résultats
// ---------------------------------------------------------------------------

export const resultsLineDtoSchema = z.object({
  level: resultsLevelSchema,
  curriculumNodeId: resultsUuidSchema.nullable(),
  parentNodeId: resultsUuidSchema.nullable(),
  value: z.string().nullable(),
  displayValue: z.string().nullable(),
  credits: z.string().nullable(),
  coefficient: z.string().nullable(),
  validated: z.boolean().nullable(),
  statusCode: z.string().nullable(),
  sessionObtained: z.union([z.literal(1), z.literal(2)]).nullable(),
  resitEligible: z.boolean().nullable(),
  rank: z.number().int().nullable(),
  cohortSize: z.number().int().nullable(),
  overridden: z.boolean(),
  outputs: z.record(z.unknown()),
});

export const resultsHeaderDtoSchema = z.object({
  id: resultsUuidSchema,
  enrollmentId: resultsUuidSchema,
  studentId: resultsUuidSchema,
  academicPeriodId: resultsUuidSchema.nullable(),
  scope: z.enum(["PERIOD", "YEAR"]),
  version: z.number().int(),
  status: resultsResultStatusSchema,
  contractId: z.string(),
  ruleSetCode: z.string(),
  ruleVersionNo: z.number().int(),
  definitionHash: z.string(),
  engineVersion: z.string(),
  inputsHash: z.string(),
  outputsHash: z.string().nullable(),
  average: z.string().nullable(),
  averageDisplay: z.string().nullable(),
  rank: z.number().int().nullable(),
  cohortSize: z.number().int().nullable(),
  mentionCode: z.string().nullable(),
  decisionCode: z.string().nullable(),
  decisionOutcome: resultsOutcomeSchema.nullable(),
  creditsAcquired: z.string().nullable(),
  creditsRequired: z.string().nullable(),
  validated: z.boolean().nullable(),
  summary: z.record(z.unknown()),
  error: z.unknown().nullable(),
  computedAt: resultsInstantSchema,
  finalizedAt: resultsInstantSchema.nullable(),
});
export type ResultsHeaderDto = z.infer<typeof resultsHeaderDtoSchema>;

export const resultsEnrollmentResultDtoSchema = z.object({ header: resultsHeaderDtoSchema, lines: z.array(resultsLineDtoSchema), decisions: z.array(z.unknown()) });

export const resultsClassMatrixDtoSchema = z.object({
  state: resultsStateDtoSchema,
  rows: z.array(z.object({ header: resultsHeaderDtoSchema, lines: z.array(resultsLineDtoSchema) })),
  decisions: z.array(z.unknown()),
});
export const resultsMatrixQuerySchema = z.object({ lines: boolQuery.optional() }).strict();

export const resultsFamilyResultDtoSchema = z.object({
  academicPeriodId: resultsUuidSchema.nullable(),
  scope: z.enum(["PERIOD", "YEAR"]),
  version: z.number().int(),
  average: z.string().nullable(),
  averageDisplay: z.string().nullable(),
  rank: z.number().int().nullable(),
  cohortSize: z.number().int().nullable(),
  mentionCode: z.string().nullable(),
  decisionCode: z.string().nullable(),
  decisionOutcome: z.string().nullable(),
  creditsAcquired: z.string().nullable(),
  creditsRequired: z.string().nullable(),
  validated: z.boolean().nullable(),
  finalizedAt: resultsInstantSchema.nullable(),
  lines: z.array(z.object({ level: resultsLevelSchema, curriculumNodeId: resultsUuidSchema.nullable(), value: z.string().nullable(), displayValue: z.string().nullable(), credits: z.string().nullable(), coefficient: z.string().nullable(), validated: z.boolean().nullable(), statusCode: z.string().nullable(), rank: z.number().int().nullable() })),
});

// ---------------------------------------------------------------------------
// Surcharges, décisions, délibérations, appréciations
// ---------------------------------------------------------------------------

export const resultsOverrideCreateBodySchema = z
  .object({
    stateId: resultsUuidSchema,
    enrollmentId: resultsUuidSchema,
    level: resultsLevelSchema,
    curriculumNodeId: resultsUuidSchema.nullish(),
    ruleKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    kind: z.enum(["VALUE", "VALIDATION"]),
    value: resultsDecimalSchema.optional(),
    flag: z.boolean().optional(),
    justification: reasonText(20),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.kind === "VALUE" && b.value === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Une surcharge de valeur exige la valeur imposée." });
    if (b.kind === "VALIDATION" && b.flag === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flag"], message: "Une surcharge de validation exige le drapeau imposé." });
  });
export const resultsOverrideDecisionBodySchema = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
export const resultsOverrideRejectBodySchema = z.object({ comment: reasonText(5) }).strict();
export const resultsOverrideRevokeBodySchema = z.object({ reason: reasonText(10) }).strict();
export const resultsOverridesQuerySchema = z.object({ stateId: resultsUuidSchema.optional(), enrollmentId: resultsUuidSchema.optional(), status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "REVOKED"]).optional() }).strict();

export const resultsOverrideDtoSchema = z.object({
  id: resultsUuidSchema,
  stateId: resultsUuidSchema,
  enrollmentId: resultsUuidSchema,
  level: resultsLevelSchema,
  curriculumNodeId: resultsUuidSchema.nullable(),
  ruleKey: z.string(),
  kind: z.enum(["VALUE", "VALIDATION"]),
  originalValue: z.string().nullable(),
  overrideValue: z.string().nullable(),
  overrideFlag: z.boolean().nullable(),
  justification: z.string(),
  requestedBy: resultsUuidSchema,
  requestedByName: z.string(),
  requestedAt: resultsInstantSchema,
  status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "REVOKED"]),
  decidedBy: resultsUuidSchema.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: resultsInstantSchema.nullable(),
  decisionComment: z.string().nullable(),
  revokedReason: z.string().nullable(),
  fourEyesWaived: z.boolean(),
});

export const resultsDecisionsQuerySchema = z.object({ stateId: resultsUuidSchema, enrollmentId: resultsUuidSchema.optional() }).strict();
export const resultsDecisionConfirmBodySchema = z
  .object({ finalCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/).optional(), justification: reasonText(20).optional(), deliberationId: resultsUuidSchema.optional() })
  .strict();
export const resultsDecisionDtoSchema = z.object({
  id: resultsUuidSchema,
  stateId: resultsUuidSchema,
  enrollmentId: resultsUuidSchema,
  scope: z.enum(["PERIOD", "YEAR"]),
  kind: z.string(),
  proposedCode: z.string().nullable(),
  proposedOutcome: z.string().nullable(),
  finalCode: z.string().nullable(),
  finalOutcome: z.string().nullable(),
  status: z.enum(["PROPOSED", "CONFIRMED", "PUBLISHED", "WITHDRAWN"]),
  deliberationId: resultsUuidSchema.nullable(),
  justification: z.string().nullable(),
  decidedBy: resultsUuidSchema.nullable(),
  decidedAt: resultsInstantSchema.nullable(),
});

export const resultsDeliberationCreateBodySchema = z
  .object({ stateId: resultsUuidSchema, kind: z.enum(["COUNCIL", "JURY"]), heldOn: resultsDateSchema.optional(), participants: z.array(z.object({ staffId: resultsUuidSchema, role: text(1, 60) }).strict()).max(100).optional() })
  .strict();
export const resultsDeliberationUpdateBodySchema = z
  .object({ status: z.enum(["HELD", "SIGNED", "CANCELLED"]).optional(), heldOn: resultsDateSchema.optional(), participants: z.array(z.object({ staffId: resultsUuidSchema, role: text(1, 60) }).strict()).max(100).optional(), minutesObjectKey: text(1, 300).optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification fournie.");
export const resultsDeliberationsQuerySchema = z.object({ stateId: resultsUuidSchema }).strict();
export const resultsDeliberationDtoSchema = z.object({
  id: resultsUuidSchema,
  stateId: resultsUuidSchema,
  classroomId: resultsUuidSchema,
  kind: z.enum(["COUNCIL", "JURY"]),
  heldOn: resultsDateSchema.nullable(),
  status: z.enum(["PLANNED", "HELD", "SIGNED", "CANCELLED"]),
  participants: z.unknown(),
  minutesObjectKey: z.string().nullable(),
});

export const resultsAppreciationBodySchema = z
  .object({
    stateId: resultsUuidSchema,
    enrollmentId: resultsUuidSchema,
    curriculumNodeId: resultsUuidSchema.nullish(),
    authorRole: z.enum(["TEACHER", "COUNCIL", "DIRECTOR"]),
    body: text(1, 1000),
  })
  .strict();
export const resultsAppreciationsQuerySchema = z.object({ stateId: resultsUuidSchema, enrollmentId: resultsUuidSchema.optional() }).strict();
export const resultsAppreciationDtoSchema = z.object({
  id: resultsUuidSchema,
  stateId: resultsUuidSchema,
  enrollmentId: resultsUuidSchema,
  curriculumNodeId: resultsUuidSchema.nullable(),
  authorStaffId: resultsUuidSchema,
  authorRole: z.enum(["TEACHER", "COUNCIL", "DIRECTOR"]),
  body: z.string(),
  updatedAt: resultsInstantSchema,
});

export const resultsSettingsUpdateBodySchema = z
  .object({ requireDeliberation: z.boolean().optional(), requireSeparateApprover: z.boolean().optional(), recomputeDelaySeconds: z.number().int().min(0).max(3600).optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Aucune modification fournie.");
export const resultsSettingsDtoSchema = z.object({ requireDeliberation: z.boolean(), requireSeparateApprover: z.boolean(), recomputeDelaySeconds: z.number().int(), updatedAt: resultsInstantSchema.nullable() });

// ---------------------------------------------------------------------------
// Événements publiés (outbox, `{ v: 1, … }`) — AUCUNE note ni moyenne dans les payloads
// ---------------------------------------------------------------------------

const ev = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });
const periodRef = { classroomId: resultsUuidSchema, academicPeriodId: resultsUuidSchema, stateId: resultsUuidSchema } as const;

export const resultsEventPayloadSchemas = {
  "results.period_result.computed": ev({ enrollmentId: resultsUuidSchema, academicPeriodId: resultsUuidSchema, resultId: resultsUuidSchema, version: z.number().int(), status: resultsResultStatusSchema }),
  "results.period.locked": ev({ ...periodRef, closureHash: z.string().nullable(), resultsVersion: z.number().int() }),
  "results.period.deliberated": ev({ ...periodRef, closureHash: z.string().nullable(), resultsVersion: z.number().int() }),
  "results.period.closed": ev({ ...periodRef, closureHash: z.string(), resultsVersion: z.number().int(), withoutDeliberation: z.boolean() }),
  "results.period.reopened": ev({ ...periodRef, closureHash: z.string().nullable(), resultsVersion: z.number().int(), reopenKind: resultsReopenKindSchema, reason: z.string() }),
  "results.decision.confirmed": ev({ enrollmentId: resultsUuidSchema, scope: z.enum(["PERIOD", "YEAR"]), kind: z.string(), finalCode: z.string().nullable(), outcome: z.string().nullable(), stateId: resultsUuidSchema, academicPeriodId: resultsUuidSchema.nullable(), changedFromProposal: z.boolean() }),
  "results.override.requested": ev({ overrideId: resultsUuidSchema, enrollmentId: resultsUuidSchema, periodId: resultsUuidSchema.nullable(), stateId: resultsUuidSchema }),
  "results.override.approved": ev({ overrideId: resultsUuidSchema, enrollmentId: resultsUuidSchema, periodId: resultsUuidSchema.nullable(), stateId: resultsUuidSchema }),
  "results.override.revoked": ev({ overrideId: resultsUuidSchema, enrollmentId: resultsUuidSchema, periodId: resultsUuidSchema.nullable(), stateId: resultsUuidSchema }),
  "results.recompute.blocked": ev({ classroomId: resultsUuidSchema, academicPeriodId: resultsUuidSchema, reason: z.string() }),
} as const;
export type ResultsEventType = keyof typeof resultsEventPayloadSchemas;
export const RESULTS_EVENT_TYPES = Object.keys(resultsEventPayloadSchemas) as ResultsEventType[];
