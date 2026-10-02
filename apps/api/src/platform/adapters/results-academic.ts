/**
 * results -> academic : `PromotionDecisionPort` (décision de passage de fin d'année d'une inscription).
 *
 * `results` répond (décision de fin d'année confirmée, ou année validée du contrat à crédits) ; academic ne calcule JAMAIS un
 * passage : sans décision confirmée, l'inscription reste « issue manquante » dans la reconduction annuelle.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { PromotionDecision, PromotionDecisionPort } from "../../modules/academic";
import { listPromotionOutcomes, type ResultsDeps } from "../../modules/results";

export function createAcademicPromotionDecisions(results: ResultsDeps): PromotionDecisionPort {
  return {
    async listDecisions(ctx: RequestContext, input): Promise<PromotionDecision[]> {
      const r = await listPromotionOutcomes(results, ctx, { academicYearId: input.academicYearId, enrollmentIds: input.enrollmentIds });
      if (!r.ok) throw r.error;
      return r.value.map((o) => ({ enrollmentId: o.enrollmentId, kind: o.kind, sourceCode: o.code }));
    },
  };
}
