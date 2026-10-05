/**
 * API PUBLIQUE du module `higher` — seul point d'import autorisé pour les autres modules.
 *
 *   import { checkPrerequisites, getCreditSummary, listDebts, listAcquiredUe, registerHigherPorts } from "../higher";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Les références
 * vers curriculum, inscriptions, étudiants, résultats et signataires sont des UUID résolus par les PORTS que fournissent
 * `academic` (004), `people` (008), `results` (011) et `reportcards` (013) : ils les enregistrent par
 * `registerHigherPorts(app, ports)` dans leur `setup(app, runtime)` (API) ou `registerHigherWorkerPorts(ports)` (worker).
 *
 * Consommateurs : 004 (`checkPrerequisites` à l'inscription, `listDebts`, `listAcquiredUe`), 013/reportcards (relevé cumulé :
 * `listAcquiredUe`, `getCreditSummary` ; rendu : lecture du snapshot d'un document, `recordDocumentSeal`/`recordDocumentRender`),
 * 025 (agrégats via événements `higher.*`).
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as higherManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export {
  higherPlugin,
  createPortRegistry,
  registerHigherPorts,
  setup as higherSetup,
  type HigherPluginOptions,
  type HigherPortRegistry,
} from "./http/plugin";
export { registerHigherWorkerPorts, resetHigherWorkerPorts, workerPorts as higherWorkerPorts } from "./worker-ports";
export { createPermissionKit, PERMISSIONS as HIGHER_PERMISSIONS, type PermissionKit } from "./http/guards";

// Dépendances
export {
  createHigherDeps,
  DEFAULT_HIGHER_CONFIG,
  inTx as higherInTx,
  randomVerificationCode,
  type CallerCaps,
  type HigherConfig,
  type HigherDeps,
  type HigherDepsInput,
} from "./application/deps";

// Ports
export type {
  ActorDirectory,
  AuditEntry,
  AuditPort,
  CreditsSourcePort,
  CurriculumNodeInfo,
  CurriculumPort,
  CycleEnrollment,
  CycleEvaluation,
  CycleResults,
  CycleResultsPort,
  CycleSemesterResult,
  DiplomaRulesPort,
  EligibilityEvaluation,
  EnrollmentDirectory,
  EnrollmentInfo,
  HigherPorts,
  InstitutionPort,
  InstitutionProfile,
  LastEnrollment,
  ListFinalLinesQuery,
  ResitCandidateLine,
  ResitCandidates,
  ResitSessionPort,
  RuleRef,
  RuleScope,
  SignatoryDirectory,
  SignatoryInfo,
  StudentDirectory,
  StudentIdentity,
  UeInfo,
  UeResultLine,
} from "./application/ports";
export { noopAudit, RecordingAudit } from "./application/ports";
export { higherAuditAdapter } from "./infrastructure/audit-adapter";
export { createRulesAdapter, CREDIT_SEMESTER_CONTRACT, RULE_KEYS, type RulesApiLike } from "./infrastructure/rules-adapter";
export {
  InMemoryActors,
  InMemoryCredits,
  InMemoryCurriculum,
  InMemoryCycleResults,
  InMemoryDocumentFiles,
  InMemoryEnrollments,
  InMemoryInstitution,
  InMemoryResitSession,
  InMemorySignatories,
  InMemoryStudents,
  ScriptedRules,
  inMemoryPorts,
  unavailablePorts,
  type InMemoryWorld,
} from "./infrastructure/in-memory-ports";

// Cas d'usage — registre de crédits, prérequis, dettes
export {
  capitalizePeriod,
  expireCredits,
  getCreditSummary,
  getLedgerEntry,
  getLedgerHistory,
  listAcquiredUe,
  listDebts,
  normalizeAcquisition,
  type CapitalizeInput,
  type CapitalizeReport,
  type CreditSummary,
} from "./application/ledger";
export {
  checkPrerequisites,
  getPrerequisites,
  setPrerequisites,
  type CheckPrerequisitesInput,
  type PrerequisiteInput,
  type PrerequisiteWarning,
  type SetPrerequisitesInput,
  type SetPrerequisitesResult,
} from "./application/prerequisites";

// Cas d'usage — UE annuelle (O-11) et dispense d'UE (O-14)
export {
  declareAnnualUe,
  foldCurriculumUes,
  listAnnualUes,
  removeAnnualUe,
  resolveAnnualLines,
  type AnnualResolution,
  type DeclareAnnualUeInput,
} from "./application/annual-ue";
export { commonLine, foldAnnualUes, isComplete as isAnnualUeComplete, type AnnualPart, type AnnualUeDef, type AnnualUeVerdict } from "./domain/annual-ue";
export {
  describeUes,
  getExemptionSettings,
  grantExemption,
  listExemptions,
  revokeExemption,
  setExemptionCreditPolicy,
  type GrantExemptionInput,
  type RevokeExemptionInput,
} from "./application/exemptions";
export { DEFAULT_EXEMPTION_CREDIT_POLICY, EXEMPTION_CREDIT_POLICIES, type ExemptionCreditPolicy, type UeExemption } from "./domain/exemption";
export type { AnnualUeEvaluation, AnnualUeEvaluationInput, AnnualUeRulePart } from "./application/ports";

// Cas d'usage — rattrapage
export {
  closeResitWindow,
  getResitWindow,
  listResitCandidates,
  listResitWindows,
  listStudentResits,
  openResitWindow,
  type OpenResitWindowInput,
  type OpenResitWindowResult,
  type StudentResitView,
} from "./application/resit";

// Cas d'usage — diplômes, octrois
export {
  createDiploma,
  createDiplomaFromCurriculum,
  deleteDiploma,
  getDiploma,
  getStudentDiplomaProgress,
  listDiplomaCandidates,
  listDiplomas,
  replaceRequirements,
  syncDiplomaRequirements,
  updateDiploma,
  type CreateDiplomaInput,
  type CreateFromCurriculumInput,
  type DiplomaCandidate,
  type DiplomaDetail,
  type DiplomaProgressView,
  type SyncReport,
} from "./application/diplomas";
export {
  awardDiploma,
  evaluateStudentDiplomas,
  getAward,
  listAwards,
  listStudentAwards,
  recomputeDiploma,
  revokeAward,
  AUTO_AWARD_ACTOR_NAME,
  type AwardInput,
  type AwardOutcome,
  type RecomputeReport,
  type RevokeAwardInput,
  type SkipReason,
} from "./application/awards";

// Cas d'usage — documents officiels, signataires
export {
  assignSlot,
  getAttestationRoster,
  getDocument,
  issueAwardDocument,
  issueSuccessAttestation,
  listDocuments,
  listSlots,
  listStudentDocuments,
  publishDocument,
  recordDocumentRender,
  recordDocumentSeal,
  revokeDocument,
  type AssignSlotInput,
  type AttestationRosterRow,
  type IssueAwardDocumentInput,
  type IssuedDocument,
} from "./application/documents";

// PDF des documents officiels : scellement, rendu (worker), téléchargement contrôlé, vérification publique
export {
  describeDocumentForVerification,
  getDocumentDownload,
  parseDocumentEvent,
  pdfFileName,
  renderOfficialDocument,
  requestDocumentRender,
  type DocumentDownload,
  type DocumentVerificationFacts,
} from "./application/files";
export { buildDocumentContext, DOCUMENT_TEMPLATE_KEYS, MENTION_LABELS, TEMPLATE_SLOT_OF, type DocumentRenderContext } from "./domain/document-context";
export type { DocumentFilesPort, RenderedDocumentFile, SealedDocumentInfo } from "./application/ports";

// Vues étudiant / tuteur, réglages
export { getStudentDiplomaView, getStudentPathway, type StudentDiplomaView, type StudentPathway } from "./application/student-view";
export { getHigherSettings, updateHigherSettings } from "./application/settings";

// Consommateurs et jobs (utilisables par les tests d'assemblage)
export { expireAllTenants, onCreditsCapitalized, onResultsPeriodClosed, parsePeriodClosed } from "./application/consumers";

// Domaine : événements, codes d'erreur, types, fonctions pures
export { ALL_HIGHER_EVENT_TYPES, ConsumedEvents as HigherConsumedEvents, HigherEvents, type HigherEventType } from "./domain/events";
export { HigherCode, type HigherCodeValue } from "./domain/errors";
export { isCurrentlyValid, sumCredits, validUntilFor } from "./domain/credits";
export { buildGraph, evaluatePrerequisites, findPath, wouldCreateCycle } from "./domain/prerequisites";
export { computeProgress, resolveRequirementStates, toEligibilityContext, MENTION_PENDING } from "./domain/diploma";
export { formatAttestationReference, formatAuthenticityReference, formatDiplomaReference } from "./domain/numbering";
export { canonicalJson, snapshotHash } from "./domain/snapshot";
export { REQUIRED_SLOTS, slotInForce } from "./domain/signatures";
export type {
  DiplomaAward,
  DiplomaDefinition,
  DiplomaRequirement,
  DocumentSlot,
  HigherSettings,
  LedgerEntry,
  OfficialDocument,
  Prerequisite,
  PrerequisiteCheck,
  ResitRegistration,
  ResitWindow,
  UeDebt,
} from "./domain/types";
