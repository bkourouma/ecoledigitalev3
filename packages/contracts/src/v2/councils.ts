/**
 * Contrats du module `councils` — conseil de classe du secondaire, procès-verbal, délibérations, orientation
 * (routes `/api/v1/councils/*`, événements `councils.*`). Écrits avant les routes (ADR-001 règle 6) ; le client web typé
 * (`apps/web/src/platform/v2/councils.ts`) s'appuie dessus.
 *
 * Conventions (ADR-007, module-conventions.md, spec v2/006 §4 US1-US7, §8.1) :
 *  - IDENTIFIANTS : UUID. Classes, périodes, inscriptions, élèves, personnel, programmes, niveaux : références SANS clé
 *    étrangère (vérifiées par des ports vers `academic`, `people`, `results`, `attendance`, `schoollife`).
 *  - L'HUMAIN DÉCIDE : décideur, résolveur, signataire, demandeur/approbateur d'un déverrouillage = l'utilisateur de la
 *    session (jamais un champ de la requête) ; la base refuse un job ou le système.
 *  - AUCUN CALCUL : les faits d'un élève (`council-facts/1`) et le procès-verbal (`council-minutes/1`) ne contiennent que des
 *    CHAÎNES, ENTIERS, BOOLÉENS et `null` — moyennes en chaînes décimales exactes lues de `results`, jamais un flottant.
 *  - AUCUNE VALEUR RÉGLEMENTAIRE : quorum, rôles exigés, signataires, types de décision, parcours d'orientation sont des
 *    DONNÉES d'établissement (`null` / vide par défaut). Le jeu de règles `placeholder` est signalé (`ruleSourceKind`).
 *  - CONFIDENTIALITÉ : une famille ne voit que sa décision, selon `guardianVisibility` — jamais la suggestion de la règle, le
 *    vote ni la justification interne (`councilsFamilyDecisionDtoSchema`).
 *  - Messages utilisateur en français ; codes d'erreur stables `councils.*`.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const councilsUuidSchema = z.string().uuid();
export const councilsDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Date inexistante.");
export const councilsInstantSchema = z.string().datetime({ offset: true });
export const councilsCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/, "Code attendu : majuscules, chiffres et _ (40 max).");
const text = (min: number, max: number, label = "Le texte") => z.string().trim().min(min, `${label} doit faire au moins ${min} caractères.`).max(max);
const hash64 = z.string().regex(/^[0-9a-f]{64}$/);
const boolQuery = z.enum(["true", "false"]).transform((v) => v === "true");
const pageQuery = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) } as const;

export const COUNCIL_STATUSES = ["PLANNED", "OPEN", "CLOSED", "SIGNED", "CANCELLED"] as const;
export const councilsStatusSchema = z.enum(COUNCIL_STATUSES);
export type CouncilStatus = z.infer<typeof councilsStatusSchema>;
export const COUNCIL_SCOPES = ["PERIOD", "YEAR"] as const;
export const councilsScopeSchema = z.enum(COUNCIL_SCOPES);
export const COUNCIL_PRESENCES = ["INVITED", "PRESENT", "ABSENT", "EXCUSED"] as const;
export const councilsPresenceSchema = z.enum(COUNCIL_PRESENCES);
export const COUNCIL_FUNCTIONS = ["PRESIDENT", "SECRETARY"] as const;
export const councilsFunctionSchema = z.enum(COUNCIL_FUNCTIONS);
export const COUNCIL_AGENDA_STATUSES = ["PENDING", "REVIEWED", "DECIDED"] as const;
export const councilsAgendaStatusSchema = z.enum(COUNCIL_AGENDA_STATUSES);
export const COUNCIL_PROPOSAL_KINDS = ["APPRECIATION", "DISTINCTION", "DECISION", "REMARK"] as const;
export const councilsProposalKindSchema = z.enum(COUNCIL_PROPOSAL_KINDS);
export const COUNCIL_PROPOSAL_ORIGINS = ["RULE_SUGGESTION", "HUMAN"] as const;
export const councilsProposalOriginSchema = z.enum(COUNCIL_PROPOSAL_ORIGINS);
export const COUNCIL_PROPOSAL_STATUSES = ["PROPOSED", "ACCEPTED", "MODIFIED", "REJECTED", "WITHDRAWN"] as const;
export const councilsProposalStatusSchema = z.enum(COUNCIL_PROPOSAL_STATUSES);
export const COUNCIL_DECISION_FAMILIES = ["PASSAGE", "REPEAT", "ORIENTATION", "REORIENTATION", "EXCLUSION", "REQUIRED_OPINION", "OTHER"] as const;
export const councilsDecisionFamilySchema = z.enum(COUNCIL_DECISION_FAMILIES);
export const COUNCIL_DECISION_APPLIES_TO = ["PERIOD", "YEAR", "BOTH"] as const;
export const COUNCIL_DECISION_MODES = ["CONSENSUS", "VOTE", "PRESIDENT_CASTING_VOTE"] as const;
export const councilsDecisionModeSchema = z.enum(COUNCIL_DECISION_MODES);
export const COUNCIL_DECISION_STATUSES = ["RECORDED", "WITHDRAWN", "SUPERSEDED"] as const;
export const councilsDecisionStatusSchema = z.enum(COUNCIL_DECISION_STATUSES);
export const COUNCIL_EFFECT_KINDS = ["RESULTS_DECISION", "ENROLLMENT_OUTCOME", "ORIENTATION_FILE", "SERIES_TRANSFER", "STUDENT_STATUS_REQUEST", "NOTIFY_GUARDIANS", "RESULTS_APPRECIATION", "RESULTS_DISTINCTION"] as const;
export const councilsEffectKindSchema = z.enum(COUNCIL_EFFECT_KINDS);
export const COUNCIL_EFFECT_STATUSES = ["PENDING", "AWAITING_HUMAN", "APPLIED", "FAILED", "REVERTED", "SKIPPED"] as const;
export const councilsEffectStatusSchema = z.enum(COUNCIL_EFFECT_STATUSES);
export const COUNCIL_MINUTES_STATUSES = ["GENERATED", "SIGNED", "SUPERSEDED", "REVOKED"] as const;
export const councilsMinutesStatusSchema = z.enum(COUNCIL_MINUTES_STATUSES);
export const COUNCIL_RENDER_STATUSES = ["PENDING", "RENDERED", "FAILED"] as const;
export const councilsRenderStatusSchema = z.enum(COUNCIL_RENDER_STATUSES);
export const COUNCIL_SIGNATURE_METHODS = ["ELECTRONIC", "SCANNED_PAPER"] as const;
export const councilsSignatureMethodSchema = z.enum(COUNCIL_SIGNATURE_METHODS);
export const COUNCIL_UNLOCK_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "CONSUMED", "EXPIRED"] as const;
export const councilsUnlockStatusSchema = z.enum(COUNCIL_UNLOCK_STATUSES);
export const COUNCIL_RESULTS_STATUSES = ["OPEN", "GRADING_LOCKED"] as const;
export const councilsResultsStatusSchema = z.enum(COUNCIL_RESULTS_STATUSES);
export const COUNCIL_EFFECT_TRIGGERS = ["CLOSED", "SIGNED"] as const;
export const COUNCIL_GUARDIAN_VISIBILITIES = ["NEVER", "AFTER_SIGNATURE", "AFTER_NOTIFICATION"] as const;
export const councilsGuardianVisibilitySchema = z.enum(COUNCIL_GUARDIAN_VISIBILITIES);
export const COUNCIL_RULE_SOURCE_KINDS = ["regulation", "institution", "platform", "placeholder"] as const;
export const councilsRuleSourceKindSchema = z.enum(COUNCIL_RULE_SOURCE_KINDS);
export const COUNCIL_ORIENTATION_PATH_KINDS = ["ORIENTATION", "REORIENTATION", "SERIES_CHANGE"] as const;
export const councilsPathKindSchema = z.enum(COUNCIL_ORIENTATION_PATH_KINDS);
export const COUNCIL_ORIENTATION_FILE_STATUSES = ["OPEN", "WISHES_COLLECTED", "PROPOSED", "DECIDED", "APPLIED", "CLOSED", "CANCELLED"] as const;
export const councilsOrientationFileStatusSchema = z.enum(COUNCIL_ORIENTATION_FILE_STATUSES);
export const COUNCIL_CONSENT_STATES = ["NOT_REQUIRED", "PENDING", "GIVEN", "REFUSED"] as const;
export const councilsConsentSchema = z.enum(COUNCIL_CONSENT_STATES);
export const COUNCIL_WISH_SOURCES = ["GUARDIAN", "STUDENT", "STAFF", "COUNSELLOR"] as const;
export const councilsWishSourceSchema = z.enum(COUNCIL_WISH_SOURCES);
export const COUNCIL_TRANSFER_STATUSES = ["PLANNED", "APPLIED", "CANCELLED", "FAILED"] as const;
export const councilsTransferStatusSchema = z.enum(COUNCIL_TRANSFER_STATUSES);

// ---------------------------------------------------------------------------
// Référentiels : rôles de participants, types de conseil, types de décision, réglages (DONNÉES)
// ---------------------------------------------------------------------------

export const councilsParticipantRoleInputSchema = z
  .object({
    code: councilsCodeSchema,
    label: text(1, 160, "Le libellé"),
    isVoting: z.boolean().default(true),
    countsForQuorum: z.boolean().default(true),
    maySign: z.boolean().default(true),
    canDecide: z.boolean().default(false),
    isExternal: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export type CouncilsParticipantRoleInput = z.infer<typeof councilsParticipantRoleInputSchema>;
export const councilsParticipantRoleDtoSchema = z.object({
  id: councilsUuidSchema,
  code: z.string(),
  label: z.string(),
  isVoting: z.boolean(),
  countsForQuorum: z.boolean(),
  maySign: z.boolean(),
  canDecide: z.boolean(),
  isExternal: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type CouncilsParticipantRoleDto = z.infer<typeof councilsParticipantRoleDtoSchema>;

export const councilsCouncilTypeInputSchema = z
  .object({
    code: councilsCodeSchema,
    label: text(1, 160, "Le libellé"),
    scope: councilsScopeSchema,
    minResultsStatus: councilsResultsStatusSchema.default("GRADING_LOCKED"),
    /** Quorum (présents comptant pour le quorum) ; `null` = aucun contrôle — jamais une valeur « officielle » par défaut. */
    minParticipants: z.number().int().min(1).max(1000).nullable().default(null),
    requiredRoleCodes: z.array(councilsCodeSchema).max(50).default([]),
    signerFunctions: z.array(councilsFunctionSchema).max(2).default(["PRESIDENT", "SECRETARY"]),
    signerRoleCodes: z.array(councilsCodeSchema).max(50).default([]),
    requiresDecisionPerStudent: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export type CouncilsCouncilTypeInput = z.infer<typeof councilsCouncilTypeInputSchema>;
export const councilsCouncilTypeDtoSchema = z.object({
  id: councilsUuidSchema,
  code: z.string(),
  label: z.string(),
  scope: councilsScopeSchema,
  minResultsStatus: councilsResultsStatusSchema,
  minParticipants: z.number().int().nullable(),
  requiredRoleCodes: z.array(z.string()),
  signerFunctions: z.array(councilsFunctionSchema),
  signerRoleCodes: z.array(z.string()),
  requiresDecisionPerStudent: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type CouncilsCouncilTypeDto = z.infer<typeof councilsCouncilTypeDtoSchema>;

export const councilsDecisionTypeInputSchema = z
  .object({
    code: councilsCodeSchema,
    label: text(1, 160, "Le libellé"),
    family: councilsDecisionFamilySchema,
    appliesTo: z.enum(COUNCIL_DECISION_APPLIES_TO).default("YEAR"),
    exclusiveGroup: councilsCodeSchema.nullable().default(null),
    requiresJustification: z.boolean().default(false),
    requiresVote: z.boolean().default(false),
    requiresTarget: z.boolean().optional(),
    /** Correspondance vers `results.decisions` (familles PASSAGE et REPEAT) : le code final DOIT être permis par le contrat de règles. */
    resultsDecisionKind: councilsCodeSchema.nullable().default(null),
    resultsFinalCode: councilsCodeSchema.nullable().default(null),
    academicOutcomeCode: councilsCodeSchema.nullable().default(null),
    needsHumanApplication: z.boolean().optional(),
    /** Statut d'élève visé par une exclusion (donnée du type, jamais supposé par le code) ; `null` pour toute autre famille. */
    studentStatus: z.enum(["SUSPENDED", "EXCLUDED"]).nullable().default(null),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export type CouncilsDecisionTypeInput = z.infer<typeof councilsDecisionTypeInputSchema>;
export const councilsDecisionTypeDtoSchema = z.object({
  id: councilsUuidSchema,
  code: z.string(),
  label: z.string(),
  family: councilsDecisionFamilySchema,
  appliesTo: z.enum(COUNCIL_DECISION_APPLIES_TO),
  exclusiveGroup: z.string().nullable(),
  requiresJustification: z.boolean(),
  requiresVote: z.boolean(),
  requiresTarget: z.boolean(),
  resultsDecisionKind: z.string().nullable(),
  resultsFinalCode: z.string().nullable(),
  academicOutcomeCode: z.string().nullable(),
  needsHumanApplication: z.boolean(),
  studentStatus: z.enum(["SUSPENDED", "EXCLUDED"]).nullable(),
  isSystem: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
});
export type CouncilsDecisionTypeDto = z.infer<typeof councilsDecisionTypeDtoSchema>;

export const councilsSettingsInputSchema = z
  .object({
    institutionId: councilsUuidSchema,
    requireSeparateUnlocker: z.boolean().optional(),
    effectsTrigger: z.enum(COUNCIL_EFFECT_TRIGGERS).optional(),
    guardianVisibility: councilsGuardianVisibilitySchema.optional(),
    allowQuorumWaiver: z.boolean().optional(),
    minutesTemplateKey: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/).nullable().optional(),
  })
  .strict();
export type CouncilsSettingsInput = z.infer<typeof councilsSettingsInputSchema>;
export const councilsSettingsDtoSchema = z.object({
  institutionId: councilsUuidSchema,
  requireSeparateUnlocker: z.boolean(),
  effectsTrigger: z.enum(COUNCIL_EFFECT_TRIGGERS),
  guardianVisibility: councilsGuardianVisibilitySchema,
  allowQuorumWaiver: z.boolean(),
  minutesTemplateKey: z.string().nullable(),
});
export type CouncilsSettingsDto = z.infer<typeof councilsSettingsDtoSchema>;

export const councilsReferenceDtoSchema = z.object({
  roles: z.array(councilsParticipantRoleDtoSchema),
  councilTypes: z.array(councilsCouncilTypeDtoSchema),
  decisionTypes: z.array(councilsDecisionTypeDtoSchema),
  settings: z.array(councilsSettingsDtoSchema),
});
export type CouncilsReferenceDto = z.infer<typeof councilsReferenceDtoSchema>;

// ---------------------------------------------------------------------------
// Instantané de faits `council-facts/1` — chaînes, entiers, booléens, null UNIQUEMENT
// ---------------------------------------------------------------------------

export const COUNCIL_FACTS_SCHEMA = "council-facts/1" as const;
/** Décimal exact lu de `results` (ex. `12.50`), jamais un nombre JSON. */
const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const councilsFactsSuggestionSchema = z.object({
  kind: z.enum(["DECISION", "DISTINCTION", "APPRECIATION"]),
  code: z.string(),
  /** Référence de la version de règle (`CODE@n`), `null` si inconnue. */
  ref: z.string().nullable(),
  /** Libellé français du code (`label_map` de la version de règle), pour l'AFFICHAGE seulement ; absent si la règle n'en définit pas. */
  label: z.string().nullable().optional(),
});
export const councilsFactsSchema = z.object({
  schema: z.literal(COUNCIL_FACTS_SCHEMA),
  results: z
    .object({
      /** `FINAL`, `DRAFT`, `ERROR` ou `null` (aucun résultat exploitable). */
      status: z.string().nullable(),
      average: decimalString.nullable(),
      averageDisplay: z.string().nullable(),
      rank: z.number().int().nullable(),
      cohortSize: z.number().int().nullable(),
      mentionCode: z.string().nullable(),
      /** Aucun résultat exploitable (`ERROR`, aucune note publiée) : une décision de passage / redoublement exige alors une justification. */
      missingResults: z.boolean(),
      ruleVersionRef: z.string().nullable(),
      ruleSourceKind: councilsRuleSourceKindSchema.nullable(),
      suggestions: z.array(councilsFactsSuggestionSchema),
      appreciations: z.array(z.object({ authorRole: z.enum(["TEACHER", "COUNCIL", "DIRECTOR"]), curriculumNodeId: councilsUuidSchema.nullable(), body: z.string() })),
    })
    .nullable(),
  attendance: z
    .object({
      available: z.boolean(),
      /** Valeurs EFFECTIVES de `attendance` (surcharge tracée comprise), recopiées sans calcul. */
      absentMinutes: z.number().int().nullable(),
      excusedMinutes: z.number().int().nullable(),
      absentCount: z.number().int().nullable(),
      excusedCount: z.number().int().nullable(),
      lateCount: z.number().int().nullable(),
    })
    .nullable(),
  discipline: z
    .object({
      available: z.boolean(),
      /** Comptages par famille de mesure (jamais un texte, jamais un élément confidentiel). */
      measuresByKind: z.record(z.string(), z.number().int()),
      measuresBySeverity: z.record(z.string(), z.number().int()),
      exclusionDays: z.number().int().nullable(),
      conductPoints: z.number().int().nullable(),
    })
    .nullable(),
  funding: z.object({ type: z.string().nullable(), stateAssigned: z.boolean() }),
  repeating: z.boolean(),
});
export type CouncilsFacts = z.infer<typeof councilsFactsSchema>;

/** Garde de contenu : refuse tout flottant (nombre non entier) ou valeur non primitive illégale dans un instantané. */
export function findNonExactNumber(value: unknown, path = "$"): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isInteger(value) ? null : path;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findNonExactNumber(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = findNonExactNumber(v, `${path}.${k}`);
      if (hit) return hit;
    }
    return null;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Procès-verbal `council-minutes/1`
// ---------------------------------------------------------------------------

export const COUNCIL_MINUTES_SCHEMA = "council-minutes/1" as const;
/** Mention imprimée sur tout PV issu d'un jeu de règles de démonstration (spec 006 AC4.2). */
export const COUNCIL_PLACEHOLDER_NOTICE = "Jeu de règles de démonstration, non réglementaire" as const;

export const councilsMinutesSnapshotSchema = z.object({
  schema: z.literal(COUNCIL_MINUTES_SCHEMA),
  institution: z.object({ institutionId: councilsUuidSchema, name: z.string().nullable() }),
  classroom: z.object({ classroomId: councilsUuidSchema, name: z.string().nullable(), gradeLevelCode: z.string().nullable() }),
  period: z.object({ periodId: councilsUuidSchema.nullable(), label: z.string().nullable(), academicYearId: councilsUuidSchema }),
  council: z.object({ councilId: councilsUuidSchema, typeCode: z.string(), typeLabel: z.string(), scope: councilsScopeSchema, heldOn: councilsDateSchema, location: z.string().nullable(), reopenCount: z.number().int(), quorumWaived: z.boolean(), quorumWaiverReason: z.string().nullable() }),
  participants: z.array(z.object({ participantId: councilsUuidSchema, name: z.string(), roleCode: z.string(), roleLabel: z.string().nullable().default(null), function: councilsFunctionSchema.nullable(), presence: councilsPresenceSchema })),
  students: z.array(
    z.object({
      enrollmentId: councilsUuidSchema,
      studentId: councilsUuidSchema,
      name: z.string(),
      factsVersion: z.number().int(),
      factsHash: z.string().nullable(),
      facts: councilsFactsSchema,
      /** Suggestion de la règle et décision côte à côte, jamais écrasées (parité R-RES-05). */
      decisions: z.array(
        z.object({
          decisionTypeCode: z.string(),
          decisionTypeLabel: z.string().nullable().default(null),
          family: councilsDecisionFamilySchema,
          suggestedCode: z.string().nullable(),
          differsFromSuggestion: z.boolean(),
          justification: z.string().nullable(),
          mode: councilsDecisionModeSchema,
          votesFor: z.number().int().nullable(),
          votesAgainst: z.number().int().nullable(),
          votesAbstain: z.number().int().nullable(),
          targetLabel: z.string().nullable(),
          deciderName: z.string(),
        }),
      ),
      appreciation: z.string().nullable(),
      distinctions: z.array(z.string()),
    }),
  ),
  signers: z.array(z.object({ participantId: councilsUuidSchema, name: z.string(), roleCode: z.string() })),
  references: z.object({ ruleVersionRef: z.string().nullable(), ruleSourceKind: councilsRuleSourceKindSchema.nullable() }),
  /** Mention « jeu de règles de démonstration, non réglementaire » quand le RuleSet épinglé est `placeholder`, sinon `null`. */
  placeholderNotice: z.string().nullable(),
});
export type CouncilsMinutesSnapshot = z.infer<typeof councilsMinutesSnapshotSchema>;

// ---------------------------------------------------------------------------
// Séances
// ---------------------------------------------------------------------------

export const councilsCreateSchema = z
  .object({
    classroomId: councilsUuidSchema,
    /** `null` / absent : bilan de fin d'année (type de portée YEAR). */
    academicPeriodId: councilsUuidSchema.nullable().optional(),
    councilTypeId: councilsUuidSchema,
    title: text(1, 200).optional(),
    scheduledAt: councilsInstantSchema.optional(),
    location: text(1, 200).optional(),
  })
  .strict();
export type CouncilsCreateInput = z.infer<typeof councilsCreateSchema>;
export const councilsUpdateSchema = z
  .object({ title: text(1, 200).nullable().optional(), scheduledAt: councilsInstantSchema.nullable().optional(), location: text(1, 200).nullable().optional(), heldOn: councilsDateSchema.nullable().optional() })
  .strict();
export type CouncilsUpdateInput = z.infer<typeof councilsUpdateSchema>;
export const councilsListQuerySchema = z
  .object({
    classroomId: councilsUuidSchema.optional(),
    academicYearId: councilsUuidSchema.optional(),
    academicPeriodId: councilsUuidSchema.optional(),
    status: councilsStatusSchema.optional(),
    from: councilsDateSchema.optional(),
    to: councilsDateSchema.optional(),
    ...pageQuery,
  })
  .strict();
export type CouncilsListQuery = z.infer<typeof councilsListQuerySchema>;
export const councilsPrepareSchema = z.object({}).strict();
export const councilsConvokeSchema = z.object({ participantIds: z.array(councilsUuidSchema).max(200).optional() }).strict();
export const councilsOpenSchema = z.object({ quorumWaiverReason: text(10, 1000, "Le motif de dérogation au quorum").optional() }).strict();
export const councilsCloseSchema = z.object({}).strict();
export const councilsCancelSchema = z.object({ reason: text(5, 1000, "Le motif d'annulation") }).strict();

export const councilsQuorumDtoSchema = z.object({
  met: z.boolean(),
  presentCount: z.number().int(),
  requiredMin: z.number().int().nullable(),
  missingRoles: z.array(z.string()),
  presidentPresent: z.boolean(),
  /** Réglage d'établissement : ouvrir sans quorum, avec motif, est possible. */
  waiverAllowed: z.boolean(),
});
export type CouncilsQuorumDto = z.infer<typeof councilsQuorumDtoSchema>;

export const councilsCouncilDtoSchema = z.object({
  id: councilsUuidSchema,
  institutionId: councilsUuidSchema,
  academicYearId: councilsUuidSchema,
  classroomId: councilsUuidSchema,
  classroomName: z.string().nullable(),
  academicPeriodId: councilsUuidSchema.nullable(),
  periodLabel: z.string().nullable(),
  councilTypeId: councilsUuidSchema,
  councilTypeCode: z.string(),
  councilTypeLabel: z.string(),
  scope: councilsScopeSchema,
  status: councilsStatusSchema,
  title: z.string().nullable(),
  scheduledAt: councilsInstantSchema.nullable(),
  location: z.string().nullable(),
  heldOn: councilsDateSchema.nullable(),
  openedAt: councilsInstantSchema.nullable(),
  closedAt: councilsInstantSchema.nullable(),
  signedAt: councilsInstantSchema.nullable(),
  quorumWaived: z.boolean(),
  quorumWaiverReason: z.string().nullable(),
  reopenCount: z.number().int(),
  cancelReason: z.string().nullable(),
  resultsStateId: councilsUuidSchema.nullable(),
  resultsDeliberationId: councilsUuidSchema.nullable(),
  /** Origine du jeu de règles épinglé : `placeholder` ⇒ bandeau « règles de démonstration » (jamais déduit côté web). */
  ruleSourceKind: councilsRuleSourceKindSchema.nullable(),
  rowVersion: z.number().int(),
  counts: z.object({ agendaItems: z.number().int(), decided: z.number().int(), participants: z.number().int(), present: z.number().int() }),
  createdAt: councilsInstantSchema,
});
export type CouncilsCouncilDto = z.infer<typeof councilsCouncilDtoSchema>;

export const councilsParticipantInputSchema = z
  .object({
    roleCode: councilsCodeSchema,
    councilFunction: councilsFunctionSchema.nullable().optional(),
    staffId: councilsUuidSchema.optional(),
    personId: councilsUuidSchema.optional(),
    /** Nom figé à la convocation ; déduit de la fiche du personnel quand `staffId` est fourni. */
    displayName: text(1, 200).optional(),
    isVoting: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.staffId !== undefined || v.personId !== undefined, { message: "Désignez un membre du personnel ou une personne externe.", path: ["staffId"] });
export type CouncilsParticipantInput = z.infer<typeof councilsParticipantInputSchema>;
export const councilsParticipantPatchSchema = z.object({ councilFunction: councilsFunctionSchema.nullable().optional(), isVoting: z.boolean().optional() }).strict();
export const councilsPresenceInputSchema = z.object({ presence: councilsPresenceSchema }).strict();

export const councilsParticipantDtoSchema = z.object({
  id: councilsUuidSchema,
  councilId: councilsUuidSchema,
  roleCode: z.string(),
  roleLabel: z.string().nullable(),
  councilFunction: councilsFunctionSchema.nullable(),
  staffId: councilsUuidSchema.nullable(),
  personId: councilsUuidSchema.nullable(),
  displayName: z.string(),
  isVoting: z.boolean(),
  canDecide: z.boolean(),
  presence: councilsPresenceSchema,
  convokedAt: councilsInstantSchema.nullable(),
  notifiedAt: councilsInstantSchema.nullable(),
});
export type CouncilsParticipantDto = z.infer<typeof councilsParticipantDtoSchema>;

/** Participants PROPOSÉS à partir des affectations d'enseignement (aucun nom n'est figé avant ajout). */
export const councilsProposedParticipantDtoSchema = z.object({ staffId: councilsUuidSchema, displayName: z.string(), roleCode: z.string().nullable(), councilFunction: councilsFunctionSchema.nullable(), source: z.enum(["HOMEROOM", "TEACHING"]) });
export type CouncilsProposedParticipantDto = z.infer<typeof councilsProposedParticipantDtoSchema>;

export const councilsCouncilDetailDtoSchema = z.object({
  council: councilsCouncilDtoSchema,
  participants: z.array(councilsParticipantDtoSchema),
  quorum: councilsQuorumDtoSchema,
  /** Avertissements non bloquants (assiduité indisponible, jeu de règles de démonstration, élèves non préparés…). */
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type CouncilsCouncilDetailDto = z.infer<typeof councilsCouncilDetailDtoSchema>;

export const councilsListDtoSchema = z.object({ items: z.array(councilsCouncilDtoSchema), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
export type CouncilsListDto = z.infer<typeof councilsListDtoSchema>;

// ---------------------------------------------------------------------------
// Ordre du jour, propositions, décisions
// ---------------------------------------------------------------------------

export const councilsProposalInputSchema = z
  .object({ kind: councilsProposalKindSchema, code: councilsCodeSchema.optional(), body: text(1, 1000, "Le texte").optional() })
  .strict()
  .refine((v) => (v.kind === "APPRECIATION" || v.kind === "REMARK" ? v.body !== undefined : v.code !== undefined), { message: "Une appréciation ou une remarque porte un texte ; une distinction ou une décision porte un code.", path: ["body"] });
export type CouncilsProposalInput = z.infer<typeof councilsProposalInputSchema>;
export const councilsProposalResolveSchema = z.object({ note: text(1, 1000).optional() }).strict();
export const councilsProposalDtoSchema = z.object({
  id: councilsUuidSchema,
  agendaItemId: councilsUuidSchema,
  kind: councilsProposalKindSchema,
  code: z.string().nullable(),
  body: z.string().nullable(),
  origin: councilsProposalOriginSchema,
  proposedBy: councilsUuidSchema.nullable(),
  proposedByName: z.string().nullable(),
  status: councilsProposalStatusSchema,
  resolvedBy: councilsUuidSchema.nullable(),
  resolvedAt: councilsInstantSchema.nullable(),
  resolutionNote: z.string().nullable(),
  ruleVersionRef: z.string().nullable(),
  createdAt: councilsInstantSchema,
});
export type CouncilsProposalDto = z.infer<typeof councilsProposalDtoSchema>;

export const councilsDecisionInputSchema = z
  .object({
    decisionTypeId: councilsUuidSchema,
    /** Participant PRÉSENT dont le rôle porte `can_decide`. */
    deciderParticipantId: councilsUuidSchema,
    mode: councilsDecisionModeSchema.default("CONSENSUS"),
    justification: text(1, 2000, "La justification").optional(),
    votesFor: z.number().int().min(0).max(1000).optional(),
    votesAgainst: z.number().int().min(0).max(1000).optional(),
    votesAbstain: z.number().int().min(0).max(1000).optional(),
    targetProgramId: councilsUuidSchema.optional(),
    targetGradeLevelId: councilsUuidSchema.optional(),
    targetLabel: text(1, 200).optional(),
    /** Décision (du même groupe exclusif) que celle-ci remplace : retirée avec `supersedeReason`. */
    supersedesDecisionId: councilsUuidSchema.optional(),
    supersedeReason: text(5, 1000, "Le motif de retrait").optional(),
  })
  .strict()
  .refine((v) => v.mode !== "VOTE" || (v.votesFor !== undefined && v.votesAgainst !== undefined && v.votesAbstain !== undefined), { message: "Un vote consigne les voix pour, contre et les abstentions.", path: ["votesFor"] })
  .refine((v) => v.supersedesDecisionId === undefined || v.supersedeReason !== undefined, { message: "Remplacer une décision exige un motif de retrait.", path: ["supersedeReason"] });
export type CouncilsDecisionInput = z.infer<typeof councilsDecisionInputSchema>;
export const councilsDecisionWithdrawSchema = z.object({ reason: text(5, 1000, "Le motif de retrait") }).strict();
export const councilsDecisionDtoSchema = z.object({
  id: councilsUuidSchema,
  councilId: councilsUuidSchema,
  agendaItemId: councilsUuidSchema,
  enrollmentId: councilsUuidSchema,
  studentId: councilsUuidSchema,
  decisionTypeId: councilsUuidSchema,
  decisionTypeCode: z.string(),
  decisionTypeLabel: z.string().nullable(),
  family: councilsDecisionFamilySchema,
  exclusiveGroup: z.string().nullable(),
  /** Ce que la règle suggérait (conservé côte à côte avec la décision). */
  suggestedCode: z.string().nullable(),
  suggestionRef: z.string().nullable(),
  differsFromSuggestion: z.boolean(),
  justification: z.string().nullable(),
  mode: councilsDecisionModeSchema,
  votesFor: z.number().int().nullable(),
  votesAgainst: z.number().int().nullable(),
  votesAbstain: z.number().int().nullable(),
  targetProgramId: councilsUuidSchema.nullable(),
  targetGradeLevelId: councilsUuidSchema.nullable(),
  targetLabel: z.string().nullable(),
  deciderParticipantId: councilsUuidSchema,
  deciderName: z.string().nullable(),
  recordedBy: councilsUuidSchema,
  recordedByName: z.string(),
  /** Version et empreinte de l'instantané sur lequel la décision est prise (on peut prouver ce que le conseil avait sous les yeux). */
  factsVersion: z.number().int(),
  factsHash: z.string().nullable(),
  decidedAt: councilsInstantSchema,
  status: councilsDecisionStatusSchema,
  withdrawnReason: z.string().nullable(),
  supersedesId: councilsUuidSchema.nullable(),
});
export type CouncilsDecisionDto = z.infer<typeof councilsDecisionDtoSchema>;

export const councilsAgendaItemDtoSchema = z.object({
  id: councilsUuidSchema,
  councilId: councilsUuidSchema,
  enrollmentId: councilsUuidSchema,
  studentId: councilsUuidSchema,
  studentName: z.string(),
  position: z.number().int(),
  status: councilsAgendaStatusSchema,
  factsVersion: z.number().int(),
  factsHash: z.string().nullable(),
  preparedAt: councilsInstantSchema.nullable(),
  missingResults: z.boolean().nullable(),
  ruleVersionRef: z.string().nullable(),
  decisionCount: z.number().int(),
  pendingProposals: z.number().int(),
});
export type CouncilsAgendaItemDto = z.infer<typeof councilsAgendaItemDtoSchema>;
export const councilsAgendaDtoSchema = z.object({ councilId: councilsUuidSchema, status: councilsStatusSchema, items: z.array(councilsAgendaItemDtoSchema) });
export type CouncilsAgendaDto = z.infer<typeof councilsAgendaDtoSchema>;

export const councilsAgendaItemDetailDtoSchema = z.object({
  item: councilsAgendaItemDtoSchema,
  facts: councilsFactsSchema.nullable(),
  proposals: z.array(councilsProposalDtoSchema),
  decisions: z.array(councilsDecisionDtoSchema),
  councilStatus: councilsStatusSchema,
  ruleSourceKind: councilsRuleSourceKindSchema.nullable(),
});
export type CouncilsAgendaItemDetailDto = z.infer<typeof councilsAgendaItemDetailDtoSchema>;

export const councilsPrepareReportDtoSchema = z.object({ councilId: councilsUuidSchema, created: z.number().int(), rebuilt: z.number().int(), unchanged: z.number().int(), skipped: z.number().int(), warnings: z.array(z.object({ code: z.string(), message: z.string() })) });
export type CouncilsPrepareReportDto = z.infer<typeof councilsPrepareReportDtoSchema>;
export const councilsConvokeReportDtoSchema = z.object({ councilId: councilsUuidSchema, convoked: z.number().int(), notified: z.number().int(), warnings: z.array(z.object({ code: z.string(), message: z.string() })) });
export type CouncilsConvokeReportDto = z.infer<typeof councilsConvokeReportDtoSchema>;

// ---------------------------------------------------------------------------
// Procès-verbal et signatures
// ---------------------------------------------------------------------------

export const councilsMinutesGenerateSchema = z.object({}).strict();
export const councilsSignSchema = z.object({}).strict();
export const councilsPaperSignatureSchema = z.object({ participantId: councilsUuidSchema, evidenceObjectKey: text(3, 500, "La clé de la pièce") }).strict();
export const councilsMinutesRevokeSchema = z.object({ reason: text(10, 1000, "Le motif de révocation") }).strict();
export const councilsSignatureDtoSchema = z.object({ id: councilsUuidSchema, participantId: councilsUuidSchema, roleCode: z.string(), signerName: z.string(), method: councilsSignatureMethodSchema, signedHash: hash64, signedAt: councilsInstantSchema });
export type CouncilsSignatureDto = z.infer<typeof councilsSignatureDtoSchema>;
export const councilsMinutesDtoSchema = z.object({
  id: councilsUuidSchema,
  councilId: councilsUuidSchema,
  version: z.number().int(),
  status: councilsMinutesStatusSchema,
  schemaName: z.string(),
  snapshotHash: hash64,
  generatedAt: councilsInstantSchema,
  generatedBy: councilsUuidSchema,
  renderStatus: councilsRenderStatusSchema,
  renderHash: hash64.nullable(),
  signedAt: councilsInstantSchema.nullable(),
  supersedesId: councilsUuidSchema.nullable(),
  revokedReason: z.string().nullable(),
  signatures: z.array(councilsSignatureDtoSchema),
  /** Signataires exigés qui n'ont pas encore signé. */
  missingSigners: z.array(z.object({ participantId: councilsUuidSchema, displayName: z.string(), roleCode: z.string() })),
  /** Mention « règles de démonstration » (reprise du snapshot). */
  placeholderNotice: z.string().nullable(),
});
export type CouncilsMinutesDto = z.infer<typeof councilsMinutesDtoSchema>;
export const councilsMinutesDetailDtoSchema = z.object({ minutes: councilsMinutesDtoSchema, snapshot: councilsMinutesSnapshotSchema });
export type CouncilsMinutesDetailDto = z.infer<typeof councilsMinutesDetailDtoSchema>;
export const councilsMinutesListDtoSchema = z.object({ items: z.array(councilsMinutesDtoSchema) });
/** URL signée, valable quelques minutes (≤ 5), après contrôle de permission. */
export const councilsMinutesPdfDtoSchema = z.object({ url: z.string().url(), expiresAt: councilsInstantSchema, renderHash: hash64 });

// ---------------------------------------------------------------------------
// Déverrouillage motivé
// ---------------------------------------------------------------------------

export const councilsUnlockRequestSchema = z.object({ reason: text(20, 2000, "Le motif de déverrouillage") }).strict();
export const councilsUnlockApproveSchema = z.object({ note: text(1, 1000).optional() }).strict();
export const councilsUnlockRejectSchema = z.object({ note: text(5, 1000, "Le motif du refus") }).strict();
export const councilsReopenSchema = z.object({}).strict();
export const councilsUnlockDtoSchema = z.object({
  id: councilsUuidSchema,
  councilId: councilsUuidSchema,
  requestedBy: councilsUuidSchema,
  requestedByName: z.string(),
  requestedAt: councilsInstantSchema,
  reason: z.string(),
  status: councilsUnlockStatusSchema,
  decidedBy: councilsUuidSchema.nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: councilsInstantSchema.nullable(),
  decisionNote: z.string().nullable(),
  fourEyesWaived: z.boolean(),
  consumedAt: councilsInstantSchema.nullable(),
});
export type CouncilsUnlockDto = z.infer<typeof councilsUnlockDtoSchema>;

// ---------------------------------------------------------------------------
// Effets
// ---------------------------------------------------------------------------

export const councilsEffectActionSchema = z.object({ reason: text(5, 1000, "Le motif").optional() }).strict();
export const councilsEffectRevertSchema = z.object({ reason: text(5, 1000, "Le motif d'annulation") }).strict();
export const councilsEffectListQuerySchema = z.object({ status: councilsEffectStatusSchema.optional(), councilId: councilsUuidSchema.optional(), kind: councilsEffectKindSchema.optional(), ...pageQuery }).strict();
export const councilsEffectDtoSchema = z.object({
  id: councilsUuidSchema,
  councilId: councilsUuidSchema,
  decisionId: councilsUuidSchema.nullable(),
  proposalId: councilsUuidSchema.nullable(),
  kind: councilsEffectKindSchema,
  status: councilsEffectStatusSchema,
  attempts: z.number().int(),
  /** Diagnostic de la dernière tentative (code et message techniques, jamais une donnée personnelle). */
  lastError: z.string().nullable(),
  externalRef: councilsUuidSchema.nullable(),
  irreversible: z.boolean(),
  appliedAt: councilsInstantSchema.nullable(),
  appliedBy: councilsUuidSchema.nullable(),
  revertedAt: councilsInstantSchema.nullable(),
  revertReason: z.string().nullable(),
  studentId: councilsUuidSchema.nullable(),
  studentName: z.string().nullable(),
  decisionTypeCode: z.string().nullable(),
  createdAt: councilsInstantSchema,
});
export type CouncilsEffectDto = z.infer<typeof councilsEffectDtoSchema>;
export const councilsEffectsDtoSchema = z.object({ items: z.array(councilsEffectDtoSchema), total: z.number().int() });
export type CouncilsEffectsDto = z.infer<typeof councilsEffectsDtoSchema>;

// ---------------------------------------------------------------------------
// Journal de séance
// ---------------------------------------------------------------------------

export const councilsEventDtoSchema = z.object({ id: councilsUuidSchema, councilId: councilsUuidSchema, kind: z.string(), actorId: councilsUuidSchema.nullable(), actorKind: z.string().nullable(), reason: z.string().nullable(), occurredAt: councilsInstantSchema, data: z.record(z.string(), z.unknown()) });
export type CouncilsEventDto = z.infer<typeof councilsEventDtoSchema>;
export const councilsEventsDtoSchema = z.object({ items: z.array(councilsEventDtoSchema) });

// ---------------------------------------------------------------------------
// Orientation et transferts de série
// ---------------------------------------------------------------------------

export const councilsOrientationPathInputSchema = z
  .object({
    institutionId: councilsUuidSchema.nullable().default(null),
    kind: councilsPathKindSchema,
    fromProgramId: councilsUuidSchema.nullable().default(null),
    fromGradeLevelId: councilsUuidSchema,
    toProgramId: councilsUuidSchema,
    toGradeLevelId: councilsUuidSchema,
    label: text(1, 200).nullable().default(null),
    requiresCouncilOpinion: z.boolean().default(true),
    requiresGuardianConsent: z.boolean().default(false),
    active: z.boolean().default(true),
    sourceKind: z.enum(["regulation", "institution", "placeholder"]).default("institution"),
  })
  .strict();
export type CouncilsOrientationPathInput = z.infer<typeof councilsOrientationPathInputSchema>;
export const councilsOrientationPathDtoSchema = z.object({
  id: councilsUuidSchema,
  institutionId: councilsUuidSchema.nullable(),
  kind: councilsPathKindSchema,
  fromProgramId: councilsUuidSchema.nullable(),
  fromGradeLevelId: councilsUuidSchema,
  toProgramId: councilsUuidSchema,
  toGradeLevelId: councilsUuidSchema,
  label: z.string().nullable(),
  requiresCouncilOpinion: z.boolean(),
  requiresGuardianConsent: z.boolean(),
  active: z.boolean(),
  sourceKind: z.enum(["regulation", "institution", "placeholder"]),
});
export type CouncilsOrientationPathDto = z.infer<typeof councilsOrientationPathDtoSchema>;

export const councilsOrientationFileCreateSchema = z.object({ enrollmentId: councilsUuidSchema, notes: text(1, 2000).optional() }).strict();
export const councilsOrientationFileListQuerySchema = z.object({ academicYearId: councilsUuidSchema.optional(), status: councilsOrientationFileStatusSchema.optional(), studentId: councilsUuidSchema.optional(), ...pageQuery }).strict();
export const councilsWishInputSchema = z
  .object({
    rank: z.number().int().min(1).max(20),
    toProgramId: councilsUuidSchema,
    toGradeLevelId: councilsUuidSchema,
    optionIds: z.array(councilsUuidSchema).max(30).default([]),
    source: councilsWishSourceSchema,
    comment: text(1, 1000).optional(),
  })
  .strict();
export type CouncilsWishInput = z.infer<typeof councilsWishInputSchema>;
export const councilsConsentInputSchema = z.object({ state: z.enum(["GIVEN", "REFUSED"]) }).strict();
export const councilsWishDtoSchema = z.object({ id: councilsUuidSchema, fileId: councilsUuidSchema, rank: z.number().int(), toProgramId: councilsUuidSchema, toGradeLevelId: councilsUuidSchema, optionIds: z.array(councilsUuidSchema), source: councilsWishSourceSchema, expressedBy: councilsUuidSchema, expressedAt: councilsInstantSchema, comment: z.string().nullable(), withdrawnAt: councilsInstantSchema.nullable() });
export const councilsOrientationFileDtoSchema = z.object({
  id: councilsUuidSchema,
  institutionId: councilsUuidSchema,
  academicYearId: councilsUuidSchema,
  enrollmentId: councilsUuidSchema,
  studentId: councilsUuidSchema,
  studentName: z.string().nullable(),
  currentProgramId: councilsUuidSchema,
  currentGradeLevelId: councilsUuidSchema,
  status: councilsOrientationFileStatusSchema,
  guardianConsent: councilsConsentSchema,
  consentRecordedAt: councilsInstantSchema.nullable(),
  decisionId: councilsUuidSchema.nullable(),
  notes: z.string().nullable(),
  wishes: z.array(councilsWishDtoSchema),
  createdAt: councilsInstantSchema,
});
export type CouncilsOrientationFileDto = z.infer<typeof councilsOrientationFileDtoSchema>;

// Vue FAMILLE / ÉLÈVE du dossier d'orientation (`GET /children/:studentId/orientation`, `GET /me/orientation`).
// Minimisation : jamais les notes internes, la décision du conseil (avant la visibilité fixée par l'établissement), les avis du
// personnel ou du conseiller d'orientation, les vœux retirés, ni quoi que ce soit d'un autre élève. L'état est « masqué » : tant que
// la décision du conseil n'est pas visible de la famille (`guardianVisibility`), le dossier reste vu comme « vœux recueillis ».
export const COUNCIL_FAMILY_ORIENTATION_STAGES = ["OPEN", "WISHES_COLLECTED", "DECIDED", "APPLIED", "CLOSED", "CANCELLED"] as const;
export const councilsFamilyOrientationStageSchema = z.enum(COUNCIL_FAMILY_ORIENTATION_STAGES);
export const councilsFamilyOrientationWishDtoSchema = z.object({
  id: councilsUuidSchema,
  rank: z.number().int(),
  toProgramId: councilsUuidSchema,
  toGradeLevelId: councilsUuidSchema,
  /** Libellé du parcours autorisé correspondant (donnée de l'établissement) ; `null` si aucun parcours nommé ne correspond. */
  targetLabel: z.string().nullable(),
  optionIds: z.array(councilsUuidSchema),
  /** Seuls les vœux de la famille et de l'élève sont exposés (jamais ceux du personnel ou du conseiller). */
  source: z.enum(["GUARDIAN", "STUDENT"]),
  expressedAt: councilsInstantSchema,
  comment: z.string().nullable(),
});
export const councilsFamilyOrientationOptionDtoSchema = z.object({
  pathId: councilsUuidSchema,
  label: z.string().nullable(),
  kind: councilsPathKindSchema,
  toProgramId: councilsUuidSchema,
  toGradeLevelId: councilsUuidSchema,
  requiresGuardianConsent: z.boolean(),
});
export const councilsFamilyOrientationFileDtoSchema = z.object({
  id: councilsUuidSchema,
  academicYearId: councilsUuidSchema,
  stage: councilsFamilyOrientationStageSchema,
  guardianConsent: councilsConsentSchema,
  consentRecordedAt: councilsInstantSchema.nullable(),
  /** Le tuteur peut-il encore exprimer ou modifier des vœux ? (jamais vrai pour l'élève : lecture seule) */
  wishesOpen: z.boolean(),
  /** Le tuteur peut-il donner / modifier son accord ? (parcours exigeant l'accord de la famille, dossier non appliqué) */
  consentOpen: z.boolean(),
  wishes: z.array(councilsFamilyOrientationWishDtoSchema),
});
export const councilsFamilyOrientationDtoSchema = z.object({
  studentId: councilsUuidSchema,
  studentName: z.string().nullable(),
  /** `null` : aucun dossier d'orientation ouvert pour cet élève. */
  file: councilsFamilyOrientationFileDtoSchema.nullable(),
  /** Destinations des parcours autorisés (données de l'établissement) pour la situation de l'élève ; vide pour l'élève et si aucun parcours. */
  options: z.array(councilsFamilyOrientationOptionDtoSchema),
});
export type CouncilsFamilyOrientationDto = z.infer<typeof councilsFamilyOrientationDtoSchema>;
export type CouncilsFamilyOrientationFileDto = z.infer<typeof councilsFamilyOrientationFileDtoSchema>;
export type CouncilsFamilyOrientationOptionDto = z.infer<typeof councilsFamilyOrientationOptionDtoSchema>;

export const councilsSeriesTransferInputSchema = z
  .object({
    enrollmentId: councilsUuidSchema,
    toProgramId: councilsUuidSchema,
    toGradeLevelId: councilsUuidSchema,
    effectiveKind: z.enum(["NEXT_YEAR", "MID_YEAR"]),
    effectiveOn: councilsDateSchema.optional(),
    decidedVia: z.enum(["COUNCIL", "DIRECTOR_ACT"]),
    decisionId: councilsUuidSchema.optional(),
    actReference: text(1, 200).optional(),
    pathId: councilsUuidSchema.optional(),
    /** Dérogation motivée (20 caractères) hors parcours autorisé ; permission sensible `council.orientation.override`. */
    overrideReason: text(20, 2000, "Le motif de dérogation").optional(),
  })
  .strict()
  .refine((v) => (v.decidedVia === "COUNCIL" ? v.decisionId !== undefined : v.actReference !== undefined), { message: "Un transfert exige une décision du conseil ou une référence d'acte de la direction.", path: ["decidedVia"] })
  .refine((v) => v.pathId !== undefined || v.overrideReason !== undefined, { message: "Désignez un parcours autorisé ou motivez une dérogation.", path: ["pathId"] })
  .refine((v) => v.effectiveKind !== "MID_YEAR" || v.effectiveOn !== undefined, { message: "Un transfert en cours d'année indique sa date d'effet.", path: ["effectiveOn"] });
export type CouncilsSeriesTransferInput = z.infer<typeof councilsSeriesTransferInputSchema>;
/** Application d'un transfert : en cours d'année, la classe de destination est désignée à l'application (même établissement et même année). */
export const councilsTransferApplySchema = z.object({ toClassroomId: councilsUuidSchema.optional() }).strict();
export const councilsTransferCancelSchema = z.object({ reason: text(5, 1000, "Le motif d'annulation") }).strict();
export const councilsSeriesTransferDtoSchema = z.object({
  id: councilsUuidSchema,
  institutionId: councilsUuidSchema,
  enrollmentId: councilsUuidSchema,
  studentId: councilsUuidSchema,
  fromProgramId: councilsUuidSchema,
  fromGradeLevelId: councilsUuidSchema,
  toProgramId: councilsUuidSchema,
  toGradeLevelId: councilsUuidSchema,
  effectiveKind: z.enum(["NEXT_YEAR", "MID_YEAR"]),
  effectiveOn: councilsDateSchema.nullable(),
  decidedVia: z.enum(["COUNCIL", "DIRECTOR_ACT"]),
  decisionId: councilsUuidSchema.nullable(),
  actReference: z.string().nullable(),
  pathId: councilsUuidSchema.nullable(),
  overridden: z.boolean(),
  status: councilsTransferStatusSchema,
  appliedAt: councilsInstantSchema.nullable(),
  lastError: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: councilsInstantSchema,
});
export type CouncilsSeriesTransferDto = z.infer<typeof councilsSeriesTransferDtoSchema>;

// ---------------------------------------------------------------------------
// Synthèse de classe et portails
// ---------------------------------------------------------------------------

export const councilsClassroomSummaryDtoSchema = z.object({
  classroomId: councilsUuidSchema,
  councils: z.array(z.object({ id: councilsUuidSchema, councilTypeCode: z.string(), academicPeriodId: councilsUuidSchema.nullable(), status: councilsStatusSchema, heldOn: councilsDateSchema.nullable(), agendaItems: z.number().int(), decided: z.number().int(), reopenCount: z.number().int() })),
  /** Décisions comptées par code (jamais l'identité d'un élève). */
  decisionsByCode: z.record(z.string(), z.number().int()),
  effects: z.object({ pending: z.number().int(), failed: z.number().int(), awaitingHuman: z.number().int() }),
  /** Séances signées dont la période de résultats a été rouverte : « conseil à revoir ». */
  reviewNeeded: z.array(councilsUuidSchema),
});
export type CouncilsClassroomSummaryDto = z.infer<typeof councilsClassroomSummaryDtoSchema>;

/**
 * Décision vue par une famille / un élève : selon `guardianVisibility`, jamais la suggestion de la règle, le vote ni la
 * justification interne ; jamais le détail des autres élèves.
 */
export const councilsFamilyDecisionDtoSchema = z.object({
  councilId: councilsUuidSchema,
  councilTypeLabel: z.string(),
  periodLabel: z.string().nullable(),
  heldOn: councilsDateSchema.nullable(),
  decisionTypeLabel: z.string(),
  family: councilsDecisionFamilySchema,
  targetLabel: z.string().nullable(),
  appreciation: z.string().nullable(),
  distinctions: z.array(z.string()),
});
export const councilsFamilyDecisionsDtoSchema = z.object({ studentId: councilsUuidSchema, studentName: z.string().nullable(), items: z.array(councilsFamilyDecisionDtoSchema) });
export type CouncilsFamilyDecisionsDto = z.infer<typeof councilsFamilyDecisionsDtoSchema>;

/** Faits publiés pour les autres modules (`getCouncilDecisionsForEnrollment`) : décision, appréciation générale, distinctions. */
export const councilsEnrollmentDecisionsDtoSchema = z.object({
  enrollmentId: councilsUuidSchema,
  decisions: z.array(z.object({ councilId: councilsUuidSchema, decisionTypeCode: z.string(), family: councilsDecisionFamilySchema, status: councilsDecisionStatusSchema, councilStatus: councilsStatusSchema, decidedAt: councilsInstantSchema })),
  appreciation: z.string().nullable(),
  distinctions: z.array(z.string()),
});
export type CouncilsEnrollmentDecisionsDto = z.infer<typeof councilsEnrollmentDecisionsDtoSchema>;

// ---------------------------------------------------------------------------
// Événements (outbox, payload `{ v: 1, … }`) — jamais de note, de justification ni de texte libre
// ---------------------------------------------------------------------------

const ev = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });
const councilEv = ev({ councilId: councilsUuidSchema, institutionId: councilsUuidSchema, classroomId: councilsUuidSchema, academicYearId: councilsUuidSchema, academicPeriodId: councilsUuidSchema.nullable(), scope: councilsScopeSchema, status: councilsStatusSchema });
const decisionEv = ev({ decisionId: councilsUuidSchema, councilId: councilsUuidSchema, enrollmentId: councilsUuidSchema, studentId: councilsUuidSchema, decisionTypeCode: z.string(), family: councilsDecisionFamilySchema });
const minutesEv = ev({ minutesId: councilsUuidSchema, councilId: councilsUuidSchema, version: z.number().int(), snapshotHash: hash64 });
const unlockEv = ev({ unlockRequestId: councilsUuidSchema, councilId: councilsUuidSchema });
const effectEv = ev({ effectId: councilsUuidSchema, councilId: councilsUuidSchema, kind: councilsEffectKindSchema, decisionId: councilsUuidSchema.nullable(), proposalId: councilsUuidSchema.nullable() });
const transferEv = ev({ transferId: councilsUuidSchema, enrollmentId: councilsUuidSchema, studentId: councilsUuidSchema, toProgramId: councilsUuidSchema, toGradeLevelId: councilsUuidSchema, effectiveKind: z.enum(["NEXT_YEAR", "MID_YEAR"]) });

export const councilsEventPayloadSchemas = {
  "councils.council.created": councilEv,
  "councils.council.convoked": councilEv.extend({ convoked: z.number().int() }),
  "councils.council.opened": councilEv,
  "councils.council.closed": councilEv,
  "councils.council.signed": councilEv,
  "councils.council.reopened": councilEv.extend({ reopenCount: z.number().int() }),
  "councils.council.cancelled": councilEv,
  /** La période de résultats a été rouverte sous une séance clôturée ou signée : à revoir par la direction (jamais de réouverture automatique). */
  "councils.council.review_needed": councilEv.extend({ cause: z.literal("RESULTS_REOPENED") }),
  "councils.quorum.waived": councilEv.extend({ presentCount: z.number().int() }),
  "councils.decision.recorded": decisionEv,
  "councils.decision.withdrawn": decisionEv,
  "councils.minutes.generated": minutesEv,
  "councils.minutes.rendered": minutesEv.extend({ renderHash: hash64 }),
  "councils.minutes.signed": minutesEv,
  /** `reasonRef` : demande de déverrouillage approuvée (le motif en clair se lit côté councils) ; consommé par reportcards pour marquer l'ancien PV « remplacé ». */
  "councils.minutes.superseded": minutesEv.extend({ reasonRef: councilsUuidSchema, reopenCount: z.number().int() }),
  "councils.minutes.revoked": minutesEv,
  "councils.unlock.requested": unlockEv,
  "councils.unlock.approved": unlockEv,
  "councils.unlock.rejected": unlockEv,
  "councils.effect.applied": effectEv,
  "councils.effect.failed": effectEv,
  "councils.effect.reverted": effectEv,
  "councils.effect.awaiting_human": effectEv,
  "councils.orientation.file_decided": ev({ fileId: councilsUuidSchema, enrollmentId: councilsUuidSchema, studentId: councilsUuidSchema, decisionId: councilsUuidSchema }),
  "councils.series_transfer.planned": transferEv,
  "councils.series_transfer.applied": transferEv,
  "councils.series_transfer.cancelled": transferEv,
} as const;
export type CouncilsEventType = keyof typeof councilsEventPayloadSchemas;
export const COUNCILS_EVENT_TYPES = Object.keys(councilsEventPayloadSchemas) as CouncilsEventType[];
