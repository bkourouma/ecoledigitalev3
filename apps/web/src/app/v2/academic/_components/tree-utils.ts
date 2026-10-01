/**
 * Mise en forme de données pour l'affichage en arbre (aucune règle métier) : la grammaire du curriculum, les cycles et les
 * parents autorisés sont contrôlés par l'API.
 */

export interface Forest<T> {
  item: T;
  children: Array<Forest<T>>;
}

/** Transforme une liste plate (avec identifiant de parent) en forêt ; un parent absent de la liste rend le nœud racine. */
export function buildForest<T>(items: ReadonlyArray<T>, getId: (item: T) => string, getParentId: (item: T) => string | null, compare?: (a: T, b: T) => number): Array<Forest<T>> {
  const nodes = new Map<string, Forest<T>>();
  for (const item of items) nodes.set(getId(item), { item, children: [] });
  const roots: Array<Forest<T>> = [];
  for (const item of items) {
    const node = nodes.get(getId(item))!;
    const parentId = getParentId(item);
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  if (compare) {
    const sort = (list: Array<Forest<T>>) => {
      list.sort((a, b) => compare(a.item, b.item));
      list.forEach((n) => sort(n.children));
    };
    sort(roots);
  }
  return roots;
}

/** Réordonne `ids` en déplaçant l'élément `from` vers `to` et renvoie les nouvelles positions (pas de 10) à écrire. */
export function computeReorder(siblings: ReadonlyArray<{ id: string; ordinal: number }>, from: number, to: number): Array<{ id: string; ordinal: number }> {
  if (from === to || from < 0 || to < 0 || from >= siblings.length || to >= siblings.length) return [];
  const order = siblings.map((s) => s.id);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  const current = new Map(siblings.map((s) => [s.id, s.ordinal]));
  const updates: Array<{ id: string; ordinal: number }> = [];
  order.forEach((id, index) => {
    const ordinal = index * 10;
    if (current.get(id) !== ordinal) updates.push({ id, ordinal });
  });
  return updates;
}

export function countNodes<T extends { children: T[] }>(roots: ReadonlyArray<T>): number {
  return roots.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

export function flattenForest<T extends { children: T[] }>(roots: ReadonlyArray<T>, depth = 0, out: Array<{ node: T; depth: number }> = []): Array<{ node: T; depth: number }> {
  for (const n of roots) {
    out.push({ node: n, depth });
    flattenForest(n.children, depth + 1, out);
  }
  return out;
}
