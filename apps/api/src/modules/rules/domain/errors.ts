/**
 * Erreurs métier du module `rules` : types du kernel (statut HTTP par catégorie) avec des codes machine STABLES
 * `rules.*` (un code publié ne change jamais). Aucune exception brute pour les cas métier.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type AppError } from "@ecoledigitale/kernel";

export const RulesCode = {
  /** Aucune règle active pour le périmètre et la date : le consommateur refuse le calcul (`results.no_active_ruleset`). */
  NO_ACTIVE_RULESET: "rules.no_active_ruleset",
  /** Une version ne satisfait pas son contrat, ou une sortie sort de l'ensemble de codes du contrat. */
  CONTRACT_VIOLATION: "rules.contract_violation",
  UNKNOWN_CONTRACT: "rules.unknown_contract",
  EVALUATION_FAILED: "rules.evaluation_failed",
  BUDGET_EXCEEDED: "rules.budget_exceeded",
  /** Le contenu d'une version ne correspond plus à son hash : usage bloqué. */
  HASH_MISMATCH: "rules.hash_mismatch",
  TRANSITION_FORBIDDEN: "rules.transition_forbidden",
  /** Deux versions (ou liaisons) actives dont les périodes d'effet se chevauchent. */
  OVERLAP: "rules.overlap",
  VERSION_IMMUTABLE: "rules.version_immutable",
  /** Verrou optimiste : la version a changé depuis la lecture. */
  STALE_VERSION: "rules.stale_version",
  VERSION_NOT_FOUND: "rules.version_not_found",
  RULESET_NOT_FOUND: "rules.ruleset_not_found",
  RULE_NOT_FOUND: "rules.rule_not_found",
  BINDING_NOT_FOUND: "rules.binding_not_found",
  SIMULATION_NOT_FOUND: "rules.simulation_not_found",
  SIMULATION_REQUIRED: "rules.simulation_required",
  SIMULATION_NOT_AVAILABLE: "rules.simulation_not_available",
  DECISION_IMPACT_CONFIRMATION_REQUIRED: "rules.decision_impact_confirmation_required",
  COMMENT_REQUIRED: "rules.comment_required",
  FOUR_EYES: "rules.four_eyes",
  INVALID_INPUT: "rules.invalid_input",
  DUPLICATE: "rules.duplicate",
  PARAMETER_OUT_OF_RANGE: "rules.parameter_out_of_range",
  RATE_LIMITED: "rules.rate_limited",
  EXPRESSION_EDIT_FORBIDDEN: "rules.expression_edit_forbidden",
  /** Liaison d'un jeu FICTIF (placeholder) en production sans accusé explicite. */
  PLACEHOLDER_REQUIRES_ACK: "rules.placeholder_requires_ack",
} as const;

export type RulesCodeValue = (typeof RulesCode)[keyof typeof RulesCode];

export const validation = (code: RulesCodeValue, message: string, field?: string, details?: Record<string, unknown>): ValidationError =>
  new ValidationError(message, field ? [{ path: [field], message, code }] : [], { code, ...(details ? { details } : {}) });

export const notFound = (code: RulesCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const conflict = (code: RulesCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const forbidden = (code: RulesCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

export function isRulesError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string" && (e as { code: string }).code.startsWith("rules.");
}
