/**
 * Projections des enregistrements vers les DTO publics (contrats). Aucune donnée interne (clé de stockage, bail,
 * instantané de l'acteur) ne sort.
 */
import type { ImportJobDto, ImportMappingTemplateDto, ImportRowDto, ImportSettingsDto } from "@ecoledigitale/contracts/src/v2/imports";
import type { JobRecord, RowRecord, SettingsRecord, TemplateRecord } from "../domain/records";
import type { ImportsConfig } from "./deps";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toJobDto(job: JobRecord, extra: { sheetNames?: readonly string[] } = {}): ImportJobDto {
  return {
    id: job.id,
    importerKey: job.importerKey,
    status: job.status,
    fileName: job.fileName,
    fileKind: job.fileKind,
    fileSize: job.fileSize,
    fileSha256: job.fileSha256,
    sheetName: job.sheetName,
    ...(extra.sheetNames ? { sheetNames: [...extra.sheetNames] } : {}),
    headers: job.headers,
    warnings: job.warnings,
    totalRows: job.totalRows,
    duplicateOfJobId: job.duplicateOfJobId,
    mapping: job.mapping,
    mappingTemplateId: job.mappingTemplateId,
    options: job.options,
    runMode: job.runMode,
    onExisting: job.onExisting,
    validRows: job.validRows,
    invalidRows: job.invalidRows,
    plannedCreate: job.plannedCreate,
    plannedUpdate: job.plannedUpdate,
    plannedSkip: job.plannedSkip,
    validationProgress: job.validationProgress,
    validatedAt: iso(job.validatedAt),
    processedCount: job.processedCount,
    createdCount: job.createdCount,
    updatedCount: job.updatedCount,
    skippedCount: job.skippedCount,
    failedCount: job.failedCount,
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    durationMs: job.durationMs,
    cancelRequested: job.cancelRequested,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    rawPurged: job.rawPurgedAt !== null,
    createdBy: job.createdBy,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function toRowDto(row: RowRecord): ImportRowDto {
  return {
    rowNo: row.rowNo,
    raw: row.raw,
    values: row.normalized,
    naturalKey: row.naturalKey,
    validation: row.validation,
    plannedAction: row.plannedAction,
    issues: row.issues,
    outcome: row.outcome,
    entityId: row.entityId,
    outcomeIssues: row.outcomeIssues ?? [],
  };
}

export function toTemplateDto(t: TemplateRecord): ImportMappingTemplateDto {
  return { id: t.id, importerKey: t.importerKey, name: t.name, mapping: t.mapping, headers: t.headers, createdBy: t.createdBy, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}

export function toSettingsDto(s: SettingsRecord, config: ImportsConfig): ImportSettingsDto {
  return { ...s, hardLimits: { maxRows: config.hardMaxRows, maxColumns: config.hardMaxColumns, maxFileBytes: config.hardMaxFileBytes } };
}
