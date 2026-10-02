/**
 * academic -> payroll : `CurriculumLabelPort` (libellé et code d'un nœud de curriculum, pour les lignes de bulletin de paie).
 * Un nœud inconnu ou hors périmètre n'a simplement pas de libellé (le bulletin affiche alors l'identifiant technique).
 */
import type { RequestContext } from "@ecoledigitale/kernel";
import { getCurriculumNode, type AcademicDeps } from "../../modules/academic";
import type { CurriculumLabel, CurriculumLabelPort } from "../../modules/payroll";

export function createPayrollCurriculumLabelPort(academic: AcademicDeps): CurriculumLabelPort {
  return {
    async getLabels(ctx: RequestContext, nodeIds): Promise<ReadonlyMap<string, CurriculumLabel>> {
      const unique = [...new Set(nodeIds)];
      const out = new Map<string, CurriculumLabel>();
      for (const id of unique) {
        const r = await getCurriculumNode(academic, ctx, id);
        if (r.ok) out.set(id, { label: r.value.label, code: r.value.code });
      }
      return out;
    },
  };
}
