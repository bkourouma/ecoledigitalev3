/**
 * Catalogue national (console du super-administrateur) : jeux de règles, versions, règles d'un brouillon, réglages.
 * Écriture réservée à l'acteur `system` (RLS) : toutes ces opérations passent par `SystemDb` avec une RAISON explicite
 * et un opérateur identifié dans l'historique et dans le journal d'audit de PLATEFORME.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { isValidIsoDate } from "../engine";
import { RulesCode, conflict, notFound, validation } from "../domain/errors";
import type { GovernanceActor, RuleSetRecord, RuleVersionRecord, RuleVersionWithRules } from "../domain/types";
import {
  deleteRules,
  getRuleSetByCode,
  getRules,
  getVersion,
  getVersionWithRules,
  insertRules,
  insertRuleSet,
  insertVersion,
  nextVersionNo,
  patchVersionStatus,
  touchDraft,
} from "../infrastructure/catalog-repository";
import { guardCode, isRestrictViolation } from "../infrastructure/pg";
import { readSettings, writeSettings, type PlatformSettings } from "../infrastructure/settings-repository";
import { inSystemTx, type RulesDeps } from "./deps";
import { ruleInputsToRecords, type RuleInput } from "./rule-input";
import { recordAudit, recordVersionEvent, versionSnapshot, type WriteEnv } from "./support";
import { getContract } from "../contracts";
import type { Operator } from "./transitions";

function nationalEnv(operator: Operator): WriteEnv {
  const actor: GovernanceActor = { kind: "super_admin", id: operator.id, name: operator.name ?? operator.id };
  return { kind: "NATIONAL", tenantId: null, ctx: null, actor };
}

export interface CreateNationalRuleSetInput {
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly regulation?: string | undefined;
  readonly educationSystem?: string | undefined;
  readonly level?: string | undefined;
}

export async function createNationalRuleSet(deps: RulesDeps, operator: Operator, input: CreateNationalRuleSetInput): Promise<Result<RuleSetRecord, AppError>> {
  const env = nationalEnv(operator);
  return inSystemTx(deps, "rules-national-ruleset-create", async (tx) => {
    if (await getRuleSetByCode(tx, "NATIONAL", input.code)) {
      return err(conflict(RulesCode.DUPLICATE, `Le jeu de règles « ${input.code} » existe déjà.`, { code: input.code }));
    }
    const set = await insertRuleSet(tx, "NATIONAL", null, { id: deps.newId(), ...input });
    await recordAudit(deps, tx, env, {
      action: "rules.ruleset.created",
      entity: "rule_set",
      entityId: set.id,
      after: { code: set.code, name: set.name, countryCode: set.countryCode, educationSystem: set.educationSystem, level: set.level },
      metadata: { origin: "national" },
    });
    return ok(set);
  });
}

export interface CreateNationalVersionInput {
  readonly ruleSetCode: string;
  readonly contractId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null | undefined;
  readonly source: { kind: "regulation" | "institution" | "platform" | "placeholder"; reference?: string | undefined; url?: string | undefined; description?: string | undefined };
  readonly rules: readonly RuleInput[];
  readonly notes?: string | undefined;
}

export async function createNationalVersion(deps: RulesDeps, operator: Operator, input: CreateNationalVersionInput): Promise<Result<RuleVersionWithRules, AppError>> {
  if (!isValidIsoDate(input.effectiveFrom) || (input.effectiveTo != null && !isValidIsoDate(input.effectiveTo))) {
    return err(validation(RulesCode.INVALID_INPUT, "Date d'effet invalide (format attendu : AAAA-MM-JJ).", "effectiveFrom"));
  }
  if (input.effectiveTo != null && input.effectiveTo < input.effectiveFrom) {
    return err(validation(RulesCode.INVALID_INPUT, "La fin d'effet doit être postérieure ou égale au début.", "effectiveTo"));
  }
  if (!getContract(input.contractId)) return err(validation(RulesCode.UNKNOWN_CONTRACT, `Contrat inconnu : ${input.contractId}.`, "contractId"));
  const records = ruleInputsToRecords(input.rules);
  if (!records.ok) return records;
  const env = nationalEnv(operator);

  return inSystemTx(deps, "rules-national-version-create", async (tx) => {
    const set = await getRuleSetByCode(tx, "NATIONAL", input.ruleSetCode);
    if (!set) return err(notFound(RulesCode.RULESET_NOT_FOUND, "Jeu de règles", input.ruleSetCode));
    const version = await insertVersion(tx, "NATIONAL", null, {
      id: deps.newId(),
      ruleSetId: set.id,
      versionNo: await nextVersionNo(tx, "NATIONAL", set.id),
      contractId: input.contractId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      source: input.source,
      notes: input.notes ?? null,
      createdBy: operator.id,
    });
    await insertRules(tx, "NATIONAL", null, version.id, records.value, deps.newId);
    await recordVersionEvent(deps, tx, env, version.id, null, "draft", "Version créée.");
    await recordAudit(deps, tx, env, {
      action: "rules.version.created",
      entity: "rule_version",
      entityId: version.id,
      after: versionSnapshot(version),
      metadata: { origin: "national", ruleSet: set.code, rules: records.value.length },
    });
    return ok({ ...version, rules: await getRules(tx, "NATIONAL", version.id) });
  });
}

/** Remplace TOUTES les règles d'un brouillon national (une version simulée repasse en brouillon). */
export async function replaceNationalDraftRules(
  deps: RulesDeps,
  operator: Operator,
  versionId: string,
  rules: readonly RuleInput[],
): Promise<Result<RuleVersionWithRules, AppError>> {
  const records = ruleInputsToRecords(rules);
  if (!records.ok) return records;
  const env = nationalEnv(operator);
  return inSystemTx(deps, "rules-national-version-edit", async (tx) => {
    const version = await getVersion(tx, "NATIONAL", versionId, { forUpdate: true });
    if (!version) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
    if (version.status !== "draft" && version.status !== "simulated") {
      return err(conflict(RulesCode.VERSION_IMMUTABLE, `Une version « ${version.status} » est immuable : créez une nouvelle version.`, { status: version.status }));
    }
    try {
      await deleteRules(tx, "NATIONAL", version.id);
      await insertRules(tx, "NATIONAL", null, version.id, records.value, deps.newId);
    } catch (e) {
      if (isRestrictViolation(e)) return err(conflict(RulesCode.VERSION_IMMUTABLE, "La version n'est plus modifiable.", { guard: guardCode(e) }));
      throw e;
    }
    const now = deps.clock.now();
    if (version.status === "simulated") {
      await patchVersionStatus(tx, "NATIONAL", version.id, { status: "draft", now, definitionHash: null });
      await recordVersionEvent(deps, tx, env, version.id, "simulated", "draft", "Modification après validation : validation invalidée.");
    } else {
      await touchDraft(tx, "NATIONAL", version.id, now);
    }
    deps.cache.evictVersion(version.id);
    await recordAudit(deps, tx, env, {
      action: "rules.version.rules_replaced",
      entity: "rule_version",
      entityId: version.id,
      metadata: { origin: "national", ruleSet: version.ruleSetCode, rules: records.value.length },
    });
    return ok((await getVersionWithRules(tx, "NATIONAL", version.id)) as RuleVersionWithRules);
  });
}

/* ------------------------------- réglages ------------------------------- */

export async function getPlatformSettings(deps: RulesDeps): Promise<PlatformSettings> {
  return deps.systemDb.run("rules-settings-read", (tx) => readSettings(tx), { readOnly: true });
}

export async function updatePlatformSettings(deps: RulesDeps, operator: Operator, patch: Partial<PlatformSettings>): Promise<Result<PlatformSettings, AppError>> {
  const env = nationalEnv(operator);
  return inSystemTx(deps, "rules-settings-update", async (tx: Tx) => {
    const before = await readSettings(tx);
    await writeSettings(tx, patch, operator.id);
    const after = await readSettings(tx);
    await recordAudit(deps, tx, env, { action: "rules.settings.updated", entity: "rules_settings", entityId: "platform", before, after, severity: "notice" });
    return ok(after);
  });
}

export type { RuleVersionRecord };
