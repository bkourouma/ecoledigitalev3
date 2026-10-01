/**
 * Circuit de validation d'une feuille de notes : machine à états PURE (miroir du déclencheur SQL).
 *
 *   DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> PUBLISHED        (PUBLISHED est terminal)
 *   SUBMITTED | REVIEWED | APPROVED -> DRAFT (retour motivé) ; DRAFT..APPROVED -> CANCELLED (annulation directe)
 *   PUBLISHED -> CANCELLED seulement par un lot de révisions approuvé (voir `revisions`).
 *
 * Séparation des tâches (Q-11) : par défaut, la personne qui SOUMET ne relit, n'approuve ni ne publie la même
 * évaluation. Si l'établissement a désactivé le réglage correspondant, la dérogation est INSCRITE sur l'évaluation
 * (`fourEyesWaived = true`) au moment où elle est exercée.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import type { AssessSettings, AssessStatus } from "./types";
import { AssessCode, conflict, validation } from "./errors";

export type TransitionTarget = "SUBMITTED" | "REVIEWED" | "APPROVED" | "PUBLISHED" | "DRAFT";

const LEGAL: Readonly<Record<AssessStatus, readonly AssessStatus[]>> = Object.freeze({
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["REVIEWED", "DRAFT", "CANCELLED"],
  REVIEWED: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["PUBLISHED", "DRAFT", "CANCELLED"],
  PUBLISHED: ["CANCELLED"],
  CANCELLED: [],
});

export function isLegalTransition(from: AssessStatus, to: AssessStatus): boolean {
  return LEGAL[from].includes(to);
}

export function nextStatuses(from: AssessStatus): readonly AssessStatus[] {
  return LEGAL[from];
}

/** Permission requise pour atteindre l'état (le retour en brouillon est ouvert à qui relit/approuve/publie). */
export const TRANSITION_PERMISSION: Readonly<Record<TransitionTarget, string>> = Object.freeze({
  SUBMITTED: "grade.enter",
  REVIEWED: "grade.review",
  APPROVED: "grade.validate",
  PUBLISHED: "grade.publish",
  DRAFT: "grade.review",
});

export interface TransitionRequest {
  readonly from: AssessStatus;
  readonly to: TransitionTarget;
  readonly actorId: string;
  readonly submittedBy: string | null;
  readonly settings: Pick<AssessSettings, "requireSeparateReviewer" | "requireSeparateApprover">;
  readonly comment?: string | undefined;
  readonly gradeCount: number;
}

export interface TransitionPlan {
  readonly to: TransitionTarget;
  /** `true` : l'acteur est le soumetteur et le réglage l'autorise — la dérogation doit être inscrite. */
  readonly fourEyesWaiver: boolean;
}

/** Valide une transition d'un acteur donné ; ne lit aucune base. */
export function planTransition(request: TransitionRequest): Result<TransitionPlan, AppError> {
  const { from, to } = request;
  if (!isLegalTransition(from, to)) {
    return err(conflict(AssessCode.INVALID_TRANSITION, `Transition interdite : ${from} → ${to}.`, { from, to }));
  }
  if (to === "DRAFT" && (request.comment?.trim().length ?? 0) < 5) {
    return err(validation(AssessCode.COMMENT_REQUIRED, "Un retour en brouillon exige un commentaire (5 caractères au moins).", "comment"));
  }
  if (to === "SUBMITTED" && request.gradeCount === 0) {
    return err(conflict(AssessCode.EMPTY_ASSESSMENT, "Une évaluation sans aucune note ne peut pas être soumise.", {}));
  }
  const sameAsSubmitter = request.submittedBy !== null && request.submittedBy === request.actorId;
  if (!sameAsSubmitter || to === "SUBMITTED" || to === "DRAFT") return ok({ to, fourEyesWaiver: false });

  const separate = to === "REVIEWED" ? request.settings.requireSeparateReviewer : request.settings.requireSeparateApprover;
  if (separate) {
    return err(conflict(AssessCode.FOUR_EYES, "La personne qui a soumis la feuille ne peut pas la relire, l'approuver ni la publier.", { to }));
  }
  return ok({ to, fourEyesWaiver: true });
}

/** Séparation des tâches pour les révisions : le demandeur n'approuve pas sa propre correction (sauf dérogation). */
export function planRevisionDecision(input: {
  requestedBy: string;
  actorId: string;
  settings: Pick<AssessSettings, "requireSeparateApprover">;
}): Result<{ fourEyesWaiver: boolean }, AppError> {
  if (input.requestedBy !== input.actorId) return ok({ fourEyesWaiver: false });
  if (input.settings.requireSeparateApprover) {
    return err(conflict(AssessCode.FOUR_EYES, "Le demandeur d'une correction ne peut pas l'approuver lui-même.", {}));
  }
  return ok({ fourEyesWaiver: true });
}
