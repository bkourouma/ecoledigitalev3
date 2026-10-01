/**
 * Gouvernance : machine d'états `draft → simulated → proposed → approved → published → retired` (décision D5).
 *
 * Les statuts et transitions sont EXACTEMENT ceux de `canTransition` du moteur (R-RUL-01) ; ce module n'en ajoute
 * pas. Il traduit seulement le refus du moteur en erreur stable `rules.transition_forbidden` (409) et ajoute les
 * exigences d'enveloppe : commentaire obligatoire (AC3.5), confirmation d'impact sur les décisions (AC2.5).
 */
import { ok, err, type AppError, type Result } from "@ecoledigitale/kernel";
import { canTransition, nextStatuses, type RuleScope, type RuleStatus, type RuleType } from "../engine";
import { RulesCode, conflict, forbidden, validation } from "./errors";
import type { GovernanceActor, Origin } from "./types";

export type EngineActor = "tenant_admin" | "super_admin";

/** `system` (chargement des données de départ) agit avec les droits du super-administrateur. */
export function engineActorOf(actor: GovernanceActor): EngineActor {
  return actor.kind === "tenant_admin" ? "tenant_admin" : "super_admin";
}

export function scopeOf(origin: Origin, tenantId: string | null): RuleScope {
  return origin === "national" ? { kind: "national" } : { kind: "tenant", tenantId: tenantId ?? "" };
}

/** Transitions atteignables depuis un statut, pour cet acteur et cette portée (affichage des boutons). */
export function allowedTransitions(from: RuleStatus, origin: Origin, tenantId: string | null, actor: GovernanceActor): RuleStatus[] {
  return nextStatuses(from).filter((to) => canTransition({ from, to, scope: scopeOf(origin, tenantId), actor: engineActorOf(actor) }).ok);
}

/**
 * Commentaire obligatoire (AC3.5) : approbation, REJET (`proposed → draft` par le super-administrateur) et retrait.
 * Le retrait par l'auteur (`proposed → draft` par un administrateur d'établissement) n'en exige pas.
 */
export function commentRequired(from: RuleStatus, to: RuleStatus, actor: GovernanceActor): boolean {
  if (to === "approved" || to === "retired") return true;
  return from === "proposed" && to === "draft" && engineActorOf(actor) === "super_admin";
}

export interface TransitionPlan {
  readonly from: RuleStatus;
  readonly to: RuleStatus;
  readonly comment: string | null;
}

/** Valide la transition demandée (machine d'états du moteur + commentaire). */
export function planTransition(input: {
  from: RuleStatus;
  to: RuleStatus;
  origin: Origin;
  tenantId: string | null;
  actor: GovernanceActor;
  comment?: string | undefined;
}): Result<TransitionPlan, AppError> {
  const decision = canTransition({ from: input.from, to: input.to, scope: scopeOf(input.origin, input.tenantId), actor: engineActorOf(input.actor) });
  if (!decision.ok) {
    const details = { from: input.from, to: input.to, actor: input.actor.kind, origin: input.origin };
    // Transition légale pour un super-administrateur : c'est l'ACTEUR qui est refusé (403, AC3.2) ; sinon la
    // transition n'existe pas depuis ce statut (409, AC3.1).
    const legalForSuperAdmin = canTransition({ from: input.from, to: input.to, scope: scopeOf("tenant", input.tenantId ?? "-"), actor: "super_admin" }).ok;
    return err(legalForSuperAdmin ? forbidden(RulesCode.TRANSITION_FORBIDDEN, decision.reason, details) : conflict(RulesCode.TRANSITION_FORBIDDEN, decision.reason, details));
  }
  const comment = input.comment?.trim() || null;
  if (commentRequired(input.from, input.to, input.actor) && !comment) {
    return err(validation(RulesCode.COMMENT_REQUIRED, `Un commentaire est obligatoire pour passer de « ${input.from} » à « ${input.to} ».`, "comment"));
  }
  return ok({ from: input.from, to: input.to, comment });
}

/* ------------------------- impact sur les décisions ------------------------- */

/** Types de règle dont la sortie est une DÉCISION (passage, validation, redoublement…) : AC2.5. */
export const DECISION_RULE_TYPES: readonly RuleType[] = Object.freeze(["promotion", "repetition", "orientation", "credit_validation"]);

export const isDecisionRule = (type: RuleType): boolean => DECISION_RULE_TYPES.includes(type);

/** La proposition exige-t-elle une confirmation explicite ? (`percent` et `threshold` en %, décimaux.) */
export function requiresDecisionConfirmation(changedPercent: number, thresholdPercent: number): boolean {
  return changedPercent > thresholdPercent;
}
