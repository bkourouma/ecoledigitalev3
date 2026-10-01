/**
 * Liaisons : quel jeu de règles pour quel périmètre (contrat × établissement / niveau / nœud × dates).
 * Résolution PURE : la date est un paramètre (début de la période), jamais l'horloge (R-RUL-05).
 *
 * Spécificité : nœud de curriculum > niveau > établissement > tout le tenant (data-model.md §3.1).
 */
import type { BindingRecord } from "./types";

export interface BindingQuery {
  readonly contractId: string;
  readonly institutionId?: string | undefined;
  readonly curriculumNodeId?: string | undefined;
  readonly levelCode?: string | undefined;
  /** « AAAA-MM-JJ » */
  readonly date: string;
}

const NODE = 100;
const LEVEL = 50;
const INSTITUTION = 10;

export function bindingSpecificity(b: Pick<BindingRecord, "curriculumNodeId" | "levelCode" | "institutionId">): number {
  return (b.curriculumNodeId ? NODE : 0) + (b.levelCode ? LEVEL : 0) + (b.institutionId ? INSTITUTION : 0);
}

export function bindingApplies(b: BindingRecord, q: BindingQuery): boolean {
  if (b.contractId !== q.contractId) return false;
  if (b.effectiveFrom > q.date) return false;
  if (b.effectiveTo !== null && q.date > b.effectiveTo) return false;
  if (b.institutionId !== null && b.institutionId !== q.institutionId) return false;
  if (b.curriculumNodeId !== null && b.curriculumNodeId !== q.curriculumNodeId) return false;
  if (b.levelCode !== null && b.levelCode !== q.levelCode) return false;
  return true;
}

/** La liaison la plus spécifique applicable ; à égalité : début d'effet le plus récent, puis identifiant (déterministe). */
export function selectBinding(bindings: readonly BindingRecord[], q: BindingQuery): BindingRecord | null {
  let best: BindingRecord | null = null;
  for (const b of bindings) {
    if (!bindingApplies(b, q)) continue;
    if (best === null) {
      best = b;
      continue;
    }
    const sb = bindingSpecificity(b);
    const sBest = bindingSpecificity(best);
    if (sb > sBest || (sb === sBest && (b.effectiveFrom > best.effectiveFrom || (b.effectiveFrom === best.effectiveFrom && b.id < best.id)))) best = b;
  }
  return best;
}
