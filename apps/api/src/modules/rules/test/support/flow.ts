/**
 * Aides de scénario pour les tests d'intégration : dériver une variante, la simuler (source fictive), la proposer, etc.
 */
import { expect } from "vitest";
import { newId, type RequestContext } from "@ecoledigitale/kernel";
import type { Operator } from "../../application/transitions";
import { transitionAsOperator, transitionTenantVersion } from "../../application/transitions";
import { deriveVariant, editParameters } from "../../application/variants";
import { recordSimulationCases, requestSimulation } from "../../application/simulations";
import type { SimulationCaseGroup } from "../../application/ports";
import type { RulesDeps } from "../../application/deps";
import type { RuleVersionRecord, RuleVersionWithRules } from "../../domain/types";
import { listVersions } from "../../infrastructure/catalog-repository";
import type { RulesTestDb } from "./db";

export const OPERATOR: Operator = { id: "00000000-0000-7000-8000-0000000000aa", name: "Super Admin" };
export const OTHER_OPERATOR: Operator = { id: "00000000-0000-7000-8000-0000000000bb", name: "Autre Super Admin" };

/** Version nationale publiée d'un jeu de départ. */
export async function nationalVersion(db: RulesTestDb, code: string): Promise<RuleVersionRecord> {
  const versions = await db.systemDb.run("test-national", (tx) => listVersions(tx, "NATIONAL", { ruleSetCode: code, statuses: ["published"] }));
  const v = versions[0];
  if (!v) throw new Error(`Aucune version publiée pour ${code}`);
  return v;
}

export async function derive(deps: RulesDeps, ctx: RequestContext, base: RuleVersionRecord, over: { effectiveFrom?: string; effectiveTo?: string | null } = {}): Promise<RuleVersionWithRules> {
  const r = await deriveVariant(deps, ctx, { ruleSetCode: base.ruleSetCode, baseVersionId: base.id, effectiveFrom: over.effectiveFrom ?? "2025-09-01", effectiveTo: over.effectiveTo ?? null });
  if (!r.ok) throw r.error;
  return r.value;
}

/** Cas fictifs pour simuler une variante qui relève le seuil de validation des ECUE. */
export function ecueGroup(n = 40): SimulationCaseGroup {
  return {
    ruleKeys: ["ecue_validee", "ecue_eliminee"],
    cases: Array.from({ length: n }, (_, i) => {
      const note = 8 + (i % 8) * 0.5; // 8 … 11,5
      return { id: `inscription-${i}:periode-1`, context: { variables: { note, validation_manuelle: false } } };
    }),
  };
}

/** Demande, exécute (cas fournis) et renvoie une simulation TERMINÉE de `versionId`. */
export async function simulateVersion(deps: RulesDeps, ctx: RequestContext, versionId: string, groups: readonly SimulationCaseGroup[] = [ecueGroup()], baseVersionId?: string) {
  const requested = await requestSimulation(deps, ctx, { versionId, ...(baseVersionId ? { baseVersionId } : {}), dataset: { periodIds: [newId()] } });
  if (!requested.ok) throw requested.error;
  const done = await recordSimulationCases(deps, ctx, requested.value.id, groups);
  if (!done.ok) throw done.error;
  return done.value;
}

/** Variante prête à être proposée : dérivée, paramètre relevé, simulée, passée à « simulated ». */
export async function simulatedVariant(deps: RulesDeps, ctx: RequestContext, base: RuleVersionRecord, seuil = 11, over: { effectiveFrom?: string; effectiveTo?: string | null } = {}) {
  const variant = await derive(deps, ctx, base, over);
  const edited = await editParameters(deps, ctx, {
    versionId: variant.id,
    changes: ["ecue_validee", "ue_validee", "statut_ecue"].map((ruleKey) => ({ ruleKey, parameter: "seuil_validation", value: seuil })),
  });
  if (!edited.ok) throw edited.error;
  const sim = await simulateVersion(deps, ctx, variant.id);
  const step = await transitionTenantVersion(deps, ctx, { versionId: variant.id, to: "simulated" });
  if (!step.ok) throw step.error;
  return { variant: step.value.version, simulation: sim };
}

export async function proposeVariant(deps: RulesDeps, ctx: RequestContext, versionId: string, confirm = true) {
  const r = await transitionTenantVersion(deps, ctx, { versionId, to: "proposed", ...(confirm ? { confirmDecisionImpact: true } : {}) });
  if (!r.ok) throw r.error;
  return r.value.version;
}

export async function approveAsOperator(deps: RulesDeps, tenantId: string, versionId: string, operator: Operator = OPERATOR) {
  const r = await transitionAsOperator(deps, operator, { versionId, to: "approved", comment: "Variante conforme aux textes de l'établissement.", tenantId });
  if (!r.ok) throw r.error;
  return r.value.version;
}

export async function expectErr<T>(p: Promise<{ ok: boolean; error?: { code: string; httpStatus: number; message: string } } & T>, code: string, status?: number): Promise<void> {
  const r = await p;
  expect(r.ok, "erreur attendue").toBe(false);
  expect(r.error?.code).toBe(code);
  if (status !== undefined) expect(r.error?.httpStatus).toBe(status);
}
