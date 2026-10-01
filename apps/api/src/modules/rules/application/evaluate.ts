/**
 * Évaluation d'une règle (ou d'un lot) d'une version chargée.
 *
 *  - `evaluate(compiled, call)` : `contextWithParameters` + `evaluate` du moteur ; les erreurs typées du moteur
 *    deviennent `rules.evaluation_failed` / `rules.budget_exceeded` (clé, position, message français). Une sortie
 *    textuelle hors de l'ensemble de codes du contrat est refusée (`rules.contract_violation`) : la logique des
 *    consommateurs repose sur des CODES, jamais sur du texte libre produit par une expression.
 *  - Chaque évaluation réussie porte `inputs_hash` / `outputs_hash` (AC4.2) et la version du moteur : mêmes
 *    (version, hash de définition, version du moteur, inputs_hash) ⇒ sorties strictement identiques.
 *  - `evaluateMany` : une passe, une erreur ISOLÉE par appel (les autres résultats sont rendus, l'échec n'est jamais masqué).
 *  - `evaluateRuleSet` : résolution (ou version épinglée) + chargement + lot, avec journal des échecs.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { contextWithParameters, evaluate as engineEvaluate, RuleError, type Budget, type EvalContext, type TraceEntry } from "../engine";
import { parameterAllowed } from "../domain/conformity";
import { computeInputsHash, computeOutputsHash } from "../domain/evaluation";
import { RulesCode, conflict, validation } from "../domain/errors";
import { originOf, type Origin } from "../domain/types";
import { insertEvaluationFailures } from "../infrastructure/failures-repository";
import { engineFailure, type CompiledVersion } from "./compiled";
import type { RulesDeps } from "./deps";
import { loadVersionInTx, resolveInTx, type ResolveInput } from "./resolve";

export interface EvaluationCall {
  readonly ruleKey: string;
  readonly context: EvalContext;
  /** Surcharge de paramètres (banc d'essai, simulation d'une valeur) : bornée comme à la saisie, R-RUL-07. */
  readonly overrides?: Readonly<Record<string, number | string | boolean>> | undefined;
  /** Trace des valeurs intermédiaires (défaut : oui). */
  readonly trace?: boolean | undefined;
}

export interface EvaluationOutput {
  readonly ruleVersionId: string;
  readonly ruleKey: string;
  readonly definitionHash: string;
  readonly engineVersion: string;
  readonly type: "number" | "string" | "boolean" | "null";
  /** Chaîne décimale exacte pour un nombre ; texte (code), booléen ou `null`. */
  readonly value: string | boolean | null;
  readonly nodesEvaluated: number;
  readonly trace: readonly TraceEntry[];
  readonly traceTruncated: boolean;
  readonly inputsHash: string;
  readonly outputsHash: string;
}

export interface EvaluateOptions {
  readonly budget?: Partial<Budget> | undefined;
}

export function evaluate(compiled: CompiledVersion, call: EvaluationCall, options: EvaluateOptions = {}): Result<EvaluationOutput, AppError> {
  const entry = compiled.rule(call.ruleKey);
  if (!entry.ok) return entry;
  const { definition, compiled: rule, inputSchema, contractRule } = entry.value;
  const overrides = call.overrides ?? {};

  for (const [name, value] of Object.entries(overrides)) {
    const spec = definition.parameters?.[name];
    if (!spec) return err(validation(RulesCode.INVALID_INPUT, `La surcharge « ${name} » ne correspond à aucun paramètre de la règle « ${call.ruleKey} ».`, name));
    const constraint = contractRule?.parameters[name];
    if (constraint && !parameterAllowed(constraint, value)) {
      return err(validation(RulesCode.INVALID_INPUT, `Valeur « ${String(value)} » non permise pour le paramètre « ${name} ».`, name));
    }
  }

  try {
    const context = contextWithParameters(definition, call.context, overrides);
    const budget = options.budget ? { ...options.budget } : undefined;
    const result = engineEvaluate(rule, context, { trace: call.trace !== false, ...(budget ? { budget } : {}) });

    if (contractRule && contractRule.outputCodes.length > 0 && typeof result.json === "string" && !contractRule.outputCodes.includes(result.json)) {
      return err(
        conflict(RulesCode.CONTRACT_VIOLATION, `La règle « ${call.ruleKey} » a produit « ${result.json} », qui n'est pas un code du contrat (${contractRule.outputCodes.join(", ")}).`, {
          ruleKey: call.ruleKey,
          output: result.json,
        }),
      );
    }

    return ok({
      ruleVersionId: compiled.version.id,
      ruleKey: call.ruleKey,
      definitionHash: compiled.definitionHash,
      engineVersion: compiled.engineVersion,
      type: result.type,
      value: result.json,
      nodesEvaluated: result.nodesEvaluated,
      trace: result.trace,
      traceTruncated: result.traceTruncated,
      inputsHash: computeInputsHash(call.ruleKey, inputSchema, call.context, overrides),
      outputsHash: computeOutputsHash(result.type, result.json),
    });
  } catch (e) {
    if (e instanceof RuleError) return err(engineFailure(e, call.ruleKey));
    throw e;
  }
}

/** Lot : un résultat (ou une erreur) PAR appel, dans l'ordre des appels. */
export function evaluateMany(compiled: CompiledVersion, calls: readonly EvaluationCall[], options: EvaluateOptions = {}): Array<Result<EvaluationOutput, AppError>> {
  return calls.map((call) => evaluate(compiled, call, options));
}

/* ------------------------------ ensemble ------------------------------ */

/** Version épinglée par le consommateur sur l'état d'une période (spec §5.9). */
export interface PinnedVersion {
  readonly ruleVersionId: string;
  readonly definitionHash: string;
}

export type RuleSetRequest =
  | (ResolveInput & { readonly pin?: undefined })
  | { readonly pin: PinnedVersion; readonly contractId?: string | undefined };

export interface RuleSetEvaluation {
  readonly ruleVersionId: string;
  readonly ruleSetCode: string;
  readonly versionNo: number;
  readonly origin: Origin;
  readonly contractId: string;
  readonly definitionHash: string;
  readonly engineVersion: string;
  readonly results: ReadonlyArray<Result<EvaluationOutput, AppError>>;
}

/**
 * Évalue des règles du jeu applicable à `(contrat, périmètre, date de début de période)` — ou de la version
 * ÉPINGLÉE (le hash épinglé doit égaler le hash courant : sinon `rules.hash_mismatch`). Aucune règle active ⇒
 * `rules.no_active_ruleset` : jamais de valeur implicite. Les échecs d'évaluation sont journalisés (sans donnée d'élève).
 */
export async function evaluateRuleSet(
  deps: RulesDeps,
  ctx: RequestContext,
  request: RuleSetRequest,
  calls: readonly EvaluationCall[],
  options: EvaluateOptions = {},
): Promise<Result<RuleSetEvaluation, AppError>> {
  const budget = options.budget ?? deps.config.evaluationBudget;
  const loaded = await deps.db.run(
    ctx,
    async (tx): Promise<Result<CompiledVersion, AppError>> => {
      let versionId: string;
      if (request.pin) {
        versionId = request.pin.ruleVersionId;
      } else {
        const resolution = await resolveInTx(tx, ctx.tenantId, request);
        if (!resolution.ok) return resolution;
        if (!resolution.value.resolved) {
          return err(
            conflict(RulesCode.NO_ACTIVE_RULESET, "Aucun jeu de règles actif pour ce périmètre à cette date : liez un jeu de règles (liaison manquante).", {
              contractId: request.contractId,
              date: request.date,
              considered: resolution.value.considered,
            }),
          );
        }
        versionId = resolution.value.resolved.ruleVersionId;
      }
      const version = await loadVersionInTx(deps, tx, versionId);
      if (!version.ok) return version;
      if (request.pin && version.value.definitionHash !== request.pin.definitionHash) {
        return err(
          conflict(RulesCode.HASH_MISMATCH, "La version épinglée ne correspond plus à l'empreinte enregistrée avec le résultat.", {
            versionId,
            pinnedHash: request.pin.definitionHash,
            actualHash: version.value.definitionHash,
          }),
        );
      }
      return version;
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;

  const compiled = loaded.value;
  const results = evaluateMany(compiled, calls, budget ? { budget } : {});

  if (deps.config.logEvaluationFailures) {
    const failures = results.flatMap((r, i) => (r.ok ? [] : [{ ruleKey: calls[i]?.ruleKey ?? "?", error: r.error, call: calls[i] }]));
    if (failures.length > 0) {
      try {
        await deps.db.run(ctx, (tx) =>
          insertEvaluationFailures(
            tx,
            ctx.tenantId,
            failures.map((f) => ({
              id: deps.newId(),
              versionKind: compiled.version.kind,
              versionId: compiled.version.id,
              ruleKey: f.ruleKey,
              errorCode: (f.error.details?.engineCode as string | undefined) ?? f.error.code,
              message: f.error.message,
              requestId: ctx.requestId,
            })),
          ),
        );
      } catch (e) {
        deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "rules : journal des échecs d'évaluation indisponible");
      }
    }
  }

  const v = compiled.version;
  return ok({
    ruleVersionId: v.id,
    ruleSetCode: v.ruleSetCode,
    versionNo: v.versionNo,
    origin: originOf(v.kind),
    contractId: v.contractId,
    definitionHash: compiled.definitionHash,
    engineVersion: compiled.engineVersion,
    results,
  });
}

/**
 * Banc d'essai (AC7.1) : évalue UNE règle d'une version visible sur un contexte saisi. Aucune persistance.
 * Visibilité : variante de l'établissement (quel que soit son statut) ou version nationale publiée/retirée.
 */
export async function benchEvaluate(
  deps: RulesDeps,
  ctx: RequestContext,
  input: { versionId: string; call: EvaluationCall },
): Promise<Result<EvaluationOutput, AppError>> {
  const compiled = await deps.db.run(ctx, (tx) => loadVersionInTx(deps, tx, input.versionId), { readOnly: true });
  if (!compiled.ok) return compiled;
  return evaluate(compiled.value, input.call, deps.config.evaluationBudget ? { budget: deps.config.evaluationBudget } : {});
}
