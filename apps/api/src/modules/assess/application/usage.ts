/**
 * Un nœud de curriculum est-il utilisé par une évaluation ? (port `CurriculumUsageGuard` d'academic : un amendement
 * STRUCTUREL d'un curriculum publié — retrait, déplacement, caractère obligatoire — est refusé tant que des évaluations ou des
 * notes en dépendent). Lecture seule ; extension additive du module, sans nouvelle table.
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { inTx, type AssessDeps } from "./deps";

export async function isCurriculumNodeInUse(deps: AssessDeps, ctx: RequestContext, nodeId: string): Promise<Result<boolean, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await tx.queryOne<{ used: boolean }>("SELECT EXISTS (SELECT 1 FROM assess.assessments WHERE curriculum_node_id = $1) AS used", [nodeId]);
      return ok(r?.used === true);
    },
    { readOnly: true },
  );
}
