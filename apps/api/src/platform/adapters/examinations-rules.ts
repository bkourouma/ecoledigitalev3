/**
 * rules -> examinations : `RulesPort` — résolution de la version du contrat `exam-national@1` applicable à la date de la session
 * (épinglée ensuite), puis évaluation par lot de la version ÉPINGLÉE (éligibilité, moyenne et issue d'un examen blanc, rang, taux).
 *
 * Passe par l'API publique du module `rules` (`RulesApi`) : jamais par le moteur ni par ses tables. La version est rechargée et son
 * empreinte de définition vérifiée par `rules` avant tout calcul ; l'évaluateur rendu est SYNCHRONE (la version est déjà compilée).
 * Un contrat inconnu de `rules` (`exam-national@1` pas encore livré) rend une erreur que `examinations` traite comme « aucune règle
 * épinglée » : éligibilité automatique et calcul d'examen blanc indisponibles, jamais de valeur par défaut.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { RulesApi } from "../../modules/rules";
import type { RuleCallResult, RulePin, RuleSession, RulesPort } from "../../modules/examinations";

export function createExaminationsRulesPort(api: RulesApi): RulesPort {
  return {
    async resolve(ctx: RequestContext, input): Promise<Result<RulePin | null, AppError>> {
      const r = await api.resolve(ctx, {
        contractId: input.contractId,
        institutionId: input.institutionId,
        ...(input.levelCode ? { levelCode: input.levelCode } : {}),
        date: input.date,
      });
      if (!r.ok) return r;
      const v = r.value.resolved;
      if (!v) return ok(null);
      // L'origine (`placeholder`, `regulation`…) est lue à l'ouverture de la version : elle pilote le bandeau « règles de démonstration ».
      return ok({ ruleVersionId: v.ruleVersionId, ruleSetCode: v.ruleSetCode, versionNo: v.versionNo, sourceKind: null });
    },

    async open(ctx: RequestContext, ruleVersionId: string): Promise<Result<RuleSession, AppError>> {
      const loaded = await api.loadVersion(ctx, ruleVersionId);
      if (!loaded.ok) return err(loaded.error);
      const compiled = loaded.value;
      const pin: RulePin = { ruleVersionId, ruleSetCode: compiled.version.ruleSetCode, versionNo: compiled.version.versionNo, sourceKind: String(compiled.version.source.kind) };
      return ok({
        pin,
        engineVersion: compiled.engineVersion,
        evaluate(calls): RuleCallResult[] {
          const outputs = api.evaluateMany(
            compiled,
            calls.map((c) => ({ ruleKey: c.ruleKey, context: { variables: c.variables as never }, trace: false })),
          );
          return outputs.map((o): RuleCallResult => (o.ok ? { ok: true, value: o.value.value, inputsHash: o.value.inputsHash } : { ok: false, code: o.error.code, message: o.error.message }));
        },
      });
    },
  };
}
