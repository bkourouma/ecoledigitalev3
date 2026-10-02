/**
 * Effets d'une décision ou d'une proposition acceptée (spec 006 AC6.1-AC6.3) — planification PURE.
 *
 *  - une décision de famille PASSAGE ou REPEAT dont le type porte `results_decision_kind` / `results_final_code` produit
 *    `RESULTS_DECISION` ; si le type porte une issue d'inscription : `ENROLLMENT_OUTCOME` ;
 *  - ORIENTATION / REORIENTATION : `ORIENTATION_FILE` (et `SERIES_TRANSFER` pour une réorientation qui vise une série) ;
 *  - EXCLUSION : `STUDENT_STATUS_REQUEST`, TOUJOURS `AWAITING_HUMAN` (jamais appliqué par un job) ;
 *  - toute décision : `NOTIFY_GUARDIANS` (information neutre des tuteurs ; jamais en attente d'un humain) ;
 *  - une proposition ACCEPTÉE d'appréciation / de distinction : `RESULTS_APPRECIATION` / `RESULTS_DISTINCTION`.
 * Un effet est unique par (décision ou proposition, nature) tant qu'il est vivant (index unique).
 */
export type EffectKind = "RESULTS_DECISION" | "ENROLLMENT_OUTCOME" | "ORIENTATION_FILE" | "SERIES_TRANSFER" | "STUDENT_STATUS_REQUEST" | "NOTIFY_GUARDIANS" | "RESULTS_APPRECIATION" | "RESULTS_DISTINCTION";

export interface DecisionTypeEffectFacts {
  readonly family: string;
  readonly resultsDecisionKind: string | null;
  readonly resultsFinalCode: string | null;
  readonly academicOutcomeCode: string | null;
  readonly needsHumanApplication: boolean;
  readonly hasTarget: boolean;
}

export function effectKindsOfDecision(t: DecisionTypeEffectFacts): EffectKind[] {
  const kinds: EffectKind[] = [];
  if ((t.family === "PASSAGE" || t.family === "REPEAT") && t.resultsDecisionKind !== null && t.resultsFinalCode !== null) kinds.push("RESULTS_DECISION");
  if (t.academicOutcomeCode !== null) kinds.push("ENROLLMENT_OUTCOME");
  if (t.family === "ORIENTATION" || t.family === "REORIENTATION") kinds.push("ORIENTATION_FILE");
  if (t.family === "REORIENTATION" && t.hasTarget) kinds.push("SERIES_TRANSFER");
  if (t.family === "EXCLUSION") kinds.push("STUDENT_STATUS_REQUEST");
  kinds.push("NOTIFY_GUARDIANS");
  return kinds;
}

export const effectKindOfProposal = (proposalKind: string): EffectKind | null => (proposalKind === "APPRECIATION" ? "RESULTS_APPRECIATION" : proposalKind === "DISTINCTION" ? "RESULTS_DISTINCTION" : null);

/**
 * Statut initial : l'exclusion (famille `EXCLUSION`, `needs_human_application`) attend l'acte d'un humain, SAUF la notification des
 * tuteurs. Miroir de `councils.effect_needs_human` : la base refuse un autre statut.
 */
export const initialEffectStatus = (kind: EffectKind, needsHumanApplication: boolean): "PENDING" | "AWAITING_HUMAN" => (kind !== "NOTIFY_GUARDIANS" && needsHumanApplication ? "AWAITING_HUMAN" : "PENDING");

/** Effets qui ne s'appliquent QUE par l'acte d'un humain (jamais par un job). */
export const requiresHumanActor = (kind: EffectKind, status: string): boolean => kind === "STUDENT_STATUS_REQUEST" || status === "AWAITING_HUMAN";

/** Effets dont l'annulation passe par la réouverture de la période de résultats (aucune API de retrait dans `results`). */
export const REVERTED_BY_RESULTS_REOPEN: readonly EffectKind[] = Object.freeze(["RESULTS_DECISION", "RESULTS_DISTINCTION"]);
