/**
 * API PUBLIQUE du module `admissions` — seul point d'import autorisé pour les autres modules (règle dependency-cruiser,
 * `pnpm check:boundaries`).
 *
 *   import { createAdmissionsDeps, registerAdmissionsPorts, type AdmissionsPorts } from "../admissions";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4). Établissement, niveau,
 * classe, élève, inscription, facture, pièces et notifications sont des références résolues par les PORTS que fournit la
 * plateforme (`StudentRegistry`, `EnrollmentService`, `RegistrationFeeService`, `InstitutionCatalog`, `DocumentStore`,
 * `ApplicantNotifier`, `Captcha`, `ActorDirectory`) : adaptateurs `platform/adapters/admissions-*.ts`.
 *
 * Consommateurs : `messaging` (annonces au personnel sur `admissions.application.submitted` / `.offer.expired`), `analytics`
 * (entonnoir direction), `academic` (arrivée en classe). Événements publiés SANS donnée personnelle.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as admissionsManifest } from "./manifest";

// Plugin Fastify et enregistrement des ports
export { admissionsPlugin, registerAdmissionsPorts, registerPublicRoutes as registerAdmissionsPublicRoutes, setup as admissionsSetup, PUBLIC_RATE as ADMISSIONS_PUBLIC_RATE, type AdmissionsPluginOptions, type PublicRoutesOptions } from "./http/plugin";
export { createAdmissionsPortRegistry, admissionsWorkerPorts, resetAdmissionsWorkerPorts, setAdmissionsWorkerPorts, type AdmissionsPortRegistry } from "./application/port-registry";

// Dépendances et ports
export { createAdmissionsDeps, DEFAULT_ADMISSIONS_CONFIG, SYSTEM_ACTOR_ID, SYSTEM_ACTOR_NAME, type AdmissionsConfig, type AdmissionsDeps, type AdmissionsDepsInput } from "./application/deps";
export type {
  ActorDirectory,
  AdmissionsPorts,
  ApplicantMessage,
  ApplicantNotifier,
  AuditEntry,
  AuditPort,
  Captcha,
  ClassroomInfo,
  DeliveryReceipt,
  DocumentStore,
  EnrollmentService,
  InstitutionCatalog,
  InstitutionInfo,
  NewEnrollment,
  NewGuardian,
  NewStudent,
  NotificationChannel,
  RegistrationFeeService,
  StoredPiece,
  StudentDuplicate,
  StudentRegistry,
} from "./application/ports";
export { noopAudit, RecordingAudit } from "./application/ports";
export { admissionsAuditAdapter } from "./infrastructure/audit-adapter";
export { InMemoryWorld, UNAVAILABLE_NOTIFIER, unavailablePorts, type FailPoint, type WorldStudent } from "./infrastructure/in-memory-ports";

// Domaine (types et règles pures, réutilisables par les adaptateurs et les tests)
export { AdmissionsEvents, ALL_ADMISSIONS_EVENT_TYPES, ConsumedEvents } from "./domain/events";
export { AdmissionsCode, HTTP_STATUS_BY_ADMISSIONS_CODE, portUnavailable } from "./domain/errors";
export { identityKey, normalizeName } from "./domain/identity";
export { orderWaitlist } from "./domain/waitlist";
export { validateWorkflow, decisionKindFor, type WorkflowDefect } from "./domain/workflow";
export { DEFAULT_STAGES, DEFAULT_TRANSITIONS, DEFAULT_DECISION_REASONS } from "./domain/default-workflow";
export { newOpaqueToken, newPublicSlug, newTrackingCode, sha256Hex, tokenHash, trackingCodeHash } from "./domain/tokens";

// Cas d'usage
export { acceptOffer, declineOffer, expireOffer, issueOffer, withdrawOffer, setOfferClassroom, recordAcceptFailure } from "./application/offers";
export { recordDecision, promoteHead, promoteOnFreedSeat } from "./application/decisions";
export { createApplication, createApplicationInTx, getApplication, getBoard, getHistory, listApplications, recordConsent, submitInTx, transitionApplication, updateApplication, withdrawConsent } from "./application/applications";
export { getWaitlist, promoteManually } from "./application/waitlist";
export { createWorkflow, getWorkflowDetail, listWorkflows, newWorkflowVersion, publishWorkflow, replaceStages, replaceTransitions } from "./application/workflows";
export { closeCampaign, createCampaign, getCampaign, listCampaigns, openCampaign, updateCampaign, upsertCapacities } from "./application/campaigns";
export { ensureInstitutionDefaults } from "./application/defaults";
export { handleEnrollmentConfirmed, handleEnrollmentEnded } from "./application/enrollment-events";
export { getPublicForm, respondOfferPublic, submitPublicApplication, trackApplication, uploadTrackedDocument, viewOfferPublic } from "./application/public-form";
export { anonymizeApplication, anonymizeExpired, exportApplication } from "./application/anonymize";
export { reviewDocument, uploadDocument } from "./application/documents";
export { attachDocumentsToStudentFile } from "./application/student-file";
export type { DocumentCaps } from "./application/ports";
export { detectDuplicates } from "./application/duplicates";
export { enforcePaymentDeadline, expireOffers, purgePublicFormData } from "./application/jobs";
export { createProspect, convertProspect } from "./application/prospects";
export { getSettings, managePublicLink, publishConsentText, updateSettings, upsertDecisionReason, upsertPriorityClass, upsertRequirement } from "./application/reference";
