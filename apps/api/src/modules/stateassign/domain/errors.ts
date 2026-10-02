/**
 * Erreurs métier du module stateassign : types du kernel + codes stables `stateassign.*`
 * (ils font partie du contrat d'API : voir `STATEASSIGN_ERROR_CODES` des contrats ; ne jamais en renommer un).
 * La couche HTTP convertit certains codes en statuts précis (503 port absent ou passerelle non configurée).
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";
import type { StateassignErrorCode } from "@ecoledigitale/contracts/src/v2/stateassign";

export const StateassignCode = {
  INVALID_INPUT: "stateassign.invalid_input",
  FORBIDDEN: "stateassign.forbidden",
  PORT_UNAVAILABLE: "stateassign.port_unavailable",
  ASSIGNMENT_NOT_FOUND: "stateassign.assignment_not_found",
  RECEIVABLE_NOT_FOUND: "stateassign.receivable_not_found",
  CONTROL_NOT_FOUND: "stateassign.control_not_found",
  DOCUMENT_NOT_FOUND: "stateassign.document_not_found",
  EXPORT_FORMAT_NOT_FOUND: "stateassign.export_format_not_found",
  ENROLLMENT_NOT_FOUND: "stateassign.enrollment_not_found",
  ENROLLMENT_NOT_ELIGIBLE: "stateassign.enrollment_not_eligible",
  ENROLLMENT_FUNDING_REFUSED: "stateassign.enrollment_funding_refused",
  DOCUMENT_REF_NOT_FOUND: "stateassign.document_ref_not_found",
  DUPLICATE_LIVE_ASSIGNMENT: "stateassign.duplicate_live_assignment",
  DUPLICATE_REFERENCE: "stateassign.duplicate_reference",
  DUPLICATE_CONTROL: "stateassign.duplicate_control",
  DUPLICATE_DOCUMENT: "stateassign.duplicate_document",
  DUPLICATE_EXPORT_FORMAT: "stateassign.duplicate_export_format",
  VERSION_CONFLICT: "stateassign.version_conflict",
  TRANSITION_INVALID: "stateassign.transition_invalid",
  FOUR_EYES_REQUIRED: "stateassign.four_eyes_required",
  HUMAN_ACTOR_REQUIRED: "stateassign.human_actor_required",
  CONTENT_FROZEN: "stateassign.content_frozen",
  CONTROL_STATE: "stateassign.control_state",
  CONTROL_TRANSITION: "stateassign.control_transition",
  RESOLUTION_REQUIRED: "stateassign.resolution_required",
  RECEIVABLE_STATE: "stateassign.receivable_state",
  DECLARED_AMOUNT_REQUIRED: "stateassign.declared_amount_required",
  RECEIVABLE_EXCEEDS_DECLARED: "stateassign.receivable_exceeds_declared",
  RECEIVABLE_CANCEL_RECEIVED: "stateassign.receivable_cancel_received",
  AMENDMENT_BELOW_SCHEDULE: "stateassign.amendment_below_schedule",
  AMENDMENT_EMPTY: "stateassign.amendment_empty",
  RECONCILIATION_UNAVAILABLE: "stateassign.reconciliation_unavailable",
  GATEWAY_NOT_CONFIGURED: "stateassign.gateway_not_configured",
  EXPORT_COLUMN_UNKNOWN: "stateassign.export_column_unknown",
  IMMUTABLE: "stateassign.immutable",
} as const satisfies Record<string, StateassignErrorCode>;

export type StateassignCodeValue = (typeof StateassignCode)[keyof typeof StateassignCode];

export const validation = (
  code: StateassignCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: StateassignCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: StateassignCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: StateassignCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Port non branché : le module échoue FERMÉ (aucune vérification sans inscription lisible, aucun rapprochement sans finance). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: StateassignCode.PORT_UNAVAILABLE,
    details: { port },
  });

/** Statut HTTP précis par code (les catégories du kernel n'ont que 400/403/404/409/500). */
export const HTTP_STATUS_BY_STATEASSIGN_CODE: Readonly<Record<string, number>> = Object.freeze({
  [StateassignCode.PORT_UNAVAILABLE]: 503,
  [StateassignCode.GATEWAY_NOT_CONFIGURED]: 503,
  [StateassignCode.RECONCILIATION_UNAVAILABLE]: 503,
  [StateassignCode.HUMAN_ACTOR_REQUIRED]: 403,
  [StateassignCode.FOUR_EYES_REQUIRED]: 403,
});
