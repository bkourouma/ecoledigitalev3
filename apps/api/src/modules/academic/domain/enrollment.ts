/**
 * Inscriptions et sélections de cours : machines d'états (miroir de `enrollments_guard` et
 * `enrollment_courses_guard`), financement, politique de confirmation, ensembles « ouvre la scolarité ».
 * Pur : aucune E/S. Aucun seuil, aucune règle réglementaire.
 */
import type {
  AcademicConfirmationPolicy,
  AcademicCourseConfirmationPolicy,
  AcademicCourseSource,
  AcademicCourseStatus,
  AcademicEnrollmentStatus,
} from "@ecoledigitale/contracts/src/v2/academic";
import type { AppError } from "@ecoledigitale/kernel";
import { AcademicCode, validation } from "./errors";
import type { FundingType } from "./records";

// ---------------------------------------------------------------------------
// Inscription
//   PENDING   -> ACTIVE | CANCELLED | WITHDRAWN
//   ACTIVE    -> SUSPENDED | COMPLETED | WITHDRAWN | TRANSFERRED_OUT | CANCELLED
//   SUSPENDED -> ACTIVE | WITHDRAWN | TRANSFERRED_OUT
//   COMPLETED -> ACTIVE            (réouverture exceptionnelle, auditée)
//   WITHDRAWN / TRANSFERRED_OUT / CANCELLED : terminaux
// ---------------------------------------------------------------------------

export const ENROLLMENT_TRANSITIONS: Readonly<Record<AcademicEnrollmentStatus, readonly AcademicEnrollmentStatus[]>> = Object.freeze({
  PENDING: ["ACTIVE", "CANCELLED", "WITHDRAWN"],
  ACTIVE: ["SUSPENDED", "COMPLETED", "WITHDRAWN", "TRANSFERRED_OUT", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "WITHDRAWN", "TRANSFERRED_OUT"],
  COMPLETED: ["ACTIVE"],
  WITHDRAWN: [],
  TRANSFERRED_OUT: [],
  CANCELLED: [],
});

export function canTransitionEnrollment(from: AcademicEnrollmentStatus, to: AcademicEnrollmentStatus): boolean {
  return ENROLLMENT_TRANSITIONS[from].includes(to);
}

/** Statuts qui terminent l'inscription (date de fin obligatoire, CHECK de la base). */
export const ENDED_ENROLLMENT_STATUSES: readonly AcademicEnrollmentStatus[] = Object.freeze(["WITHDRAWN", "TRANSFERRED_OUT", "CANCELLED"]);
/** Statuts vivants (une inscription vivante par classe) — index `enrollments_one_live_per_class`. */
export const LIVE_ENROLLMENT_STATUSES: readonly AcademicEnrollmentStatus[] = Object.freeze(["PENDING", "ACTIVE", "SUSPENDED", "COMPLETED"]);
/** Statuts qui occupent une place de classe (capacité) : la classe terminée libère sa place. */
export const SEAT_ENROLLMENT_STATUSES: readonly AcademicEnrollmentStatus[] = Object.freeze(["PENDING", "ACTIVE", "SUSPENDED"]);
/**
 * G-04 / R25 : seules ces inscriptions ouvrent présences, notes, bulletins. Ensemble défini UNE fois ici et
 * exposé par `getRoster` / `listNodesForEnrollment` (jamais redéfini en littéral dans une requête ailleurs).
 */
export const SCHOOLING_ENROLLMENT_STATUSES: readonly AcademicEnrollmentStatus[] = Object.freeze(["ACTIVE", "COMPLETED"]);
export const SCHOOLING_COURSE_STATUSES: readonly AcademicCourseStatus[] = Object.freeze(["CONFIRMED", "COMPLETED"]);

export function opensSchooling(status: AcademicEnrollmentStatus): boolean {
  return SCHOOLING_ENROLLMENT_STATUSES.includes(status);
}

/** Action d'état -> statut cible (routes `/enrollments/:id/{confirm,suspend,…}`). */
export const ENROLLMENT_ACTION_TARGETS = Object.freeze({
  confirm: "ACTIVE",
  resume: "ACTIVE",
  reopen: "ACTIVE",
  suspend: "SUSPENDED",
  complete: "COMPLETED",
  withdraw: "WITHDRAWN",
  cancel: "CANCELLED",
} as const satisfies Record<string, AcademicEnrollmentStatus>);
export type EnrollmentAction = keyof typeof ENROLLMENT_ACTION_TARGETS;

/** Actions qui exigent un motif (retrait, annulation, suspension, réouverture). */
export const ENROLLMENT_ACTIONS_REQUIRING_REASON: readonly EnrollmentAction[] = Object.freeze(["suspend", "withdraw", "cancel", "reopen"]);

/** Source de l'action pour valider l'action contre l'état courant. `confirm` n'est valable que depuis PENDING. */
export function validateEnrollmentAction(action: EnrollmentAction, from: AcademicEnrollmentStatus): "ok" | "illegal" {
  if (action === "confirm") return from === "PENDING" ? "ok" : "illegal";
  if (action === "resume") return from === "SUSPENDED" ? "ok" : "illegal";
  if (action === "reopen") return from === "COMPLETED" ? "ok" : "illegal";
  return canTransitionEnrollment(from, ENROLLMENT_ACTION_TARGETS[action]) ? "ok" : "illegal";
}

// ---------------------------------------------------------------------------
// Financement (PRD §20) : le type est une donnée du pack ; l'exigence de référence en est une aussi
// ---------------------------------------------------------------------------

export interface FundingInput {
  fundingType: string;
  assignmentReference: string | null;
  funderLabel: string | null;
}

export function validateFunding(def: FundingType | undefined, input: FundingInput): AppError | null {
  if (!def || !def.active) return validation(AcademicCode.FUNDING_TYPE_UNKNOWN, `Type de financement inconnu ou inactif : « ${input.fundingType} ».`, "fundingType");
  if (input.fundingType === "PRIVATE" && input.assignmentReference?.trim()) {
    return validation(AcademicCode.FUNDING_REFERENCE_FORBIDDEN, "Un financement privé ne porte pas de référence d'affectation.", "assignmentReference");
  }
  if (def.requiresReference && !input.assignmentReference?.trim()) {
    return validation(AcademicCode.FUNDING_REFERENCE_REQUIRED, `Le financement « ${def.label} » exige une référence d'affectation.`, "assignmentReference");
  }
  if (def.requiresFunder && !input.funderLabel?.trim()) {
    return validation(AcademicCode.FUNDING_FUNDER_REQUIRED, `Le financement « ${def.label} » exige l'identification du financeur.`, "funderLabel");
  }
  return null;
}

export function normalizeFunding(input: FundingInput): { assignmentReference: string | null; funderLabel: string | null } {
  return { assignmentReference: input.assignmentReference?.trim() || null, funderLabel: input.funderLabel?.trim() || null };
}

// ---------------------------------------------------------------------------
// Politique de confirmation à deux niveaux (AC5.5, décision métier validée)
// ---------------------------------------------------------------------------

/**
 * Statut initial d'une inscription : `AUTO` -> ACTIVE à la création ; les politiques liées au paiement -> PENDING,
 * sauf si finance signale qu'AUCUN frais d'inscription n'est dû (équivalent de la correction 0127 du legacy).
 * `MANUAL` -> PENDING (confirmée par un utilisateur habilité).
 */
export function initialEnrollmentStatus(policy: AcademicConfirmationPolicy, registrationFeeDue: boolean | null): "PENDING" | "ACTIVE" {
  if (policy === "AUTO") return "ACTIVE";
  if (policy === "ON_REGISTRATION_FEE_PAID" && registrationFeeDue === false) return "ACTIVE";
  return "PENDING";
}

// ---------------------------------------------------------------------------
// O-01 : confirmation par le paiement OU confirmation manuelle (dérogation motivée)
// ---------------------------------------------------------------------------

/** Comment une inscription a été confirmée (colonne `confirmation_mode`). */
export type EnrollmentConfirmationMode = "AUTO" | "PAYMENT" | "MANUAL" | "OVERRIDE";

/** Politiques de confirmation que le PAIEMENT déclenche : les confirmer à la main est une dérogation. */
export const PAYMENT_LINKED_CONFIRMATION_POLICIES: readonly AcademicConfirmationPolicy[] = Object.freeze(["ON_REGISTRATION_FEE_PAID", "ON_FULL_PAYMENT"]);

/** Longueur minimale du motif d'une dérogation (même seuil que les autres actions motivées de l'inscription). */
export const OVERRIDE_REASON_MIN_LENGTH = 5;

/**
 * Mode d'une confirmation faite à la main : `OVERRIDE` quand la politique attend normalement un paiement (dérogation :
 * permission dédiée et motif obligatoires), `MANUAL` sinon (politique `MANUAL`, confirmation ordinaire d'une personne habilitée).
 */
export function manualConfirmationMode(policy: AcademicConfirmationPolicy): "MANUAL" | "OVERRIDE" {
  return PAYMENT_LINKED_CONFIRMATION_POLICIES.includes(policy) ? "OVERRIDE" : "MANUAL";
}

export interface PaidInvoiceFacts {
  /** L'inscription visée par la facture (jamais « toutes celles de l'étudiant » : bug legacy P-081/P-089). */
  enrollmentId: string | null;
  containsRegistrationFee: boolean | null;
}

/**
 * Une facture soldée confirme-t-elle l'inscription visée ?
 *  - ON_REGISTRATION_FEE_PAID : la facture soldée contient les frais d'inscription ;
 *  - ON_FULL_PAYMENT          : toute facture d'inscription intégralement soldée (finance publie `invoice.paid`
 *                                uniquement quand la facture est soldée) ;
 *  - AUTO / MANUAL            : jamais par événement.
 */
export function invoicePaidConfirmsEnrollment(policy: AcademicConfirmationPolicy, facts: PaidInvoiceFacts, enrollmentStatus: AcademicEnrollmentStatus): boolean {
  if (enrollmentStatus !== "PENDING" || facts.enrollmentId === null) return false;
  if (policy === "ON_FULL_PAYMENT") return true;
  if (policy === "ON_REGISTRATION_FEE_PAID") return facts.containsRegistrationFee === true;
  return false;
}

// ---------------------------------------------------------------------------
// Sélection de cours : PENDING -> CONFIRMED | CANCELLED ; CONFIRMED -> COMPLETED | CANCELLED ; COMPLETED terminal
// ---------------------------------------------------------------------------

export const COURSE_TRANSITIONS: Readonly<Record<AcademicCourseStatus, readonly AcademicCourseStatus[]>> = Object.freeze({
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
});

export function canTransitionCourse(from: AcademicCourseStatus, to: AcademicCourseStatus): boolean {
  return COURSE_TRANSITIONS[from].includes(to);
}

/**
 * Politique de confirmation EFFECTIVE d'une sélection selon sa source : une option de classe ou une reprise de
 * dette n'a pas de ligne de facture propre -> confirmée avec l'inscription (`AUTO`) ; une inscription à la carte
 * ou de rattrapage suit la politique de l'établissement.
 */
export function courseConfirmationPolicyFor(source: AcademicCourseSource, policy: AcademicCourseConfirmationPolicy): AcademicCourseConfirmationPolicy {
  return source === "OPTION" || source === "CARRY_OVER" ? "AUTO" : policy;
}

/**
 * Statut initial d'une sélection : `AUTO` la confirme tout de suite si l'inscription est ACTIVE (la base impose
 * « sélection confirmée => inscription active ») ; sinon elle attend (PENDING).
 */
export function initialCourseStatus(policy: AcademicCourseConfirmationPolicy, enrollmentStatus: AcademicEnrollmentStatus): "PENDING" | "CONFIRMED" {
  return policy === "AUTO" && (enrollmentStatus === "ACTIVE" || enrollmentStatus === "COMPLETED") ? "CONFIRMED" : "PENDING";
}

export type CoursePaymentDecision = "confirm" | "remember_payment" | "reinstate_or_orphan" | "ignore";

/**
 * Effet de « la ligne de facture de cette sélection est soldée » (`ON_LINE_PAID`) :
 *  - sélection PENDING et inscription active -> confirmer ;
 *  - sélection PENDING et inscription pas encore confirmée -> mémoriser le paiement (confirmation dès que
 *    l'inscription l'est : aucun encaissement perdu) ;
 *  - sélection CANCELLED (réservation expirée entre deux écrans) -> rétablir si la place existe, sinon signaler
 *    `payment_orphan` (remboursement ou réaffectation décidés par finance) ;
 *  - déjà confirmée/terminée -> rien.
 */
export function decideCourseOnLinePaid(
  policy: AcademicCourseConfirmationPolicy,
  courseStatus: AcademicCourseStatus,
  enrollmentStatus: AcademicEnrollmentStatus,
): CoursePaymentDecision {
  if (policy === "MANUAL") return "ignore";
  if (courseStatus === "CANCELLED") return "reinstate_or_orphan";
  if (courseStatus !== "PENDING") return "ignore";
  if (policy === "AUTO") return "ignore";
  return enrollmentStatus === "ACTIVE" || enrollmentStatus === "COMPLETED" ? "confirm" : "remember_payment";
}

// ---------------------------------------------------------------------------
// Historique (append-only) : forme des entrées
// ---------------------------------------------------------------------------

export type HistoryKind = "CREATED" | "STATUS" | "FUNDING" | "PLACEMENT" | "COURSE" | "OUTCOME" | "NOTE";

export interface HistoryDraft {
  kind: HistoryKind;
  from: unknown;
  to: unknown;
  reason: string | null;
}

export const statusHistory = (from: AcademicEnrollmentStatus | null, to: AcademicEnrollmentStatus, reason: string | null): HistoryDraft => ({
  kind: from === null ? "CREATED" : "STATUS",
  from: from === null ? null : { status: from },
  to: { status: to },
  reason,
});

/** Statuts de l'étudiant (module people) pour lesquels une inscription vivante est retirée automatiquement. */
export const STUDENT_STATUSES_THAT_WITHDRAW: readonly string[] = Object.freeze(["WITHDRAWN", "EXCLUDED", "TRANSFERRED_OUT"]);
/** Statuts d'un apprenant que l'on peut inscrire (par défaut ; surchargeable au câblage). */
export const DEFAULT_ENROLLABLE_STUDENT_STATUSES: readonly string[] = Object.freeze(["ACTIVE"]);

/** Inscription issue d une admission : le dossier de l élève est INACTIF jusqu à la confirmation (paiement des frais d inscription, spec 007). */
export const DEFAULT_ADMISSION_ENROLLABLE_STUDENT_STATUSES: readonly string[] = Object.freeze(["ACTIVE", "INACTIVE"]);
