/**
 * API PUBLIQUE du module `examinations` — seul point d'import autorisé pour les autres modules (règle dependency-cruiser,
 * `pnpm check:boundaries`).
 *
 *   import { createExaminationsDeps, registerExaminationsPorts, type ExaminationsPorts } from "../examinations";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les références vers
 * élèves, inscriptions, classes, évaluations, versions de règle et documents sont des UUID résolus par les PORTS que fournit la
 * plateforme (adaptateurs `platform/adapters/examinations-*.ts`).
 *
 * Consommateurs prévus : 006 / 007 (admission en 6e) consomment `examinations.result.published` (issue seule, sans note) ;
 * `notifications` consomme les événements de session et de document ; 025 (statistiques de direction) lit les compteurs.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as examinationsManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { examinationsPlugin, registerExaminationsPorts, setup as examinationsSetup, type ExaminationsPluginOptions } from "./http/plugin";
export { createPermissionKit, PERMISSIONS as EXAMINATIONS_PERMISSIONS, type PermissionKit } from "./http/guards";
export { createExaminationsPortRegistry, examinationsWorkerPorts, resetExaminationsWorkerPorts, setExaminationsWorkerPorts, type ExaminationsPortRegistry } from "./application/port-registry";

// Dépendances et ports
export { createExaminationsDeps, type ExaminationsDeps, type ExaminationsDepsInput } from "./application/deps";
export {
  DEFAULT_EXAMINATIONS_CONFIG,
  noopAudit,
  RecordingAudit,
  type AssessPort,
  type AssessmentFacts,
  type AuditEntry,
  type AuditPort,
  type ClassroomRoster,
  type EligibilityFacts,
  type EligibilityFactsInput,
  type EligibilityFactsPort,
  type EnrollmentFacts,
  type ExamFeeCatalogEntry,
  type ExamFeePayer,
  type ExamFeesPort,
  type ExamInvoiceLine,
  type ExamInvoiceState,
  type ExamInvoiceStatus,
  type ExamIssueOutcome,
  type ExamOfficialKind,
  type ExaminationsConfig,
  type ExaminationsPorts,
  type FamilyLinks,
  type InstitutionDirectory,
  type OfficialDocumentPort,
  type OfficialDocumentRequest,
  type OfficialDocumentState,
  type PieceDocumentPort,
  type PublishedGradeFact,
  type RosterEntry,
  type RuleCall,
  type RuleCallResult,
  type RulePin,
  type RuleSession,
  type RulesPort,
  type StoragePort,
  type StoredObject,
  type StudentDirectory,
  type StudentIdentity,
} from "./application/ports";
export { examinationsAuditAdapter } from "./infrastructure/audit-adapter";
export { InMemoryStorage, InMemoryWorld, deterministicUuid, inMemoryPorts, unavailablePorts } from "./infrastructure/in-memory-ports";

// Domaine (types et règles pures, réutilisables par les adaptateurs et les tests)
export { ALL_EXAMINATIONS_EVENT_TYPES, ConsumedEvents as ExaminationsConsumedEvents, ExaminationsEvents } from "./domain/events";
export { ExamCode, HTTP_STATUS_BY_EXAM_CODE, fromDbError, portUnavailable } from "./domain/errors";
export { formatCandidateNumber, validateNumberPattern } from "./domain/number-pattern";
export { EXPORT_SOURCES, EXPORT_TRANSFORMS, validateExportColumns, validateImportColumns } from "./domain/export-spec";
export { MOCK_ASSESSMENT_TYPE_CODE } from "./domain/mock";
export { PACK_TEMPLATES, PRIMARY_PACK } from "./domain/pack-template";
export { feeIdempotencyKey, FEE_STATUSES, type FeeStatus } from "./domain/fees";

// Cas d'usage (lectures utiles aux autres modules et aux tests d'assemblage)
export { instantiatePack } from "./application/reference";
export { onEnrollmentWithdrawn } from "./application/consumers";
export { listChildExams, listMyExams } from "./application/family";
