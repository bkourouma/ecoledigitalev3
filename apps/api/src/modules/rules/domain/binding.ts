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
  /** Code du cycle d'enseignement (ex. `PRIMARY`, `PRESCHOOL`) : une liaison par niveau peut aussi viser le cycle (moins spécifique que le niveau fin). */
  readonly educationLevelCode?: string | undefined;
  /** « AAAA-MM-JJ » */
  readonly date: string;
}

const NODE = 100;
const LEVEL = 50;
const EDUCATION_LEVEL = 45;
const INSTITUTION = 10;

export function bindingSpecificity(b: Pick<BindingRecord, "curriculumNodeId" | "levelCode" | "institutionId">, q?: Pick<BindingQuery, "levelCode" | "educationLevelCode">): number {
  // une liaison dont le code est celui du niveau fin est plus spécifique que celle qui vise le cycle d'enseignement
  const level = b.levelCode ? (q && q.levelCode !== b.levelCode && q.educationLevelCode === b.levelCode ? EDUCATION_LEVEL : LEVEL) : 0;
  return (b.curriculumNodeId ? NODE : 0) + level + (b.institutionId ? INSTITUTION : 0);
}

export function bindingApplies(b: BindingRecord, q: BindingQuery): boolean {
  if (b.contractId !== q.contractId) return false;
  if (b.effectiveFrom > q.date) return false;
  if (b.effectiveTo !== null && q.date > b.effectiveTo) return false;
  if (b.institutionId !== null && b.institutionId !== q.institutionId) return false;
  if (b.curriculumNodeId !== null && b.curriculumNodeId !== q.curriculumNodeId) return false;
  if (b.levelCode !== null && b.levelCode !== q.levelCode && b.levelCode !== q.educationLevelCode) return false;
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
    const sb = bindingSpecificity(b, q);
    const sBest = bindingSpecificity(best, q);
    if (sb > sBest || (sb === sBest && (b.effectiveFrom > best.effectiveFrom || (b.effectiveFrom === best.effectiveFrom && b.id < best.id)))) best = b;
  }
  return best;
}
