/**
 * API PUBLIQUE du module `primary_school` — seul point d'import autorisé pour les autres modules (règle dependency-cruiser,
 * `pnpm check:boundaries`).
 *
 *   import { createPrimarySchoolDeps, registerPrimarySchoolPorts, checkHomeroomForActivation } from "../primary_school";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les références vers
 * classes, périodes, inscriptions, élèves, personnel, délibérations, décisions et documents sont des UUID résolus par les PORTS que
 * fournit la plateforme (`ClassroomPort`, `PeriodStatePort`, `TeachingPort`, `ResultsPort`, `RulesPort`, `AttendancePort`,
 * `DocumentsPort`…) : adaptateurs `platform/adapters/*-primary.ts`.
 *
 * Aucune moyenne, aucun seuil, aucune décision de passage ici : tout vient de `results` et `rules`.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as primarySchoolManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { primarySchoolPlugin, registerPrimarySchoolPorts, setup as primarySchoolSetup, type PrimarySchoolPluginOptions, type RateLimiterLike } from "./http/plugin";
export { createPermissionKit as createPrimaryPermissionKit, PERMISSIONS as PRIMARY_PERMISSIONS, type PermissionKit as PrimaryPermissionKit } from "./http/guards";
export { createPrimarySchoolPortRegistry, primarySchoolWorkerPorts, resetPrimarySchoolWorkerPorts, setPrimarySchoolWorkerPorts, type PrimarySchoolPortRegistry } from "./application/port-registry";

// Q-P18 : état « prêt » (lecture famille filtrée par results via un port de plateforme)
export { isPeriodReleasedToFamilies, listPeriodReadiness, markPeriodReady, withdrawPeriodReady, type ReadinessView } from "./application/readiness";

// Dépendances et ports
export { createPrimarySchoolDeps, DEFAULT_PRIMARY_SCHOOL_CONFIG, type PrimarySchoolConfig, type PrimarySchoolDeps, type PrimarySchoolDepsInput } from "./application/deps";
export type {
  AttendancePort,
  AttendanceRegisterRow,
  AttendanceYearSummary,
  AuditEntry as PrimaryAuditEntry,
  AuditPort as PrimaryAuditPort,
  ClassroomInfo as PrimaryClassroomInfo,
  ClassroomPort as PrimaryClassroomPort,
  ClassroomStaffInfo,
  ConfirmedDecision,
  CouncilOpening,
  DeliberationInfo,
  DocumentsPort as PrimaryDocumentsPort,
  EnrollmentInfo as PrimaryEnrollmentInfo,
  GuardianshipPort as PrimaryGuardianshipPort,
  MinutesRequest,
  OutcomePort,
  PeriodInfo as PrimaryPeriodInfo,
  PeriodStatePort,
  PrimarySchoolPorts,
  ProposalInfo,
  ResultsPort as PrimaryResultsPort,
  ReviewDocumentRequest,
  RosterEntryInfo,
  RulesPort as PrimaryRulesPort,
  TeachingPort as PrimaryTeachingPort,
  TemplatePort,
  YearInfo as PrimaryYearInfo,
  YearResultInfo,
} from "./application/ports";
export { noopAudit as primaryNoopAudit, RecordingAudit as PrimaryRecordingAudit } from "./application/ports";
export { primarySchoolAuditAdapter } from "./infrastructure/audit-adapter";
export { InMemoryWorld as PrimaryInMemoryWorld, unavailablePorts as unavailablePrimaryPorts } from "./infrastructure/in-memory-ports";
export { bundledTemplatePort } from "./templates";

// Domaine (types et règles pures, réutilisables par les adaptateurs et les tests)
export { PrimarySchoolPackTemplateSchema, type PrimarySchoolPackTemplate } from "./domain/template";
export { summarizeCompetencies, filterPhrases, decideBulkLine, completenessOf, validateLevels } from "./domain/competency";
export { canonicalJson as primaryCanonicalJson, reviewHash, sealBlockers, buildManifest, manifestHash, snapshotOf } from "./domain/review";
export { buildMinutes, countAttendance, decisionNeedsJustification, signatureProblems, JUSTIFICATION_MIN_LENGTH } from "./domain/council";
export { ALL_PRIMARY_EVENT_TYPES, ConsumedEvents as PrimaryConsumedEvents, PrimaryEvents } from "./domain/events";
export { PrimaryCode, type PrimaryCodeValue } from "./domain/errors";
export type { AnnualReview, CallerCaps as PrimaryCallerCaps, CompetencyAssessment, Framework, Phrase, RatingScale, Settings as PrimarySettings, YearArchive } from "./domain/types";

// Cas d'usage
export { getSettings as getPrimarySettings, updateSettings as updatePrimarySettings } from "./application/settings";
export { createFramework, createScale, getFrameworkDetail, listFrameworks, listScales, newFrameworkVersion, publishFramework, putLevels, putStructure, updateScale } from "./application/frameworks";
export { bulkRecordCompetencies, getCompetencyCounters, getReportcardCompetencies, type ReportcardCompetencies, getCompetencySheet, getCompetencySummary, getFamilyCompetencySummary, listMyClassrooms, reviseCompetencyAssessment, validateCompetencies } from "./application/competencies";
export { createPhrase, listPhrases, updatePhrase } from "./application/phrases";
export { decideCouncilCase, getCouncil, listCouncils, outcomeCodeOfDecision, prepareCouncil, putCouncilAttendance, requestCouncilMinutes, updateCouncilCase } from "./application/council";
export { getAnnualReview, listAnnualReviews, listFamilyAnnualReviews, prepareAnnualReviews, purgeStaleDraftReviews, reissueAnnualReview, requestReviewDocument, sealAnnualReview } from "./application/reviews";
export { freezeYearArchive, getYearArchive, listYearArchives, prepareYearArchive } from "./application/archives";
export { buildReport, getProgress, getRuleBanner, reportToCsv } from "./application/reports";
export { instantiatePrimaryReferenceData, type TemplateResult } from "./application/template";
export { checkHomeroomForActivation, type ActivationCheck } from "./application/activation";
export { isBenignConsumerError, onAnnualReviewSealed, onClassroomPeriodEvent, onInstitutionCreated, onOfficialDocumentRendered, onResultsDecisionConfirmed } from "./application/consumers";
