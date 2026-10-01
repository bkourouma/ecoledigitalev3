/**
 * Erreurs métier du module `results` : types du kernel (statut HTTP par catégorie) avec des codes machine STABLES
 * `results.*` (un code publié ne change jamais). Les mêmes codes préfixent les messages des déclencheurs SQL
 * (`results.<code>: …`) : `mapDbError` les retraduit.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const ResultsCode = {
  /** Aucune règle active pour la classe × période : le calcul est refusé (R-RES-08), jamais de valeur par défaut. */
  NO_ACTIVE_RULESET: "results.no_active_ruleset",
  RULES_UNAVAILABLE: "results.rules_unavailable",
  CURRICULUM_UNAVAILABLE: "results.curriculum_unavailable",
  CURRICULUM_INCOMPLETE: "results.curriculum_incomplete",
  UNSUPPORTED_CONTRACT: "results.unsupported_contract",
  STATE_NOT_FOUND: "results.state_not_found",
  RESULT_NOT_FOUND: "results.result_not_found",
  OVERRIDE_NOT_FOUND: "results.override_not_found",
  DECISION_NOT_FOUND: "results.decision_not_found",
  DELIBERATION_NOT_FOUND: "results.deliberation_not_found",
  INVALID_STATE_TRANSITION: "results.invalid_state_transition",
  STATE_NOT_OPEN: "results.state_not_open",
  STATE_CLOSED: "results.state_closed",
  PENDING_ASSESSMENTS: "results.pending_assessments",
  CALCULATION_ERRORS: "results.calculation_errors",
  DELIBERATION_REQUIRED: "results.deliberation_required",
  REOPEN_REQUIRES_REASON: "results.reopen_requires_reason",
  OVERRIDE_NOT_ALLOWED: "results.override_not_allowed",
  OVERRIDE_INVALID: "results.override_invalid",
  OVERRIDE_TRANSITION: "results.override_transition",
  OVERRIDE_DUPLICATE: "results.override_duplicate",
  FOUR_EYES: "results.four_eyes",
  JUSTIFICATION_REQUIRED: "results.justification_required",
  DECISION_TRANSITION: "results.decision_transition",
  DECISION_STALE: "results.decision_stale",
  FINAL_IMMUTABLE: "results.final_immutable",
  NOT_VISIBLE: "results.not_visible",
  FORBIDDEN: "results.forbidden",
  STALE_STATE: "results.stale_state",
  PORT_UNAVAILABLE: "results.port_unavailable",
  INVALID_INPUT: "results.invalid_input",
  REPIN_NOT_ALLOWED: "results.repin_not_allowed",
  HASH_MISMATCH: "results.hash_mismatch",
} as const;

export type ResultsCodeValue = (typeof ResultsCode)[keyof typeof ResultsCode];

export const validation = (code: ResultsCodeValue, message: string, field?: string, details?: Record<string, unknown>): ValidationError =>
  new ValidationError(message, field ? [{ path: [field], message, code }] : [], { code, ...(details ? { details } : {}) });

export const notFound = (code: ResultsCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const conflict = (code: ResultsCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const forbidden = (code: ResultsCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

export const DB_CODE_MESSAGES: Readonly<Record<string, { code: ResultsCodeValue; message: string }>> = Object.freeze({
  "results.final_immutable": { code: ResultsCode.FINAL_IMMUTABLE, message: "Un résultat final est immuable : rouvrez la période pour produire une nouvelle version." },
  "results.state_closed": { code: ResultsCode.STATE_CLOSED, message: "La période est clôturée : rouvrez-la pour la modifier." },
  "results.state_not_open": { code: ResultsCode.STATE_NOT_OPEN, message: "La période est verrouillée ou clôturée : aucun calcul provisoire n'est possible." },
  "results.invalid_state_transition": { code: ResultsCode.INVALID_STATE_TRANSITION, message: "Cette étape du cycle de la période n'est pas permise." },
  "results.reopen_requires_reason": { code: ResultsCode.REOPEN_REQUIRES_REASON, message: "Une réouverture exige sa nature et un motif d'au moins 10 caractères." },
  "results.override_transition": { code: ResultsCode.OVERRIDE_TRANSITION, message: "Cette décision sur la surcharge n'est pas permise dans son état actuel." },
  "results.decision_immutable": { code: ResultsCode.DECISION_TRANSITION, message: "La décision est figée." },
  "results.pin_frozen": { code: ResultsCode.REPIN_NOT_ALLOWED, message: "La version de règle ne peut être modifiée que sur une période ouverte." },
  "results.version_requires_closure": { code: ResultsCode.INVALID_STATE_TRANSITION, message: "La version des résultats ne change qu'avec une clôture." },
  "results.final_requires_closure": { code: ResultsCode.FINAL_IMMUTABLE, message: "Un résultat final naît d'une clôture." },
});

export function dbCodeOf(message: string | undefined): string | null {
  const m = /(results\.[a-z0-9_]+):/.exec(message ?? "");
  return m ? (m[1] as string) : null;
}
