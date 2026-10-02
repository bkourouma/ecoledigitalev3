/**
 * Erreurs métier du module primary_school : types du kernel + codes stables `primary_school.*`
 * (ils font partie du contrat d'API ; ne jamais en renommer un).
 *
 * Les déclencheurs SQL (migrations 1800-1802) lèvent des messages préfixés `primary_school.<code>: …` ; `dbCodeOf` les relit
 * pour renvoyer une réponse stable (409) en cas de course ou de contournement, jamais un 500.
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const PrimaryCode = {
  INVALID_INPUT: "primary_school.invalid_input",
  FORBIDDEN: "primary_school.forbidden",
  PORT_UNAVAILABLE: "primary_school.port_unavailable",
  TEMPLATE_UNAVAILABLE: "primary_school.template_unavailable",
  INSTITUTION_REQUIRED: "primary_school.institution_required",
  // Échelles, référentiels
  SCALE_NOT_FOUND: "primary_school.scale_not_found",
  SCALE_DUPLICATE_CODE: "primary_school.scale_duplicate_code",
  SCALE_IN_USE: "primary_school.scale_in_use",
  FRAMEWORK_NOT_FOUND: "primary_school.framework_not_found",
  FRAMEWORK_DUPLICATE: "primary_school.framework_duplicate",
  FRAMEWORK_NOT_PUBLISHED: "primary_school.framework_not_published",
  FRAMEWORK_NOT_DRAFT: "primary_school.framework_published_immutable",
  FRAMEWORK_EMPTY: "primary_school.framework_empty",
  FRAMEWORK_NO_LEVEL: "primary_school.framework_no_level",
  SCALE_TOO_SMALL: "primary_school.scale_too_small",
  FRAMEWORK_NOT_APPLICABLE: "primary_school.framework_not_applicable",
  FRAMEWORK_TRANSITION: "primary_school.framework_transition",
  // Compétences
  SCALE_MISMATCH: "primary_school.scale_mismatch",
  PERIOD_LOCKED: "primary_school.period_locked",
  VALIDATED_FROZEN: "primary_school.validated_frozen",
  ASSESSMENT_NOT_FOUND: "primary_school.assessment_not_found",
  ASSESSMENT_NOT_VALIDATED: "primary_school.assessment_not_validated",
  ROW_VERSION_CONFLICT: "primary_school.row_version_conflict",
  ENROLLMENT_NOT_IN_CLASS: "primary_school.enrollment_not_in_class",
  COMPETENCY_UNKNOWN: "primary_school.competency_unknown",
  LEVEL_UNKNOWN: "primary_school.level_unknown",
  STAFF_PROFILE_REQUIRED: "primary_school.staff_profile_required",
  REVISION_SAME_LEVEL: "primary_school.revision_same_level",
  // Banque d'appréciations
  PHRASE_NOT_FOUND: "primary_school.phrase_not_found",
  PHRASE_DUPLICATE: "primary_school.phrase_duplicate",
  // Classe
  CLASSROOM_NOT_FOUND: "primary_school.classroom_not_found",
  HOMEROOM_REQUIRED: "primary_school.homeroom_required",
  // Conseil
  COUNCIL_NOT_FOUND: "primary_school.council_not_found",
  COUNCIL_CASE_NOT_FOUND: "primary_school.council_case_not_found",
  COUNCIL_ALREADY_PREPARED: "primary_school.council_already_prepared",
  CASE_ALREADY_DECIDED: "primary_school.case_already_decided",
  CASE_NO_DECISION: "primary_school.case_no_decision",
  ATTENDANCE_SIGNED: "primary_school.attendance_signed",
  ATTENDANCE_UNKNOWN_SIGNER: "primary_school.attendance_unknown_signer",
  MINUTES_NOT_READY: "primary_school.minutes_not_ready",
  // Bilan annuel
  REVIEW_NOT_FOUND: "primary_school.review_not_found",
  REVIEW_NEEDS_RESULTS: "primary_school.review_needs_results",
  REVIEW_NEEDS_DECISION: "primary_school.review_needs_decision",
  REVIEW_SEALED: "primary_school.review_sealed",
  REVIEW_NOT_SEALED: "primary_school.review_not_sealed",
  REVIEW_TRANSITION: "primary_school.review_transition",
  REVIEW_PERIODS_OPEN: "primary_school.review_periods_open",
  YEAR_FROZEN: "primary_school.year_frozen",
  // Archive
  ARCHIVE_NOT_FOUND: "primary_school.archive_not_found",
  ARCHIVE_FROZEN: "primary_school.archive_frozen",
  ARCHIVE_NOT_READY: "primary_school.archive_not_ready",
  ARCHIVE_YEAR_NOT_CLOSED: "primary_school.archive_year_not_closed",
  ARCHIVE_TRANSITION: "primary_school.archive_transition",
  // Accès famille
  NOT_GUARDIAN: "primary_school.not_guardian",
  NO_STUDENT_PROFILE: "primary_school.no_student_profile",
  // Rapports
  REPORT_UNKNOWN: "primary_school.report_unknown",
} as const;

export type PrimaryCodeValue = (typeof PrimaryCode)[keyof typeof PrimaryCode];

export const validation = (
  code: PrimaryCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: PrimaryCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: PrimaryCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code: PrimaryCode.FORBIDDEN, ...(details ? { details } : {}) });

/** Refus dont le CODE stable précise la cause (ex. fiche de personnel manquante). */
export const forbiddenCode = (code: PrimaryCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Port non branché : le module échoue FERMÉ (aucune écriture sans la source de vérité). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: PrimaryCode.PORT_UNAVAILABLE,
    details: { port },
  });

// ---------------------------------------------------------------------------
// Messages des déclencheurs SQL
// ---------------------------------------------------------------------------

/** Extrait le code `xxx` d'un message `primary_school.xxx: …` levé par un déclencheur. */
export function dbCodeOf(message: string): string | null {
  const m = /primary_school\.([a-z_]+)\s*:/.exec(message);
  return m ? (m[1] as string) : null;
}

export const DB_CODE_MESSAGES: Readonly<Record<string, { code: PrimaryCodeValue; message: string }>> = Object.freeze({
  framework_not_published: { code: PrimaryCode.FRAMEWORK_NOT_PUBLISHED, message: "Seul un référentiel publié s'évalue." },
  scale_mismatch: { code: PrimaryCode.SCALE_MISMATCH, message: "Le niveau n'appartient pas à l'échelle du référentiel." },
  period_locked: { code: PrimaryCode.PERIOD_LOCKED, message: "La saisie est arrêtée pour cette classe et cette période." },
  validated_frozen: { code: PrimaryCode.VALIDATED_FROZEN, message: "Une appréciation validée ne se corrige que par une révision motivée." },
  assessment_transition: { code: PrimaryCode.VALIDATED_FROZEN, message: "Une appréciation validée ne revient pas en brouillon (réviser)." },
  assessment_delete_forbidden: { code: PrimaryCode.VALIDATED_FROZEN, message: "Une appréciation validée ne se supprime pas (réviser)." },
  framework_published_immutable: { code: PrimaryCode.FRAMEWORK_NOT_DRAFT, message: "Un référentiel publié ne se modifie pas : créer une nouvelle version." },
  framework_delete_forbidden: { code: PrimaryCode.FRAMEWORK_NOT_DRAFT, message: "Un référentiel publié ne se supprime pas." },
  framework_empty: { code: PrimaryCode.FRAMEWORK_EMPTY, message: "Un référentiel sans compétence ne se publie pas." },
  framework_no_level: { code: PrimaryCode.FRAMEWORK_NO_LEVEL, message: "Indiquer au moins un niveau d'application." },
  scale_too_small: { code: PrimaryCode.SCALE_TOO_SMALL, message: "L'échelle doit compter au moins deux niveaux." },
  framework_transition: { code: PrimaryCode.FRAMEWORK_TRANSITION, message: "Cette transition de référentiel est interdite." },
  scale_in_use: { code: PrimaryCode.SCALE_IN_USE, message: "L'échelle est employée par un référentiel publié : créer une nouvelle échelle." },
  attendance_signed: { code: PrimaryCode.ATTENDANCE_SIGNED, message: "Une présence signée est figée." },
  review_sealed: { code: PrimaryCode.REVIEW_SEALED, message: "Un bilan scellé est immuable : créer la version suivante." },
  review_delete_forbidden: { code: PrimaryCode.REVIEW_SEALED, message: "Un bilan qui n'est plus un brouillon ne se supprime pas." },
  review_transition: { code: PrimaryCode.REVIEW_TRANSITION, message: "Cette transition de bilan est interdite." },
  review_needs_decision: { code: PrimaryCode.REVIEW_NEEDS_DECISION, message: "Le bilan ne se scelle qu'avec la décision du conseil des maîtres." },
  review_needs_results: { code: PrimaryCode.REVIEW_NEEDS_RESULTS, message: "Le bilan ne se scelle qu'avec un résultat d'année FINAL." },
  year_frozen: { code: PrimaryCode.YEAR_FROZEN, message: "L'année est archivée : plus aucun bilan ne peut être écrit." },
  archive_frozen: { code: PrimaryCode.ARCHIVE_FROZEN, message: "Une année archivée est figée." },
  archive_transition: { code: PrimaryCode.ARCHIVE_TRANSITION, message: "Cette transition d'archive est interdite." },
  append_only: { code: PrimaryCode.VALIDATED_FROZEN, message: "Ce journal est en ajout seul." },
});
