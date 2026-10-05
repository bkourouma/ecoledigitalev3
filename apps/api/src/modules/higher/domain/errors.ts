/**
 * Erreurs métier du module higher : types du kernel + codes stables `higher.*`
 * (ils font partie du contrat d'API ; ne jamais en renommer un).
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const HigherCode = {
  INVALID_INPUT: "higher.invalid_input",
  FORBIDDEN: "higher.forbidden",
  PORT_UNAVAILABLE: "higher.port_unavailable",
  RULES_UNAVAILABLE: "higher.rules_unavailable",
  // Prérequis
  PREREQUISITE_SELF: "higher.prerequisite_self",
  PREREQUISITE_CROSS_PROGRAM: "higher.prerequisite_cross_program",
  PREREQUISITE_CYCLE: "higher.prerequisite_cycle",
  PREREQUISITE_UNKNOWN_UE: "higher.prerequisite_unknown_ue",
  // Registre de crédits
  CREDIT_IN_USE: "higher.credit_in_use",
  LEDGER_NOT_FOUND: "higher.ledger_not_found",
  // UE annuelle (O-11)
  ANNUAL_UE_NOT_FOUND: "higher.annual_ue_not_found",
  ANNUAL_UE_EXISTS: "higher.annual_ue_exists",
  ANNUAL_UE_MEMBER_TAKEN: "higher.annual_ue_member_taken",
  ANNUAL_UE_UNKNOWN_UE: "higher.annual_ue_unknown_ue",
  ANNUAL_UE_IN_USE: "higher.annual_ue_in_use",
  // Dispense d'UE (O-14)
  EXEMPTION_NOT_FOUND: "higher.exemption_not_found",
  EXEMPTION_EXISTS: "higher.exemption_exists",
  EXEMPTION_REASON_REQUIRED: "higher.exemption_reason_required",
  EXEMPTION_ALREADY_REVOKED: "higher.exemption_already_revoked",
  EXEMPTION_UNKNOWN_UE: "higher.exemption_unknown_ue",
  EXEMPTION_UE_ACQUIRED: "higher.exemption_ue_already_acquired",
  EXEMPTION_ENROLLMENT_MISMATCH: "higher.exemption_enrollment_mismatch",
  // Rattrapage
  RESIT_WINDOW_NOT_FOUND: "higher.resit_window_not_found",
  RESIT_WINDOW_OPEN_EXISTS: "higher.resit_window_open_exists",
  RESIT_WINDOW_NOT_OPEN: "higher.resit_window_not_open",
  RESIT_WINDOW_DATES: "higher.resit_window_dates",
  RESIT_NO_CANDIDATES: "higher.resit_no_candidates",
  // Diplômes
  DIPLOMA_NOT_FOUND: "higher.diploma_not_found",
  DIPLOMA_DUPLICATE_CODE: "higher.diploma_duplicate_code",
  DIPLOMA_HAS_AWARDS: "higher.diploma_has_awards",
  DIPLOMA_INACTIVE: "higher.diploma_inactive",
  NOT_A_CYCLE_NODE: "higher.not_a_cycle_node",
  CURRICULUM_NODE_NOT_FOUND: "higher.curriculum_node_not_found",
  REQUIREMENT_CROSS_CYCLE: "higher.requirement_cross_cycle",
  REQUIREMENT_DUPLICATE: "higher.requirement_duplicate",
  UV_REQUIRED_UNKNOWN: "higher.uv_required_unknown",
  // Octrois
  AWARD_NOT_FOUND: "higher.award_not_found",
  ALREADY_AWARDED: "higher.diploma_already_awarded",
  NOT_ELIGIBLE: "higher.diploma_not_eligible",
  FORCE_REASON_REQUIRED: "higher.force_reason_required",
  REVOKE_REASON_REQUIRED: "higher.revoke_reason_required",
  ALREADY_REVOKED: "higher.award_already_revoked",
  REAWARD_FORBIDDEN: "higher.reaward_forbidden",
  STUDENT_NOT_IN_CYCLE: "higher.student_not_in_cycle",
  // Documents
  DOCUMENT_NOT_FOUND: "higher.document_not_found",
  DOCUMENT_REVOKED: "higher.document_revoked",
  AWARD_REVOKED: "higher.award_revoked",
  SIGNATORY_MISSING: "higher.signatory_missing",
  SIGNATORY_UNKNOWN: "higher.signatory_unknown",
  SIGNATORY_INACTIVE: "higher.signatory_inactive",
  SLOT_OVERLAP: "higher.slot_overlap",
  ATTESTATION_NOT_ELIGIBLE: "higher.attestation_not_eligible",
  ATTESTATION_NO_UE: "higher.attestation_no_ue_configured",
  STUDENT_NOT_FOUND: "higher.student_not_found",
  // Accès
  NOT_GUARDIAN: "higher.not_guardian",
  NO_STUDENT_PROFILE: "higher.no_student_profile",
} as const;

export type HigherCodeValue = (typeof HigherCode)[keyof typeof HigherCode];

export const validation = (
  code: HigherCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: HigherCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: HigherCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: HigherCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Port non branché : le module échoue FERMÉ (aucune écriture sans la source de vérité). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: HigherCode.PORT_UNAVAILABLE,
    details: { port },
  });

export const rulesUnavailable = (message: string, details?: Record<string, unknown>): InternalError =>
  new InternalError(message, { code: HigherCode.RULES_UNAVAILABLE, ...(details ? { details } : {}) });
