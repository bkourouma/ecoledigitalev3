/**
 * API PUBLIQUE du module `documents` — seul point d'import autorisé pour les autres modules (règle dependency-cruiser,
 * `pnpm check:boundaries`).
 *
 *   import { createDocumentsDeps, registerDocumentsPorts, type DocumentsPorts } from "../documents";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les références
 * vers élèves, personnel et comptes sont des UUID résolus par les PORTS que fournit la plateforme (`OwnerDirectory`,
 * `StoragePort`, `MalwareScanner`, `DocumentConverter`, `UsageReporter`) : adaptateurs `platform/adapters/*-documents.ts`.
 *
 * Consommateurs : le chantier notifications consomme `documents.document.expiring` / `documents.document.expired` ; l'API
 * expose aux autres modules la lecture d'un document par son identifiant (`getDocument`) sous les mêmes règles d'accès.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as documentsManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { documentsPlugin, registerDocumentsPorts, setup as documentsSetup, type DocumentsPluginOptions } from "./http/plugin";
export { createPermissionKit, PERMISSIONS as DOCUMENTS_PERMISSIONS, type PermissionKit } from "./http/guards";
export { createDocumentsPortRegistry, documentsWorkerPorts, resetDocumentsWorkerPorts, setDocumentsWorkerPorts, type DocumentsPortRegistry } from "./application/port-registry";

// Dépendances et ports
export { createDocumentsDeps, DEFAULT_DOCUMENTS_CONFIG, type DocumentsConfig, type DocumentsDeps, type DocumentsDepsInput } from "./application/deps";
export type {
  AuditEntry,
  AuditPort,
  DocumentConverter,
  DocumentsPorts,
  MalwareScanner,
  OwnerDirectory,
  PersonRef,
  PlanQuotaResolver,
  ScanPolicy,
  ScanVerdict,
  StoragePort,
  StoredObject,
  UsageReporter,
} from "./application/ports";
export { noopAudit, NO_CONVERTER, NO_SCANNER, NO_USAGE_REPORTER, RecordingAudit } from "./application/ports";
export { documentsAuditAdapter } from "./infrastructure/audit-adapter";
export { EICAR, eicarBytes, FakeScanner, InMemoryOwners, InMemoryStorage, inMemoryPorts, unavailablePorts, type InMemoryWorld } from "./infrastructure/in-memory-ports";

// Antivirus et conversion : adaptateurs configurables par l'environnement
export { ClamavScanner, clamavScannerFromEnv, scanPolicyFromEnv, type ClamavOptions } from "./infrastructure/clamav-scanner";
export { OfficeConverter, officeConverterFromEnv, type OfficeConverterOptions } from "./infrastructure/office-converter";

// Domaine (types et règles pures, réutilisables par les adaptateurs et les tests)
export type { Actor, ActorCaps, ActorLinks, DocumentFacts, CategoryFacts } from "./domain/types";
export { NO_LINKS } from "./domain/types";
export { resolveAccess, resolveCreate, tierAllows, type Access, type AccessVia } from "./domain/policy";
export { checkFile, detectFileType, previewKindOf, sanitizeFileName, type FileCheck } from "./domain/file-policy";
export { dueAlert, effectiveAlertDays, expiryStatus } from "./domain/expiry";
export { ALL_DOCUMENTS_EVENT_TYPES, DocumentsEvents } from "./domain/events";
export { DocumentsCode, HTTP_STATUS_BY_DOCUMENTS_CODE } from "./domain/errors";
export { DEFAULT_CATEGORIES } from "./domain/default-categories";
export { GIB, PLAN_QUOTA_DEFAULT_BYTES, QUOTA_FEATURE_KEYS, planQuotaBytes, quotaTierFor, type QuotaTier } from "./domain/quota";

// Cas d'usage
export { createDocument, addVersion, type UploadedFile } from "./application/uploads";
export {
  archiveDocument,
  expirationCounts,
  getDocument,
  getDownloadUrl,
  getHistory,
  getPreview,
  listDocuments,
  listGuardianUsers,
  restoreDocument,
  searchPeople,
  updateDocument,
  type PreviewResult,
} from "./application/documents";
export { listShares, shareDocument, unshareDocument } from "./application/shares";
export { deleteQuarantine, listQuarantine, releaseQuarantine } from "./application/quarantine";
export {
  createCategory,
  getMyContext,
  getSettings,
  getUsage,
  grantCategory,
  listCategories,
  listCategoryGrants,
  revokeCategoryGrant,
  setCategoryArchived,
  updateCategory,
  updateSettings,
} from "./application/categories";

// Jobs
export { housekeepingAllTenants, runHousekeeping, sweepExpirations, sweepExpirationsAllTenants, type ExpiryReport, type HousekeepingReport } from "./application/housekeeping";
