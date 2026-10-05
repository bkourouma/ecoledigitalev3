/**
 * Contrats du module `primary_school` (routes `/api/v1/primary_school/*`, événements `primary_school.*`) — pack Primary :
 * évaluation par compétences (maternelle et primaire), appréciations, conseil des maîtres, bilan annuel scellé, archives.
 * Écrits avant les routes (ADR-001 règle 6) ; le client web est typé à partir de ces schémas.
 *
 * Conventions (ADR-007, module-conventions.md) :
 *  - IDENTIFIANTS : UUID. Classe, période, année, inscription, élève, personnel, délibération, décision sont des références
 *    SANS clé étrangère vers academic, people, results et reportcards ; les niveaux de classe (PS, CP1…) sont désignés par leur CODE.
 *  - DATES calendaires : `AAAA-MM-JJ` ; INSTANTS : ISO 8601 avec fuseau.
 *  - AUCUNE règle réglementaire : ce module ne calcule ni moyenne, ni rang, ni décision de passage. Les niveaux de maîtrise sont
 *    COMPTÉS (jamais moyennés). Toute valeur de référentiel porte son origine (`sourceKind`) ; `placeholder` = jeu FICTIF de démonstration.
 *  - Aucun contenu pédagogique (appréciation, note, niveau) dans les événements ni dans l'audit.
 *  - Messages utilisateur en français ; codes d'erreur stables `primary_school.*`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const primaryUuidSchema = z.string().uuid();

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const primaryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine(isRealDate, "Date inexistante.");
export const primaryInstantSchema = z.string().datetime({ offset: true });

/** Code de référentiel : majuscules, chiffres et `_`. */
export const primaryCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Code attendu : majuscules, chiffres et _ (2 à 40).");
/** Code de niveau d'une échelle (`N1`) ou de niveau de classe (`CP1`). */
export const primaryLevelCodeSchema = z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,39}$/, "Code attendu : majuscules, chiffres et _ (1 à 40).");
/** Code de domaine ou de compétence (`D1.2`). */
export const primaryCompetencyCodeSchema = z.string().regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/, "Code attendu : majuscules, chiffres, . - et _ (1 à 40).");
export const primaryPhraseCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/, "Code attendu : majuscules, chiffres et _ (2 à 60).");
const labelSchema = z.string().trim().min(1).max(200);

export const PRIMARY_SOURCE_KINDS = ["regulation", "institution", "platform", "placeholder"] as const;
export const primarySourceKindSchema = z.enum(PRIMARY_SOURCE_KINDS);
export type PrimarySourceKind = z.infer<typeof primarySourceKindSchema>;

export const PRIMARY_SCALE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const primaryScaleStatusSchema = z.enum(PRIMARY_SCALE_STATUSES);
export const PRIMARY_FRAMEWORK_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"] as const;
export const primaryFrameworkStatusSchema = z.enum(PRIMARY_FRAMEWORK_STATUSES);
export const PRIMARY_ASSESSMENT_STATUSES = ["DRAFT", "VALIDATED"] as const;
export const primaryAssessmentStatusSchema = z.enum(PRIMARY_ASSESSMENT_STATUSES);
export const PRIMARY_PHRASE_SCOPES = ["PERIOD", "YEAR", "COMPETENCY"] as const;
export const primaryPhraseScopeSchema = z.enum(PRIMARY_PHRASE_SCOPES);
export const PRIMARY_CASE_STATUSES = ["OPEN", "DECIDED", "DEFERRED"] as const;
export const primaryCaseStatusSchema = z.enum(PRIMARY_CASE_STATUSES);
export const PRIMARY_COUNCIL_ROLES = ["CHAIR", "HOMEROOM", "TEACHER", "SPECIALIST", "DIRECTOR", "SECRETARY", "OTHER"] as const;
export const primaryCouncilRoleSchema = z.enum(PRIMARY_COUNCIL_ROLES);
export const PRIMARY_REVIEW_STATUSES = ["DRAFT", "READY", "SEALED", "SUPERSEDED"] as const;
export const primaryReviewStatusSchema = z.enum(PRIMARY_REVIEW_STATUSES);
export const PRIMARY_ARCHIVE_STATUSES = ["PREPARING", "READY", "FROZEN"] as const;
export const primaryArchiveStatusSchema = z.enum(PRIMARY_ARCHIVE_STATUSES);
/** Motifs d'examen d'un dossier de conseil (codes fournis par les règles ; `MANUAL` = posé à la main ; `RULE_REVIEW` = « la règle ne tranche pas »). */
export const PRIMARY_REASON_CODES = ["BORDERLINE", "LONG_ABSENCE", "ALREADY_REPEATED", "RULE_REVIEW", "MANUAL"] as const;
export const primaryReasonCodeSchema = z.enum(PRIMARY_REASON_CODES);
/** Propositions d'une règle de fin d'année (contrat `coef-period@1`) : des CODES, jamais des libellés. */
export const PRIMARY_RULE_PROPOSALS = ["PENDING", "PROMOTED", "REPEAT", "COUNCIL_REVIEW"] as const;
export const primaryRuleProposalSchema = z.enum(PRIMARY_RULE_PROPOSALS);
export const PRIMARY_OUTCOME_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/);

// ---------------------------------------------------------------------------
// Paramètres de l'établissement
// ---------------------------------------------------------------------------

export const primarySettingsDtoSchema = z.object({
  institutionId: primaryUuidSchema,
  requireHomeroomForActivation: z.boolean(),
  councilRequiredForBilan: z.boolean(),
  phraseBankEnabled: z.boolean(),
  defaultRatingScaleId: primaryUuidSchema.nullable(),
  /** `null` = durée de conservation non déterminée (question métier Q-P11) : aucune purge. */
  archiveRetentionYears: z.number().int().positive().nullable(),
});
export type PrimarySettingsDto = z.infer<typeof primarySettingsDtoSchema>;

export const primaryUpdateSettingsBodySchema = z
  .object({
    institutionId: primaryUuidSchema.optional(),
    requireHomeroomForActivation: z.boolean().optional(),
    councilRequiredForBilan: z.boolean().optional(),
    phraseBankEnabled: z.boolean().optional(),
    defaultRatingScaleId: primaryUuidSchema.nullable().optional(),
    archiveRetentionYears: z.number().int().positive().max(200).nullable().optional(),
  })
  .strict();
export type PrimaryUpdateSettingsBody = z.infer<typeof primaryUpdateSettingsBodySchema>;

export const primarySettingsQuerySchema = z.object({ institutionId: primaryUuidSchema.optional() });

// ---------------------------------------------------------------------------
// Échelles d'appréciation
// ---------------------------------------------------------------------------

export const primaryRatingLevelDtoSchema = z.object({
  id: primaryUuidSchema,
  code: primaryLevelCodeSchema,
  label: z.string(),
  ordinal: z.number().int().min(1),
  /** Drapeau PÉDAGOGIQUE de synthèse (« attendu atteint ») : ce n'est ni un seuil ni une règle. */
  meetsExpectation: z.boolean(),
});
export type PrimaryRatingLevelDto = z.infer<typeof primaryRatingLevelDtoSchema>;

export const primaryRatingScaleDtoSchema = z.object({
  id: primaryUuidSchema,
  code: primaryCodeSchema,
  label: z.string(),
  sourceKind: primarySourceKindSchema,
  sourceReference: z.string().nullable(),
  status: primaryScaleStatusSchema,
  levels: z.array(primaryRatingLevelDtoSchema),
  /** Au moins un référentiel publié l'emploie : ses niveaux ne se modifient plus. */
  locked: z.boolean(),
});
export type PrimaryRatingScaleDto = z.infer<typeof primaryRatingScaleDtoSchema>;

export const primaryLevelInputSchema = z.object({
  code: primaryLevelCodeSchema,
  label: labelSchema,
  ordinal: z.number().int().min(1).max(50),
  meetsExpectation: z.boolean().default(false),
});
export type PrimaryLevelInput = z.infer<typeof primaryLevelInputSchema>;

const refine = {
  /** `regulation` exige la référence du texte (contrainte SQL reprise ici pour un message clair). */
  source: (v: { sourceKind?: string | undefined; sourceReference?: string | null | undefined }): boolean =>
    v.sourceKind !== "regulation" || (typeof v.sourceReference === "string" && v.sourceReference.trim().length > 0),
};

export const primaryCreateScaleBodySchema = z
  .object({
    code: primaryCodeSchema,
    label: labelSchema,
    sourceKind: primarySourceKindSchema.default("institution"),
    sourceReference: z.string().trim().min(1).max(500).nullable().optional(),
    levels: z.array(primaryLevelInputSchema).min(2, "Une échelle compte au moins deux niveaux.").max(12),
  })
  .strict()
  .refine(refine.source, { path: ["sourceReference"], message: "Un référentiel réglementaire cite son texte." });
export type PrimaryCreateScaleBody = z.infer<typeof primaryCreateScaleBodySchema>;

export const primaryUpdateScaleBodySchema = z.object({ label: labelSchema.optional(), status: primaryScaleStatusSchema.optional() }).strict();
export const primaryPutLevelsBodySchema = z.object({ levels: z.array(primaryLevelInputSchema).min(2).max(12) }).strict();

// ---------------------------------------------------------------------------
// Référentiels de compétences
// ---------------------------------------------------------------------------

export const primaryCompetencyDtoSchema = z.object({
  id: primaryUuidSchema,
  code: primaryCompetencyCodeSchema,
  label: z.string(),
  description: z.string().nullable(),
  ordinal: z.number().int().min(1),
});
export type PrimaryCompetencyDto = z.infer<typeof primaryCompetencyDtoSchema>;

export const primaryDomainDtoSchema = z.object({
  id: primaryUuidSchema,
  code: primaryCompetencyCodeSchema,
  label: z.string(),
  ordinal: z.number().int().min(1),
  competencies: z.array(primaryCompetencyDtoSchema),
});
export type PrimaryDomainDto = z.infer<typeof primaryDomainDtoSchema>;

export const primaryFrameworkDtoSchema = z.object({
  id: primaryUuidSchema,
  code: primaryCodeSchema,
  version: z.number().int().min(1),
  label: z.string(),
  scaleId: primaryUuidSchema,
  status: primaryFrameworkStatusSchema,
  sourceKind: primarySourceKindSchema,
  sourceReference: z.string().nullable(),
  publishedAt: primaryInstantSchema.nullable(),
  gradeLevelCodes: z.array(primaryLevelCodeSchema),
  competencyCount: z.number().int().min(0),
});
export type PrimaryFrameworkDto = z.infer<typeof primaryFrameworkDtoSchema>;

export const primaryFrameworkDetailDtoSchema = primaryFrameworkDtoSchema.extend({
  domains: z.array(primaryDomainDtoSchema),
  scale: primaryRatingScaleDtoSchema,
  /** Manques empêchant la publication (liste vide = publiable). */
  publishBlockers: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type PrimaryFrameworkDetailDto = z.infer<typeof primaryFrameworkDetailDtoSchema>;

export const primaryCreateFrameworkBodySchema = z
  .object({
    code: primaryCodeSchema,
    label: labelSchema,
    scaleId: primaryUuidSchema,
    gradeLevelCodes: z.array(primaryLevelCodeSchema).max(20).default([]),
    sourceKind: primarySourceKindSchema.default("institution"),
    sourceReference: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict()
  .refine(refine.source, { path: ["sourceReference"], message: "Un référentiel réglementaire cite son texte." });
export type PrimaryCreateFrameworkBody = z.infer<typeof primaryCreateFrameworkBodySchema>;

export const primaryStructureBodySchema = z
  .object({
    label: labelSchema.optional(),
    gradeLevelCodes: z.array(primaryLevelCodeSchema).max(20).optional(),
    domains: z
      .array(
        z.object({
          code: primaryCompetencyCodeSchema,
          label: labelSchema,
          competencies: z
            .array(z.object({ code: primaryCompetencyCodeSchema, label: labelSchema, description: z.string().trim().max(1000).nullable().optional() }))
            .max(200),
        }),
      )
      .max(60),
  })
  .strict();
export type PrimaryStructureBody = z.infer<typeof primaryStructureBodySchema>;

export const primaryFrameworkListQuerySchema = z.object({
  status: primaryFrameworkStatusSchema.optional(),
  gradeLevelCode: primaryLevelCodeSchema.optional(),
});

// ---------------------------------------------------------------------------
// Évaluation par compétences
// ---------------------------------------------------------------------------

export const primaryAssessmentDtoSchema = z.object({
  id: primaryUuidSchema,
  enrollmentId: primaryUuidSchema,
  studentId: primaryUuidSchema,
  competencyId: primaryUuidSchema,
  ratingLevelId: primaryUuidSchema,
  observedOn: primaryDateSchema,
  note: z.string().nullable(),
  status: primaryAssessmentStatusSchema,
  rowVersion: z.number().int().min(1),
  validatedAt: primaryInstantSchema.nullable(),
});
export type PrimaryAssessmentDto = z.infer<typeof primaryAssessmentDtoSchema>;

export const primarySheetQuerySchema = z.object({ periodId: primaryUuidSchema, frameworkId: primaryUuidSchema.optional() });

export const primaryCompetencySheetDtoSchema = z.object({
  classroomId: primaryUuidSchema,
  periodId: primaryUuidSchema,
  gradeLevelCode: z.string(),
  /** La saisie est arrêtée pour cette classe et cette période (période verrouillée). */
  locked: z.boolean(),
  frameworks: z.array(primaryFrameworkDtoSchema),
  framework: primaryFrameworkDetailDtoSchema.nullable(),
  students: z.array(z.object({ enrollmentId: primaryUuidSchema, studentId: primaryUuidSchema, displayName: z.string().nullable(), isRepeating: z.boolean() })),
  assessments: z.array(primaryAssessmentDtoSchema),
  completeness: z.object({
    expected: z.number().int().min(0),
    recorded: z.number().int().min(0),
    validated: z.number().int().min(0),
    byEnrollment: z.array(z.object({ enrollmentId: primaryUuidSchema, recorded: z.number().int().min(0), validated: z.number().int().min(0) })),
  }),
});
export type PrimaryCompetencySheetDto = z.infer<typeof primaryCompetencySheetDtoSchema>;

export const PRIMARY_BULK_MAX_LINES = 500;

export const primaryBulkLineSchema = z.object({
  enrollmentId: primaryUuidSchema,
  competencyId: primaryUuidSchema,
  ratingLevelId: primaryUuidSchema,
  observedOn: primaryDateSchema.optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Exigé pour modifier une ligne EXISTANTE dont la valeur diffère (verrou optimiste). */
  rowVersion: z.number().int().min(1).optional(),
});
export type PrimaryBulkLine = z.infer<typeof primaryBulkLineSchema>;

export const primaryBulkRecordBodySchema = z
  .object({
    classroomId: primaryUuidSchema,
    periodId: primaryUuidSchema,
    frameworkId: primaryUuidSchema,
    lines: z.array(primaryBulkLineSchema).min(1).max(PRIMARY_BULK_MAX_LINES),
  })
  .strict();
export type PrimaryBulkRecordBody = z.infer<typeof primaryBulkRecordBodySchema>;

export const primaryBulkResultDtoSchema = z.object({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  assessments: z.array(primaryAssessmentDtoSchema),
});
export type PrimaryBulkResultDto = z.infer<typeof primaryBulkResultDtoSchema>;

export const primaryValidateBodySchema = z.object({ frameworkId: primaryUuidSchema.optional() }).strict();
export const primaryValidateResultDtoSchema = z.object({
  validated: z.number().int().min(0),
  alreadyValidated: z.number().int().min(0),
  expected: z.number().int().min(0),
  /** Compétences attendues non saisies (rien n'est inventé : elles restent « non évaluées »). */
  missing: z.number().int().min(0),
});
export type PrimaryValidateResultDto = z.infer<typeof primaryValidateResultDtoSchema>;

export const primaryReviseBodySchema = z
  .object({ toRatingLevelId: primaryUuidSchema, reason: z.string().trim().min(10, "Le motif compte au moins 10 caractères.").max(1000) })
  .strict();
export type PrimaryReviseBody = z.infer<typeof primaryReviseBodySchema>;

export const primaryRevisionDtoSchema = z.object({
  id: primaryUuidSchema,
  assessmentId: primaryUuidSchema,
  fromLevelId: primaryUuidSchema,
  toLevelId: primaryUuidSchema,
  reason: z.string(),
  requestedBy: primaryUuidSchema,
  createdAt: primaryInstantSchema,
});
export type PrimaryRevisionDto = z.infer<typeof primaryRevisionDtoSchema>;

export const primarySummaryQuerySchema = z.object({
  periodIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(primaryUuidSchema).max(12).optional()),
});

/** `{ domaine: { niveau: n } }` : COMPTEURS de lignes validées. Aucune moyenne, aucun seuil. */
export const primaryCompetencySummarySchema = z.record(z.record(z.number().int().min(0)));
export type PrimaryCompetencySummary = z.infer<typeof primaryCompetencySummarySchema>;

export const primaryCompetencySummaryDtoSchema = z.object({
  enrollmentId: primaryUuidSchema,
  periodIds: z.array(primaryUuidSchema).nullable(),
  summary: primaryCompetencySummarySchema,
  /** Libellés des domaines et des niveaux pour l'affichage (code -> libellé). */
  domainLabels: z.record(z.string()),
  levelLabels: z.record(z.string()),
  levelOrder: z.array(z.string()),
});
export type PrimaryCompetencySummaryDto = z.infer<typeof primaryCompetencySummaryDtoSchema>;

// ---------------------------------------------------------------------------
// Banque d'appréciations
// ---------------------------------------------------------------------------

export const primaryPhraseDtoSchema = z.object({
  id: primaryUuidSchema,
  code: primaryPhraseCodeSchema,
  scope: primaryPhraseScopeSchema,
  body: z.string(),
  ratingLevelCode: z.string().nullable(),
  gradeLevelCode: z.string().nullable(),
  sourceKind: primarySourceKindSchema,
  active: z.boolean(),
});
export type PrimaryPhraseDto = z.infer<typeof primaryPhraseDtoSchema>;

export const primaryCreatePhraseBodySchema = z
  .object({
    code: primaryPhraseCodeSchema,
    scope: primaryPhraseScopeSchema,
    body: z.string().trim().min(1).max(300),
    ratingLevelCode: primaryLevelCodeSchema.nullable().optional(),
    gradeLevelCode: primaryLevelCodeSchema.nullable().optional(),
    sourceKind: primarySourceKindSchema.default("institution"),
  })
  .strict();
export type PrimaryCreatePhraseBody = z.infer<typeof primaryCreatePhraseBodySchema>;

export const primaryUpdatePhraseBodySchema = z
  .object({
    body: z.string().trim().min(1).max(300).optional(),
    ratingLevelCode: primaryLevelCodeSchema.nullable().optional(),
    gradeLevelCode: primaryLevelCodeSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const primaryPhraseListQuerySchema = z.object({
  scope: primaryPhraseScopeSchema.optional(),
  ratingLevelCode: primaryLevelCodeSchema.optional(),
  gradeLevelCode: primaryLevelCodeSchema.optional(),
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

// ---------------------------------------------------------------------------
// Conseil des maîtres
// ---------------------------------------------------------------------------

export const primaryPrepareCouncilBodySchema = z
  .object({
    classroomId: primaryUuidSchema,
    /** Période du conseil ; pour le conseil de fin d'année, la DERNIÈRE période de l'année. */
    periodId: primaryUuidSchema,
    heldOn: primaryDateSchema.optional(),
  })
  .strict();
export type PrimaryPrepareCouncilBody = z.infer<typeof primaryPrepareCouncilBodySchema>;

export const primaryCouncilCaseDtoSchema = z.object({
  id: primaryUuidSchema,
  deliberationId: primaryUuidSchema,
  classroomId: primaryUuidSchema,
  enrollmentId: primaryUuidSchema,
  studentId: primaryUuidSchema,
  studentName: z.string().nullable(),
  reasonCodes: z.array(z.string()),
  /** Proposition de la RÈGLE (code) telle que lue dans `results.decisions`. */
  ruleProposalCode: z.string().nullable(),
  /** Proposition de l'instituteur (code d'issue). */
  proposalCode: PRIMARY_OUTCOME_CODE.nullable(),
  proposalNote: z.string().nullable(),
  discussionNote: z.string().nullable(),
  status: primaryCaseStatusSchema,
  decisionRef: primaryUuidSchema.nullable(),
  /** Décision confirmée (code) ; `null` tant que le conseil n'a pas statué. */
  finalCode: z.string().nullable(),
  justification: z.string().nullable(),
});
export type PrimaryCouncilCaseDto = z.infer<typeof primaryCouncilCaseDtoSchema>;

export const primaryCouncilAttendanceDtoSchema = z.object({
  staffId: primaryUuidSchema,
  staffName: z.string().nullable(),
  roleCode: primaryCouncilRoleSchema,
  convened: z.boolean(),
  present: z.boolean().nullable(),
  signedAt: primaryInstantSchema.nullable(),
  note: z.string().nullable(),
});
export type PrimaryCouncilAttendanceDto = z.infer<typeof primaryCouncilAttendanceDtoSchema>;

export const primaryQuorumDtoSchema = z.object({
  convened: z.number().int().min(0),
  present: z.number().int().min(0),
  /** Évalué par la règle `quorum_conseil` du RuleSet lié ; `null` = aucune règle liée (aucun quorum bloquant, présence affichée). */
  met: z.boolean().nullable(),
  source: z.enum(["rule", "none"]),
});
export type PrimaryQuorumDto = z.infer<typeof primaryQuorumDtoSchema>;

export const primaryCouncilOverviewDtoSchema = z.object({
  deliberationId: primaryUuidSchema,
  classroomId: primaryUuidSchema,
  periodId: primaryUuidSchema,
  heldOn: primaryDateSchema.nullable(),
  /** `placeholder` : tout document issu de ce conseil porte la mention des règles de démonstration. */
  ruleSourceKind: primarySourceKindSchema.nullable(),
  counts: z.object({ total: z.number().int().min(0), open: z.number().int().min(0), decided: z.number().int().min(0), deferred: z.number().int().min(0) }),
  quorum: primaryQuorumDtoSchema,
  cases: z.array(primaryCouncilCaseDtoSchema),
  attendance: z.array(primaryCouncilAttendanceDtoSchema),
  minutesDocumentId: primaryUuidSchema.nullable(),
});
export type PrimaryCouncilOverviewDto = z.infer<typeof primaryCouncilOverviewDtoSchema>;

export const primaryCouncilSummaryDtoSchema = z.object({
  deliberationId: primaryUuidSchema,
  classroomId: primaryUuidSchema,
  periodId: primaryUuidSchema,
  total: z.number().int().min(0),
  open: z.number().int().min(0),
  decided: z.number().int().min(0),
});
export type PrimaryCouncilSummaryDto = z.infer<typeof primaryCouncilSummaryDtoSchema>;

export const primaryCouncilListQuerySchema = z.object({ classroomId: primaryUuidSchema.optional(), periodId: primaryUuidSchema.optional() });

export const primaryUpdateCaseBodySchema = z
  .object({
    proposalCode: PRIMARY_OUTCOME_CODE.nullable().optional(),
    proposalNote: z.string().trim().max(1000).nullable().optional(),
    discussionNote: z.string().trim().max(2000).nullable().optional(),
    /** `DEFERRED` : le conseil ne statue pas ce jour. `DECIDED` ne se pose que par `decide`. */
    status: z.enum(["OPEN", "DEFERRED"]).optional(),
    reasonCodes: z.array(primaryReasonCodeSchema).max(6).optional(),
  })
  .strict();
export type PrimaryUpdateCaseBody = z.infer<typeof primaryUpdateCaseBodySchema>;

export const primaryDecideCaseBodySchema = z
  .object({
    /** Absent : la proposition de la règle est confirmée telle quelle. */
    finalCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/).optional(),
    /** Exigée (20 caractères) quand la décision diffère de la proposition de la règle. */
    justification: z.string().trim().max(2000).optional(),
  })
  .strict();
export type PrimaryDecideCaseBody = z.infer<typeof primaryDecideCaseBodySchema>;

export const primaryAttendanceInputSchema = z.object({
  staffId: primaryUuidSchema,
  roleCode: primaryCouncilRoleSchema,
  convened: z.boolean().default(true),
  present: z.boolean().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const primaryPutAttendanceBodySchema = z
  .object({
    participants: z.array(primaryAttendanceInputSchema).min(1).max(60),
    /** Staff ayant signé la feuille (exige leur présence ; une présence signée est figée). */
    signedStaffIds: z.array(primaryUuidSchema).max(60).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const [i, p] of v.participants.entries()) {
      if (seen.has(p.staffId)) ctx.addIssue({ code: "custom", path: ["participants", i, "staffId"], message: "Participant en double." });
      seen.add(p.staffId);
    }
    const chairs = v.participants.filter((p) => p.roleCode === "CHAIR").length;
    const secretaries = v.participants.filter((p) => p.roleCode === "SECRETARY").length;
    if (chairs > 1) ctx.addIssue({ code: "custom", path: ["participants"], message: "Un seul président." });
    if (secretaries > 1) ctx.addIssue({ code: "custom", path: ["participants"], message: "Un seul secrétaire." });
  });
export type PrimaryPutAttendanceBody = z.infer<typeof primaryPutAttendanceBodySchema>;

export const primaryMinutesResultDtoSchema = z.object({ documentId: primaryUuidSchema, contentHash: z.string().regex(/^[0-9a-f]{64}$/) });
export type PrimaryMinutesResultDto = z.infer<typeof primaryMinutesResultDtoSchema>;

// ---------------------------------------------------------------------------
// Bilan annuel
// ---------------------------------------------------------------------------

/** Nombre de journées d'assiduité figé dans un bilan : entier, ou chaîne « N.5 » quand une demi-journée y est comptée. */
export const primaryDayCountSchema = z.union([z.number().int().min(0), z.string().regex(/^\d+\.5$/)]);

export const primaryAttendanceSummarySchema = z
  .object({
    // Journées : entiers avec l'appel unique ; avec l'appel du matin et de l'après-midi (décision Q-P17), une demi-journée s'écrit en chaîne
    // décimale exacte (« 2.5 »), convention des instantanés canoniques.
    openDays: primaryDayCountSchema.nullable().optional(),
    absentDays: primaryDayCountSchema.nullable().optional(),
    justifiedAbsentDays: primaryDayCountSchema.nullable().optional(),
    lateCount: primaryDayCountSchema.nullable().optional(),
  })
  .passthrough();

export const primaryAnnualReviewDtoSchema = z.object({
  id: primaryUuidSchema,
  academicYearId: primaryUuidSchema,
  enrollmentId: primaryUuidSchema,
  studentId: primaryUuidSchema,
  studentName: z.string().nullable(),
  classroomId: primaryUuidSchema,
  gradeLevelCode: z.string(),
  version: z.number().int().min(1),
  status: primaryReviewStatusSchema,
  yearResultRef: primaryUuidSchema.nullable(),
  decisionRef: primaryUuidSchema.nullable(),
  outcomeCode: PRIMARY_OUTCOME_CODE.nullable(),
  competencySummary: primaryCompetencySummarySchema,
  attendanceSummary: primaryAttendanceSummarySchema,
  ruleVersionRef: z.string().nullable(),
  /** `placeholder` : le document est marqué « Règles de démonstration — document sans valeur officielle ». */
  ruleSourceKind: primarySourceKindSchema.nullable(),
  contentHash: z.string().nullable(),
  sealedAt: primaryInstantSchema.nullable(),
  reportcardId: primaryUuidSchema.nullable(),
  supersedesId: primaryUuidSchema.nullable(),
  supersedeReason: z.string().nullable(),
});
export type PrimaryAnnualReviewDto = z.infer<typeof primaryAnnualReviewDtoSchema>;

export const primaryPrepareReviewsBodySchema = z.object({ classroomId: primaryUuidSchema, academicYearId: primaryUuidSchema }).strict();
export type PrimaryPrepareReviewsBody = z.infer<typeof primaryPrepareReviewsBodySchema>;

export const primaryPrepareReviewsResultDtoSchema = z.object({
  created: z.number().int().min(0),
  refreshed: z.number().int().min(0),
  skippedSealed: z.number().int().min(0),
  reviews: z.array(primaryAnnualReviewDtoSchema),
});
export type PrimaryPrepareReviewsResultDto = z.infer<typeof primaryPrepareReviewsResultDtoSchema>;

export const primaryReviewListQuerySchema = z.object({
  classroomId: primaryUuidSchema.optional(),
  yearId: primaryUuidSchema.optional(),
  status: primaryReviewStatusSchema.optional(),
});

export const primaryReissueBodySchema = z.object({ reason: z.string().trim().min(10, "Le motif compte au moins 10 caractères.").max(1000) }).strict();
export type PrimaryReissueBody = z.infer<typeof primaryReissueBodySchema>;

// ---------------------------------------------------------------------------
// Archives d'année
// ---------------------------------------------------------------------------

export const primaryYearArchiveDtoSchema = z.object({
  id: primaryUuidSchema,
  institutionId: primaryUuidSchema,
  academicYearId: primaryUuidSchema,
  status: primaryArchiveStatusSchema,
  reviewsTotal: z.number().int().min(0),
  reviewsSealed: z.number().int().min(0),
  manifestHash: z.string().nullable(),
  preparedAt: primaryInstantSchema.nullable(),
  frozenAt: primaryInstantSchema.nullable(),
  /** Empêchements du passage à `READY` (bilans non scellés…). */
  blockers: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type PrimaryYearArchiveDto = z.infer<typeof primaryYearArchiveDtoSchema>;

export const primaryPrepareArchiveBodySchema = z.object({ academicYearId: primaryUuidSchema, institutionId: primaryUuidSchema.optional() }).strict();
export type PrimaryPrepareArchiveBody = z.infer<typeof primaryPrepareArchiveBodySchema>;

export const primaryArchiveListQuerySchema = z.object({ yearId: primaryUuidSchema.optional() });

// ---------------------------------------------------------------------------
// Rapports (lecture seule)
// ---------------------------------------------------------------------------

export const PRIMARY_REPORT_KEYS = ["class-list", "enrollment-stats", "attendance-register", "repeaters", "competency-coverage", "council-pack", "progress"] as const;
export const primaryReportKeySchema = z.enum(PRIMARY_REPORT_KEYS);
export type PrimaryReportKey = z.infer<typeof primaryReportKeySchema>;

export const primaryReportQuerySchema = z.object({
  classroomId: primaryUuidSchema.optional(),
  periodId: primaryUuidSchema.optional(),
  yearId: primaryUuidSchema.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Mois attendu au format AAAA-MM.").optional(),
  deliberationId: primaryUuidSchema.optional(),
  format: z.enum(["json", "csv"]).default("json"),
});
export type PrimaryReportQuery = z.infer<typeof primaryReportQuerySchema>;

export const primaryReportDtoSchema = z.object({
  key: primaryReportKeySchema,
  title: z.string(),
  generatedAt: primaryInstantSchema,
  /** Paramètres reçus (le rapport est reproductible). */
  parameters: z.record(z.string().nullable()),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});
export type PrimaryReportDto = z.infer<typeof primaryReportDtoSchema>;

// ---------------------------------------------------------------------------
// Modèle de pack
// ---------------------------------------------------------------------------

export const primaryApplyTemplateBodySchema = z.object({ institutionId: primaryUuidSchema.optional() }).strict();
export const primaryTemplateResultDtoSchema = z.object({
  institutionId: primaryUuidSchema,
  templateVersion: z.number().int().min(1),
  alreadyApplied: z.boolean(),
  created: z.object({ scales: z.number().int(), frameworks: z.number().int(), phrases: z.number().int(), settings: z.number().int() }),
});
export type PrimaryTemplateResultDto = z.infer<typeof primaryTemplateResultDtoSchema>;

// ---------------------------------------------------------------------------
// Vues d'accès (portails)
// ---------------------------------------------------------------------------

/** « Ma classe » (instituteur) : classes visibles et état du verrou par période. */
export const primaryMyClassroomDtoSchema = z.object({
  classroomId: primaryUuidSchema,
  name: z.string().nullable(),
  gradeLevelCode: z.string().nullable(),
  academicYearId: primaryUuidSchema,
  studentCount: z.number().int().min(0),
  periods: z.array(z.object({ id: primaryUuidSchema, label: z.string(), locked: z.boolean() })),
  isHomeroom: z.boolean(),
});
export type PrimaryMyClassroomDto = z.infer<typeof primaryMyClassroomDtoSchema>;

/** Avancement d'une classe (direction) : feux vert / orange / rouge calculés SANS seuil (comptages bruts). */
export const primaryProgressDtoSchema = z.object({
  classroomId: primaryUuidSchema,
  name: z.string().nullable(),
  periodId: primaryUuidSchema,
  locked: z.boolean(),
  studentCount: z.number().int().min(0),
  competencies: z.object({ expected: z.number().int().min(0), recorded: z.number().int().min(0), validated: z.number().int().min(0) }),
  reviews: z.object({ total: z.number().int().min(0), sealed: z.number().int().min(0) }),
});
export type PrimaryProgressDto = z.infer<typeof primaryProgressDtoSchema>;

/** Placeholder : à afficher en bandeau permanent tant que le RuleSet lié est fictif. */
export const primaryRuleBannerDtoSchema = z.object({ ruleSourceKind: primarySourceKindSchema.nullable(), isPlaceholder: z.boolean() });
export type PrimaryRuleBannerDto = z.infer<typeof primaryRuleBannerDtoSchema>;

/** Mention affichée sur tout document issu d'un jeu de règles fictif. */
export const PRIMARY_PLACEHOLDER_NOTICE = "Règles de démonstration — document sans valeur officielle";

// ---------------------------------------------------------------------------
// Événements (outbox, `{ v: 1, … }`, aucun contenu pédagogique)
// ---------------------------------------------------------------------------

export const PRIMARY_EVENT_TYPES = [
  "primary_school.template.applied",
  "primary_school.framework.published",
  "primary_school.competency.validated",
  "primary_school.competency.revised",
  "primary_school.council.prepared",
  "primary_school.council.minutes_requested",
  "primary_school.annual_review.sealed",
  "primary_school.annual_review.superseded",
  "primary_school.year_archive.ready",
  "primary_school.year_archive.frozen",
] as const;

/** Codes d'erreur stables (liste indicative : voir `apps/api/src/modules/primary_school/domain/errors.ts`). */
export const PRIMARY_ERROR_CODES = [
  "primary_school.invalid_input",
  "primary_school.forbidden",
  "primary_school.port_unavailable",
  "primary_school.template_unavailable",
  "primary_school.framework_not_published",
  "primary_school.scale_mismatch",
  "primary_school.period_locked",
  "primary_school.validated_frozen",
  "primary_school.review_needs_results",
  "primary_school.review_needs_decision",
  "primary_school.review_sealed",
  "primary_school.year_frozen",
  "primary_school.archive_frozen",
  "primary_school.homeroom_required",
] as const;

/**
 * Charge utile de chaque événement PUBLIÉ par primary_school (`{ v: 1, … }`). Source de vérité des tests de contrat
 * (`apps/api/test/events-contracts`) : elle suit exactement les appels `events.add` du module. Aucune appréciation, aucun niveau de
 * maîtrise, aucune note, aucun nom d'élève : seulement des identifiants, des comptages, des codes et des empreintes.
 */
const primaryEventHash = z.string().regex(/^[0-9a-f]{64}$/);
export const primaryEventPayloadSchemas = {
  "primary_school.template.applied": z.object({
    v: z.literal(1),
    institutionId: primaryUuidSchema,
    educationSystem: z.string(),
    templateVersion: z.number().int().min(1),
    scales: z.number().int(),
    frameworks: z.number().int(),
    phrases: z.number().int(),
    settings: z.number().int(),
  }),
  "primary_school.framework.published": z.object({ v: z.literal(1), frameworkId: primaryUuidSchema, code: z.string(), version: z.number().int(), retiredVersions: z.number().int() }),
  "primary_school.competency.validated": z.object({ v: z.literal(1), classroomId: primaryUuidSchema, periodId: primaryUuidSchema, frameworkId: primaryUuidSchema.nullable(), validated: z.number().int(), missing: z.number().int() }),
  "primary_school.competency.revised": z.object({ v: z.literal(1), assessmentId: primaryUuidSchema, revisionId: primaryUuidSchema, classroomId: primaryUuidSchema, periodId: primaryUuidSchema, enrollmentId: primaryUuidSchema }),
  "primary_school.council.prepared": z.object({ v: z.literal(1), deliberationId: primaryUuidSchema, classroomId: primaryUuidSchema, periodId: primaryUuidSchema, cases: z.number().int() }),
  "primary_school.council.minutes_requested": z.object({ v: z.literal(1), deliberationId: primaryUuidSchema, classroomId: primaryUuidSchema, periodId: primaryUuidSchema, version: z.number().int(), documentId: primaryUuidSchema }),
  "primary_school.annual_review.sealed": z.object({ v: z.literal(1), reviewId: primaryUuidSchema, enrollmentId: primaryUuidSchema, classroomId: primaryUuidSchema, academicYearId: primaryUuidSchema, version: z.number().int(), contentHash: primaryEventHash }),
  "primary_school.annual_review.superseded": z.object({ v: z.literal(1), reviewId: primaryUuidSchema, replacedByReviewId: primaryUuidSchema, enrollmentId: primaryUuidSchema, academicYearId: primaryUuidSchema, version: z.number().int() }),
  "primary_school.year_archive.ready": z.object({ v: z.literal(1), archiveId: primaryUuidSchema, institutionId: primaryUuidSchema, academicYearId: primaryUuidSchema, reviews: z.number().int(), manifestHash: primaryEventHash.nullable() }),
  "primary_school.year_archive.frozen": z.object({ v: z.literal(1), archiveId: primaryUuidSchema, institutionId: primaryUuidSchema, academicYearId: primaryUuidSchema, reviews: z.number().int(), manifestHash: primaryEventHash.nullable() }),
} as const;
