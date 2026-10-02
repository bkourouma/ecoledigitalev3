/**
 * Épinglage de la version de règle du contrat `exam-national@1` : la session retient la version applicable À SA DATE ; elle
 * ne change plus ensuite. Un fournisseur absent ou sans liaison donne `null` (jamais une valeur par défaut) : l'éligibilité
 * automatique et le calcul des examens blancs sont alors indisponibles (`examinations.no_rule_version`), la saisie manuelle de
 * l'éligibilité (avec auteur) reste possible.
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { ExaminationsDeps } from "./deps";
import type { RulePin } from "./ports";

export async function pinRuleVersion(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  input: { contractId: string; institutionId: string; levelCode: string | null; date: string },
): Promise<RulePin | null> {
  try {
    const resolved = await deps.ports.rules.resolve(ctx, input);
    if (!resolved.ok) {
      deps.logger.warn({ code: resolved.error.code, contractId: input.contractId }, "examinations : règle non épinglée (résolution refusée)");
      return null;
    }
    return resolved.value;
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e), contractId: input.contractId }, "examinations : règle non épinglée (port indisponible)");
    return null;
  }
}
