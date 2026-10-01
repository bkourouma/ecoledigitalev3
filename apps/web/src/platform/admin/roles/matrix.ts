/**
 * Matrice de permissions : regroupement par module, état des cases, différences (fonctions pures, testées).
 */

import type { RbacPermissionEntry } from "@ecoledigitale/contracts/v2/rbac";

export interface PermissionGroup {
  moduleKey: string;
  title: string;
  entries: RbacPermissionEntry[];
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Groupes par module (titre alphabétique, permissions par clé). `query` filtre sur clé, libellé et description. */
export function groupPermissions(entries: readonly RbacPermissionEntry[], query = "", fallbackTitle = "Autres"): PermissionGroup[] {
  const needle = fold(query.trim());
  const groups = new Map<string, PermissionGroup>();
  for (const entry of entries) {
    if (needle && !fold(`${entry.key} ${entry.label} ${entry.description ?? ""}`).includes(needle)) continue;
    let group = groups.get(entry.moduleKey);
    if (!group) {
      group = { moduleKey: entry.moduleKey, title: entry.moduleTitle ?? (entry.moduleKey || fallbackTitle), entries: [] };
      groups.set(entry.moduleKey, group);
    }
    group.entries.push(entry);
  }
  const out = [...groups.values()];
  for (const group of out) group.entries.sort((a, b) => a.key.localeCompare(b.key));
  return out.sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

export type GroupState = "all" | "some" | "none";

export function groupState(group: PermissionGroup, selected: ReadonlySet<string>): GroupState {
  const count = group.entries.filter((e) => selected.has(e.key)).length;
  if (count === 0) return "none";
  return count === group.entries.length ? "all" : "some";
}

export function togglePermission(selected: ReadonlySet<string>, key: string, on: boolean): Set<string> {
  const next = new Set(selected);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

/** (Dé)sélectionne un groupe ; en sélection, seules les permissions accordables sont ajoutées. */
export function toggleGroup(
  selected: ReadonlySet<string>,
  group: PermissionGroup,
  on: boolean,
  grantable: (key: string) => boolean,
): Set<string> {
  const next = new Set(selected);
  for (const entry of group.entries) {
    if (on) {
      if (grantable(entry.key)) next.add(entry.key);
    } else {
      next.delete(entry.key);
    }
  }
  return next;
}

export function diffPermissions(before: Iterable<string>, after: Iterable<string>): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: [...a].filter((k) => !b.has(k)).sort(),
    removed: [...b].filter((k) => !a.has(k)).sort(),
  };
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((k) => b.has(k));
}
