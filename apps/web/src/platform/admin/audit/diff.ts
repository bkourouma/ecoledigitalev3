/**
 * Mise en forme du diff d'audit (fonctions pures).
 *
 * Le serveur calcule le diff (`{ "<chemin>": { from?, to? } }`) sur les valeurs brutes puis masque les champs
 * sensibles (`[MASKED]`) : le web l'affiche tel quel, il ne recalcule rien. `from` seul = champ retiré, `to` seul = ajouté.
 */

export const MASKED_VALUE = "[MASKED]";

export type DiffKind = "added" | "removed" | "changed";

export interface DiffRow {
  path: string;
  kind: DiffKind;
  from: unknown;
  to: unknown;
  hasFrom: boolean;
  hasTo: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Chemin lisible : retire l'échappement `\.` / `\\` du serveur. */
export function displayPath(path: string): string {
  return path.replace(/\\([\\.])/g, "$1");
}

export function diffRows(diff: unknown): DiffRow[] {
  if (!isRecord(diff)) return [];
  const rows: DiffRow[] = [];
  for (const path of Object.keys(diff).sort()) {
    const entry = diff[path];
    if (!isRecord(entry)) continue;
    const hasFrom = "from" in entry;
    const hasTo = "to" in entry;
    rows.push({
      path,
      kind: hasFrom && hasTo ? "changed" : hasTo ? "added" : "removed",
      from: entry.from,
      to: entry.to,
      hasFrom,
      hasTo,
    });
  }
  return rows;
}

export function isMasked(value: unknown): boolean {
  return value === MASKED_VALUE;
}

/** Valeur affichable (texte brut ; React échappe). `undefined` -> chaîne vide. */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "";
}

export function countByKind(rows: readonly DiffRow[]): Record<DiffKind, number> {
  const counts: Record<DiffKind, number> = { added: 0, removed: 0, changed: 0 };
  for (const row of rows) counts[row.kind] += 1;
  return counts;
}
