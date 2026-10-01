/**
 * Adaptateur du port `DiplomaRulesPort` vers l'API publique du module `rules` (`app.rules`, contrat `credit-semester@1`).
 *
 * Ce module ne connaît NI le moteur NI le DSL : seulement des CLÉS de règle (`diplome_eligible`, `moyenne_annuelle`,
 * `mention_diplome`) et des contextes typés. Le jeu de règles applicable est RÉSOLU à la date d'effet (RuleSet du
 * tenant / national) ; sans jeu actif, l'évaluation est REFUSÉE (`rules.no_active_ruleset`) — jamais de valeur implicite.
 * Les empreintes (`inputsHash`, `outputsHash`) et la version de règle sont figées dans l'octroi.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { rulesUnavailable } from "../domain/errors";
import type { CycleEvaluation, DiplomaRulesPort, EligibilityEvaluation, RuleRef, RuleScope } from "../application/ports";

/** Clés de règle du contrat `credit-semester@1` utilisées par ce module (mêmes noms que `CREDIT_SEMESTER_RULES`). */
export const CREDIT_SEMESTER_CONTRACT = "credit-semester@1";
export const RULE_KEYS = {
  DIPLOME_ELIGIBLE: "diplome_eligible",
  MOYENNE_ANNUELLE: "moyenne_annuelle",
  MENTION_DIPLOME: "mention_diplome",
} as const;

interface EvalOutput {
  readonly value: string | boolean | null;
  readonly inputsHash: string;
  readonly outputsHash: string;
}

interface RuleSetEval {
  readonly ruleVersionId: string;
  readonly ruleSetCode: string;
  readonly versionNo: number;
  readonly definitionHash: string;
  readonly results: ReadonlyArray<Result<EvalOutput, AppError>>;
}

/** Sous-ensemble structurel de `RulesApi` (module rules) dont ce module a besoin. */
export interface RulesApiLike {
  evaluateRuleSet(
    ctx: RequestContext,
    request:
      | { contractId: string; institutionId?: string | undefined; curriculumNodeId?: string | undefined; date: string; pin?: undefined }
      | { pin: { ruleVersionId: string; definitionHash: string }; contractId?: string | undefined },
    calls: ReadonlyArray<{ ruleKey: string; context: { variables: Record<string, unknown> }; trace?: boolean | undefined }>,
  ): Promise<Result<RuleSetEval, AppError>>;
}

const refOf = (e: RuleSetEval): RuleRef => ({ ruleSetCode: e.ruleSetCode, ruleVersionId: e.ruleVersionId, versionNo: e.versionNo, definitionHash: e.definitionHash });

function single(e: RuleSetEval, key: string): Result<EvalOutput, AppError> {
  const r = e.results[0];
  if (!r) return err(rulesUnavailable(`La règle « ${key} » n'a rendu aucun résultat.`, { ruleKey: key }));
  return r;
}

export function createRulesAdapter(getApi: () => RulesApiLike | undefined): DiplomaRulesPort {
  const api = (): RulesApiLike => {
    const a = getApi();
    if (!a) throw rulesUnavailable("Le module de règles n'est pas disponible : décision refusée.");
    return a;
  };
  const request = (scope: RuleScope) => ({
    contractId: CREDIT_SEMESTER_CONTRACT,
    ...(scope.institutionId ? { institutionId: scope.institutionId } : {}),
    ...(scope.curriculumNodeId ? { curriculumNodeId: scope.curriculumNodeId } : {}),
    date: scope.onDate,
  });

  return {
    async evaluateEligibility(ctx, input): Promise<Result<EligibilityEvaluation, AppError>> {
      const evaluated = await api().evaluateRuleSet(ctx, request(input.scope), [
        { ruleKey: RULE_KEYS.DIPLOME_ELIGIBLE, context: { variables: { exigences: input.exigences, uv_requises: input.uvRequises } }, trace: false },
      ]);
      if (!evaluated.ok) return evaluated;
      const out = single(evaluated.value, RULE_KEYS.DIPLOME_ELIGIBLE);
      if (!out.ok) return out;
      if (typeof out.value.value !== "boolean") return err(rulesUnavailable("La règle « diplome_eligible » doit rendre un booléen.", { ruleKey: RULE_KEYS.DIPLOME_ELIGIBLE }));
      return ok({ eligible: out.value.value, rule: refOf(evaluated.value), inputsHash: out.value.inputsHash, outputsHash: out.value.outputsHash });
    },

    async evaluateCycle(ctx, input): Promise<Result<CycleEvaluation, AppError>> {
      const first = await api().evaluateRuleSet(ctx, request(input.scope), [
        { ruleKey: RULE_KEYS.MOYENNE_ANNUELLE, context: { variables: { semestres: input.semestres.map((s) => ({ moyenne: s.moyenne, credits: s.credits })) } }, trace: false },
      ]);
      if (!first.ok) return first;
      const avg = single(first.value, RULE_KEYS.MOYENNE_ANNUELLE);
      if (!avg.ok) return avg;
      const average = avg.value.value === null ? null : String(avg.value.value);
      // La mention est évaluée avec la MÊME version de règle que la moyenne (épinglée).
      const second = await api().evaluateRuleSet(
        ctx,
        { pin: { ruleVersionId: first.value.ruleVersionId, definitionHash: first.value.definitionHash }, contractId: CREDIT_SEMESTER_CONTRACT },
        [{ ruleKey: RULE_KEYS.MENTION_DIPLOME, context: { variables: { moyenne: average } }, trace: false }],
      );
      if (!second.ok) return second;
      const mention = single(second.value, RULE_KEYS.MENTION_DIPLOME);
      if (!mention.ok) return mention;
      if (typeof mention.value.value !== "string") return err(rulesUnavailable("La règle « mention_diplome » doit rendre un code.", { ruleKey: RULE_KEYS.MENTION_DIPLOME }));
      return ok({ average, mentionCode: mention.value.value, rule: refOf(first.value) });
    },
  };
}
