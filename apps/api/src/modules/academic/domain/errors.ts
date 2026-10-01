/**
 * Erreurs métier du module academic : types du kernel + codes stables `academic.*`.
 * Les codes font partie du contrat d'API (et ceux des déclencheurs SQL en sont le préfixe de message) :
 * ne jamais en renommer un.
 *
 * HTTP : `validation` -> 400 (convention du kernel, aucun 422), `conflict` -> 409, `not_found` -> 404,
 * `forbidden` -> 403.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, err, type Result } from "@ecoledigitale/kernel";

export const AcademicCode = {
  INVALID_INPUT: "academic.invalid_input",
  NOT_FOUND: "academic.not_found",
  // Années
  YEAR_NOT_FOUND: "academic.year_not_found",
  YEAR_OVERLAP: "academic.year_overlap",
  YEAR_GAP: "academic.year_gap",
  YEAR_CODE_TAKEN: "academic.year_code_taken",
  YEAR_DATES_INVALID: "academic.year_dates_invalid",
  YEAR_TRANSITION: "academic.year_transition",
  YEAR_NOT_OPEN: "academic.year_not_open",
  YEAR_NOT_EDITABLE: "academic.year_not_editable",
  YEAR_CLOSE_BLOCKED: "academic.year_close_blocked",
  // Périodes
  PERIOD_NOT_FOUND: "academic.period_not_found",
  PERIOD_OUTSIDE_YEAR: "academic.period_outside_year",
  PERIOD_OUTSIDE_PARENT: "academic.period_outside_parent",
  PERIOD_PARENT_OTHER_YEAR: "academic.period_parent_other_year",
  PERIOD_TOO_DEEP: "academic.period_too_deep",
  PERIOD_OVERLAP: "academic.period_overlap",
  PERIOD_CODE_TAKEN: "academic.period_code_taken",
  PERIOD_TRANSITION: "academic.period_transition",
  PERIOD_CLOSED_DATES: "academic.period_closed_dates",
  PERIOD_DELETE_FORBIDDEN: "academic.period_delete_forbidden",
  PERIOD_TYPE_UNKNOWN: "academic.period_type_unknown",
  PERIOD_PLAN_UNKNOWN: "academic.period_plan_unknown",
  PERIOD_PLAN_CONFLICT: "academic.period_plan_conflict",
  PERIOD_AMBIGUOUS: "academic.period_ambiguous",
  PERIOD_CLOSED: "academic.period_closed",
  PERIOD_CLOSE_REFUSED: "academic.period_close_refused",
  PERIOD_NOT_OPEN: "academic.period_not_open",
  PERIOD_IDENTITY_IMMUTABLE: "academic.period_identity_immutable",
  CLASSROOM_PERIOD_TRANSITION: "academic.classroom_period_transition",
  CLASSROOM_PERIOD_OTHER_YEAR: "academic.classroom_period_other_year",
  // Programmes, matières, référentiels
  PROGRAM_NOT_FOUND: "academic.program_not_found",
  PROGRAM_CODE_TAKEN: "academic.program_code_taken",
  PROGRAM_PARENT_OTHER_INSTITUTION: "academic.program_parent_other_institution",
  PROGRAM_TOO_DEEP: "academic.program_too_deep",
  SUBJECT_NOT_FOUND: "academic.subject_not_found",
  SUBJECT_CODE_TAKEN: "academic.subject_code_taken",
  SUBJECT_IN_USE: "academic.subject_in_use",
  REFERENCE_UNKNOWN: "academic.reference_unknown",
  REFERENCE_SYSTEM_LOCKED: "academic.reference_system_locked",
  GRADE_LEVEL_NOT_FOUND: "academic.grade_level_not_found",
  EDUCATION_LEVEL_NOT_FOUND: "academic.education_level_not_found",
  SETTINGS_INVALID: "academic.settings_invalid",
  TEMPLATE_UNKNOWN: "academic.template_unknown",
  TEMPLATE_INVALID: "academic.template_invalid",
  INSTITUTION_NOT_FOUND: "academic.institution_not_found",
  // Curriculum
  CURRICULUM_NOT_FOUND: "academic.curriculum_not_found",
  CURRICULUM_EXISTS: "academic.curriculum_exists",
  CURRICULUM_PUBLISHED: "academic.curriculum_published",
  CURRICULUM_LOCKED: "academic.curriculum_locked",
  CURRICULUM_INVALID: "academic.curriculum_invalid",
  CURRICULUM_TRANSITION: "academic.version_transition",
  VERSION_IDENTITY_IMMUTABLE: "academic.version_identity_immutable",
  NODE_NOT_FOUND: "academic.node_not_found",
  NODE_TYPE_UNKNOWN: "academic.node_type_unknown",
  NODE_BAD_PARENT: "academic.node_bad_parent",
  NODE_NEEDS_PARENT: "academic.node_needs_parent",
  NODE_CYCLE: "academic.node_cycle",
  NODE_SUBJECT_REQUIRED: "academic.node_subject_required",
  NODE_SUBJECT_FORBIDDEN: "academic.node_subject_forbidden",
  NODE_GRADE_LEVEL_REQUIRED: "academic.node_grade_level_required",
  NODE_GRADE_LEVEL_FORBIDDEN: "academic.node_grade_level_forbidden",
  NODE_PERIOD_SLOT_REQUIRED: "academic.node_period_slot_required",
  NODE_PERIOD_SLOT_FORBIDDEN: "academic.node_period_slot_forbidden",
  NODE_COEFFICIENT_FORBIDDEN: "academic.node_coefficient_forbidden",
  NODE_CREDITS_FORBIDDEN: "academic.node_credits_forbidden",
  NODE_LEVEL_NOT_IN_PROGRAM: "academic.node_level_not_in_program",
  NODE_CODE_TAKEN: "academic.node_code_taken",
  NODE_HAS_CHILDREN: "academic.node_has_children",
  NODE_IN_USE: "academic.node_in_use",
  NODE_IDENTITY_IMMUTABLE: "academic.node_identity_immutable",
  PREREQUISITE_SELF: "academic.prerequisite_self",
  PREREQUISITE_CYCLE: "academic.prerequisite_cycle",
  PREREQUISITE_UNKNOWN_LINEAGE: "academic.prerequisite_unknown_lineage",
  AMENDMENT_REASON_REQUIRED: "academic.amendment_reason_required",
  AMENDMENT_NOT_ALLOWED: "academic.amendment_not_allowed",
  // Classes et offres
  CLASSROOM_NOT_FOUND: "academic.classroom_not_found",
  CLASSROOM_CODE_TAKEN: "academic.classroom_code_taken",
  CLASSROOM_NAME_TAKEN: "academic.classroom_name_taken",
  CLASSROOM_YEAR_INSTITUTION: "academic.classroom_year_institution",
  CLASSROOM_LEVEL_NOT_IN_PROGRAM: "academic.classroom_level_not_in_program",
  CLASSROOM_CURRICULUM_MISMATCH: "academic.classroom_curriculum_mismatch",
  CLASSROOM_CURRICULUM_DRAFT: "academic.classroom_curriculum_draft",
  CLASSROOM_CURRICULUM_REQUIRED: "academic.classroom_curriculum_required",
  CLASSROOM_TRANSITION: "academic.classroom_transition",
  CLASSROOM_NOT_OPEN: "academic.classroom_not_open",
  CLASSROOM_FULL: "academic.classroom_full",
  CLASSROOM_IDENTITY_IMMUTABLE: "academic.classroom_identity_immutable",
  OFFERING_NOT_FOUND: "academic.offering_not_found",
  OFFERING_NOT_OPEN: "academic.offering_not_open",
  OFFERING_FULL: "academic.offering_full",
  OFFERING_CLOSED: "academic.offering_closed",
  OFFERING_TRANSITION: "academic.offering_transition",
  OFFERING_OUTSIDE_YEAR: "academic.offering_outside_year",
  OFFERING_DATES_INVALID: "academic.offering_dates_invalid",
  OFFERING_NODE_NOT_IN_CURRICULUM: "academic.offering_node_not_in_curriculum",
  OFFERING_NODE_NOT_ENROLLABLE: "academic.offering_node_not_enrollable",
  OFFERING_NODE_TRANSVERSAL: "academic.offering_node_transversal",
  OFFERING_NODE_INACTIVE: "academic.offering_node_inactive",
  OFFERING_NOT_READY: "academic.offering_not_ready",
  OFFERING_EXISTS: "academic.offering_exists",
  CAPACITY_BELOW_RESERVED: "academic.capacity_below_reserved",
  REGISTRATION_WINDOW_CLOSED: "academic.registration_window_closed",
  PREREQUISITES_UNMET: "academic.prerequisites_unmet",
  ALREADY_COMPLETED: "academic.already_completed",
  DUPLICATE_ENROLLMENT: "academic.duplicate_enrollment",
  // Inscriptions
  ENROLLMENT_NOT_FOUND: "academic.enrollment_not_found",
  ENROLLMENT_TRANSITION: "academic.enrollment_transition",
  ENROLLMENT_REASON_REQUIRED: "academic.enrollment_reason_required",
  ENROLLMENT_IDENTITY_IMMUTABLE: "academic.enrollment_identity_immutable",
  ENROLLMENT_CLASS_MISMATCH: "academic.enrollment_class_mismatch",
  ALREADY_ENROLLED: "academic.already_enrolled",
  CLASS_ENROLLMENT_EXISTS: "academic.class_enrollment_exists",
  ENROLLMENT_NOT_ACTIVE: "academic.enrollment_not_active",
  ENROLLMENT_MODE_MISMATCH: "academic.enrollment_mode_mismatch",
  STUDENT_NOT_FOUND: "academic.student_not_found",
  STUDENT_NOT_ENROLLABLE: "academic.student_not_enrollable",
  FUNDING_TYPE_UNKNOWN: "academic.funding_type_unknown",
  FUNDING_REFERENCE_REQUIRED: "academic.funding_reference_required",
  FUNDING_REFERENCE_FORBIDDEN: "academic.funding_reference_forbidden",
  FUNDING_FUNDER_REQUIRED: "academic.funding_funder_required",
  FUNDING_STATE_ASSIGNED_DISABLED: "academic.funding_feature_disabled",
  OUTCOME_UNKNOWN: "academic.outcome_unknown",
  OUTCOME_TARGET_REQUIRED: "academic.outcome_target_required",
  OVERRIDE_REASON_REQUIRED: "academic.override_reason_required",
  OVERRIDE_NOT_ALLOWED: "academic.override_not_allowed",
  REGISTRATION_NUMBER_CONFLICT: "academic.registration_number_conflict",
  REGISTRATION_PATTERN_INVALID: "academic.registration_pattern_invalid",
  REGISTRATION_SEQUENCE_MISSING: "academic.registration_sequence_missing",
  PLACEMENT_OVERLAP: "academic.placement_overlap",
  TRANSFER_SAME_CLASSROOM: "academic.transfer_same_classroom",
  TRANSFER_INVALID_TARGET: "academic.transfer_invalid_target",
  // Sélections de cours
  COURSE_NOT_FOUND: "academic.enrollment_course_not_found",
  COURSE_TRANSITION: "academic.course_transition",
  COURSE_ENROLLMENT_NOT_ACTIVE: "academic.course_enrollment_not_active",
  COURSE_TRANSVERSAL: "academic.course_transversal",
  COURSE_OTHER_YEAR: "academic.course_other_year",
  COURSE_OFFERING_OTHER_CLASS: "academic.course_offering_other_class",
  COURSE_OFFERING_NODE_MISMATCH: "academic.offering_node_mismatch",
  COURSE_IDENTITY_IMMUTABLE: "academic.course_identity_immutable",
  FEATURE_DISABLED: "academic.feature_disabled",
  // Reconduction
  ROLLOVER_INVALID: "academic.rollover_invalid",
  ROLLOVER_YEAR_ORDER: "academic.rollover_year_order",
  // Technique
  IMMUTABLE: "academic.immutable",
  FORBIDDEN_SCOPE: "academic.forbidden_scope",
} as const;

export type AcademicCodeValue = (typeof AcademicCode)[keyof typeof AcademicCode];

export const validation = (
  code: AcademicCodeValue | (string & {}),
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: AcademicCodeValue | (string & {}), message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: AcademicCodeValue | (string & {}), resource: string, id?: string): NotFoundError =>
  NotFoundError.of(resource, id, { code });

export const forbidden = (code: AcademicCodeValue | (string & {}), message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Raccourci : `fail(validation(...))` -> `Err`. */
export const fail = <E>(error: E): Result<never, E> => err(error);

/**
 * Codes SQL (préfixe des messages des déclencheurs) qui sont des CONFLITS (409) même quand le SQLSTATE est
 * `check_violation` : l'état de la ressource empêche l'opération, l'entrée n'est pas en cause.
 */
export const CONFLICT_SQL_CODES: ReadonlySet<string> = new Set([
  AcademicCode.CLASSROOM_FULL,
  AcademicCode.OFFERING_FULL,
  AcademicCode.OFFERING_CLOSED,
  AcademicCode.CAPACITY_BELOW_RESERVED,
  AcademicCode.COURSE_ENROLLMENT_NOT_ACTIVE,
  AcademicCode.CURRICULUM_PUBLISHED,
  AcademicCode.CURRICULUM_LOCKED,
  AcademicCode.DUPLICATE_ENROLLMENT,
  AcademicCode.NODE_CYCLE,
  AcademicCode.PREREQUISITE_CYCLE,
]);
