/**
 * Contrats du module `rules` (routes `/api/v1/rules/*`). Écrits avant les routes
 * (ADR-001 règle 6) ; le client web est typé à partir de ces schémas.
 *
 * Dates d'effet : « AAAA-MM-JJ » (jours calendaires, bornes incluses). Horodatages : ISO 8601 UTC.
 * Identifiants : UUID. Libellés : français. Codes de sortie des règles : anglais en majuscules.
 *
 * Ce paquet ne dépend pas du moteur de règles (`@ecoledigitale/rules-engine`, réservé au module `rules`) :
 * les formes utiles (paramètres bornés, diagnostics) sont décrites ici et vérifiées par le module.
 *
 * Préfixe tenant : `/api/v1/rules`. Console du super-administrateur : `/api/v1/rules/platform/*`.
 */
import { z } from "zod";

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const RULES_STATUSES = ["draft", "simulated", "proposed", "approved", "published", "retired"] as const;
export const RulesStatusSchema = z.enum(RULES_STATUSES);
export type RulesStatus = z.infer<typeof RulesStatusSchema>;

export const RULES_RULE_TYPES = [
  "grading_scale",
  "assessment_aggregation",
  "period_average",
  "annual_average",
  "ranking",
  "rounding",
  "mention",
  "promotion",
  "repetition",
  "orientation",
  "credit_validation",
  "compensation",
  "eliminatory_grade",
] as const;
export const RulesRuleTypeSchema = z.enum(RULES_RULE_TYPES);

/** `credit-semester@1` : nom du contrat + version (changer la structure = nouveau contrat). */
export const RulesContractIdSchema = z.string().regex(/^[a-z][a-z0-9-]*@[0-9]+$/, "Identifiant de contrat invalide (ex. credit-semester@1).");
/** Code d'un jeu de règles, ex. `CI-HIGHER-LMD`. */
export const RulesRuleSetCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_-]{2,63}$/, "Code de jeu de règles invalide (ex. CI-HIGHER-LMD).");
export const RulesRuleKeySchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "Clé de règle en minuscules (a-z, 0-9, _), commençant par une lettre.");
export const RulesIsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const isoDateTime = z.string().datetime({ offset: true });

export const RulesOriginSchema = z.enum(["national", "tenant"]);
export type RulesOrigin = z.infer<typeof RulesOriginSchema>;

export const RulesSourceSchema = z
  .object({
    kind: z.enum(["regulation", "institution", "platform"]),
    reference: z.string().trim().min(1).max(500).optional(),
    url: z.string().url().max(1000).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();
export type RulesSource = z.infer<typeof RulesSourceSchema>;

/** Paramètre d'une règle : toujours borné quand il est numérique (R-RUL-07). */
export const RulesParameterSpecSchema = z
  .object({
    type: z.enum(["number", "string", "boolean"]),
    default: z.union([z.number().finite(), z.string().max(200), z.boolean()]),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    description: z.string().max(500).optional(),
  })
  .strict();
export type RulesParameterSpec = z.infer<typeof RulesParameterSpecSchema>;

export const RulesLabelMapSchema = z.record(z.record(z.string().max(200)));

export const RulesDiagnosticSchema = z.object({
  code: z.string(),
  phase: z.string(),
  message: z.string(),
  hint: z.string().optional(),
  position: z.object({ start: z.number(), end: z.number(), line: z.number(), column: z.number() }).optional(),
});
export type RulesDiagnostic = z.infer<typeof RulesDiagnosticSchema>;

// ---------------------------------------------------------------------------
// Lecture : jeux, versions, règles
// ---------------------------------------------------------------------------

export const RulesRuleDefinitionDtoSchema = z.object({
  key: RulesRuleKeySchema,
  type: RulesRuleTypeSchema,
  position: z.number().int().nonnegative(),
  expression: z.string(),
  description: z.string().nullable(),
  parameters: z.record(RulesParameterSpecSchema),
  /** `null` : le schéma d'entrée du contrat s'applique. */
  inputSchema: z.record(z.unknown()).nullable(),
  /** `null` : le type de résultat du contrat s'applique. */
  resultType: z.enum(["number", "number?", "string", "string?", "boolean", "boolean?"]).nullable(),
  labelMap: RulesLabelMapSchema,
  isOptional: z.boolean(),
});
export type RulesRuleDefinitionDto = z.infer<typeof RulesRuleDefinitionDtoSchema>;

export const RulesVersionSummaryDtoSchema = z.object({
  id: UuidSchema,
  ruleSetId: UuidSchema,
  ruleSetCode: RulesRuleSetCodeSchema,
  origin: RulesOriginSchema,
  /** Numéro de version dans le jeu (1, 2…). */
  versionNo: z.number().int().min(1),
  status: RulesStatusSchema,
  contractId: RulesContractIdSchema,
  basedOnVersionId: UuidSchema.nullable(),
  effectiveFrom: RulesIsoDateSchema,
  effectiveTo: RulesIsoDateSchema.nullable(),
  source: RulesSourceSchema,
  definitionHash: z.string().nullable(),
  lastSimulationId: UuidSchema.nullable(),
  createdBy: UuidSchema.nullable(),
  approvedBy: UuidSchema.nullable(),
  /** Verrou optimiste (variantes d'établissement) ; `null` pour le catalogue national. */
  rowVersion: z.number().int().nullable(),
  notes: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type RulesVersionSummaryDto = z.infer<typeof RulesVersionSummaryDtoSchema>;

export const RulesVersionEventDtoSchema = z.object({
  id: UuidSchema,
  fromStatus: RulesStatusSchema.nullable(),
  toStatus: RulesStatusSchema,
  actorId: UuidSchema.nullable(),
  actorName: z.string(),
  actorKind: z.enum(["tenant_admin", "super_admin", "system"]),
  comment: z.string().nullable(),
  occurredAt: isoDateTime,
});
export type RulesVersionEventDto = z.infer<typeof RulesVersionEventDtoSchema>;

export const RulesVersionDetailDtoSchema = RulesVersionSummaryDtoSchema.extend({
  rules: z.array(RulesRuleDefinitionDtoSchema),
  events: z.array(RulesVersionEventDtoSchema),
});
export type RulesVersionDetailDto = z.infer<typeof RulesVersionDetailDtoSchema>;

export const RulesRuleSetDtoSchema = z.object({
  id: UuidSchema,
  code: RulesRuleSetCodeSchema,
  name: z.string(),
  countryCode: z.string(),
  regulation: z.string().nullable(),
  educationSystem: z.string().nullable(),
  level: z.string().nullable(),
  origin: RulesOriginSchema,
  basedOnSetId: UuidSchema.nullable(),
  versions: z.array(RulesVersionSummaryDtoSchema),
});
export type RulesRuleSetDto = z.infer<typeof RulesRuleSetDtoSchema>;

export const RulesListRuleSetsQuerySchema = z
  .object({
    code: RulesRuleSetCodeSchema.optional(),
    status: RulesStatusSchema.optional(),
    origin: RulesOriginSchema.optional(),
  })
  .strict();
export type RulesListRuleSetsQuery = z.infer<typeof RulesListRuleSetsQuerySchema>;

export const RulesListRuleSetsResponseSchema = z.object({ items: z.array(RulesRuleSetDtoSchema) });
export type RulesListRuleSetsResponse = z.infer<typeof RulesListRuleSetsResponseSchema>;

export const RulesIdParamsSchema = z.object({ id: UuidSchema }).strict();
export const RulesCodeParamsSchema = z.object({ code: RulesRuleSetCodeSchema }).strict();
export const RulesVersionRuleParamsSchema = z.object({ id: UuidSchema, key: RulesRuleKeySchema }).strict();

// ---------------------------------------------------------------------------
// Variantes d'établissement : dérivation, édition, validation
// ---------------------------------------------------------------------------

export const RulesDeriveVariantBodySchema = z
  .object({
    /** Version nationale publiée dont la variante est la COPIE (pas un héritage). */
    baseVersionId: UuidSchema,
    name: z.string().trim().min(1).max(200).optional(),
    effectiveFrom: RulesIsoDateSchema,
    effectiveTo: RulesIsoDateSchema.nullable().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type RulesDeriveVariantBody = z.infer<typeof RulesDeriveVariantBodySchema>;

export const RulesParameterChangeSchema = z
  .object({
    ruleKey: RulesRuleKeySchema,
    parameter: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
    value: z.union([z.number().finite(), z.string().max(200), z.boolean()]),
  })
  .strict();

export const RulesEditParametersBodySchema = z
  .object({
    changes: z.array(RulesParameterChangeSchema).min(1).max(200),
    /** Verrou optimiste : 409 si la version a été modifiée entre-temps. */
    expectedRowVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type RulesEditParametersBody = z.infer<typeof RulesEditParametersBodySchema>;

export const RulesEditExpressionBodySchema = z
  .object({
    expression: z.string().min(1).max(10_000),
    description: z.string().max(2000).nullable().optional(),
    expectedRowVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type RulesEditExpressionBody = z.infer<typeof RulesEditExpressionBodySchema>;

export const RulesContractViolationSchema = z.object({
  ruleKey: z.string().nullable(),
  code: z.string(),
  message: z.string(),
});
export type RulesContractViolation = z.infer<typeof RulesContractViolationSchema>;

export const RulesValidateResponseSchema = z.object({
  ok: z.boolean(),
  contractId: RulesContractIdSchema,
  rules: z.array(
    z.object({
      key: z.string(),
      ok: z.boolean(),
      diagnostics: z.array(RulesDiagnosticSchema),
      resultType: z.string().nullable(),
    }),
  ),
  violations: z.array(RulesContractViolationSchema),
});
export type RulesValidateResponse = z.infer<typeof RulesValidateResponseSchema>;

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export const RulesSimulationDatasetSchema = z
  .object({
    periodIds: z.array(UuidSchema).min(1).max(50),
    classroomIds: z.array(UuidSchema).max(200).optional(),
    sample: z
      .object({
        size: z.number().int().min(1).max(100_000).optional(),
        seed: z.number().int().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type RulesSimulationDataset = z.infer<typeof RulesSimulationDatasetSchema>;

export const RulesRequestSimulationBodySchema = z
  .object({
    /** Version de référence ; défaut : la version active du même jeu (ou la version nationale copiée). */
    baseVersionId: UuidSchema.optional(),
    dataset: RulesSimulationDatasetSchema,
  })
  .strict();
export type RulesRequestSimulationBody = z.infer<typeof RulesRequestSimulationBodySchema>;

export const RulesSimulationStatusSchema = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

export const RulesSimulationOutcomeSchema = z.union([
  z.object({ status: z.literal("ok"), type: z.enum(["number", "string", "boolean", "null"]), value: z.union([z.string(), z.boolean(), z.null()]) }),
  z.object({ status: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ status: z.literal("absent") }),
]);

export const RulesSimulationDifferenceDtoSchema = z.object({
  caseRef: z.string(),
  ruleKey: z.string(),
  kind: z.enum(["value_changed", "error_introduced", "error_resolved", "error_changed"]),
  old: RulesSimulationOutcomeSchema,
  new: RulesSimulationOutcomeSchema,
  delta: z.string().nullable(),
});

export const RulesSimulationRuleStatsDtoSchema = z.object({
  key: z.string(),
  presence: z.enum(["both", "added", "removed"]),
  compileErrors: z.object({ old: z.string().optional(), new: z.string().optional() }),
  evaluated: z.number().int(),
  changed: z.number().int(),
  unchanged: z.number().int(),
  newErrors: z.number().int(),
  resolvedErrors: z.number().int(),
  changedErrors: z.number().int(),
  maxAbsDelta: z.string().optional(),
  meanDelta: z.string().optional(),
  transitions: z.array(z.object({ from: z.string(), to: z.string(), count: z.number().int() })),
});

export const RulesSimulationDtoSchema = z.object({
  id: UuidSchema,
  targetVersionId: UuidSchema,
  baseVersionId: UuidSchema,
  targetDefinitionHash: z.string(),
  contractId: RulesContractIdSchema,
  status: RulesSimulationStatusSchema,
  progressPercent: z.number().int().min(0).max(100),
  casesCount: z.number().int().nullable(),
  summary: z
    .object({
      cases: z.number().int(),
      rules: z.number().int(),
      evaluations: z.number().int(),
      changed: z.number().int(),
      unchanged: z.number().int(),
      newErrors: z.number().int(),
      resolvedErrors: z.number().int(),
      changedErrors: z.number().int(),
      changedPercent: z.string(),
    })
    .nullable(),
  rules: z.array(RulesSimulationRuleStatsDtoSchema),
  /** Part (en %) des évaluations de DÉCISION (passage, validation…) modifiées (AC2.5). */
  decisionChangedPercent: z.string().nullable(),
  differencesTruncated: z.boolean(),
  differences: z.array(RulesSimulationDifferenceDtoSchema),
  error: z.string().nullable(),
  requestedBy: UuidSchema,
  startedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type RulesSimulationDto = z.infer<typeof RulesSimulationDtoSchema>;

export const RulesAcceptedSimulationResponseSchema = z.object({
  simulationId: UuidSchema,
  status: RulesSimulationStatusSchema,
});
export type RulesAcceptedSimulationResponse = z.infer<typeof RulesAcceptedSimulationResponseSchema>;

// ---------------------------------------------------------------------------
// Gouvernance : transitions
// ---------------------------------------------------------------------------

export const RulesTransitionBodySchema = z
  .object({
    to: RulesStatusSchema,
    comment: z.string().trim().min(1).max(2000).optional(),
    /** AC2.5 : confirmation explicite quand la simulation modifie plus de X % des décisions. */
    confirmDecisionImpact: z.boolean().optional(),
    expectedRowVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type RulesTransitionBody = z.infer<typeof RulesTransitionBodySchema>;

export const RulesTransitionResponseSchema = z.object({
  version: RulesVersionSummaryDtoSchema,
  /** Part (en %) des décisions modifiées par la dernière simulation, si connue. */
  decisionChangedPercent: z.string().nullable(),
});
export type RulesTransitionResponse = z.infer<typeof RulesTransitionResponseSchema>;

// ---------------------------------------------------------------------------
// Liaisons contrat / périmètre -> jeu de règles
// ---------------------------------------------------------------------------

export const RulesBindingBodySchema = z
  .object({
    contractId: RulesContractIdSchema,
    ruleSetCode: RulesRuleSetCodeSchema,
    institutionId: UuidSchema.nullable().optional(),
    curriculumNodeId: UuidSchema.nullable().optional(),
    levelCode: z.string().trim().min(1).max(64).nullable().optional(),
    effectiveFrom: RulesIsoDateSchema,
    effectiveTo: RulesIsoDateSchema.nullable().optional(),
  })
  .strict();
export type RulesBindingBody = z.infer<typeof RulesBindingBodySchema>;

export const RulesBindingDtoSchema = z.object({
  id: UuidSchema,
  contractId: RulesContractIdSchema,
  ruleSetCode: RulesRuleSetCodeSchema,
  institutionId: UuidSchema.nullable(),
  curriculumNodeId: UuidSchema.nullable(),
  levelCode: z.string().nullable(),
  effectiveFrom: RulesIsoDateSchema,
  effectiveTo: RulesIsoDateSchema.nullable(),
  createdAt: isoDateTime,
});
export type RulesBindingDto = z.infer<typeof RulesBindingDtoSchema>;

export const RulesListBindingsQuerySchema = z.object({ contractId: RulesContractIdSchema.optional() }).strict();
export const RulesListBindingsResponseSchema = z.object({ items: z.array(RulesBindingDtoSchema) });

// ---------------------------------------------------------------------------
// Contrats (catalogue en code)
// ---------------------------------------------------------------------------

export const RulesContractRuleDtoSchema = z.object({
  key: RulesRuleKeySchema,
  type: RulesRuleTypeSchema,
  optional: z.boolean(),
  inputs: z.record(z.unknown()),
  result: z.enum(["number", "number?", "string", "string?", "boolean", "boolean?"]),
  /** Valeurs de sortie permises (codes), pour les règles à code. */
  outputCodes: z.array(z.string()),
  parameters: z.record(z.object({ type: z.enum(["number", "string", "boolean"]), allowed: z.array(z.union([z.string(), z.number()])).optional() })),
  description: z.string(),
});
export const RulesContractDtoSchema = z.object({
  id: RulesContractIdSchema,
  name: z.string(),
  description: z.string(),
  rules: z.array(RulesContractRuleDtoSchema),
  pipeline: z.array(z.object({ stage: z.string(), rules: z.array(z.string()), description: z.string() })),
});
export type RulesContractDto = z.infer<typeof RulesContractDtoSchema>;
export const RulesContractListResponseSchema = z.object({ items: z.array(RulesContractDtoSchema.pick({ id: true, name: true, description: true })) });

// ---------------------------------------------------------------------------
// Résolution et évaluation
// ---------------------------------------------------------------------------

export const RulesResolveQuerySchema = z
  .object({
    contractId: RulesContractIdSchema,
    institutionId: UuidSchema.optional(),
    curriculumNodeId: UuidSchema.optional(),
    levelCode: z.string().trim().min(1).max(64).optional(),
    /** Date de DÉBUT de la période : jamais l'heure courante (R-RUL-05). */
    date: RulesIsoDateSchema,
  })
  .strict();
export type RulesResolveQuery = z.infer<typeof RulesResolveQuerySchema>;

export const RulesConsideredVersionDtoSchema = z.object({
  ruleSetId: z.string(),
  versionId: z.string(),
  version: z.number().int(),
  origin: RulesOriginSchema,
  eligible: z.boolean(),
  reason: z.string().optional(),
});

export const RulesResolveResponseSchema = z.object({
  /** `null` : aucune règle active — le consommateur refuse le calcul (`results.no_active_ruleset`). */
  resolved: z
    .object({
      ruleVersionId: UuidSchema,
      ruleSetCode: RulesRuleSetCodeSchema,
      versionNo: z.number().int(),
      definitionHash: z.string(),
      origin: RulesOriginSchema,
      bindingId: UuidSchema,
    })
    .nullable(),
  considered: z.array(RulesConsideredVersionDtoSchema),
});
export type RulesResolveResponse = z.infer<typeof RulesResolveResponseSchema>;

/** Banc d'essai : évalue UNE règle d'une version visible sur un contexte saisi (sans persistance, 30 appels/min). */
export const RulesEvaluateBodySchema = z
  .object({
    versionId: UuidSchema,
    ruleKey: RulesRuleKeySchema,
    context: z
      .object({
        variables: z.record(z.unknown()).default({}),
        lookups: z.record(z.record(z.unknown())).optional(),
      })
      .strict(),
    overrides: z.record(z.union([z.number().finite(), z.string(), z.boolean()])).optional(),
    trace: z.boolean().default(true),
  })
  .strict();
export type RulesEvaluateBody = z.infer<typeof RulesEvaluateBodySchema>;

export const RulesTraceEntryDtoSchema = z.object({
  seq: z.number().int(),
  kind: z.string(),
  label: z.string(),
  source: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  type: z.string(),
  value: z.unknown(),
});

export const RulesEvaluateResponseSchema = z.object({
  ruleVersionId: UuidSchema,
  ruleKey: z.string(),
  definitionHash: z.string(),
  engineVersion: z.string(),
  type: z.enum(["number", "string", "boolean", "null"]),
  /** Les nombres sont des chaînes décimales exactes. */
  value: z.union([z.string(), z.boolean(), z.null()]),
  nodesEvaluated: z.number().int(),
  trace: z.array(RulesTraceEntryDtoSchema),
  traceTruncated: z.boolean(),
  inputsHash: z.string(),
  outputsHash: z.string(),
});
export type RulesEvaluateResponse = z.infer<typeof RulesEvaluateResponseSchema>;

export const RulesVersionEventsResponseSchema = z.object({ items: z.array(RulesVersionEventDtoSchema) });

// ---------------------------------------------------------------------------
// Console du super-administrateur (`/platform/*`)
// ---------------------------------------------------------------------------

export const RulesPlatformRuleInputSchema = z
  .object({
    key: RulesRuleKeySchema,
    type: RulesRuleTypeSchema,
    expression: z.string().min(1).max(10_000),
    description: z.string().max(2000).optional(),
    parameters: z.record(RulesParameterSpecSchema).optional(),
    /** Absent : le schéma d'entrée du contrat s'applique (cas courant). */
    inputSchema: z.record(z.unknown()).optional(),
    resultType: z.enum(["number", "number?", "string", "string?", "boolean", "boolean?"]).optional(),
    labelMap: RulesLabelMapSchema.optional(),
    isOptional: z.boolean().optional(),
  })
  .strict();
export type RulesPlatformRuleInput = z.infer<typeof RulesPlatformRuleInputSchema>;

export const RulesPlatformCreateRuleSetBodySchema = z
  .object({
    code: RulesRuleSetCodeSchema,
    name: z.string().trim().min(1).max(200),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    regulation: z.string().max(500).optional(),
    educationSystem: z.string().max(100).optional(),
    level: z.string().max(100).optional(),
  })
  .strict();
export type RulesPlatformCreateRuleSetBody = z.infer<typeof RulesPlatformCreateRuleSetBodySchema>;

export const RulesPlatformCreateVersionBodySchema = z
  .object({
    contractId: RulesContractIdSchema,
    effectiveFrom: RulesIsoDateSchema,
    effectiveTo: RulesIsoDateSchema.nullable().optional(),
    source: RulesSourceSchema,
    rules: z.array(RulesPlatformRuleInputSchema).min(1).max(500),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type RulesPlatformCreateVersionBody = z.infer<typeof RulesPlatformCreateVersionBodySchema>;

export const RulesPlatformReplaceRulesBodySchema = z
  .object({ rules: z.array(RulesPlatformRuleInputSchema).min(1).max(500) })
  .strict();

/** `tenantId` absent : version du catalogue NATIONAL ; présent : variante de cet établissement. */
export const RulesPlatformDecisionBodySchema = z
  .object({
    tenantId: UuidSchema.optional(),
    comment: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export type RulesPlatformDecisionBody = z.infer<typeof RulesPlatformDecisionBodySchema>;

/** Clôture la période d'effet d'une version approuvée/publiée (la fin ne peut qu'être raccourcie). */
export const RulesPlatformClosePeriodBodySchema = RulesPlatformDecisionBodySchema.extend({ effectiveTo: RulesIsoDateSchema }).strict();
export type RulesPlatformClosePeriodBody = z.infer<typeof RulesPlatformClosePeriodBodySchema>;

export const RulesPlatformTransitionBodySchema =RulesPlatformDecisionBodySchema.extend({ to: RulesStatusSchema }).strict();
export type RulesPlatformTransitionBody = z.infer<typeof RulesPlatformTransitionBodySchema>;

export const RulesPlatformQueueItemSchema = z.object({
  tenantId: UuidSchema,
  tenantSlug: z.string(),
  version: RulesVersionSummaryDtoSchema,
  ruleSetName: z.string(),
  lastSimulationId: UuidSchema.nullable(),
  decisionChangedPercent: z.string().nullable(),
  decisionImpactConfirmed: z.boolean(),
});
export const RulesPlatformQueueResponseSchema = z.object({ items: z.array(RulesPlatformQueueItemSchema) });
export type RulesPlatformQueueResponse = z.infer<typeof RulesPlatformQueueResponseSchema>;

export const RulesPlatformImpactResponseSchema = z.object({
  items: z.array(
    z.object({
      tenantId: UuidSchema,
      tenantSlug: z.string(),
      activeVariants: z.array(RulesVersionSummaryDtoSchema),
    }),
  ),
});
export type RulesPlatformImpactResponse = z.infer<typeof RulesPlatformImpactResponseSchema>;

export const RulesPlatformSettingsBodySchema = z
  .object({
    decisionImpactConfirmPercent: z.number().min(0).max(100).optional(),
    nationalFourEyes: z.boolean().optional(),
    replaySamplePercent: z.number().min(0).max(100).optional(),
  })
  .strict();
export type RulesPlatformSettingsBody = z.infer<typeof RulesPlatformSettingsBodySchema>;
export const RulesPlatformSettingsResponseSchema = z.object({
  decisionImpactConfirmPercent: z.number(),
  nationalFourEyes: z.boolean(),
  replaySamplePercent: z.number(),
});
