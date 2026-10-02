/**
 * Codes d'erreur stables `schoollife.*` et traduction des refus de la BASE en erreurs applicatives.
 *
 * La base est la dernière ligne de défense (déclencheurs : acteur humain, machines à états, séparation des tâches,
 * confidentialité jamais abaissée, exclusions sans chevauchement…). Elle lève `schoollife.<code>: message` ; la couche
 * application les convertit en `AppError` (aucun 500 pour une violation prévisible, spec §8).
 * Domaine pur : aucun import d'infrastructure (les violations arrivent sous forme d'objets `{ code, message, constraint }`).
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type AppError } from "@ecoledigitale/kernel";

export const SchoolLifeCode = {
  PORT_UNAVAILABLE: "schoollife.port_unavailable",
  HUMAN_ACTOR_REQUIRED: "schoollife.human_actor_required",
  FOUR_EYES_REQUIRED: "schoollife.four_eyes_required",
  FORBIDDEN: "schoollife.forbidden",
  SCOPE_FORBIDDEN: "schoollife.scope_forbidden",
  PERMISSION_REQUIRED: "schoollife.permission_required",
  APPROVER_PERMISSION_REQUIRED: "schoollife.approver_permission_required",
  CONFIDENTIAL_FORBIDDEN: "schoollife.confidential_forbidden",
  PURPOSE_REQUIRED: "schoollife.purpose_required",
  NOT_FOUND: "schoollife.not_found",
  ENROLLMENT_NOT_FOUND: "schoollife.enrollment_not_found",
  ENROLLMENT_INACTIVE: "schoollife.enrollment_inactive",
  TYPE_NOT_FOUND: "schoollife.type_not_found",
  TYPE_INACTIVE: "schoollife.type_inactive",
  SCALE_NOT_FOUND: "schoollife.scale_not_found",
  EXCLUSION_OVERLAP: "schoollife.exclusion_overlap",
  SCALE_OVERLAP: "schoollife.scale_overlap",
  DUPLICATE: "schoollife.duplicate",
  INVALID_REFERENCE: "schoollife.invalid_reference",
  INVALID_INPUT: "schoollife.invalid_input",
  INVALID_STATE: "schoollife.invalid_state",
  NO_GUARDIANS: "schoollife.no_guardians",
  NOT_A_GUARDIAN: "schoollife.not_a_guardian",
  NOTIFICATION_FAILED: "schoollife.notification_failed",
  STUDENT_STATUS_FAILED: "schoollife.student_status_failed",
} as const;

export const forbidden = (code: string, message: string): AppError => new ForbiddenError(message, { code });
export const notFound = (code: string, resource: string, id?: string): AppError => NotFoundError.of(resource, id, { code });
export const conflict = (code: string, message: string, details?: Record<string, unknown>): AppError => new ConflictError(message, { code, ...(details ? { details } : {}) });
export const invalid = (code: string, message: string, field?: string): AppError =>
  new ValidationError(message, field ? [{ path: [field], message, code }] : [], { code });

export const portUnavailable = (port: string): AppError =>
  conflict(SchoolLifeCode.PORT_UNAVAILABLE, `Le service « ${port} » n'est pas branché : l'opération est refusée par prudence.`, { port });

export const humanRequired = (): AppError =>
  forbidden(SchoolLifeCode.HUMAN_ACTOR_REQUIRED, "Cet acte exige un utilisateur identifié : un traitement automatique ne peut pas décider ni valider.");

/** Violation levée par la base : SQLSTATE + message `schoollife.<code>: …` + éventuelle contrainte. */
export interface DbViolation {
  readonly sqlstate: string | undefined;
  readonly message: string;
  readonly constraint?: string | undefined;
}

const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  human_actor_required: "Cet acte exige un utilisateur identifié (ni un job ni le système).",
  four_eyes_required: "La validation doit venir d'une autre personne que le proposant (séparation des tâches).",
  proposer_mismatch: "Le proposant est l'utilisateur connecté.",
  reporter_mismatch: "Le déclarant est l'utilisateur connecté.",
  author_mismatch: "L'auteur est l'utilisateur connecté.",
  convener_mismatch: "Le convocateur est l'utilisateur connecté.",
  filer_mismatch: "Le déposant est l'utilisateur connecté.",
  decider_mismatch: "L'issue du recours est celle de l'utilisateur connecté.",
  reader_mismatch: "Le lecteur journalisé est l'utilisateur connecté.",
  dates_required: "Ce type de mesure exige des dates de début et de fin.",
  validation_required: "Ce type de mesure se propose, puis se valide.",
  initial_status: "Statut initial interdit pour cet enregistrement.",
  type_kind: "Le type choisi n'est pas de la bonne famille ou n'est plus actif.",
  type_kind_locked: "La famille d'un type déjà utilisé ne change plus : créez un autre type et désactivez celui-ci.",
  confidentiality_floor: "La confidentialité ne peut pas être inférieure à celle du type.",
  confidentiality_lowered: "La confidentialité ne s'abaisse jamais.",
  not_involved: "L'élève n'est pas désigné comme auteur de l'incident.",
  not_appealable: "La mesure n'est pas susceptible de recours dans son état actuel.",
  visibility_widened: "Une mesure cachée aux familles ne leur est pas rendue visible.",
  visibility_forbidden: "Ce type d'événement n'est pas partageable avec les familles.",
  acknowledger: "L'accusé de réception doit venir d'un tuteur convoqué.",
  scale_empty: "Un barème actif contient au moins une valeur.",
  scale_not_active: "Le barème n'est pas actif.",
  conduct_disabled: "Les points de conduite ne sont pas activés pour cet établissement.",
  source_invalid: "La source du mouvement n'est pas valide (mesure validée ou note active de cette inscription exigée).",
  delta_not_in_scale: "Les points doivent être ceux du barème pour ce type d'événement.",
  reversal_mismatch: "Un mouvement inverse annule exactement un mouvement du même barème et du même élève.",
  human_application_required: "Cet effet attend l'acte d'un humain habilité.",
  closed: "L'incident est clos ou écarté.",
  description_frozen: "La description ne change plus après l'ouverture de l'instruction.",
  measure_frozen: "Le contenu de la mesure ne change plus à cette étape.",
  measure_final: "La mesure est dans un état final.",
  measure_identity_immutable: "L'identité de la mesure ne change pas.",
  incident_identity_immutable: "L'identité de l'incident ne change pas.",
  note_immutable: "Une note ne change pas : retirez-la avec un motif et écrivez-en une autre.",
  note_withdrawn: "La note est retirée.",
  appeal_final: "Le recours est déjà tranché.",
  convocation_frozen: "Destinataires et motif ne changent plus après l'envoi.",
  convocation_final: "La convocation est dans un état final.",
  scale_frozen: "Un barème actif ou retiré ne change plus : créez-en un nouveau.",
  immutable: "Cet enregistrement est immuable (jamais supprimé ni modifié).",
});

const kindOf = (code: string): "forbidden" | "conflict" | "validation" | "not_found" => {
  if (/(_mismatch$|^human_actor_required$|^four_eyes_required$)/.test(code) && code !== "reversal_mismatch") return "forbidden";
  if (/(^immutable$|_transition$|_frozen$|_final$|_locked$|^closed$|^description_frozen$|_immutable$|_withdrawn$|_lowered$|_widened$)/.test(code)) return "conflict";
  if (code === "scale_not_found" || code === "no_data_found") return "not_found";
  return "validation";
};

/**
 * Traduit une violation de la base ; `null` si elle ne relève pas du module (l'appelant relance l'erreur d'origine).
 * Sans code `schoollife.*`, on classe par SQLSTATE : exclusion (23P01) = chevauchement, unicité (23505), clé étrangère (23503),
 * contrainte CHECK (23514).
 */
export function translateViolation(v: DbViolation): AppError | null {
  const m = /^schoollife\.([a-z_]+)/.exec(v.message);
  if (m) {
    const code = m[1] as string;
    const text = MESSAGES[code] ?? v.message.replace(/^schoollife\.[a-z_]+:\s*/, "");
    const full = `schoollife.${code}`;
    switch (kindOf(code)) {
      case "forbidden":
        return forbidden(full, text);
      case "conflict":
        return conflict(full, text);
      case "not_found":
        return new NotFoundError(text, { code: full });
      default:
        return invalid(full, text);
    }
  }
  switch (v.sqlstate) {
    case "23P01":
      return conflict(
        /scales|conduct_scales/.test(v.constraint ?? "") || /conduct_scales/.test(v.message) ? SchoolLifeCode.SCALE_OVERLAP : SchoolLifeCode.EXCLUSION_OVERLAP,
        /conduct_scales/.test(v.constraint ?? v.message)
          ? "Un autre barème actif couvre déjà ce niveau sur cette période d'effet."
          : "Une exclusion temporaire en vigueur de cet élève couvre déjà une partie de ces dates.",
      );
    case "23505":
      return conflict(SchoolLifeCode.DUPLICATE, "Cet enregistrement existe déjà.");
    case "23503":
      return invalid(SchoolLifeCode.INVALID_REFERENCE, "Référence inconnue (type, gravité ou enregistrement lié).");
    case "23514":
      return invalid(SchoolLifeCode.INVALID_INPUT, `Valeur refusée par une règle de la base${v.constraint ? ` (${v.constraint})` : ""}.`);
    case "42501":
      return /row-level security|row level security/i.test(v.message) ? null : forbidden(SchoolLifeCode.HUMAN_ACTOR_REQUIRED, "Opération refusée : droits insuffisants sur la base.");
    default:
      return null;
  }
}
