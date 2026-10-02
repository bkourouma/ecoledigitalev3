import type { AcademicCurriculumTreeNodeDto } from "@ecoledigitale/contracts/v2/academic";

export interface UeNode {
  id: string;
  code: string;
  label: string;
  nodeTypeCode: string;
  depth: number;
  credits: string | null;
}

/** Aplatit l'arbre d'une version du curriculum (ordre de lecture). */
export function flattenTree(nodes: ReadonlyArray<AcademicCurriculumTreeNodeDto>, depth = 0): UeNode[] {
  return nodes.flatMap((n) => [{ id: n.id, code: n.code, label: n.label, nodeTypeCode: n.nodeTypeCode, depth, credits: n.credits }, ...flattenTree(n.children, depth + 1)]);
}

/**
 * Éléments proposés comme UE : ceux dont le type de nœud porte des crédits (donnée de grammaire du curriculum). Aide de
 * sélection seulement : l'API refuse tout nœud qui n'est pas une UE. `creditTypes` inconnu (référentiel illisible) ou
 * `showAll` : tous les éléments.
 */
export function candidateUes(nodes: ReadonlyArray<UeNode>, creditTypes: ReadonlySet<string> | null, showAll: boolean): UeNode[] {
  if (showAll || creditTypes === null) return [...nodes];
  return nodes.filter((n) => creditTypes.has(n.nodeTypeCode));
}
