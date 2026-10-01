/**
 * Un nœud de curriculum porte-t-il des résultats ? (port `CurriculumUsageGuard` d'academic, avec `assess` : un amendement
 * STRUCTUREL d'un curriculum publié est refusé tant qu'un résultat — brouillon ou FINAL — référence ce nœud.) Lecture seule ;
 * extension additive du module, sans nouvelle table.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { inTx, type ResultsDeps } from "./deps";

export async function isCurriculumNodeInResults(deps: ResultsDeps, ctx: RequestContext, nodeId: string): Promise<Result<boolean, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await tx.queryOne<{ used: boolean }>("SELECT EXISTS (SELECT 1 FROM results.line_results WHERE curriculum_node_id = $1) AS used", [nodeId]);
      return ok(r?.used === true);
    },
    { readOnly: true },
  );
}
