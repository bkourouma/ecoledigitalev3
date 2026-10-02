"use client";

/**
 * Hooks typés du module `rules` (`/api/v1/rules/*`) : catalogue des jeux de règles (nationaux en lecture), variantes de
 * l'établissement, éditeur d'expressions (validé par l'API), simulation, workflow de gouvernance, liaisons, banc d'essai.
 * Schémas Zod de `packages/contracts/src/v2/rules.ts`.
 *
 * Le langage (DSL) est vérifié par le SERVEUR : le web ne fait aucune analyse d'expression, il affiche les diagnostics
 * (message en français + position) renvoyés par l'API.
 *
 * Clés de cache : `["rules", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { ApiError } from "@/platform/api/errors";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  RulesAcceptedSimulationResponseSchema,
  RulesBindingDtoSchema,
  RulesContractDtoSchema,
  RulesContractListResponseSchema,
  RulesDiagnosticSchema,
  RulesEvaluateResponseSchema,
  RulesListBindingsResponseSchema,
  RulesListRuleSetsResponseSchema,
  RulesResolveResponseSchema,
  RulesSimulationDtoSchema,
  RulesTransitionResponseSchema,
  RulesValidateResponseSchema,
  RulesVersionDetailDtoSchema,
  RulesVersionEventsResponseSchema,
  type RulesBindingBody,
  type RulesDiagnostic,
  type RulesEvaluateBody,
  type RulesRequestSimulationBody,
  type RulesStatus,
} from "@ecoledigitale/contracts/v2/rules";
import { useApiAction } from "./actions";

export const RULES_BASE = "/api/v1/rules";

// ---------------------------------------------------------------------------
// Catalogue et versions
// ---------------------------------------------------------------------------

export function useRuleSets(query: { code?: string; status?: string; origin?: string } = {}) {
  return hooks.useApiQuery(["rules", "sets", query], `${RULES_BASE}/rule-sets`, {
    schema: RulesListRuleSetsResponseSchema,
    select: (d) => d.items,
    query: Object.fromEntries(Object.entries(query).filter(([, v]) => v)) as Record<string, string>,
  });
}

export function useRuleVersion(id: string | null, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["rules", "version", id], `${RULES_BASE}/rule-versions/${id}`, {
    schema: RulesVersionDetailDtoSchema,
    enabled: id !== null && (options.enabled ?? true),
    // Les libellés de codes changent rarement : pas de relecture à chaque fenêtre.
    staleTime: 60_000,
    retry: false,
  });
}

export function useRuleVersionEvents(id: string | null) {
  return hooks.useApiQuery(["rules", "events", id], `${RULES_BASE}/rule-versions/${id}/events`, {
    schema: RulesVersionEventsResponseSchema,
    select: (d) => d.items,
    enabled: id !== null,
  });
}

export function useContracts(enabled = true) {
  return hooks.useApiQuery(["rules", "contracts"], `${RULES_BASE}/contracts`, { schema: RulesContractListResponseSchema, select: (d) => d.items, enabled, staleTime: 5 * 60_000 });
}

export function useContract(id: string | null) {
  return hooks.useApiQuery(["rules", "contract", id], `${RULES_BASE}/contracts/${id}`, { schema: RulesContractDtoSchema, enabled: id !== null, staleTime: 5 * 60_000, retry: false });
}

const RULES_KEY = ["rules"] as const;

// ---------------------------------------------------------------------------
// Variantes et édition
// ---------------------------------------------------------------------------

export function useDeriveVariant() {
  return useApiAction({
    path: (v: { code: string; baseVersionId: string; name?: string; effectiveFrom: string; effectiveTo?: string | null; notes?: string }) => `${RULES_BASE}/rule-sets/${v.code}/variants`,
    body: (v) => ({ baseVersionId: v.baseVersionId, ...(v.name ? { name: v.name } : {}), effectiveFrom: v.effectiveFrom, ...(v.effectiveTo !== undefined ? { effectiveTo: v.effectiveTo } : {}), ...(v.notes ? { notes: v.notes } : {}) }),
    schema: RulesVersionDetailDtoSchema,
    invalidate: [RULES_KEY],
  });
}

export function useEditParameters() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; changes: Array<{ ruleKey: string; parameter: string; value: number | string | boolean }>; expectedRowVersion?: number }) => `${RULES_BASE}/rule-versions/${v.id}/parameters`,
    body: (v) => ({ changes: v.changes, ...(v.expectedRowVersion !== undefined ? { expectedRowVersion: v.expectedRowVersion } : {}) }),
    schema: RulesVersionDetailDtoSchema,
    invalidate: [RULES_KEY],
  });
}

export function useEditExpression() {
  return useApiAction({
    method: "PUT",
    path: (v: { id: string; key: string; expression: string; description?: string | null; expectedRowVersion?: number }) => `${RULES_BASE}/rule-versions/${v.id}/rules/${v.key}`,
    body: (v) => ({ expression: v.expression, ...(v.description !== undefined ? { description: v.description } : {}), ...(v.expectedRowVersion !== undefined ? { expectedRowVersion: v.expectedRowVersion } : {}) }),
    schema: RulesVersionDetailDtoSchema,
    invalidate: [RULES_KEY],
  });
}

export function useValidateVersion() {
  return useApiAction({ path: (v: { id: string }) => `${RULES_BASE}/rule-versions/${v.id}/validate`, schema: RulesValidateResponseSchema });
}

/**
 * Diagnostics d'une expression refusée par l'API : `{ code, phase, message, hint?, position? { start, end, line, column } }`.
 * Le serveur les joint à l'erreur 4xx (`details.diagnostics`) ; on les cherche aussi dans un niveau imbriqué.
 */
export function diagnosticsOf(error: unknown): RulesDiagnostic[] {
  if (!(error instanceof ApiError)) return [];
  const find = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || depth > 3) return undefined;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.diagnostics)) return record.diagnostics;
    for (const v of Object.values(record)) {
      const hit = find(v, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  const raw = find(error.details, 0);
  const parsed = z.array(RulesDiagnosticSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export function useRequestSimulation() {
  return useApiAction({
    path: (v: { versionId: string; body: RulesRequestSimulationBody }) => `${RULES_BASE}/rule-versions/${v.versionId}/simulations`,
    body: (v) => v.body,
    schema: RulesAcceptedSimulationResponseSchema,
    invalidate: [RULES_KEY],
  });
}

const RUNNING = new Set(["PENDING", "RUNNING"]);

/** Rapport de simulation ; relu toutes les 2 s tant qu'elle n'est pas terminée (tâche de fond côté API). */
export function useSimulation(id: string | null) {
  return hooks.useApiQuery(["rules", "simulation", id], `${RULES_BASE}/simulations/${id}`, {
    schema: RulesSimulationDtoSchema,
    enabled: id !== null,
    refetchInterval: (data) => (data && !RUNNING.has(data.status) ? false : 2000),
  });
}

// ---------------------------------------------------------------------------
// Gouvernance
// ---------------------------------------------------------------------------

export function useTransitionVersion() {
  return useApiAction({
    path: (v: { id: string; to: RulesStatus; comment?: string; confirmDecisionImpact?: boolean; expectedRowVersion?: number }) => `${RULES_BASE}/rule-versions/${v.id}/transitions`,
    body: (v) => ({ to: v.to, ...(v.comment ? { comment: v.comment } : {}), ...(v.confirmDecisionImpact ? { confirmDecisionImpact: true } : {}), ...(v.expectedRowVersion !== undefined ? { expectedRowVersion: v.expectedRowVersion } : {}) }),
    schema: RulesTransitionResponseSchema,
    invalidate: [RULES_KEY],
  });
}

// ---------------------------------------------------------------------------
// Liaisons, résolution, banc d'essai
// ---------------------------------------------------------------------------

export function useBindings(contractId?: string, enabled = true) {
  return hooks.useApiQuery(["rules", "bindings", contractId ?? null], `${RULES_BASE}/bindings`, {
    schema: RulesListBindingsResponseSchema,
    select: (d) => d.items,
    query: contractId ? { contractId } : undefined,
    enabled,
  });
}

export function usePutBinding() {
  return useApiAction({ method: "PUT", path: `${RULES_BASE}/bindings`, body: (v: RulesBindingBody) => v, schema: RulesBindingDtoSchema, invalidate: [["rules", "bindings"]] });
}

export function useDeleteBinding() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${RULES_BASE}/bindings/${v.id}`, invalidate: [["rules", "bindings"]] });
}

export function useResolveRules(query: { contractId: string; institutionId?: string; levelCode?: string; date: string } | null) {
  return hooks.useApiQuery(["rules", "resolve", query], `${RULES_BASE}/resolve`, { schema: RulesResolveResponseSchema, query: query ?? undefined, enabled: query !== null });
}

export function useEvaluateRule() {
  return useApiAction({
    path: `${RULES_BASE}/evaluate`,
    body: (v: Omit<RulesEvaluateBody, "trace"> & { trace?: boolean }) => v,
    schema: RulesEvaluateResponseSchema,
  });
}
