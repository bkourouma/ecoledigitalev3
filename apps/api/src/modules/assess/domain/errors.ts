/**
 * Erreurs métier du module `assess` : types du kernel (statut HTTP par catégorie) avec des codes machine STABLES
 * `assess.*` (un code publié ne change jamais). Aucune exception brute pour les cas métier. Les mêmes codes sont
 * utilisés en PRÉFIXE des messages des déclencheurs SQL (`assess.<code>: …`) : `mapDbError` les retraduit.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const AssessCode = {
  NOT_ASSIGNED: "assess.not_assigned",
  TYPE_NOT_FOUND: "assess.type_not_found",
  TYPE_INACTIVE: "assess.type_inactive",
  TYPE_DUPLICATE: "assess.type_duplicate",
  TYPE_IN_USE: "assess.type_in_use",
  ASSESSMENT_NOT_FOUND: "assess.assessment_not_found",
  GRADE_NOT_FOUND: "assess.grade_not_found",
  REVISION_NOT_FOUND: "assess.revision_not_found",
  INVALID_TRANSITION: "assess.invalid_transition",
  FOUR_EYES: "assess.four_eyes",
  COMMENT_REQUIRED: "assess.comment_required",
  EMPTY_ASSESSMENT: "assess.empty_assessment",
  ASSESSMENT_FROZEN: "assess.assessment_frozen",
  SCALE_CONFLICT: "assess.scale_conflict",
  SCORE_OUT_OF_SCALE: "assess.score_out_of_scale",
  SCORE_PRECISION: "assess.score_precision",
  GRADE_FROZEN: "assess.grade_frozen",
  GRADE_PUBLISHED: "assess.grade_published",
  STALE_GRADE: "assess.stale_grade",
  STALE_ASSESSMENT: "assess.stale_assessment",
  PERIOD_LOCKED: "assess.period_locked",
  UNKNOWN_ENROLLMENT: "assess.unknown_enrollment",
  INVALID_ENTRY: "assess.invalid_entry",
  IDEMPOTENCY_CONFLICT: "assess.idempotency_conflict",
  REVISION_NOT_APPLICABLE: "assess.revision_not_applicable",
  REVISION_NOT_APPROVED: "assess.revision_not_approved",
  REVISION_TRANSITION: "assess.revision_transition",
  REVISION_NOOP: "assess.revision_noop",
  REVISION_PENDING: "assess.revision_pending",
  GRADE_EXISTS: "assess.grade_exists",
  PUBLISHED_IMMUTABLE: "assess.published_immutable",
  SESSION2_NOT_ALLOWED: "assess.session2_not_allowed",
  INVALID_REFERENCE: "assess.invalid_reference",
  PORT_UNAVAILABLE: "assess.port_unavailable",
  LOCK_NOT_FOUND: "assess.lock_not_found",
  LOCK_CANNOT_WIDEN: "assess.lock_cannot_widen",
  FORBIDDEN: "assess.forbidden",
  NOT_VISIBLE: "assess.not_visible",
} as const;

export type AssessCodeValue = (typeof AssessCode)[keyof typeof AssessCode];

export const validation = (code: AssessCodeValue, message: string, field?: string, details?: Record<string, unknown>): ValidationError =>
  new ValidationError(message, field ? [{ path: [field], message, code }] : [], { code, ...(details ? { details } : {}) });

export const notFound = (code: AssessCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const conflict = (code: AssessCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const forbidden = (code: AssessCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Messages français des codes levés par les déclencheurs SQL (`assess.<code>: …`). */
export const DB_CODE_MESSAGES: Readonly<Record<string, { code: AssessCodeValue; kind: "conflict" | "validation"; message: string }>> = Object.freeze({
  "assess.invalid_transition": { code: AssessCode.INVALID_TRANSITION, kind: "conflict", message: "Cette transition du circuit de validation n'est pas permise." },
  "assess.four_eyes": { code: AssessCode.FOUR_EYES, kind: "conflict", message: "La personne qui soumet la feuille ne peut pas la relire, l'approuver ni la publier." },
  "assess.four_eyes_waiver_required": { code: AssessCode.FOUR_EYES, kind: "conflict", message: "La dérogation à la séparation des tâches doit être inscrite." },
  "assess.empty_assessment": { code: AssessCode.EMPTY_ASSESSMENT, kind: "conflict", message: "Une évaluation sans aucune note ne peut pas être soumise." },
  "assess.assessment_frozen": { code: AssessCode.ASSESSMENT_FROZEN, kind: "conflict", message: "L'évaluation est figée : barème, poids, nœud, période et session ne changent plus après la soumission." },
  "assess.scale_conflict": { code: AssessCode.SCALE_CONFLICT, kind: "conflict", message: "Des notes saisies dépassent le nouveau barème." },
  "assess.score_out_of_scale": { code: AssessCode.SCORE_OUT_OF_SCALE, kind: "validation", message: "La note dépasse le barème de l'évaluation." },
  "assess.score_precision": { code: AssessCode.SCORE_PRECISION, kind: "validation", message: "La note comporte trop de décimales." },
  "assess.grade_frozen": { code: AssessCode.GRADE_FROZEN, kind: "conflict", message: "Les notes de cette feuille sont figées : retournez-la en brouillon ou passez par une révision." },
  "assess.grade_published": { code: AssessCode.GRADE_PUBLISHED, kind: "conflict", message: "Une note publiée ne se modifie que par une révision approuvée." },
  "assess.period_locked": { code: AssessCode.PERIOD_LOCKED, kind: "conflict", message: "La période de cette classe est verrouillée pour cette session." },
  "assess.published_immutable": { code: AssessCode.PUBLISHED_IMMUTABLE, kind: "conflict", message: "Une évaluation publiée ne s'annule que par un lot de révisions approuvé." },
  "assess.revision_not_applicable": { code: AssessCode.REVISION_NOT_APPLICABLE, kind: "conflict", message: "Seule une feuille publiée se corrige par révision." },
  "assess.revision_not_approved": { code: AssessCode.REVISION_NOT_APPROVED, kind: "conflict", message: "Seule une révision approuvée peut être appliquée." },
  "assess.revision_transition": { code: AssessCode.REVISION_TRANSITION, kind: "conflict", message: "Cette décision n'est pas permise dans l'état actuel de la révision." },
  "assess.revision_noop": { code: AssessCode.REVISION_NOOP, kind: "validation", message: "La nouvelle valeur est identique à la valeur publiée." },
  "assess.grade_exists": { code: AssessCode.GRADE_EXISTS, kind: "conflict", message: "Cette inscription figure déjà sur la feuille : demandez une correction." },
  "assess.grade_not_found": { code: AssessCode.GRADE_NOT_FOUND, kind: "conflict", message: "Note introuvable sur cette évaluation." },
  "assess.type_in_use": { code: AssessCode.TYPE_IN_USE, kind: "conflict", message: "Le groupe d'agrégation d'un type déjà utilisé ne change plus." },
  "assess.lock_cannot_widen": { code: AssessCode.LOCK_CANNOT_WIDEN, kind: "conflict", message: "Un verrou actif ne peut qu'être réduit." },
});

/** Extrait le code `assess.xxx` d'un message d'erreur Postgres levé par un déclencheur, sinon `null`. */
export function dbCodeOf(message: string | undefined): string | null {
  const m = /(assess\.[a-z0-9_]+):/.exec(message ?? "");
  return m ? (m[1] as string) : null;
}
