/**
 * Erreurs métier du module `examinations` : types du kernel + codes stables `examinations.*` (ils font partie du contrat
 * d'API, voir `EXAMINATIONS_ERROR_CODES` des contrats ; ne jamais en renommer un).
 *
 * Les gardes de la base lèvent des exceptions `examinations.<code>: message` (déclencheurs de 2000–2004) : `fromDbError`
 * les traduit en erreurs typées au bord de la transaction, avec le MÊME code. Un code inconnu de la liste reste une
 * erreur de conflit (409) au code préfixé : jamais une 500 pour une règle métier que la base a refusée.
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError, type AppError } from "@ecoledigitale/kernel";

export const ExamCode = {
  INVALID_INPUT: "examinations.invalid_input",
  FORBIDDEN: "examinations.forbidden",
  PORT_UNAVAILABLE: "examinations.port_unavailable",
  NOT_FOUND: "examinations.not_found",
  TYPE_NOT_FOUND: "examinations.type_not_found",
  SESSION_NOT_FOUND: "examinations.session_not_found",
  CANDIDATE_NOT_FOUND: "examinations.candidate_not_found",
  CENTER_NOT_FOUND: "examinations.center_not_found",
  ROOM_NOT_FOUND: "examinations.room_not_found",
  PAPER_NOT_FOUND: "examinations.paper_not_found",
  TRACK_NOT_FOUND: "examinations.track_not_found",
  REQUIREMENT_NOT_FOUND: "examinations.requirement_not_found",
  FORMAT_NOT_FOUND: "examinations.format_not_found",
  BATCH_NOT_FOUND: "examinations.batch_not_found",
  RESULT_NOT_FOUND: "examinations.result_not_found",
  SCORE_NOT_FOUND: "examinations.score_not_found",
  REQUEST_NOT_FOUND: "examinations.request_not_found",
  DOCUMENT_NOT_FOUND: "examinations.document_not_found",
  EXPORT_NOT_FOUND: "examinations.export_not_found",
  CODE_TAKEN: "examinations.code_taken",
  TYPE_ARCHIVED: "examinations.type_archived",
  // Sessions
  DEFINITION_LOCKED: "examinations.definition_locked",
  DEFINITION_NOT_LOCKED: "examinations.definition_not_locked",
  NO_PAPERS: "examinations.no_papers",
  SESSION_TRANSITION: "examinations.session_transition",
  SESSION_ARCHIVED: "examinations.session_archived",
  SESSION_IDENTITY_IMMUTABLE: "examinations.session_identity_immutable",
  SESSION_INITIAL_STATE: "examinations.session_initial_state",
  SESSION_REGISTRATION_CLOSED: "examinations.session_registration_closed",
  MOCK_TARGET_INVALID: "examinations.mock_target_invalid",
  RESULTS_INCOMPLETE: "examinations.results_incomplete",
  // Candidats
  CANDIDATE_INSTITUTION: "examinations.candidate_institution",
  CANDIDATE_INITIAL_STATE: "examinations.candidate_initial_state",
  CANDIDATE_IDENTITY_IMMUTABLE: "examinations.candidate_identity_immutable",
  CANDIDATE_NUMBER_IMMUTABLE: "examinations.candidate_number_immutable",
  CANDIDATE_SNAPSHOT_FROZEN: "examinations.candidate_snapshot_frozen",
  CANDIDATE_TRANSITION: "examinations.candidate_transition",
  CANDIDATE_WITHDRAWN: "examinations.candidate_withdrawn",
  CANDIDATE_NOT_REGISTERED: "examinations.candidate_not_registered",
  CANDIDATE_DUPLICATE: "examinations.candidate_duplicate",
  OUTCOME_DERIVED: "examinations.outcome_derived",
  ELIGIBILITY_DERIVED: "examinations.eligibility_derived",
  NOT_ELIGIBLE: "examinations.not_eligible",
  DOCUMENTS_INCOMPLETE: "examinations.documents_incomplete",
  WITHDRAW_AFTER_RESULTS: "examinations.withdraw_after_results",
  IDENTITY_INCOMPLETE: "examinations.identity_incomplete",
  ENROLLMENT_MISMATCH: "examinations.enrollment_mismatch",
  TRACK_UNKNOWN: "examinations.track_unknown",
  IDENTIFIER_TAKEN: "examinations.identifier_taken",
  // Candidat libre (Q-E15)
  EXTERNAL_ONLY: "examinations.external_only",
  EXTERNAL_OFFICIAL_ONLY: "examinations.external_official_only",
  CANDIDATE_ANONYMIZED: "examinations.candidate_anonymized",
  PIECE_MODE_MISMATCH: "examinations.piece_mode_mismatch",
  EXTERNAL_PROFILE_INCOMPLETE: "examinations.external_profile_incomplete",
  // Éligibilité
  NO_RULE_VERSION: "examinations.no_rule_version",
  RULE_EVALUATION_FAILED: "examinations.rule_evaluation_failed",
  MANUAL_ELIGIBILITY_REFUSED: "examinations.manual_eligibility_refused",
  // Pièces
  PIECE_DOCUMENT_UNKNOWN: "examinations.piece_document_unknown",
  PIECE_REVIEW_INVALID: "examinations.piece_review_invalid",
  // Centres et répartition
  CENTER_NOT_IN_SESSION: "examinations.center_not_in_session",
  ASSIGNMENT_FROZEN: "examinations.assignment_frozen",
  ROOM_INACTIVE: "examinations.room_inactive",
  SEAT_BEYOND_CAPACITY: "examinations.seat_beyond_capacity",
  SEAT_TAKEN: "examinations.seat_taken",
  NO_CAPACITY: "examinations.no_capacity",
  CENTER_IN_USE: "examinations.center_in_use",
  // Notes
  SCORES_CLOSED: "examinations.scores_closed",
  SCORES_FROZEN: "examinations.scores_frozen",
  SCORE_ABOVE_SCALE: "examinations.score_above_scale",
  SCORE_REVISION_REQUIRED: "examinations.score_revision_required",
  PAPER_NOT_FOR_TRACK: "examinations.paper_not_for_track",
  // Résultats
  RESULTS_CLOSED: "examinations.results_closed",
  OFFICIAL_NOT_COMPUTED: "examinations.official_not_computed",
  MOCK_NOT_IMPORTED: "examinations.mock_not_imported",
  MOCK_RESULTS_COMPUTED: "examinations.mock_results_computed",
  RESULT_PUBLISHED: "examinations.result_published",
  RESULT_REVISION_REQUIRED: "examinations.result_revision_required",
  RESULT_INITIAL_STATE: "examinations.result_initial_state",
  // Révisions
  REVISION_NOT_NEEDED: "examinations.revision_not_needed",
  REVISION_REQUEST_CLOSED: "examinations.revision_request_closed",
  REVISION_SAME_PERSON: "examinations.revision_same_person",
  REVISION_PENDING: "examinations.revision_pending",
  REVISION_NO_CHANGE: "examinations.revision_no_change",
  // Imports
  BATCH_CLOSED: "examinations.batch_closed",
  BATCH_TRANSITION: "examinations.batch_transition",
  BATCH_DUPLICATE: "examinations.batch_duplicate",
  BATCH_HAS_ERRORS: "examinations.batch_has_errors",
  BATCH_NOT_VALIDATED: "examinations.batch_not_validated",
  FILE_EMPTY: "examinations.file_empty",
  FILE_TOO_LARGE: "examinations.file_too_large",
  FILE_UNREADABLE: "examinations.file_unreadable",
  FORMAT_NOT_PUBLISHED: "examinations.format_not_published",
  FORMAT_KIND_MISMATCH: "examinations.format_kind_mismatch",
  // Examens blancs
  LINKS_MOCK_ONLY: "examinations.links_mock_only",
  LINKS_FROZEN: "examinations.links_frozen",
  ASSESSMENT_UNKNOWN: "examinations.assessment_unknown",
  ASSESSMENT_SCALE_MISMATCH: "examinations.assessment_scale_mismatch",
  ASSESSMENT_NOT_MOCK: "examinations.assessment_not_mock",
  ASSESSMENT_CLASSROOM_MISMATCH: "examinations.assessment_classroom_mismatch",
  MOCK_ONLY: "examinations.mock_only",
  NO_LINKS: "examinations.no_links",
  // Formats, exports
  FORMAT_INVALID: "examinations.format_invalid",
  FORMAT_PUBLISHED_IMMUTABLE: "examinations.format_published_immutable",
  FORMAT_TRANSITION: "examinations.format_transition",
  FORMAT_IDENTITY_IMMUTABLE: "examinations.format_identity_immutable",
  EXPORT_CLOSED: "examinations.export_closed",
  EXPORT_FAILED: "examinations.export_failed",
  // Documents
  ATTESTATION_REQUIRES_ADMISSION: "examinations.attestation_requires_admission",
  CONVOCATION_REQUIRES_ASSIGNMENT: "examinations.convocation_requires_assignment",
  DOCUMENT_REVOKED: "examinations.document_revoked",
  DOCUMENT_ISSUED: "examinations.document_issued",
  DOCUMENT_ALREADY_LIVE: "examinations.document_already_live",
  REVOKE_REASON_REQUIRED: "examinations.revoke_reason_required",
  MOCK_NO_OFFICIAL_DOCUMENT: "examinations.mock_no_official_document",
  // Statistiques, transport
  GROUP_UNKNOWN: "examinations.group_unknown",
  RATE_LIMITED: "examinations.rate_limited",
} as const;

export type ExamCodeValue = (typeof ExamCode)[keyof typeof ExamCode];

export const validation = (
  code: ExamCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: ExamCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: ExamCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: ExamCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Port non branché : le module échoue FERMÉ (aucune éligibilité sans faits, aucun document sans scellement). */
export const portUnavailable = (port: string, expected?: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: ExamCode.PORT_UNAVAILABLE,
    details: { port, ...(expected ? { expected } : {}) },
  });

/** Statut HTTP précis par code (les catégories du kernel n'ont que 400/403/404/409/500). */
export const HTTP_STATUS_BY_EXAM_CODE: Readonly<Record<string, number>> = Object.freeze({
  [ExamCode.FILE_TOO_LARGE]: 413,
  [ExamCode.PORT_UNAVAILABLE]: 503,
  [ExamCode.RATE_LIMITED]: 429,
});

/** Codes de la base qui désignent une ressource absente (404) plutôt qu'un conflit. */
const DB_NOT_FOUND: ReadonlySet<string> = new Set([ExamCode.SESSION_NOT_FOUND]);
/** Codes de la base qui sont des entrées invalides (400) plutôt que des conflits d'état. */
const DB_VALIDATION: ReadonlySet<string> = new Set([
  ExamCode.SCORE_ABOVE_SCALE,
  ExamCode.SEAT_BEYOND_CAPACITY,
  ExamCode.NO_PAPERS,
  ExamCode.PAPER_NOT_FOR_TRACK,
  ExamCode.MOCK_TARGET_INVALID,
]);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";

/** Extrait le code `examinations.<code>` d'un message d'exception de la base. `null` si l'exception n'en porte pas. */
export function dbRuleCode(error: unknown): string | null {
  const m = /(?:^|\s)(examinations\.[a-z_]+)(?::|\b)/.exec(messageOf(error));
  return m ? (m[1] as string) : null;
}

/** Message d'utilisateur : la partie après le code (déjà en français dans les déclencheurs), sinon un texte générique. */
function dbMessage(error: unknown): string {
  const message = messageOf(error);
  const idx = message.indexOf(": ");
  const after = idx >= 0 ? message.slice(idx + 2).trim() : "";
  return after.length > 0 ? after : "L'opération est refusée par une règle de l'examen.";
}

/** Contraintes d'unicité -> codes. Les noms par défaut de Postgres sont `<table>_<colonnes>_key` ; les index portent leur nom. */
const UNIQUE_CODES: ReadonlyArray<readonly [RegExp, ExamCodeValue, string]> = [
  [/candidates_one_live_per_student/, ExamCode.CANDIDATE_DUPLICATE, "Cet élève est déjà candidat de la session."],
  [/candidates_one_live_external/, ExamCode.CANDIDATE_DUPLICATE, "Ce candidat libre (même nom, mêmes prénoms, même naissance) est déjà inscrit dans la session."],
  [/external_candidate_profiles_piece/, ExamCode.CANDIDATE_DUPLICATE, "Cette pièce d'identité désigne déjà un autre candidat libre de la session."],
  [/candidate_identifiers_tenant_id_session_id_kind_value_key/, ExamCode.IDENTIFIER_TAKEN, "Cet identifiant désigne déjà un autre candidat de la session."],
  [/candidate_identifiers_tenant_id_candidate_id_kind_key/, ExamCode.IDENTIFIER_TAKEN, "Ce candidat a déjà un identifiant de cette nature."],
  [/seat_assignments_tenant_id_session_id_room_id_seat_number_key/, ExamCode.SEAT_TAKEN, "Cette place est déjà attribuée."],
  [/seat_assignments_tenant_id_session_id_candidate_id_key/, ExamCode.SEAT_TAKEN, "Ce candidat a déjà une place."],
  [/import_batches_tenant_id_session_id_kind_sha256_key/, ExamCode.BATCH_DUPLICATE, "Ce fichier a déjà été importé pour cette session."],
  [/exam_types_tenant_id_code_key/, ExamCode.CODE_TAKEN, "Ce code de type d'examen existe déjà."],
  [/sessions_tenant_id_institution_id_code_key/, ExamCode.CODE_TAKEN, "Ce code de session existe déjà pour cet établissement."],
  [/centers_tenant_id_code_key/, ExamCode.CODE_TAKEN, "Ce code de centre existe déjà."],
  [/rooms_tenant_id_center_id_code_key/, ExamCode.CODE_TAKEN, "Ce code de salle existe déjà dans ce centre."],
  [/exam_tracks_tenant_id_exam_type_id_code_key/, ExamCode.CODE_TAKEN, "Ce code de série existe déjà."],
  [/exam_papers_unique/, ExamCode.CODE_TAKEN, "Ce code d'épreuve existe déjà."],
  [/session_papers_unique/, ExamCode.CODE_TAKEN, "Ce code d'épreuve existe déjà dans la session."],
  [/document_requirements_tenant_id_exam_type_id_code_key/, ExamCode.CODE_TAKEN, "Ce code de pièce existe déjà."],
  [/(export|import)_formats_(tenant_id_code_version_key|one_published)/, ExamCode.CODE_TAKEN, "Ce code de format existe déjà (ou un format est déjà publié sous ce code)."],
  [/issued_documents_one_live/, ExamCode.DOCUMENT_ALREADY_LIVE, "Ce candidat a déjà un document vivant de cette nature (le révoquer d'abord)."],
  [/revision_requests_one_pending/, ExamCode.REVISION_PENDING, "Une demande de révision est déjà en attente pour cette cible."],
  [/paper_assessment_links_tenant_id_assessment_id_key/, ExamCode.LINKS_MOCK_ONLY, "Cette évaluation alimente déjà une épreuve."],
  [/paper_assessment_links_tenant_id_paper_id_classroom_id_key/, ExamCode.LINKS_MOCK_ONLY, "Cette épreuve est déjà liée à une évaluation pour cette classe."],
];

/**
 * Traduit une exception de la base en `AppError` typée, ou `null` si elle n'est pas une règle métier connue (une vraie
 * panne reste une exception inattendue). Appelée UNIQUEMENT au bord de la transaction : une transaction Postgres en erreur
 * est de toute façon abandonnée.
 */
export function fromDbError(error: unknown): AppError | null {
  const rule = dbRuleCode(error);
  if (rule) {
    const code = rule as ExamCodeValue;
    const message = dbMessage(error);
    if (DB_NOT_FOUND.has(rule)) return new NotFoundError(message, { code });
    if (DB_VALIDATION.has(rule)) return validation(code, message);
    return conflict(code, message);
  }
  const pg = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  const constraint = typeof error === "object" && error !== null && "constraint" in error ? String((error as { constraint?: unknown }).constraint ?? "") : "";
  const text = `${constraint} ${messageOf(error)}`;
  if (pg === "23505") {
    for (const [re, code, message] of UNIQUE_CODES) if (re.test(text)) return conflict(code, message);
    return conflict(ExamCode.CODE_TAKEN, "Cette valeur existe déjà.");
  }
  if (pg === "23503") return validation(ExamCode.INVALID_INPUT, "Une référence de la requête est inconnue ou n'appartient pas à la même session.");
  if (pg === "23514" || pg === "23502") return validation(ExamCode.INVALID_INPUT, "Une valeur de la requête est refusée par les contraintes du modèle.", "input", { constraint });
  return null;
}
