/**
 * Contrats du module `higher` (routes `/api/v1/higher/*`, événements `higher.*`) — enseignement supérieur : registre de
 * crédits (capitalisation), prérequis, rattrapage (session 2), diplômes, attestations, signataires datés.
 * Écrits avant les routes (ADR-001 règle 6) ; le client web est typé à partir de ces schémas.
 *
 * Conventions (ADR-007, module-conventions.md) :
 *  - IDENTIFIANTS : UUID. Nœuds du curriculum, inscriptions, étudiants, classes, périodes, années et signataires sont des
 *    références SANS clé étrangère vers les modules academic, people, results et reportcards.
 *  - DATES calendaires : `AAAA-MM-JJ` ; INSTANTS : ISO 8601 avec fuseau (`...Z`).
 *  - MOYENNES : chaînes décimales EXACTES (jamais de flottant) ; CRÉDITS : nombres à deux décimales au plus.
 *  - AUCUNE formule, AUCUN seuil réglementaire : l'éligibilité au diplôme, la moyenne de cycle, la mention et l'état d'UE
 *    sont des règles (RuleSet, module rules). Les codes de mention sont ceux du contrat `credit-semester@1`.
 *  - Messages utilisateur en français ; codes d'erreur stables `higher.*`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const higherUuidSchema = z.string().uuid();

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const higherDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine(isRealDate, "Date inexistante.");
export const higherInstantSchema = z.string().datetime({ offset: true });
/** Chaîne décimale exacte (`"12.375"`). */
export const higherDecimalSchema = z.string().regex(/^-?\d+(\.\d+)?$/, "Nombre décimal attendu.");
export const higherCreditsSchema = z.number().min(0).max(100000).multipleOf(0.01);

export const higherDiplomaCodeSchema = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,49}$/, "Code attendu : majuscules, chiffres, - et _ (2 à 50).");
export const higherGradeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Code de grade attendu : majuscules, chiffres et _ (2 à 32).");

export const HIGHER_LEDGER_STATUSES = ["ACQUIRED", "REVOKED", "EXPIRED"] as const;
export const higherLedgerStatusSchema = z.enum(HIGHER_LEDGER_STATUSES);
export const HIGHER_ACQUIRED_VIA = ["DIRECT", "RESIT", "JURY_OVERRIDE", "TRANSFER", "EXEMPTION"] as const;
export const higherAcquiredViaSchema = z.enum(HIGHER_ACQUIRED_VIA);
export const HIGHER_PREREQUISITE_MODES = ["VALIDATED", "ATTENDED", "MIN_AVERAGE"] as const;
export const higherPrerequisiteModeSchema = z.enum(HIGHER_PREREQUISITE_MODES);
export const HIGHER_DIPLOMA_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const higherDiplomaStatusSchema = z.enum(HIGHER_DIPLOMA_STATUSES);
export const HIGHER_AWARD_STATUSES = ["OBTAINED", "REVOKED"] as const;
export const higherAwardStatusSchema = z.enum(HIGHER_AWARD_STATUSES);
export const HIGHER_AWARDED_VIA = ["AUTO", "MANUAL", "FORCED"] as const;
export const higherAwardedViaSchema = z.enum(HIGHER_AWARDED_VIA);
export const HIGHER_DOCUMENT_KINDS = ["DIPLOMA", "ATTESTATION_SUCCESS", "ATTESTATION_AUTHENTICITY"] as const;
export const higherDocumentKindSchema = z.enum(HIGHER_DOCUMENT_KINDS);
export const HIGHER_DOCUMENT_STATUSES = ["ISSUED", "SUPERSEDED", "REVOKED"] as const;
export const higherDocumentStatusSchema = z.enum(HIGHER_DOCUMENT_STATUSES);
export const HIGHER_RENDER_STATUSES = ["PENDING", "RENDERING", "RENDERED", "FAILED"] as const;
export const higherRenderStatusSchema = z.enum(HIGHER_RENDER_STATUSES);
export const HIGHER_SLOT_KEYS = ["DIPLOMA_LEFT", "DIPLOMA_RIGHT", "ATTESTATION_SUCCESS", "AUTHENTICITY"] as const;
export const higherSlotKeySchema = z.enum(HIGHER_SLOT_KEYS);
export const HIGHER_RESIT_WINDOW_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const;
export const higherResitWindowStatusSchema = z.enum(HIGHER_RESIT_WINDOW_STATUSES);
export const HIGHER_RESIT_REGISTRATION_STATUSES = ["REGISTERED", "PRESENT", "ABSENT", "WAIVED", "GRADED"] as const;
export const higherResitRegistrationStatusSchema = z.enum(HIGHER_RESIT_REGISTRATION_STATUSES);
export const HIGHER_RESIT_PHASES = ["TO_RETAKE", "NOT_VALIDATED", "VALIDATED"] as const;
export const higherResitPhaseSchema = z.enum(HIGHER_RESIT_PHASES);

const cursor = z.string().min(1).max(500);
const limit = (max: number, def: number) => z.coerce.number().int().min(1).max(max).default(def);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

// ---------------------------------------------------------------------------
// Paramètres de route et requêtes de liste
// ---------------------------------------------------------------------------

export const higherIdParamsSchema = z.object({ id: higherUuidSchema }).strict();
export const higherStudentParamsSchema = z.object({ id: higherUuidSchema }).strict();
export const higherChildParamsSchema = z.object({ studentId: higherUuidSchema }).strict();
export const higherNodeParamsSchema = z.object({ nodeId: higherUuidSchema }).strict();
export const higherDiplomaStudentParamsSchema = z.object({ id: higherUuidSchema, studentId: higherUuidSchema }).strict();

export const higherListDiplomasQuerySchema = z
  .object({ status: higherDiplomaStatusSchema.optional(), curriculumNodeId: higherUuidSchema.optional(), gradeCode: higherGradeCodeSchema.optional(), q: text(1, 100).optional() })
  .strict();
export const higherListAwardedQuerySchema = z.object({ status: higherAwardStatusSchema.optional(), limit: limit(200, 50), cursor: cursor.optional() }).strict();
export const higherListDocumentsQuerySchema = z
  .object({ kind: higherDocumentKindSchema.optional(), status: higherDocumentStatusSchema.optional(), studentId: higherUuidSchema.optional(), limit: limit(200, 50), cursor: cursor.optional() })
  .strict();
export const higherAttestationRosterQuerySchema = z.object({ programNodeId: higherUuidSchema, classroomId: higherUuidSchema.optional() }).strict();
export const higherPrerequisitesCheckQuerySchema = z.object({ nodeId: higherUuidSchema }).strict();
export const higherResitCandidatesQuerySchema = z.object({ classroomId: higherUuidSchema, periodId: higherUuidSchema }).strict();
export const higherListResitWindowsQuerySchema = z
  .object({ classroomId: higherUuidSchema.optional(), periodId: higherUuidSchema.optional(), status: higherResitWindowStatusSchema.optional(), limit: limit(200, 50), cursor: cursor.optional() })
  .strict();
export const higherCreditsQuerySchema = z.object({ status: higherLedgerStatusSchema.optional(), limit: limit(500, 100), cursor: cursor.optional() }).strict();

// ---------------------------------------------------------------------------
// Corps de requête
// ---------------------------------------------------------------------------

const requirementInput = z.object({ ueNodeId: higherUuidSchema, mandatory: z.boolean().optional() }).strict();

export const higherCreateDiplomaBodySchema = z
  .object({
    code: higherDiplomaCodeSchema,
    label: text(1, 200),
    gradeCode: higherGradeCodeSchema,
    curriculumNodeId: higherUuidSchema,
    uvRequired: z.number().positive().max(100000).multipleOf(0.01),
    autoAward: z.boolean().optional(),
    description: text(1, 2000).nullable().optional(),
    institutionId: higherUuidSchema.nullable().optional(),
    requirements: z.array(requirementInput).max(500).optional(),
  })
  .strict();

export const higherCreateFromCurriculumBodySchema = z
  .object({
    curriculumNodeId: higherUuidSchema,
    gradeCode: higherGradeCodeSchema,
    code: higherDiplomaCodeSchema.optional(),
    label: text(1, 200).optional(),
    uvRequired: z.number().positive().max(100000).multipleOf(0.01).optional(),
    autoAward: z.boolean().optional(),
    description: text(1, 2000).nullable().optional(),
    institutionId: higherUuidSchema.nullable().optional(),
  })
  .strict();

export const higherUpdateDiplomaBodySchema = z
  .object({
    label: text(1, 200).optional(),
    description: text(1, 2000).nullable().optional(),
    uvRequired: z.number().positive().max(100000).multipleOf(0.01).optional(),
    status: higherDiplomaStatusSchema.optional(),
    autoAward: z.boolean().optional(),
    gradeCode: higherGradeCodeSchema.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Au moins un champ à modifier.");

export const higherReplaceRequirementsBodySchema = z.object({ requirements: z.array(requirementInput).max(500) }).strict();

export const higherAwardBodySchema = z
  .object({
    studentId: higherUuidSchema,
    /** Octroi forcé (étudiant non éligible) : exige la permission sensible et un motif de 20 caractères au moins. */
    force: z.boolean().optional(),
    reason: text(20, 1000).optional(),
    /** Ré-octroi d'un diplôme révoqué : décision écrite référencée du directeur général (20 caractères au moins). */
    reawardDecision: text(20, 1000).optional(),
  })
  .strict()
  .refine((b) => !b.force || Boolean(b.reason), { message: "Le motif d'un octroi forcé (20 caractères au moins) est obligatoire.", path: ["reason"] });

export const higherRevokeBodySchema = z.object({ reason: text(10, 1000) }).strict();

export const higherIssueDocumentBodySchema = z
  .object({ kind: z.enum(["DIPLOMA", "ATTESTATION_AUTHENTICITY"]), duplicate: z.boolean().optional() })
  .strict()
  .refine((b) => !b.duplicate || b.kind === "DIPLOMA", { message: "Seul un diplôme peut faire l'objet d'un duplicata.", path: ["duplicate"] });

export const higherIssueAttestationBodySchema = z.object({ studentId: higherUuidSchema, programNodeId: higherUuidSchema }).strict();

export const higherSetPrerequisitesBodySchema = z
  .object({
    prerequisites: z
      .array(
        z
          .object({ prerequisiteNodeId: higherUuidSchema, mode: higherPrerequisiteModeSchema.optional(), minAverage: z.number().min(0).max(20).optional() })
          .strict()
          .refine((p) => (p.mode === "MIN_AVERAGE") === (p.minAverage !== undefined), { message: "La moyenne minimale va avec le mode « moyenne minimale », et seulement avec lui.", path: ["minAverage"] }),
      )
      .max(50),
  })
  .strict();

export const higherOpenResitWindowBodySchema = z
  .object({
    classroomId: higherUuidSchema,
    academicPeriodId: higherUuidSchema,
    opensOn: higherDateSchema,
    closesOn: higherDateSchema,
    nodeIds: z.array(higherUuidSchema).min(1).max(500).optional(),
  })
  .strict()
  .refine((b) => b.closesOn >= b.opensOn, { message: "La fin de la fenêtre précède son début.", path: ["closesOn"] });

export const higherAssignSlotBodySchema = z
  .object({ slotKey: higherSlotKeySchema, signatoryId: higherUuidSchema, validFrom: higherDateSchema, validTo: higherDateSchema.nullable().optional() })
  .strict()
  .refine((b) => !b.validTo || b.validTo >= b.validFrom, { message: "La fin de validité précède son début.", path: ["validTo"] });

export const higherUpdateSettingsBodySchema = z.object({ creditValidityMonths: z.number().int().min(1).max(1200).nullable() }).strict();

// --- O-11 : UE annuelle (offerte sur plusieurs semestres, un résultat commun) -------------------------------------------
export const higherDeclareAnnualUeBodySchema = z
  .object({
    ueNodeId: higherUuidSchema,
    memberNodeIds: z.array(higherUuidSchema).max(8).optional(),
    partsExpected: z.number().int().min(2).max(4).optional(),
    reason: text(5, 1000),
  })
  .strict();
export const higherRemoveAnnualUeBodySchema = z.object({ reason: text(5, 1000) }).strict();

// --- O-14 : dispense d'UE manuelle avec motif ------------------------------------------------------------------------------
export const HIGHER_EXEMPTION_CREDIT_POLICIES = ["RECORD_ONLY", "GRANT_CREDITS"] as const;
export const higherExemptionCreditPolicySchema = z.enum(HIGHER_EXEMPTION_CREDIT_POLICIES);
export const HIGHER_EXEMPTION_STATUSES = ["ACTIVE", "REVOKED"] as const;
export const higherExemptionStatusSchema = z.enum(HIGHER_EXEMPTION_STATUSES);
export const higherGrantExemptionBodySchema = z
  .object({ studentId: higherUuidSchema, enrollmentId: higherUuidSchema, ueNodeId: higherUuidSchema, academicPeriodId: higherUuidSchema, reason: text(10, 1000) })
  .strict();
export const higherRevokeExemptionBodySchema = z.object({ reason: text(10, 1000) }).strict();
export const higherListExemptionsQuerySchema = z
  .object({ studentId: higherUuidSchema.optional(), ueNodeId: higherUuidSchema.optional(), status: higherExemptionStatusSchema.optional(), limit: limit(500, 100) })
  .strict();
export const higherUpdateExemptionSettingsBodySchema = z.object({ exemptionCreditPolicy: higherExemptionCreditPolicySchema }).strict();

// ---------------------------------------------------------------------------
// DTO de réponse
// ---------------------------------------------------------------------------

export const higherDiplomaDtoSchema = z.object({
  id: higherUuidSchema,
  institutionId: higherUuidSchema.nullable(),
  code: z.string(),
  label: z.string(),
  gradeCode: z.string(),
  curriculumNodeId: higherUuidSchema,
  uvRequired: z.number(),
  autoAward: z.boolean(),
  status: higherDiplomaStatusSchema,
  description: z.string().nullable(),
  lastSyncedAt: higherInstantSchema.nullable(),
  createdAt: higherInstantSchema,
  updatedAt: higherInstantSchema,
});

export const higherRequirementDtoSchema = z.object({
  id: higherUuidSchema,
  ueNodeId: higherUuidSchema,
  ueCode: z.string().nullable(),
  ueLabel: z.string().nullable(),
  credits: z.number(),
  mandatory: z.boolean(),
  position: z.number().int(),
  removedFromCurriculum: z.boolean(),
});

export const higherDiplomaDetailDtoSchema = z.object({
  diploma: higherDiplomaDtoSchema,
  requirements: z.array(higherRequirementDtoSchema),
  requirementsCredits: z.number(),
  awardCounts: z.object({ total: z.number().int(), obtained: z.number().int() }),
});

export const higherSyncReportDtoSchema = z.object({
  added: z.array(z.object({ ueNodeId: higherUuidSchema, code: z.string(), label: z.string(), credits: z.number() })),
  removed: z.array(z.object({ ueNodeId: higherUuidSchema, code: z.string().nullable(), label: z.string().nullable() })),
  updated: z.number().int(),
  unchanged: z.number().int(),
  suggestedUvRequired: z.number(),
});

export const higherRequirementStateDtoSchema = z.object({
  ueNodeId: higherUuidSchema,
  code: z.string().nullable(),
  label: z.string().nullable(),
  credits: z.number(),
  mandatory: z.boolean(),
  validated: z.boolean(),
  ledgerId: higherUuidSchema.nullable(),
  removedFromCurriculum: z.boolean(),
});

export const higherProgressDtoSchema = z.object({
  uvValidated: z.number(),
  uvRequired: z.number(),
  percent: z.number().int().min(0).max(100),
  validated: z.array(higherRequirementStateDtoSchema),
  remaining: z.array(higherRequirementStateDtoSchema),
  missingMandatory: z.array(higherRequirementStateDtoSchema),
});

export const higherRuleRefDtoSchema = z.object({ ruleSetCode: z.string(), ruleVersionId: higherUuidSchema, versionNo: z.number().int(), definitionHash: z.string() });

export const higherEligibilityDtoSchema = z.object({ eligible: z.boolean(), rule: higherRuleRefDtoSchema });

export const higherAwardDtoSchema = z.object({
  id: higherUuidSchema,
  definitionId: higherUuidSchema,
  studentId: higherUuidSchema,
  lastEnrollmentId: higherUuidSchema.nullable(),
  academicYearId: higherUuidSchema.nullable(),
  reference: z.string(),
  status: higherAwardStatusSchema,
  awardedVia: higherAwardedViaSchema,
  forcedReason: z.string().nullable(),
  creditsTotal: z.number(),
  requirements: z.array(
    z.object({ ueNodeId: higherUuidSchema, code: z.string().nullable(), label: z.string().nullable(), credits: z.number(), mandatory: z.boolean(), validated: z.boolean(), ledgerId: higherUuidSchema.nullable() }),
  ),
  cycleAverage: higherDecimalSchema.nullable(),
  mentionCode: z.string().nullable(),
  rule: higherRuleRefDtoSchema,
  awardedAt: higherInstantSchema,
  awardedBy: higherUuidSchema.nullable(),
  awardedByName: z.string(),
  acquiredDate: higherDateSchema.nullable(),
  revokedAt: higherInstantSchema.nullable(),
  revokedByName: z.string().nullable(),
  revokeReason: z.string().nullable(),
  predecessorAwardId: higherUuidSchema.nullable(),
  reawardDecision: z.string().nullable(),
});

export const higherAwardOutcomeDtoSchema = z.object({ award: higherAwardDtoSchema });
export const higherAwardsPageDtoSchema = z.object({ items: z.array(higherAwardDtoSchema), nextCursor: z.string().nullable() });

export const higherRecomputeReportDtoSchema = z.object({
  evaluated: z.number().int(),
  awarded: z.number().int(),
  skipped: z.record(z.string(), z.number().int()),
  failed: z.number().int(),
});

export const higherCandidateDtoSchema = z.object({
  studentId: higherUuidSchema,
  fullName: z.string().nullable(),
  matricule: z.string().nullable(),
  classroomId: higherUuidSchema,
  academicYearId: higherUuidSchema,
  uvValidated: z.number(),
  percent: z.number().int(),
  missingMandatory: z.number().int(),
  eligible: z.boolean().nullable(),
  awardStatus: higherAwardStatusSchema.nullable(),
  awardReference: z.string().nullable(),
  acquiredDate: higherDateSchema.nullable(),
  revokeReason: z.string().nullable(),
});

export const higherStudentDiplomaProgressDtoSchema = z.object({ diploma: higherDiplomaDtoSchema, progress: higherProgressDtoSchema, eligible: z.boolean().nullable() });

export const higherDiplomaProgressViewDtoSchema = z.object({
  diploma: higherDiplomaDtoSchema,
  progress: higherProgressDtoSchema,
  eligibility: higherEligibilityDtoSchema.nullable(),
  award: higherAwardDtoSchema.nullable(),
});

export const higherStudentDiplomasDtoSchema = z.object({ studentId: higherUuidSchema, awards: z.array(higherAwardDtoSchema), progress: z.array(higherStudentDiplomaProgressDtoSchema) });

export const higherLedgerEntryDtoSchema = z.object({
  id: higherUuidSchema,
  studentId: higherUuidSchema,
  enrollmentId: higherUuidSchema,
  ueNodeId: higherUuidSchema,
  academicYearId: higherUuidSchema,
  academicPeriodId: higherUuidSchema,
  credits: z.number(),
  averageExact: higherDecimalSchema.nullable(),
  acquiredVia: higherAcquiredViaSchema,
  sessionObtained: z.union([z.literal(1), z.literal(2)]),
  status: higherLedgerStatusSchema,
  compensatedEcueCount: z.number().int(),
  overrideId: higherUuidSchema.nullable(),
  sourceResultId: higherUuidSchema,
  sourceResultsVersion: z.number().int(),
  validUntil: higherDateSchema.nullable(),
  acquiredAt: higherInstantSchema,
  revokedAt: higherInstantSchema.nullable(),
  revokeReason: z.string().nullable(),
  expiredAt: higherInstantSchema.nullable(),
});

export const higherDebtDtoSchema = z.object({
  id: higherUuidSchema,
  studentId: higherUuidSchema,
  enrollmentId: higherUuidSchema,
  ueNodeId: higherUuidSchema,
  academicYearId: higherUuidSchema,
  academicPeriodId: higherUuidSchema,
  status: z.enum(["OPEN", "CLEARED"]),
  detectedAt: higherInstantSchema,
  clearedAt: higherInstantSchema.nullable(),
});

export const higherCreditSummaryDtoSchema = z.object({
  studentId: higherUuidSchema,
  totalCredits: z.number(),
  acquiredUeCount: z.number().int(),
  byYear: z.array(z.object({ academicYearId: higherUuidSchema, credits: z.number(), ueCount: z.number().int() })),
  byPeriod: z.array(z.object({ academicPeriodId: higherUuidSchema, credits: z.number(), ueCount: z.number().int() })),
  openDebtCount: z.number().int(),
});

export const higherStudentCreditsDtoSchema = z.object({
  summary: higherCreditSummaryDtoSchema,
  entries: z.array(higherLedgerEntryDtoSchema),
  debts: z.array(higherDebtDtoSchema),
  nextCursor: z.string().nullable(),
});

export const higherPrerequisiteDtoSchema = z.object({ id: higherUuidSchema, ueNodeId: higherUuidSchema, prerequisiteNodeId: higherUuidSchema, mode: higherPrerequisiteModeSchema, minAverage: higherDecimalSchema.nullable() });
export const higherMissingPrerequisiteDtoSchema = z.object({
  prerequisiteNodeId: higherUuidSchema,
  mode: higherPrerequisiteModeSchema,
  minAverage: higherDecimalSchema.nullable(),
  reason: z.enum(["NOT_ACQUIRED", "NOT_ATTENDED", "AVERAGE_TOO_LOW"]),
});
export const higherPrerequisiteCheckDtoSchema = z.object({ satisfied: z.boolean(), missing: z.array(higherMissingPrerequisiteDtoSchema) });
export const higherSetPrerequisitesResultDtoSchema = z.object({
  prerequisites: z.array(higherPrerequisiteDtoSchema),
  warnings: z.array(z.object({ studentId: higherUuidSchema, missing: z.array(higherMissingPrerequisiteDtoSchema) })),
});

export const higherResitWindowDtoSchema = z.object({
  id: higherUuidSchema,
  classroomId: higherUuidSchema,
  academicPeriodId: higherUuidSchema,
  resultsStateId: higherUuidSchema.nullable(),
  opensOn: higherDateSchema,
  closesOn: higherDateSchema,
  nodeIds: z.array(higherUuidSchema).nullable(),
  status: higherResitWindowStatusSchema,
  openedBy: higherUuidSchema,
  openedAt: higherInstantSchema,
  closedBy: higherUuidSchema.nullable(),
  closedAt: higherInstantSchema.nullable(),
});
export const higherResitRegistrationDtoSchema = z.object({
  id: higherUuidSchema,
  windowId: higherUuidSchema,
  enrollmentId: higherUuidSchema,
  studentId: higherUuidSchema,
  academicPeriodId: higherUuidSchema,
  ecueNodeId: higherUuidSchema,
  ueNodeId: higherUuidSchema,
  session1Average: higherDecimalSchema.nullable(),
  status: higherResitRegistrationStatusSchema,
  outcome: z.enum(["VALIDATED", "NOT_VALIDATED"]).nullable(),
});
export const higherOpenResitWindowResultDtoSchema = z.object({
  window: higherResitWindowDtoSchema,
  registrations: z.array(higherResitRegistrationDtoSchema),
  alreadyRegistered: z.number().int(),
});
export const higherResitWindowDetailDtoSchema = z.object({ window: higherResitWindowDtoSchema, registrations: z.array(higherResitRegistrationDtoSchema) });
export const higherResitCandidatesDtoSchema = z.object({
  stateId: higherUuidSchema,
  candidates: z.array(z.object({ enrollmentId: higherUuidSchema, studentId: higherUuidSchema, ecueNodeId: higherUuidSchema, ueNodeId: higherUuidSchema, session1Average: higherDecimalSchema.nullable() })),
});
export const higherStudentResitDtoSchema = higherResitRegistrationDtoSchema.extend({
  opensOn: higherDateSchema,
  closesOn: higherDateSchema,
  windowStatus: higherResitWindowStatusSchema,
  phase: higherResitPhaseSchema,
});

export const higherDocumentDtoSchema = z.object({
  id: higherUuidSchema,
  documentKind: higherDocumentKindSchema,
  awardId: higherUuidSchema.nullable(),
  studentId: higherUuidSchema,
  programNodeId: higherUuidSchema.nullable(),
  reference: z.string(),
  version: z.number().int(),
  supersedesId: higherUuidSchema.nullable(),
  status: higherDocumentStatusSchema,
  snapshotSchema: z.string(),
  snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  verificationCode: z.string(),
  sealed: z.boolean(),
  renderStatus: higherRenderStatusSchema,
  issuedAt: higherInstantSchema,
  issuedByName: z.string(),
  publishedAt: higherInstantSchema.nullable(),
  revokedAt: higherInstantSchema.nullable(),
  revokeReason: z.string().nullable(),
});
/** Détail : le snapshot (lisible par le personnel habilité et par l'étudiant pour ses documents publiés). */
export const higherDocumentDetailDtoSchema = higherDocumentDtoSchema.extend({ snapshot: z.record(z.string(), z.unknown()) });
export const higherIssuedDocumentDtoSchema = z.object({ document: higherDocumentDetailDtoSchema, created: z.boolean() });
export const higherDocumentsPageDtoSchema = z.object({ items: z.array(higherDocumentDtoSchema), nextCursor: z.string().nullable() });

export const higherAttestationRosterRowDtoSchema = z.object({
  studentId: higherUuidSchema,
  fullName: z.string().nullable(),
  matricule: z.string().nullable(),
  classroomId: higherUuidSchema,
  academicYearId: higherUuidSchema,
  ueAcquired: z.number().int(),
  ueRequired: z.number().int(),
  creditsAcquired: z.number(),
  eligible: z.boolean(),
  missingUeNodeIds: z.array(higherUuidSchema),
  acquiredDate: higherDateSchema.nullable(),
  documentId: higherUuidSchema.nullable(),
  reference: z.string().nullable(),
});

export const higherSlotDtoSchema = z.object({
  id: higherUuidSchema,
  slotKey: higherSlotKeySchema,
  signatoryId: higherUuidSchema,
  validFrom: higherDateSchema,
  validTo: higherDateSchema.nullable(),
  createdAt: higherInstantSchema,
});

export const higherSettingsDtoSchema = z.object({ creditValidityMonths: z.number().int().nullable() });
export const higherExemptionSettingsDtoSchema = z.object({ exemptionCreditPolicy: higherExemptionCreditPolicySchema });

export const higherAnnualUeDtoSchema = z.object({
  id: higherUuidSchema,
  ueNodeId: higherUuidSchema,
  memberNodeIds: z.array(higherUuidSchema),
  partsExpected: z.number().int(),
  reason: z.string(),
  createdAt: higherInstantSchema,
  /** Code et libellé de l'UE principale et des UE membres (lus du curriculum à l'affichage ; absents si l'UE n'existe plus). */
  ueCode: z.string().nullable().optional(),
  ueLabel: z.string().nullable().optional(),
  members: z.array(z.object({ ueNodeId: higherUuidSchema, code: z.string().nullable(), label: z.string().nullable() })).optional(),
});
export type HigherAnnualUeDto = z.infer<typeof higherAnnualUeDtoSchema>;

export const higherExemptionDtoSchema = z.object({
  id: higherUuidSchema,
  studentId: higherUuidSchema,
  enrollmentId: higherUuidSchema,
  ueNodeId: higherUuidSchema,
  academicYearId: higherUuidSchema,
  academicPeriodId: higherUuidSchema,
  credits: z.number(),
  reason: z.string(),
  creditPolicy: higherExemptionCreditPolicySchema,
  ledgerId: higherUuidSchema.nullable(),
  status: higherExemptionStatusSchema,
  grantedBy: higherUuidSchema,
  grantedAt: higherInstantSchema,
  revokedBy: higherUuidSchema.nullable(),
  revokedAt: higherInstantSchema.nullable(),
  revokeReason: z.string().nullable(),
  /** Libellé de l'UE (lu du curriculum à l'affichage ; `null` si l'UE n'existe plus). */
  ueCode: z.string().nullable().optional(),
  ueLabel: z.string().nullable().optional(),
});
export type HigherExemptionDto = z.infer<typeof higherExemptionDtoSchema>;

export const higherPathwayDtoSchema = z.object({
  studentId: higherUuidSchema,
  summary: higherCreditSummaryDtoSchema,
  acquired: z.array(higherLedgerEntryDtoSchema),
  debts: z.array(higherDebtDtoSchema),
  resits: z.array(higherStudentResitDtoSchema),
  diplomas: higherStudentDiplomasDtoSchema,
});

// ---------------------------------------------------------------------------
// Événements publiés (payload JSON versionné `{ v: 1, … }`)
// ---------------------------------------------------------------------------

const v1 = z.literal(1);

export const higherEventPayloadSchemas = {
  "higher.credits.capitalized": z.object({
    v: v1,
    studentId: higherUuidSchema,
    ueNodeId: higherUuidSchema,
    credits: z.number(),
    yearId: higherUuidSchema,
    via: higherAcquiredViaSchema,
    sessionObtained: z.union([z.literal(1), z.literal(2)]),
    ledgerId: higherUuidSchema,
  }),
  "higher.credits.revoked": z.object({ v: v1, ledgerId: higherUuidSchema, studentId: higherUuidSchema, ueNodeId: higherUuidSchema, reason: z.string() }),
  "higher.credits.expired": z.object({ v: v1, ledgerId: higherUuidSchema, studentId: higherUuidSchema, ueNodeId: higherUuidSchema }),
  "higher.credits.revocation_blocked": z.object({ v: v1, ledgerId: higherUuidSchema, studentId: higherUuidSchema, ueNodeId: higherUuidSchema, awardIds: z.array(higherUuidSchema) }),
  "higher.ue.debt_detected": z.object({ v: v1, studentId: higherUuidSchema, ueNodeId: higherUuidSchema, periodId: higherUuidSchema }),
  "higher.ue.exempted": z.object({
    v: v1,
    exemptionId: higherUuidSchema,
    studentId: higherUuidSchema,
    ueNodeId: higherUuidSchema,
    enrollmentId: higherUuidSchema,
    creditPolicy: higherExemptionCreditPolicySchema,
    ledgerId: higherUuidSchema.nullable(),
  }),
  "higher.ue.exemption_revoked": z.object({ v: v1, exemptionId: higherUuidSchema, studentId: higherUuidSchema, ueNodeId: higherUuidSchema }),
  "higher.resit.window_opened": z.object({ v: v1, windowId: higherUuidSchema, classroomId: higherUuidSchema, periodId: higherUuidSchema, nodeIds: z.array(higherUuidSchema) }),
  "higher.resit.window_closed": z.object({ v: v1, windowId: higherUuidSchema, classroomId: higherUuidSchema, periodId: higherUuidSchema, nodeIds: z.array(higherUuidSchema) }),
  "higher.resit.registered": z.object({ v: v1, registrationId: higherUuidSchema, enrollmentId: higherUuidSchema, nodeId: higherUuidSchema, periodId: higherUuidSchema }),
  "higher.diploma.eligible": z.object({ v: v1, studentId: higherUuidSchema, definitionId: higherUuidSchema }),
  "higher.diploma.awarded": z.object({ v: v1, awardId: higherUuidSchema, studentId: higherUuidSchema, definitionId: higherUuidSchema, reference: z.string(), via: higherAwardedViaSchema }),
  "higher.diploma.revoked": z.object({ v: v1, awardId: higherUuidSchema, studentId: higherUuidSchema, definitionId: higherUuidSchema, reason: z.string() }),
  "higher.document.issued": z.object({ v: v1, documentId: higherUuidSchema, kind: higherDocumentKindSchema, awardId: higherUuidSchema.optional() }),
  "higher.document.render_requested": z.object({ v: v1, documentId: higherUuidSchema, kind: higherDocumentKindSchema }),
} as const;

export type HigherEventType = keyof typeof higherEventPayloadSchemas;

// Types dérivés
export type HigherCreateDiplomaBody = z.infer<typeof higherCreateDiplomaBodySchema>;
export type HigherAwardBody = z.infer<typeof higherAwardBodySchema>;
export type HigherDiplomaDto = z.infer<typeof higherDiplomaDtoSchema>;
export type HigherAwardDto = z.infer<typeof higherAwardDtoSchema>;
export type HigherDocumentDto = z.infer<typeof higherDocumentDtoSchema>;
