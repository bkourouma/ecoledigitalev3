/**
 * API PUBLIQUE du module `imports` — seul point d'import autorisé pour les autres modules (ADR-001).
 *
 *   import { createImportsDeps, registerImportsPorts, setImportsWorkerPorts, type ImportTargetPort } from "../imports";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les
 * adaptateurs de `platform/adapters` implémentent `ImportTargetPort` par l'API publique des modules cibles.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as importsManifest } from "./manifest";

// Plugin Fastify et registres de ports (adaptateurs de plateforme)
export { importsPlugin, registerImportsPorts, setup as importsSetup, default as importsModulePlugin, type ImportsPluginOptions } from "./http/plugin";
export { createImportsPortRegistry, importsWorkerPorts, resetImportsWorkerPorts, setImportsWorkerPorts, type ImportsPortRegistry } from "./application/port-registry";

// Dépendances et ports
export { createImportsDeps, DEFAULT_IMPORTS_CONFIG, actorContext, snapshotOf, type ActorSnapshot, type ImportsConfig, type ImportsDeps, type ImportsDepsInput } from "./application/deps";
export {
  noopAudit as importsNoopAudit,
  RecordingAudit as ImportsRecordingAudit,
  type ApplyItem,
  type ApplyRef,
  type ApplyResult,
  type AuditEntry as ImportsAuditEntry,
  type AuditPort as ImportsAuditPort,
  type ImportActorNamePort,
  type ImportPorts,
  type ImportStoragePort,
  type ImportTargetPort,
  type PlanItem,
  type PlanResult,
  type PlanRun,
} from "./application/ports";
export { importsAuditAdapter } from "./infrastructure/audit-adapter";

// Cas d'usage
export { uploadImportFile, type UploadInput } from "./application/upload";
export { cancelImportJob, deleteImportJob, getImportJob, listImportJobs, listOptionChoices, setImportMapping, type Viewer as ImportsViewer } from "./application/jobs";
export { getImportPreview, processValidation, requestImportValidation } from "./application/validate";
export { getImportReport, processRun, requestImportRun } from "./application/run";
export { buildImportReportFile, buildTemplateFile, listImportRows } from "./application/report";
export { createMappingTemplate, listMappingTemplates, removeMappingTemplate, updateMappingTemplate } from "./application/templates";
export { getImportSettings, updateImportSettings } from "./application/settings";
export { handleRunRequested, handleValidationRequested, purgeExpiredImports, resumeStalledImports } from "./application/consumers";

// Importeurs (description : colonnes, schéma, clé naturelle) et domaine pur
export { IMPORTERS, IMPORTER_LIST, findImporter, getImporter } from "./importers/registry";
export type { ColumnDef, ImporterDef, ImportIssue, ImportOptions, RowValues } from "./domain/types";
export type { StudentRow } from "./importers/students";
export type { GuardianRow } from "./importers/guardians";
export { guardianIdentityKey } from "./importers/guardians";
export type { StaffRow } from "./importers/staff";
export type { ClassroomRow } from "./importers/classrooms";
export type { CurriculumRow } from "./importers/curriculum";
export type { GradeRow, GradeEntry } from "./importers/grades";
export type { EnrollmentRow } from "./importers/enrollments";
export type { BalanceRow } from "./importers/opening-balances";
export { ALL_IMPORT_EVENT_TYPES, ImportEvents } from "./domain/events";
export { detectMapping, matchTemplate, validateMapping } from "./domain/mapping";
export { neutralizeCell } from "./domain/text";
