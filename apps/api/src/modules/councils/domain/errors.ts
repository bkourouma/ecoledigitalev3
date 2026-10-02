/**
 * Codes d'erreur stables `councils.*` et traduction des refus de la BASE en erreurs applicatives.
 *
 * La base est la dernière ligne de défense (déclencheurs : acteur humain, machine à états de la séance, quorum, verrouillage,
 * décideur présent et habilité, signatures, déverrouillage motivé…). Elle lève `councils.<code>: message` ; la couche application
 * les convertit en `AppError` (aucun 500 pour une violation prévisible, spec 006 §8).
 * Domaine pur : aucun import d'infrastructure (les violations arrivent sous forme d'objets `{ sqlstate, message, constraint }`).
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type AppError } from "@ecoledigitale/kernel";

export const CouncilsCode = {
  PORT_UNAVAILABLE: "councils.port_unavailable",
  HUMAN_DECISION_REQUIRED: "councils.human_decision_required",
  FORBIDDEN: "councils.forbidden",
  PERMISSION_REQUIRED: "councils.permission_required",
  NOT_FOUND: "councils.not_found",
  CLASSROOM_NOT_FOUND: "councils.classroom_not_found",
  CLASSROOM_NOT_ACTIVE: "councils.classroom_not_active",
  ENROLLMENT_NOT_FOUND: "councils.enrollment_not_found",
  TYPE_NOT_FOUND: "councils.type_not_found",
  TYPE_INACTIVE: "councils.type_inactive",
  SCOPE_MISMATCH: "councils.scope_mismatch",
  RESULTS_NOT_READY: "councils.results_not_ready",
  RESULTS_UNAVAILABLE: "councils.results_unavailable",
  ALREADY_EXISTS: "councils.already_exists",
  INVALID_INPUT: "councils.invalid_input",
  INVALID_STATE: "councils.invalid_state",
  INVALID_REFERENCE: "councils.invalid_reference",
  DUPLICATE: "councils.duplicate",
  CODE_NOT_ALLOWED: "councils.code_not_allowed_by_contract",
  JUSTIFICATION_REQUIRED: "councils.justification_required",
  NOT_A_PARTICIPANT: "councils.not_a_participant",
  UNDECIDED_STUDENTS: "councils.undecided_students",
  QUORUM_NOT_MET: "councils.quorum_not_met",
  MINUTES_NOT_RENDERED: "councils.minutes_not_rendered",
  EFFECT_NOT_APPLICABLE: "councils.effect_not_applicable",
  EFFECT_FAILED: "councils.effect_failed",
  TEMPLATE_UNAVAILABLE: "councils.template_unavailable",
  TRANSFER_TARGET_REQUIRED: "councils.transfer_target_required",
  OUT_OF_SCOPE: "councils.out_of_scope",
} as const;

export const forbidden = (code: string, message: string): AppError => new ForbiddenError(message, { code });
export const notFound = (code: string, resource: string, id?: string): AppError => NotFoundError.of(resource, id, { code });
export const conflict = (code: string, message: string, details?: Record<string, unknown>): AppError => new ConflictError(message, { code, ...(details ? { details } : {}) });
export const invalid = (code: string, message: string, field?: string): AppError => new ValidationError(message, field ? [{ path: [field], message, code }] : [], { code });

/** Port non branché : la plateforme n'a pas câblé le module voisin ; l'opération est refusée par prudence (échec fermé). */
export const portUnavailable = (port: string): AppError =>
  conflict(CouncilsCode.PORT_UNAVAILABLE, `Le service « ${port} » n'est pas branché : l'opération est refusée par prudence.`, { port });

export const humanRequired = (): AppError =>
  forbidden(CouncilsCode.HUMAN_DECISION_REQUIRED, "Cet acte exige un utilisateur identifié : un traitement automatique ne peut ni décider, ni signer, ni ouvrir ou clore une séance.");

/** Violation levée par la base : SQLSTATE + message `councils.<code>: …` + éventuelle contrainte. */
export interface DbViolation {
  readonly sqlstate: string | undefined;
  readonly message: string;
  readonly constraint?: string | undefined;
}

const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  human_decision_required: "Cet acte exige un utilisateur identifié (ni un job, ni le système, ni le super-administrateur).",
  four_eyes_required: "L'approbation doit venir d'une autre personne que le demandeur (séparation des tâches).",
  president_required: "Un président PRÉSENT est nécessaire pour ouvrir la séance.",
  president_role: "Ce rôle ne peut pas présider la séance.",
  quorum_not_met: "Le quorum n'est pas atteint.",
  quorum_waiver_forbidden: "L'établissement n'autorise pas l'ouverture sans quorum.",
  undecided_students: "Des élèves n'ont pas encore de décision.",
  decider_not_present: "Le décideur doit être un participant présent de la séance.",
  decider_not_allowed: "Ce rôle ne peut pas porter une décision.",
  decider_has_decisions: "Ce participant est le décideur de décisions enregistrées : retirez-les d'abord.",
  vote_required: "Ce type de décision exige un vote.",
  justification_required: "Ce type de décision exige une justification (10 caractères au moins).",
  target_required: "Ce type de décision exige une série ou un niveau visé.",
  decision_scope: "Ce type de décision ne s'applique pas à ce type de séance.",
  decision_type_inactive: "Ce type de décision est désactivé.",
  decision_immutable: "Une décision enregistrée ne se modifie pas : retirez-la puis enregistrez-en une autre.",
  decision_final: "Cette décision est déjà retirée.",
  not_open: "Les décisions se prennent séance ouverte.",
  no_decision: "Aucune décision n'est enregistrée pour cet élève.",
  item_has_decisions: "Des décisions enregistrées existent pour cet élève.",
  item_mismatch: "L'élève ne correspond pas à l'ordre du jour de cette séance.",
  facts_locked_by_decision: "Des décisions reposent sur cet instantané : retirez-les avant de le reconstruire.",
  agenda_frozen: "L'ordre du jour est figé.",
  participants_frozen: "Les participants sont figés.",
  proposals_frozen: "Les propositions sont figées.",
  proposal_resolved: "La proposition est déjà traitée.",
  proposal_immutable: "Le contenu d'une proposition ne change pas : créez-en une nouvelle.",
  locked: "La séance est verrouillée.",
  scope_mismatch: "Le type de conseil ne correspond pas à la portée de la séance.",
  type_inactive: "Ce type de conseil est désactivé.",
  identity_immutable: "Établissement, année, classe, période et type de la séance sont figés.",
  immutable: "Cet enregistrement est immuable (jamais supprimé ni modifié).",
  not_closed: "Le procès-verbal se génère séance close.",
  no_signer: "Aucun signataire exigé n'est présent.",
  minutes_not_signable: "Ce procès-verbal ne peut plus être signé.",
  minutes_not_signed: "Aucun procès-verbal signé pour cette séance.",
  minutes_immutable: "Le contenu d'un procès-verbal ne change jamais.",
  minutes_final: "Ce procès-verbal est remplacé ou révoqué.",
  signature_hash_mismatch: "La signature porte sur un autre contenu que le procès-verbal.",
  not_a_signer: "Ce participant n'est pas un signataire exigé ou n'est pas présent.",
  signatures_missing: "Toutes les signatures exigées ne sont pas recueillies.",
  supersede_requires_reopen: "Un procès-verbal n'est remplacé qu'après réouverture motivée de la séance.",
  unlock_not_approved: "Le déverrouillage exige une demande motivée approuvée.",
  unlock_not_needed: "La séance n'est pas verrouillée.",
  unlock_immutable: "Demandeur, date et motif d'une demande sont figés.",
  effect_irreversible: "Des effets appliqués doivent d'abord être annulés (ou sont irréversibles).",
  effects_too_early: "Les effets ne naissent qu'à l'état configuré de la séance.",
  human_application_required: "Cet effet attend l'acte d'un humain habilité.",
  effect_transition: "Transition d'effet interdite.",
  path_mismatch: "Le parcours désigné ne correspond pas au transfert (ou est désactivé).",
  override_actor: "La dérogation de parcours est celle de l'utilisateur connecté.",
  consent_required: "Le parcours exige l'accord de la famille.",
  decision_target_mismatch: "La décision du conseil ne vise pas cette série ou ce niveau pour cette inscription.",
  not_found: "Conseil introuvable.",
  role_unknown: "Rôle de participant inconnu.",
  role_inactive: "Ce rôle de participant est désactivé.",
});

/** Codes dont le suffixe `_mismatch` n'est PAS un refus d'identité (erreur de saisie plutôt que de droit). */
const MISMATCH_AS_VALIDATION = new Set(["decision_target_mismatch", "scope_mismatch", "path_mismatch", "item_mismatch", "signature_hash_mismatch"]);

const kindOf = (code: string): "forbidden" | "conflict" | "validation" | "not_found" => {
  if (!MISMATCH_AS_VALIDATION.has(code) && /(_mismatch$|^human_decision_required$|^four_eyes_required$|^unlock_not_approved$|^override_actor$)/.test(code)) return "forbidden";
  if (/(^immutable$|_transition$|_frozen$|_final$|_locked$|^locked$|_immutable$|_resolved$|^effect_irreversible$|^decider_has_decisions$|^supersede_requires_reopen$|^not_open$|^not_closed$|^minutes_not_signable$|^item_has_decisions$)/.test(code)) return "conflict";
  if (code === "not_found") return "not_found";
  return "validation";
};

/**
 * Traduit une violation de la base ; `null` si elle ne relève pas du module (l'appelant relance l'erreur d'origine).
 * Sans code `councils.*`, on classe par SQLSTATE : unicité (23505), clé étrangère (23503), CHECK (23514).
 */
export function translateViolation(v: DbViolation): AppError | null {
  const m = /^councils\.([a-z_]+)/.exec(v.message);
  if (m) {
    const code = m[1] as string;
    const text = MESSAGES[code] ?? v.message.replace(/^councils\.[a-z_]+:\s*/, "");
    const full = `councils.${code}`;
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
    case "23505": {
      const where = v.constraint ?? v.message;
      if (/councils_one_live/.test(where)) return conflict(CouncilsCode.DUPLICATE, "Un conseil de ce type existe déjà pour cette classe et cette période.");
      if (/decisions_one_per_group/.test(where)) return conflict(CouncilsCode.DUPLICATE, "Une décision du même groupe existe déjà pour cet élève : retirez-la d'abord.");
      if (/series_transfers_one_live/.test(where)) return conflict(CouncilsCode.DUPLICATE, "Un transfert de série est déjà prévu ou appliqué pour cette inscription.");
      if (/unlock_requests_one_open/.test(where)) return conflict(CouncilsCode.DUPLICATE, "Une demande de déverrouillage est déjà ouverte pour cette séance.");
      return conflict(CouncilsCode.DUPLICATE, "Cet enregistrement existe déjà.");
    }
    case "23503":
      return invalid(CouncilsCode.INVALID_REFERENCE, "Référence inconnue (type, rôle ou enregistrement lié).");
    case "23514":
      return invalid(CouncilsCode.INVALID_INPUT, `Valeur refusée par une règle de la base${v.constraint ? ` (${v.constraint})` : ""}.`);
    case "42501":
      return /row-level security|row level security/i.test(v.message) ? null : forbidden(CouncilsCode.HUMAN_DECISION_REQUIRED, "Opération refusée : droits insuffisants sur la base.");
    default:
      return null;
  }
}
