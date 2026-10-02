/**
 * Implémentation RÉELLE du port `RulesPort` : passe par l'API publique du module `rules` (`RulesApi`) — jamais par le
 * moteur ni par ses tables. La version épinglée est rechargée et son hash de définition vérifié avant tout calcul ;
 * l'évaluateur rendu est SYNCHRONE (la version est déjà compilée en mémoire) : une passe par étape pour toute la classe.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { RulesCode, type RulesApi } from "../../rules";
import { ResultsCode, conflict } from "../domain/errors";
import type { BatchEvaluator, CallResult } from "../domain/pipeline/runner";
import type { ResolveRequest, RulePin, RuleSourceKind, RulesPort, RuleSession } from "../application/ports";

export function rulesPortFrom(api: RulesApi): RulesPort {
  return {
    async resolve(ctx: RequestContext, request: ResolveRequest): Promise<Result<(RulePin & { contractId: string }) | null, AppError>> {
      const r = await api.resolve(ctx, {
        contractId: request.contractId,
        ...(request.institutionId ? { institutionId: request.institutionId } : {}),
        ...(request.levelCode ? { levelCode: request.levelCode } : {}),
        date: request.date,
      });
      if (!r.ok) return r;
      const v = r.value.resolved;
      if (!v) return ok(null);
      return ok({
        ruleVersionKind: v.origin === "national" ? "NATIONAL" : "TENANT",
        ruleVersionId: v.ruleVersionId,
        ruleSetCode: v.ruleSetCode,
        ruleVersionNo: v.versionNo,
        definitionHash: v.definitionHash,
        contractId: v.contractId,
      });
    },

    async sourceKindOf(ctx: RequestContext, pin: RulePin): Promise<RuleSourceKind | null> {
      const loaded = await api.loadVersion(ctx, pin.ruleVersionId);
      return loaded.ok ? loaded.value.version.source.kind : null;
    },

    async open(ctx: RequestContext, pin: RulePin & { contractId: string }): Promise<Result<RuleSession, AppError>> {
      const loaded = await api.loadVersion(ctx, pin.ruleVersionId);
      if (!loaded.ok) return loaded;
      const compiled = loaded.value;
      if (compiled.definitionHash !== pin.definitionHash) {
        return err(conflict(ResultsCode.HASH_MISMATCH, "La version de règle épinglée ne correspond plus à son empreinte : calcul bloqué.", { ruleVersionId: pin.ruleVersionId, rulesCode: RulesCode.HASH_MISMATCH }));
      }
      const defined = new Set(compiled.rules.map((r) => r.key));
      return ok({
        pin,
        engineVersion: compiled.engineVersion,
        contractId: pin.contractId,
        sourceKind: compiled.version.source.kind,
        hasRule: (ruleKey: string) => defined.has(ruleKey),
        evaluator(options: { trace: boolean }): BatchEvaluator {
          return {
            run(calls) {
              const outputs = api.evaluateMany(
                compiled,
                calls.map((c) => ({ ruleKey: c.ruleKey, context: { variables: c.variables }, trace: options.trace })),
              );
              return outputs.map((o): CallResult =>
                o.ok
                  ? { ok: true, value: o.value.value, inputsHash: o.value.inputsHash, outputsHash: o.value.outputsHash, nodesEvaluated: o.value.nodesEvaluated, ...(options.trace ? { trace: o.value.trace } : {}) }
                  : { ok: false, code: o.error.code, message: o.error.message },
              );
            },
          };
        },
      });
    },
  };
}
