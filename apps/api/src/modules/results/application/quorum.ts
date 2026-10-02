/**
 * Quorum d'un conseil des maîtres (spec 005 US8, contrats `coef-period@1` et `competency-period@1`, règle `quorum_conseil`).
 *
 * `primary_school` fournit les effectifs (convoqués, présents) ; la règle — et son seuil, une DONNÉE du jeu de règles — vit dans
 * `rules`. `results` ne fait que résoudre la version (l'épinglée de la période si l'état existe, sinon la version active à la
 * date de début de la période) et évaluer la règle : aucune formule, aucun pourcentage ici. Le résultat porte la provenance de
 * la version (`placeholder` ⇒ filigrane « règles de démonstration »).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { ResultsCode, conflict, notFound, validation } from "../domain/errors";
import { asBool } from "../domain/pipeline/runner";
import { getStateByKey } from "../infrastructure/states-repository";
import { inTx, type ResultsDeps } from "./deps";
import type { RulePin, RuleSourceKind } from "./ports";

const QUORUM_CONTRACTS: readonly string[] = ["coef-period@1", "competency-period@1"];

export interface EvaluateCouncilQuorumInput {
  readonly classroomId: string;
  readonly academicPeriodId: string;
  readonly convoked: number;
  readonly present: number;
}

export interface CouncilQuorumResult {
  /** `true` : quorum atteint ; `false` : non atteint. */
  readonly reached: boolean;
  readonly contractId: string;
  readonly pin: RulePin;
  readonly ruleSourceKind: RuleSourceKind;
}

export async function evaluateCouncilQuorum(deps: ResultsDeps, ctx: RequestContext, input: EvaluateCouncilQuorumInput): Promise<Result<CouncilQuorumResult, AppError>> {
  if (!Number.isInteger(input.convoked) || !Number.isInteger(input.present) || input.convoked < 0 || input.present < 0) {
    return err(validation(ResultsCode.INVALID_INPUT, "Les effectifs du conseil (convoqués, présents) sont des entiers positifs ou nuls.", "convoked"));
  }
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const structure = await deps.ports.curriculum.getStructure(ctx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId });
      if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum", `${input.classroomId}/${input.academicPeriodId}`));
      if (!QUORUM_CONTRACTS.includes(structure.contractId)) {
        return err(conflict(ResultsCode.UNSUPPORTED_CONTRACT, `Le contrat « ${structure.contractId} » ne définit pas de quorum de conseil.`, { contractId: structure.contractId }));
      }
      const state = await getStateByKey(tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, academicYearId: structure.academicYearId, scope: "PERIOD" });
      let pin: (RulePin & { contractId: string }) | null = null;
      if (state) {
        pin = { ruleVersionKind: state.ruleVersionKind, ruleVersionId: state.ruleVersionId, ruleSetCode: state.ruleSetCode, ruleVersionNo: state.ruleVersionNo, definitionHash: state.definitionHash, contractId: state.contractId };
      } else {
        const resolved = await deps.ports.rules.resolve(ctx, { contractId: structure.contractId, institutionId: structure.institutionId, levelCode: structure.levelCode, date: structure.period.startsOn });
        if (!resolved.ok) return resolved;
        pin = resolved.value;
      }
      if (!pin) {
        return err(conflict(ResultsCode.NO_ACTIVE_RULESET, "Aucun jeu de règles actif pour cette classe et cette période : liez un jeu de règles avant d'évaluer le quorum.", { contractId: structure.contractId, date: structure.period.startsOn }));
      }
      const session = await deps.ports.rules.open(ctx, pin);
      if (!session.ok) return session;
      const [result] = session.value.evaluator({ trace: false }).run([{ ruleKey: "quorum_conseil", variables: { convoques: input.convoked, presents: input.present } }]);
      if (!result || !result.ok) {
        return err(conflict(ResultsCode.CALCULATION_ERRORS, "Le quorum n'a pas pu être évalué par les règles.", { code: result && !result.ok ? result.code : "results.rule_missing_result", message: result && !result.ok ? result.message : "Aucun résultat de règle." }));
      }
      const reached = asBool(result.value);
      if (reached === null) return err(conflict(ResultsCode.CALCULATION_ERRORS, "La règle du quorum n'a pas rendu de booléen.", {}));
      return ok({ reached, contractId: pin.contractId, pin, ruleSourceKind: session.value.sourceKind });
    },
    { readOnly: true },
  );
}
