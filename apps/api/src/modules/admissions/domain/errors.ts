/**
 * Erreurs métier du module admissions : types du kernel + codes stables `admissions.*` (contrat d'API, voir
 * `ADMISSIONS_ERROR_CODES` des contrats ; ne jamais en renommer un). Les déclencheurs SQL commencent leur message par le code
 * stable (`admissions.capacity_full: …`) : `mapDbError` (infrastructure) les traduit. La couche HTTP convertit certains codes en
 * statuts précis (404, 410, 429, 503) : voir `HTTP_STATUS_BY_ADMISSIONS_CODE`.
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const AdmissionsCode = {
  INVALID_INPUT: "admissions.invalid_input",
  FORBIDDEN: "admissions.forbidden",
  PORT_UNAVAILABLE: "admissions.port_unavailable",
  NOT_FOUND: "admissions.not_found",
  INSTITUTION_REQUIRED: "admissions.institution_required",
  INSTITUTION_UNKNOWN: "admissions.institution_unknown",
  WORKFLOW_NOT_FOUND: "admissions.workflow_not_found",
  WORKFLOW_NOT_DRAFT: "admissions.workflow_not_draft",
  WORKFLOW_CONFLICT: "admissions.workflow_conflict",
  CAMPAIGN_NOT_FOUND: "admissions.campaign_not_found",
  CAMPAIGN_CLOSED: "admissions.campaign_closed",
  APPLICATION_NOT_FOUND: "admissions.application_not_found",
  PROSPECT_NOT_FOUND: "admissions.prospect_not_found",
  STAGE_NOT_FOUND: "admissions.stage_not_found",
  TRANSITION_NOT_ALLOWED: "admissions.transition_not_allowed",
  DECISION_MISSING: "admissions.decision_missing",
  DECISION_KIND_MISMATCH: "admissions.decision_kind_mismatch",
  REASON_REQUIRED: "admissions.reason_required",
  REASON_UNKNOWN: "admissions.reason_unknown",
  PERMISSION_DENIED: "admissions.permission_denied",
  VERSION_CONFLICT: "admissions.version_conflict",
  DUPLICATE_APPLICATION: "admissions.duplicate_application",
  DUPLICATES_PENDING: "admissions.duplicates_pending",
  DUPLICATE_NOT_FOUND: "admissions.duplicate_not_found",
  CAPACITY_FULL: "admissions.capacity_full",
  CAPACITY_OVERRIDE_REASON: "admissions.capacity_override_reason",
  WAITLIST_FULL: "admissions.waitlist_full",
  WAITLIST_DISABLED: "admissions.waitlist_disabled",
  CONSENT_MISSING: "admissions.consent_missing",
  CONSENT_TEXT_MISSING: "admissions.consent_text_missing",
  DOCUMENTS_INCOMPLETE: "admissions.documents_incomplete",
  REQUIREMENT_NOT_FOUND: "admissions.requirement_not_found",
  DOCUMENT_NOT_FOUND: "admissions.document_not_found",
  FILE_REJECTED: "admissions.file_rejected",
  INTERVIEW_NOT_FOUND: "admissions.interview_not_found",
  OFFER_NOT_FOUND: "admissions.offer_not_found",
  OFFER_EXPIRED: "admissions.offer_expired",
  OFFER_NOT_PENDING: "admissions.offer_not_pending",
  OFFER_EXISTS: "admissions.offer_exists",
  OFFER_INVALID_TOKEN: "admissions.offer_invalid_token",
  CLASSROOM_REQUIRED: "admissions.classroom_required",
  CLASSROOM_INVALID: "admissions.classroom_invalid",
  APPLICANT_GENDER_REQUIRED: "admissions.applicant_gender_required",
  GUARDIAN_NOT_ENTITLED: "admissions.guardian_not_entitled",
  APPLICATION_ANONYMIZED: "admissions.application_anonymized",
  ANONYMIZE_FORBIDDEN: "admissions.anonymize_forbidden",
  PUBLIC_FORM_CLOSED: "admissions.public_form_closed",
  RATE_LIMITED: "admissions.rate_limited",
  REFERENCE_CODE_TAKEN: "admissions.reference_code_taken",
  WORKFLOW_PUBLISH_FAILED: "admissions.workflow_publish_failed",
} as const;

export type AdmissionsCodeValue = (typeof AdmissionsCode)[keyof typeof AdmissionsCode];

/** Un code de l'espace `admissions.*` (y compris ceux levés par les déclencheurs SQL). */
type AnyCode = AdmissionsCodeValue | (string & {});

export const validation = (code: AnyCode, message: string, path: string | ReadonlyArray<string | number> = "input", details?: Record<string, unknown>): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: AnyCode, message: string, details?: Record<string, unknown>): ConflictError => new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: AnyCode, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: AnyCode, message: string, details?: Record<string, unknown>): ForbiddenError => new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/**
 * Port non branché : le module échoue FERMÉ (aucune acceptation d'offre sans `people`, `academic`, `finance`).
 * `expected` : l'interface attendue du module voisin, pour la reprise (voir le README du module).
 */
export const portUnavailable = (port: string, expected?: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: AdmissionsCode.PORT_UNAVAILABLE,
    details: { port, ...(expected ? { expected } : {}) },
  });

/** Statut HTTP précis par code (les catégories du kernel n'ont que 400/403/404/409/500). */
export const HTTP_STATUS_BY_ADMISSIONS_CODE: Readonly<Record<string, number>> = Object.freeze({
  [AdmissionsCode.PORT_UNAVAILABLE]: 503,
  [AdmissionsCode.RATE_LIMITED]: 429,
  [AdmissionsCode.OFFER_EXPIRED]: 410,
});

/** Codes levés par les déclencheurs SQL qui traduisent un ÉTAT du dossier (409) plutôt qu'une erreur de saisie (400). */
export const CONFLICT_SQL_CODES: ReadonlySet<string> = new Set([
  "admissions.capacity_full",
  "admissions.waitlist_full",
  "admissions.transition_not_allowed",
  "admissions.decision_missing",
  "admissions.decision_stale",
  "admissions.documents_incomplete",
  "admissions.consent_missing",
  "admissions.interview_missing",
  "admissions.offer_not_accepted",
  "admissions.enrollment_missing",
  "admissions.duplicates_pending",
  "admissions.campaign_closed",
  "admissions.campaign_workflow_not_published",
  "admissions.campaign_workflow_frozen",
  "admissions.campaign_transition",
  "admissions.application_frozen_after_enrollment",
  "admissions.application_anonymized",
  "admissions.application_enrolled_final",
  "admissions.application_identity_immutable",
  "admissions.anonymize_forbidden",
  "admissions.workflow_published_immutable",
  "admissions.workflow_transition",
  "admissions.workflow_delete_forbidden",
  "admissions.append_only",
  "admissions.consent_already_withdrawn",
  "admissions.consent_immutable",
  "admissions.consent_text_immutable",
  "admissions.consent_text_retired",
  "admissions.form_session_consumed",
]);
