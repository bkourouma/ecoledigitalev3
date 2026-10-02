/**
 * Variantes d'établissement : dériver (COPIE d'une version nationale publiée, pas un héritage), modifier les paramètres
 * (bornés) ou une expression, valider. Toute modification d'une version SIMULÉE la repasse en brouillon et invalide sa
 * simulation (AC2.1). Seules les versions en brouillon ou simulées sont modifiables (R-RUL-02, triggers en base).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import {
  contextWithParameters,
  effectiveRuleSchema,
  isValidIsoDate,
  validate,
  RuleError,
  type ParameterSpec,
} from "../engine";
import { contractRule as findContractRule, getContract } from "../contracts";
import { checkConformity, parameterAllowed, type ConformityReport } from "../domain/conformity";
import { RulesCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import type { GovernanceActor, RuleDefinitionRecord, RuleVersionRecord, RuleVersionWithRules, VersionKind } from "../domain/types";
import {
  findVersion,
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
  updateRuleExpression,
  updateRuleParameters,
} from "../infrastructure/catalog-repository";
import { guardCode, isRestrictViolation } from "../infrastructure/pg";
import { inTx, type RulesDeps } from "./deps";
import { recordAudit, recordVersionEvent, versionSnapshot, type WriteEnv } from "./support";

const EDITABLE = new Set(["draft", "simulated"]);

function tenantActor(ctx: RequestContext, name?: string): GovernanceActor {
  return { kind: "tenant_admin", id: ctx.userId, name: name ?? ctx.userId ?? "inconnu" };
}

function tenantEnv(ctx: RequestContext, name?: string): WriteEnv {
  return { kind: "TENANT", tenantId: ctx.tenantId, ctx, actor: tenantActor(ctx, name) };
}

function immutable(version: RuleVersionRecord): AppError {
  return conflict(RulesCode.VERSION_IMMUTABLE, `Une version « ${version.status} » est immuable : créez une nouvelle version pour la modifier.`, {
    versionId: version.id,
    status: version.status,
  });
}

/** Charge une version modifiable (verrouillée), contrôle le verrou optimiste. */
async function loadEditable(
  tx: Parameters<Parameters<typeof inTx>[2]>[0],
  kind: VersionKind,
  versionId: string,
  expectedRowVersion?: number,
): Promise<Result<RuleVersionRecord, AppError>> {
  const version = await getVersion(tx, kind, versionId, { forUpdate: true });
  if (!version) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
  if (kind === "TENANT" && expectedRowVersion !== undefined && version.rowVersion !== expectedRowVersion) {
    return err(conflict(RulesCode.STALE_VERSION, "La version a été modifiée depuis votre lecture : rechargez-la.", { expected: expectedRowVersion, actual: version.rowVersion }));
  }
  if (!EDITABLE.has(version.status)) return err(immutable(version));
  return ok(version);
}

/**
 * Après une modification de contenu : une version simulée redevient brouillon (sa simulation n'est plus valable) ;
 * sinon on rafraîchit seulement le verrou optimiste.
 */
async function afterContentEdit(deps: RulesDeps, tx: Parameters<Parameters<typeof inTx>[2]>[0], env: WriteEnv, version: RuleVersionRecord): Promise<void> {
  const now = deps.clock.now();
  if (version.status === "simulated") {
    await patchVersionStatus(tx, env.kind, version.id, { status: "draft", now, definitionHash: null, clearSimulation: true });
    await recordVersionEvent(deps, tx, env, version.id, "simulated", "draft", "Modification après simulation : simulation invalidée.");
  } else {
    await touchDraft(tx, env.kind, version.id, now);
  }
  deps.cache.evictVersion(version.id);
}

/* ------------------------------ dériver ------------------------------ */

export interface DeriveVariantInput {
  readonly ruleSetCode: string;
  readonly baseVersionId: string;
  readonly name?: string | undefined;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null | undefined;
  readonly notes?: string | undefined;
  readonly actorName?: string | undefined;
}

export async function deriveVariant(deps: RulesDeps, ctx: RequestContext, input: DeriveVariantInput): Promise<Result<RuleVersionWithRules, AppError>> {
  if (!ctx.userId) return err(validation(RulesCode.INVALID_INPUT, "Créer une variante exige un utilisateur identifié.", "actor"));
  if (!isValidIsoDate(input.effectiveFrom) || (input.effectiveTo != null && !isValidIsoDate(input.effectiveTo))) {
    return err(validation(RulesCode.INVALID_INPUT, "Date d'effet invalide (format attendu : AAAA-MM-JJ).", "effectiveFrom"));
  }
  if (input.effectiveTo != null && input.effectiveTo < input.effectiveFrom) {
    return err(validation(RulesCode.INVALID_INPUT, "La fin d'effet doit être postérieure ou égale au début.", "effectiveTo"));
  }
  const env = tenantEnv(ctx, input.actorName);

  return inTx(deps, ctx, async (tx) => {
    // Base : version nationale PUBLIÉE du jeu demandé, ou version déjà figée de la variante de cet établissement.
    const national = await getVersionWithRules(tx, "NATIONAL", input.baseVersionId);
    const own = national ? null : await getVersionWithRules(tx, "TENANT", input.baseVersionId);
    const base = national ?? own;
    if (!base) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de base", input.baseVersionId));
    if (base.ruleSetCode !== input.ruleSetCode) {
      return err(validation(RulesCode.INVALID_INPUT, `La version de base appartient au jeu « ${base.ruleSetCode} », pas à « ${input.ruleSetCode} ».`, "baseVersionId"));
    }
    if (national && national.status !== "published") {
      return err(conflict(RulesCode.TRANSITION_FORBIDDEN, "Une variante se dérive d'une version nationale PUBLIÉE.", { status: national.status }));
    }
    if (own && EDITABLE.has(own.status)) {
      return err(conflict(RulesCode.TRANSITION_FORBIDDEN, "Une variante se dérive d'une version figée (proposée, approuvée, publiée ou retirée), pas d'un brouillon.", { status: own.status }));
    }

    const nationalSet = await getRuleSetByCode(tx, "NATIONAL", input.ruleSetCode);
    let tenantSet = await getRuleSetByCode(tx, "TENANT", input.ruleSetCode);
    if (!tenantSet) {
      if (!nationalSet) return err(notFound(RulesCode.RULESET_NOT_FOUND, "Jeu de règles", input.ruleSetCode));
      tenantSet = await insertRuleSet(tx, "TENANT", ctx.tenantId, {
        id: deps.newId(),
        code: nationalSet.code,
        name: input.name ?? nationalSet.name,
        countryCode: nationalSet.countryCode,
        regulation: nationalSet.regulation,
        educationSystem: nationalSet.educationSystem,
        level: nationalSet.level,
        basedOnSetId: nationalSet.id,
      });
    }

    const versionNo = await nextVersionNo(tx, "TENANT", tenantSet.id);
    const baseLabel = `${base.ruleSetCode} v${base.versionNo}${national ? "" : " (variante de l'établissement)"}`;
    const version = await insertVersion(tx, "TENANT", ctx.tenantId, {
      id: deps.newId(),
      ruleSetId: tenantSet.id,
      versionNo,
      contractId: base.contractId,
      basedOnVersionId: national ? national.id : (own?.basedOnVersionId ?? null),
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      // Une variante d'un jeu FICTIF reste fictive tant que le texte officiel n'est pas cité (filigrane et accusé de liaison conservés).
      source: { kind: base.source.kind === "placeholder" ? "placeholder" : "institution", reference: baseLabel, description: `Variante dérivée de ${baseLabel}.` },
      notes: input.notes ?? null,
      createdBy: ctx.userId,
    });
    await insertRules(tx, "TENANT", ctx.tenantId, version.id, base.rules, deps.newId);
    await recordVersionEvent(deps, tx, env, version.id, null, "draft", `Variante dérivée de ${baseLabel}.`);
    await recordAudit(deps, tx, env, {
      action: "rules.version.created",
      entity: "rule_version",
      entityId: version.id,
      after: versionSnapshot(version),
      metadata: { origin: "tenant", ruleSet: version.ruleSetCode, baseVersionId: base.id, baseKind: national ? "national" : "tenant", rules: base.rules.length },
    });
    return ok({ ...version, rules: await getRules(tx, "TENANT", version.id) });
  });
}

/* ---------------------------- paramètres ---------------------------- */

export interface ParameterChange {
  readonly ruleKey: string;
  readonly parameter: string;
  readonly value: number | string | boolean;
}

export interface EditParametersInput {
  readonly versionId: string;
  readonly changes: readonly ParameterChange[];
  readonly expectedRowVersion?: number | undefined;
  readonly actorName?: string | undefined;
}

export async function editParameters(deps: RulesDeps, ctx: RequestContext, input: EditParametersInput): Promise<Result<RuleVersionWithRules, AppError>> {
  const env = tenantEnv(ctx, input.actorName);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadEditable(tx, "TENANT", input.versionId, input.expectedRowVersion);
    if (!loaded.ok) return loaded;
    const version = loaded.value;
    const rules = await getRules(tx, "TENANT", version.id);
    const contract = getContract(version.contractId);

    const next = new Map<string, Record<string, ParameterSpec>>(rules.map((r) => [r.key, { ...r.parameters }]));
    const changed: Array<{ ruleKey: string; parameter: string; before: unknown; after: unknown }> = [];
    for (const change of input.changes) {
      const rule = rules.find((r) => r.key === change.ruleKey);
      if (!rule) return err(notFound(RulesCode.RULE_NOT_FOUND, "Règle", change.ruleKey));
      const spec = next.get(rule.key)?.[change.parameter];
      if (!spec) return err(notFound(RulesCode.RULE_NOT_FOUND, `Paramètre « ${change.parameter} » de la règle « ${rule.key} »`, change.parameter));
      if (typeof change.value !== spec.type) {
        return err(validation(RulesCode.INVALID_INPUT, `Le paramètre « ${change.parameter} » doit être de type ${spec.type}.`, change.parameter));
      }
      const constraint = contract ? findContractRule(contract, rule.key)?.parameters[change.parameter] : undefined;
      if (constraint && !parameterAllowed(constraint, change.value)) {
        return err(
          validation(RulesCode.INVALID_INPUT, `Valeur « ${String(change.value)} » non permise pour « ${change.parameter} » (${(constraint.allowed ?? []).join(", ")}).`, change.parameter),
        );
      }
      // Bornes : le message est celui du moteur (« hors de l'intervalle autorisé »), AC1.2.
      try {
        contextWithParameters({ key: rule.key, type: rule.type, expression: rule.expression, parameters: { [change.parameter]: spec } }, {}, { [change.parameter]: change.value });
      } catch (e) {
        if (e instanceof RuleError) return err(validation(RulesCode.PARAMETER_OUT_OF_RANGE, e.message, change.parameter, { ruleKey: rule.key, engineCode: e.code }));
        throw e;
      }
      changed.push({ ruleKey: rule.key, parameter: change.parameter, before: spec.default, after: change.value });
      (next.get(rule.key) as Record<string, ParameterSpec>)[change.parameter] = { ...spec, default: change.value } as ParameterSpec;
    }

    try {
      for (const rule of rules) {
        const params = next.get(rule.key) as Record<string, ParameterSpec>;
        if (changed.some((c) => c.ruleKey === rule.key)) await updateRuleParameters(tx, "TENANT", version.id, rule.key, params);
      }
    } catch (e) {
      if (isRestrictViolation(e)) return err(conflict(RulesCode.VERSION_IMMUTABLE, "La version n'est plus modifiable.", { guard: guardCode(e) }));
      throw e;
    }
    await afterContentEdit(deps, tx, env, version);
    await recordAudit(deps, tx, env, {
      action: "rules.version.parameters_edited",
      entity: "rule_version",
      entityId: version.id,
      before: Object.fromEntries(changed.map((c) => [`${c.ruleKey}.${c.parameter}`, c.before])),
      after: Object.fromEntries(changed.map((c) => [`${c.ruleKey}.${c.parameter}`, c.after])),
      metadata: { origin: "tenant", ruleSet: version.ruleSetCode, changes: changed.length },
    });
    return ok((await getVersionWithRules(tx, "TENANT", version.id)) as RuleVersionWithRules);
  });
}

/* ---------------------------- expressions ---------------------------- */

export interface EditExpressionInput {
  readonly versionId: string;
  readonly ruleKey: string;
  readonly expression: string;
  readonly description?: string | null | undefined;
  readonly expectedRowVersion?: number | undefined;
  readonly actorName?: string | undefined;
}

/** Diagnostics français (ligne/colonne, conseil) de la règle `rule` dans le contexte de son contrat. */
export function validateExpression(version: Pick<RuleVersionRecord, "contractId">, rule: RuleDefinitionRecord, expression: string) {
  const contract = getContract(version.contractId);
  const cr = contract ? findContractRule(contract, rule.key) : undefined;
  const schema = effectiveRuleSchema(
    { key: rule.key, type: rule.type, expression, parameters: rule.parameters, ...((rule.inputSchema ?? cr?.inputs) ? { inputSchema: (rule.inputSchema ?? cr?.inputs) as never } : {}) },
    cr?.inputs,
  );
  return validate(expression, schema, { expect: rule.resultType ?? cr?.result ?? "number?" });
}

export async function editExpression(deps: RulesDeps, ctx: RequestContext, input: EditExpressionInput): Promise<Result<RuleVersionWithRules, AppError>> {
  const env = tenantEnv(ctx, input.actorName);
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadEditable(tx, "TENANT", input.versionId, input.expectedRowVersion);
    if (!loaded.ok) return loaded;
    const version = loaded.value;
    const rules = await getRules(tx, "TENANT", version.id);
    const rule = rules.find((r) => r.key === input.ruleKey);
    if (!rule) return err(notFound(RulesCode.RULE_NOT_FOUND, "Règle", input.ruleKey));
    const report = validateExpression(version, rule, input.expression);
    if (!report.ok) {
      return err(
        validation(RulesCode.INVALID_INPUT, report.diagnostics[0]?.message ?? "Expression invalide.", "expression", {
          diagnostics: report.diagnostics,
          ruleKey: rule.key,
        }),
      );
    }
    try {
      await updateRuleExpression(tx, "TENANT", version.id, rule.key, { expression: input.expression, description: input.description });
    } catch (e) {
      if (isRestrictViolation(e)) return err(conflict(RulesCode.VERSION_IMMUTABLE, "La version n'est plus modifiable.", { guard: guardCode(e) }));
      throw e;
    }
    await afterContentEdit(deps, tx, env, version);
    await recordAudit(deps, tx, env, {
      action: "rules.version.expression_edited",
      entity: "rule_version",
      entityId: version.id,
      before: { ruleKey: rule.key, expression: rule.expression },
      after: { ruleKey: rule.key, expression: input.expression },
      severity: "notice",
      metadata: { origin: "tenant", ruleSet: version.ruleSetCode },
    });
    return ok((await getVersionWithRules(tx, "TENANT", version.id)) as RuleVersionWithRules);
  });
}

/* ------------------------------ validation ------------------------------ */

/** Validation à blanc d'une version visible (variante de l'établissement ou version nationale publiée) : compile + contrat. */
export async function validateVersion(deps: RulesDeps, ctx: RequestContext, versionId: string): Promise<Result<ConformityReport, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const version = await findVersion(tx, versionId);
      if (!version) return err(notFound(RulesCode.VERSION_NOT_FOUND, "Version de règles", versionId));
      if (version.kind === "NATIONAL" && !["published", "retired"].includes(version.status)) {
        return err(forbidden(RulesCode.TRANSITION_FORBIDDEN, "Cette version du catalogue national n'est pas publiée."));
      }
      const contract = getContract(version.contractId);
      if (!contract) return err(validation(RulesCode.UNKNOWN_CONTRACT, `Contrat inconnu : ${version.contractId}.`, "contractId"));
      return ok(checkConformity(contract, await getRules(tx, version.kind, version.id)));
    },
    { readOnly: true },
  );
}
