/**
 * Enregistrements du module (lignes de base de données, en camelCase) — types purs.
 */
import type {
  ImportFileKind,
  ImportIssue,
  ImportJobStatus,
  ImporterKey,
  ImportOnExisting,
  ImportOutcome,
  ImportPlannedAction,
  ImportRowValidation,
  ImportRunMode,
  ImportWarning,
} from "@ecoledigitale/contracts/src/v2/imports";

export interface JobRecord {
  id: string;
  tenantId: string;
  importerKey: ImporterKey;
  status: ImportJobStatus;
  fileName: string;
  fileKind: ImportFileKind;
  fileSize: number;
  fileSha256: string;
  storageKey: string | null;
  sheetName: string | null;
  headers: string[];
  warnings: ImportWarning[];
  totalRows: number;
  duplicateOfJobId: string | null;
  mapping: Record<string, string | null> | null;
  mappingTemplateId: string | null;
  options: Record<string, string | number | boolean>;
  runMode: ImportRunMode;
  onExisting: ImportOnExisting;
  validRows: number;
  invalidRows: number;
  plannedCreate: number;
  plannedUpdate: number;
  plannedSkip: number;
  validationProgress: number;
  validatedAt: Date | null;
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  runAttempts: number;
  runRequestedAt: Date | null;
  runRequestedBy: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  cancelRequested: boolean;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  heartbeatAt: Date | null;
  actorUserId: string | null;
  actorRoles: string[];
  actorMfa: boolean;
  actorInstitutionId: string | null;
  actorCampusId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rawPurgedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RowRecord {
  jobId: string;
  rowNo: number;
  raw: string[] | null;
  normalized: Record<string, unknown> | null;
  naturalKey: string | null;
  validation: ImportRowValidation;
  plannedAction: ImportPlannedAction | null;
  plannedEntityId: string | null;
  issues: ImportIssue[];
  outcome: ImportOutcome | null;
  entityId: string | null;
  outcomeIssues: ImportIssue[] | null;
  processedAt: Date | null;
}

export interface TemplateRecord {
  id: string;
  tenantId: string;
  importerKey: ImporterKey;
  name: string;
  mapping: Record<string, string | null>;
  headers: string[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettingsRecord {
  maxRows: number;
  maxColumns: number;
  maxFileBytes: number;
  batchSize: number;
  allOrNothingMaxRows: number;
  maxActiveJobs: number;
  maxJobsPerDay: number;
  retentionDays: number;
}

export const DEFAULT_SETTINGS: SettingsRecord = Object.freeze({
  maxRows: 5000,
  maxColumns: 100,
  maxFileBytes: 5 * 1024 * 1024,
  batchSize: 200,
  allOrNothingMaxRows: 5000,
  maxActiveJobs: 5,
  maxJobsPerDay: 50,
  retentionDays: 30,
});

export interface RowStats {
  total: number;
  valid: number;
  invalid: number;
  pending: number;
  plannedCreate: number;
  plannedUpdate: number;
  plannedSkip: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  processed: number;
  withWarnings: number;
}

export const ACTIVE_STATUSES: readonly ImportJobStatus[] = ["UPLOADED", "MAPPED", "VALIDATING", "VALIDATED", "QUEUED", "RUNNING"];
