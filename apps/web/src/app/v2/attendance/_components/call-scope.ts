"use client";

/**
 * Politique d'appel du cycle (journalier, par séance ou les deux) : de quoi MASQUER les actions d'appel que l'API refuserait
 * (409 `attendance.call_scope_not_allowed`). L'API reste la barrière : quand la politique ou le niveau de la classe est inconnu
 * (lecture refusée, classe sans niveau), tout est proposé, comme avant.
 */
import { useMemo } from "react";

import { usePermission } from "@/platform/access";
import { useCallPolicies } from "@/platform/v2/attendance";

export type CallScopeKind = "DAILY" | "SESSION";
type PolicyLike = { educationLevelCode: string; callScope: "DAILY" | "SESSION" | "BOTH" };

/** Même sélection que l'API (`selectPolicy`) : politique du niveau de la classe, sinon celle par défaut (`*`), sinon aucune. */
export function selectCallPolicy(policies: readonly PolicyLike[], levelCode: string | null | undefined) {
  return (levelCode ? policies.find((p) => p.educationLevelCode === levelCode) : undefined) ?? policies.find((p) => p.educationLevelCode === "*") ?? null;
}

/** Le type d'appel est-il permis pour ce niveau ? Sans politique connue : oui (l'API tranche). */
export function callScopeAllowed(policies: readonly PolicyLike[] | undefined, levelCode: string | null | undefined, scope: CallScopeKind): boolean {
  if (!policies || policies.length === 0) return true;
  const policy = selectCallPolicy(policies, levelCode);
  return !policy || policy.callScope === "BOTH" || policy.callScope === scope;
}

/** `allows(levelCode, scope)` selon la politique lisible par le compte (`attendance.take` suffit pour la lire). */
export function useCallScope() {
  const take = usePermission("attendance.take").allowed;
  const manage = usePermission("attendance.manage").allowed;
  const query = useCallPolicies(take || manage);
  const policies = query.data;
  return useMemo(
    () => ({
      policies,
      allows: (levelCode: string | null | undefined, scope: CallScopeKind) => callScopeAllowed(policies, levelCode, scope),
    }),
    [policies],
  );
}
