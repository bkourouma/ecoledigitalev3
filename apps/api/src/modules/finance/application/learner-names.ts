/**
 * Noms d'affichage des apprenants pour les listes et exports : UNE lecture par lot (port `learners.getLearnerNames`, branché sur
 * `people`), jamais une requête par apprenant. Sans le port, ou en cas d'échec, la liste reste servie SANS nom (décoration).
 * Les appels sont séquentiels (une connexion par transaction, voir `platform-assembly.md` §11).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import type { FinanceDeps } from "./deps";

export async function learnerNames(deps: FinanceDeps, ctx: RequestContext, ids: Iterable<string>): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  const port = deps.learners.getLearnerNames;
  if (unique.length === 0 || !port) return new Map();
  try {
    return await port.call(deps.learners, ctx, unique);
  } catch (e) {
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e) }, "finance : noms d'apprenants indisponibles (liste servie sans nom)");
    return new Map();
  }
}
