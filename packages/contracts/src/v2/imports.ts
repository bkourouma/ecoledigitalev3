/**
 * Contrats du module `imports` (routes `/api/v1/imports/*`, événements `imports.*`) — spec v2/031-imports.
 *
 * Conventions :
 *  - IDENTIFIANTS : UUID. INSTANTS : ISO 8601 avec fuseau.
 *  - Le fichier est envoyé en CORPS BRUT (`application/octet-stream`, ou le type du fichier) ; ni le nom ni le type
 *    annoncés ne font foi : le type réel est contrôlé sur les octets par le serveur.
 *  - AUCUNE ligne brute dans un événement ni un journal : décomptes et identifiants seulement.
 *  - Messages utilisateur en français ; codes d'erreur stables `imports.*` (ceux des modules cibles sont repris tels
 *    quels dans `issues[].code`).
 *  - Entrées `strict()` : un champ inconnu est refusé.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives et énumérations
// ---------------------------------------------------------------------------

export const importsUuidSchema = z.string().uuid();
export const importsInstantSchema = z.string().datetime({ offset: true });

export const IMPORTER_KEYS = ["students", "guardians", "staff", "classrooms", "curriculum", "grades", "opening_balances"] as const;
export const importerKeySchema = z.enum(IMPORTER_KEYS);
export type ImporterKey = z.infer<typeof importerKeySchema>;

export const IMPORT_FILE_KINDS = ["XLSX", "CSV"] as const;
export const importFileKindSchema = z.enum(IMPORT_FILE_KINDS);
export type ImportFileKind = z.infer<typeof importFileKindSchema>;

export const IMPORT_JOB_STATUSES = ["UPLOADED", "MAPPED", "VALIDATING", "VALIDATED", "QUEUED", "RUNNING", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"] as const;
export const importJobStatusSchema = z.enum(IMPORT_JOB_STATUSES);
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;
/** États terminaux : plus aucune transition. */
export const IMPORT_FINAL_STATUSES: readonly ImportJobStatus[] = ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"];

export const IMPORT_RUN_MODES = ["ALL_OR_NOTHING", "VALID_ONLY"] as const;
export const importRunModeSchema = z.enum(IMPORT_RUN_MODES);
export type ImportRunMode = z.infer<typeof importRunModeSchema>;

export const IMPORT_ON_EXISTING = ["SKIP", "UPDATE"] as const;
export const importOnExistingSchema = z.enum(IMPORT_ON_EXISTING);
export type ImportOnExisting = z.infer<typeof importOnExistingSchema>;

export const IMPORT_ROW_VALIDATIONS = ["PENDING", "VALID", "INVALID"] as const;
export const importRowValidationSchema = z.enum(IMPORT_ROW_VALIDATIONS);
export type ImportRowValidation = z.infer<typeof importRowValidationSchema>;

export const IMPORT_PLANNED_ACTIONS = ["CREATE", "UPDATE", "SKIP", "ERROR"] as const;
export const importPlannedActionSchema = z.enum(IMPORT_PLANNED_ACTIONS);
export type ImportPlannedAction = z.infer<typeof importPlannedActionSchema>;

export const IMPORT_OUTCOMES = ["CREATED", "UPDATED", "SKIPPED", "FAILED"] as const;
export const importOutcomeSchema = z.enum(IMPORT_OUTCOMES);
export type ImportOutcome = z.infer<typeof importOutcomeSchema>;

export const IMPORT_COLUMN_TYPES = ["text", "date", "integer", "decimal", "boolean", "code", "email", "phone"] as const;
export const importColumnTypeSchema = z.enum(IMPORT_COLUMN_TYPES);
export type ImportColumnType = z.infer<typeof importColumnTypeSchema>;

/** Codes d'erreur stables du cadre (contrat d'API). */
export const IMPORT_ERROR_CODES = [
  "imports.importer_unknown",
  "imports.job_not_found",
  "imports.template_not_found",
  "imports.template_exists",
  "imports.file_empty",
  "imports.file_too_large",
  "imports.file_type_unsupported",
  "imports.file_type_mismatch",
  "imports.file_corrupt",
  "imports.file_unsafe",
  "imports.too_many_rows",
  "imports.too_many_columns",
  "imports.no_header",
  "imports.duplicate_header",
  "imports.sheet_unknown",
  "imports.cell_too_long",
  "imports.cell_errors",
  "imports.rate_limited",
  "imports.storage_unavailable",
  "imports.port_unavailable",
  "imports.quota_active_jobs",
  "imports.quota_daily_jobs",
  "imports.invalid_state",
  "imports.mapping_incomplete",
  "imports.mapping_invalid",
  "imports.options_invalid",
  "imports.not_validated",
  "imports.has_errors",
  "imports.too_many_rows_all_or_nothing",
  "imports.mfa_required",
  "imports.run_already_started",
  "imports.cancelled",
  "imports.required",
  "imports.invalid_value",
  "imports.invalid_date",
  "imports.invalid_email",
  "imports.invalid_phone",
  "imports.invalid_choice",
  "imports.amount_not_integer",
  "imports.amount_invalid",
  "imports.duplicate_in_file",
  "imports.reference_unknown",
  "imports.already_imported",
  "imports.rule_violation",
  "imports.write_failed",
  "imports.formulas_ignored",
  "imports.macros_ignored",
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Descripteurs d'importeurs (colonnes, options, permissions)
// ---------------------------------------------------------------------------

export const importColumnDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  type: importColumnTypeSchema,
  description: z.string(),
  example: z.string(),
});
export type ImportColumnDef = z.infer<typeof importColumnDefSchema>;

export const importOptionDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  help: z.string(),
  /** `choice` : valeurs proposées par `GET /importers/:key/options/:option/choices` ; `text` : saisie libre. */
  kind: z.enum(["choice", "text", "boolean"]),
  /** Valeurs fixes (sinon, valeurs proposées par `GET /importers/:key/options/:option/choices`). */
  choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});
export type ImportOptionDef = z.infer<typeof importOptionDefSchema>;

export const importerDescriptorSchema = z.object({
  key: importerKeySchema,
  label: z.string(),
  description: z.string(),
  /** Soldes financiers : MFA exigée pour lancer l'import. */
  sensitive: z.boolean(),
  columns: z.array(importColumnDefSchema),
  options: z.array(importOptionDefSchema),
  /** Permission de lancer cet importeur (en plus de celles du module cible). */
  importPermission: z.string(),
  /** Permissions du module cible exigées (sous-ensemble conditionnel : voir `conditionalPermissions`). */
  targetPermissions: z.array(z.string()),
  conditionalPermissions: z.array(z.object({ permission: z.string(), when: z.string() })),
  /** `true` si l'appelant détient `imports.create` ET les permissions du module cible. */
  canUse: z.boolean(),
  /** `true` si l'appelant détient aussi la permission de lancement. */
  canRun: z.boolean(),
});
export type ImporterDescriptor = z.infer<typeof importerDescriptorSchema>;

export const importChoiceSchema = z.object({ value: z.string(), label: z.string() });
export type ImportChoice = z.infer<typeof importChoiceSchema>;

// ---------------------------------------------------------------------------
// Rapports de ligne et de fichier
// ---------------------------------------------------------------------------

export const importIssueSchema = z.object({
  /** Champ cible concerné (`null` : ligne entière). */
  column: z.string().nullable(),
  /** En-tête du fichier correspondant, si le champ est mappé. */
  header: z.string().nullable().optional(),
  code: z.string(),
  message: z.string(),
  severity: z.enum(["ERROR", "WARNING"]),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const importWarningSchema = z.object({ code: z.string(), message: z.string(), count: z.number().int().optional() });
export type ImportWarning = z.infer<typeof importWarningSchema>;

export const importJobDtoSchema = z.object({
  id: importsUuidSchema,
  importerKey: importerKeySchema,
  status: importJobStatusSchema,
  fileName: z.string(),
  fileKind: importFileKindSchema,
  fileSize: z.number().int(),
  fileSha256: z.string(),
  sheetName: z.string().nullable(),
  sheetNames: z.array(z.string()).optional(),
  headers: z.array(z.string()),
  warnings: z.array(importWarningSchema),
  totalRows: z.number().int(),
  duplicateOfJobId: importsUuidSchema.nullable(),
  mapping: z.record(z.string().nullable()).nullable(),
  mappingTemplateId: importsUuidSchema.nullable(),
  options: z.record(z.unknown()),
  runMode: importRunModeSchema,
  onExisting: importOnExistingSchema,
  validRows: z.number().int(),
  invalidRows: z.number().int(),
  plannedCreate: z.number().int(),
  plannedUpdate: z.number().int(),
  plannedSkip: z.number().int(),
  /** Lignes validées / total pendant la validation (0..totalRows). */
  validationProgress: z.number().int(),
  validatedAt: importsInstantSchema.nullable(),
  processedCount: z.number().int(),
  createdCount: z.number().int(),
  updatedCount: z.number().int(),
  skippedCount: z.number().int(),
  failedCount: z.number().int(),
  startedAt: importsInstantSchema.nullable(),
  finishedAt: importsInstantSchema.nullable(),
  durationMs: z.number().int().nullable(),
  cancelRequested: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  rawPurged: z.boolean(),
  createdBy: importsUuidSchema,
  createdAt: importsInstantSchema,
  updatedAt: importsInstantSchema,
});
export type ImportJobDto = z.infer<typeof importJobDtoSchema>;

export const importRowDtoSchema = z.object({
  rowNo: z.number().int(),
  raw: z.array(z.string()).nullable(),
  values: z.record(z.unknown()).nullable(),
  naturalKey: z.string().nullable(),
  validation: importRowValidationSchema,
  plannedAction: importPlannedActionSchema.nullable(),
  issues: z.array(importIssueSchema),
  outcome: importOutcomeSchema.nullable(),
  entityId: importsUuidSchema.nullable(),
  outcomeIssues: z.array(importIssueSchema),
});
export type ImportRowDto = z.infer<typeof importRowDtoSchema>;

export const importRowPageSchema = z.object({ items: z.array(importRowDtoSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });
export type ImportRowPage = z.infer<typeof importRowPageSchema>;

export const importJobPageSchema = z.object({ items: z.array(importJobDtoSchema), total: z.number().int(), limit: z.number().int(), offset: z.number().int() });
export type ImportJobPage = z.infer<typeof importJobPageSchema>;

/** Réponse de l'upload : l'import créé et le mapping proposé. */
export const importUploadResultSchema = z.object({
  job: importJobDtoSchema,
  /** champ cible -> en-tête (`null` : non trouvé). */
  suggestedMapping: z.record(z.string().nullable()),
  /** Modèle de mapping appliqué automatiquement (>= 80 % d'en-têtes retrouvés), sinon `null`. */
  suggestedTemplateId: importsUuidSchema.nullable(),
  /** Champs obligatoires sans colonne trouvée. */
  missingRequired: z.array(z.string()),
  /** En-têtes du fichier non affectés. */
  unmappedHeaders: z.array(z.string()),
  /** Aperçu des premières lignes (texte brut). */
  sample: z.array(z.array(z.string())),
});
export type ImportUploadResult = z.infer<typeof importUploadResultSchema>;

export const importPreviewSchema = z.object({
  jobId: importsUuidSchema,
  totalRows: z.number().int(),
  validRows: z.number().int(),
  invalidRows: z.number().int(),
  willCreate: z.number().int(),
  willUpdate: z.number().int(),
  willSkip: z.number().int(),
  willFail: z.number().int(),
  /** Nombre de lignes avec avertissement (non bloquant). */
  warnings: z.number().int(),
  /** Erreurs les plus fréquentes : code, nombre, premier exemple. */
  topIssues: z.array(z.object({ code: z.string(), count: z.number().int(), column: z.string().nullable(), example: z.string() })),
  /** Échantillon de lignes par action (<= 10 chacune). */
  samples: z.object({ create: z.array(importRowDtoSchema), update: z.array(importRowDtoSchema), skip: z.array(importRowDtoSchema), error: z.array(importRowDtoSchema) }),
  /** `true` si l'import peut être lancé dans le mode demandé. */
  canRun: z.boolean(),
  blockers: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importReportSchema = z.object({
  job: importJobDtoSchema,
  author: z.object({ userId: importsUuidSchema, displayName: z.string().nullable() }),
  totals: z.object({ created: z.number().int(), updated: z.number().int(), skipped: z.number().int(), failed: z.number().int(), processed: z.number().int(), total: z.number().int() }),
  /** Erreurs les plus fréquentes de l'exécution. */
  topIssues: z.array(z.object({ code: z.string(), count: z.number().int(), column: z.string().nullable(), example: z.string() })),
});
export type ImportReport = z.infer<typeof importReportSchema>;

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------

const optionsSchema = z.record(z.union([z.string().max(200), z.boolean(), z.number()])).refine((v) => Object.keys(v).length <= 20, "Trop d'options.");

/** Paramètres d'URL de l'upload (le fichier est le corps de la requête). */
export const importUploadQuerySchema = z
  .object({
    importer: importerKeySchema,
    fileName: z.string().trim().min(1).max(255),
    sheet: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const importMappingBodySchema = z
  .object({
    /** champ cible -> en-tête du fichier, ou `null` pour ne pas importer le champ. */
    mapping: z.record(z.string().max(300).nullable()),
    templateId: importsUuidSchema.nullable().optional(),
    options: optionsSchema.optional(),
    runMode: importRunModeSchema.optional(),
    onExisting: importOnExistingSchema.optional(),
  })
  .strict();
export type ImportMappingBody = z.infer<typeof importMappingBodySchema>;

export const importRunBodySchema = z
  .object({
    runMode: importRunModeSchema,
    onExisting: importOnExistingSchema,
    /** Confirmation explicite de la preview consultée (empêche un lancement « à l'aveugle »). */
    confirm: z.literal(true),
  })
  .strict();
export type ImportRunBody = z.infer<typeof importRunBodySchema>;

export const importCancelBodySchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const importListJobsQuerySchema = z.object({
  importer: importerKeySchema.optional(),
  status: importJobStatusSchema.optional(),
  mine: z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const importListRowsQuerySchema = z.object({
  validation: importRowValidationSchema.optional(),
  action: importPlannedActionSchema.optional(),
  outcome: importOutcomeSchema.optional(),
  /** Seulement les lignes ayant un problème (erreur de validation ou échec d'exécution). */
  onlyProblems: z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean()).optional(),
  /** Champ cible concerné par un problème. */
  column: z.string().trim().max(100).optional(),
  code: z.string().trim().max(100).optional(),
  rowNo: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ImportListRowsQuery = z.infer<typeof importListRowsQuerySchema>;

export const importReportQuerySchema = z.object({ format: z.enum(["csv", "xlsx"]).default("csv"), kind: z.enum(["errors", "full"]).default("errors") });
export const importTemplateFileQuerySchema = z.object({ format: z.enum(["csv", "xlsx"]).default("xlsx") });
export const importChoicesQuerySchema = z.object({ q: z.string().trim().max(100).optional() });

export const importMappingTemplateDtoSchema = z.object({
  id: importsUuidSchema,
  importerKey: importerKeySchema,
  name: z.string(),
  mapping: z.record(z.string().nullable()),
  headers: z.array(z.string()),
  createdBy: importsUuidSchema.nullable(),
  createdAt: importsInstantSchema,
  updatedAt: importsInstantSchema,
});
export type ImportMappingTemplateDto = z.infer<typeof importMappingTemplateDtoSchema>;

export const importCreateTemplateBodySchema = z
  .object({
    importerKey: importerKeySchema,
    name: z.string().trim().min(1).max(120),
    mapping: z.record(z.string().max(300).nullable()),
    headers: z.array(z.string().max(300)).max(200).optional(),
  })
  .strict();
export type ImportCreateTemplateBody = z.infer<typeof importCreateTemplateBodySchema>;

export const importUpdateTemplateBodySchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), mapping: z.record(z.string().max(300).nullable()).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");

export const importListTemplatesQuerySchema = z.object({ importer: importerKeySchema.optional() });

export const importSettingsDtoSchema = z.object({
  maxRows: z.number().int(),
  maxColumns: z.number().int(),
  maxFileBytes: z.number().int(),
  batchSize: z.number().int(),
  allOrNothingMaxRows: z.number().int(),
  maxActiveJobs: z.number().int(),
  maxJobsPerDay: z.number().int(),
  retentionDays: z.number().int(),
  /** Plafonds absolus du produit (non modifiables). */
  hardLimits: z.object({ maxRows: z.number().int(), maxColumns: z.number().int(), maxFileBytes: z.number().int() }),
});
export type ImportSettingsDto = z.infer<typeof importSettingsDtoSchema>;

export const importUpdateSettingsBodySchema = z
  .object({
    maxRows: z.number().int().min(1).max(20_000).optional(),
    maxColumns: z.number().int().min(1).max(200).optional(),
    maxFileBytes: z.number().int().min(1024).max(20_971_520).optional(),
    batchSize: z.number().int().min(1).max(500).optional(),
    allOrNothingMaxRows: z.number().int().min(1).max(20_000).optional(),
    maxActiveJobs: z.number().int().min(1).max(50).optional(),
    maxJobsPerDay: z.number().int().min(1).max(1000).optional(),
    retentionDays: z.number().int().min(1).max(365).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Aucune modification.");
export type ImportUpdateSettingsBody = z.infer<typeof importUpdateSettingsBodySchema>;

// ---------------------------------------------------------------------------
// Événements (payload `{ v: 1, ... }`, aucune donnée personnelle)
// ---------------------------------------------------------------------------

export const IMPORT_EVENTS = {
  jobCreated: "imports.job.created",
  validationRequested: "imports.job.validation_requested",
  jobValidated: "imports.job.validated",
  runRequested: "imports.run.requested",
  runStarted: "imports.run.started",
  runCompleted: "imports.run.completed",
  runFailed: "imports.run.failed",
  runCancelled: "imports.run.cancelled",
} as const;
export type ImportEventType = (typeof IMPORT_EVENTS)[keyof typeof IMPORT_EVENTS];

export const importRunCompletedPayloadSchema = z.object({
  v: z.literal(1),
  jobId: importsUuidSchema,
  importerKey: importerKeySchema,
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  status: z.enum(["COMPLETED", "COMPLETED_WITH_ERRORS"]),
});
export type ImportRunCompletedPayload = z.infer<typeof importRunCompletedPayloadSchema>;
