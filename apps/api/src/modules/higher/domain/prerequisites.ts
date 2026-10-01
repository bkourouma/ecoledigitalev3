/**
 * Graphe de prérequis entre UE (R-HIG-11) : détection de cycle (parité avec `wouldCreateUePrerequisiteCycle` du legacy)
 * et évaluation de satisfaction à partir du registre. Fonctions pures.
 */
import type { DecimalString, LedgerEntry, MissingPrerequisite, Prerequisite, PrerequisiteCheck, Uuid } from "./types";

/** Arêtes `UE -> prérequis` indexées par UE. */
export type PrerequisiteGraph = ReadonlyMap<Uuid, readonly Uuid[]>;

export function buildGraph(edges: ReadonlyArray<{ ueNodeId: Uuid; prerequisiteNodeId: Uuid }>): PrerequisiteGraph {
  const g = new Map<Uuid, Uuid[]>();
  for (const e of edges) {
    const list = g.get(e.ueNodeId);
    if (list) list.push(e.prerequisiteNodeId);
    else g.set(e.ueNodeId, [e.prerequisiteNodeId]);
  }
  return g;
}

/**
 * Chemin `from -> … -> to` dans le graphe des prérequis (parcours itératif, tolérant aux cycles déjà présents), ou `null`.
 * Sert aussi à expliquer un cycle à l'utilisateur.
 */
export function findPath(graph: PrerequisiteGraph, from: Uuid, to: Uuid): Uuid[] | null {
  const parent = new Map<Uuid, Uuid | null>([[from, null]]);
  const queue: Uuid[] = [from];
  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i] as Uuid;
    if (node === to) {
      const path: Uuid[] = [];
      for (let cur: Uuid | null = node; cur !== null; cur = parent.get(cur) ?? null) path.push(cur);
      return path.reverse();
    }
    for (const next of graph.get(node) ?? []) {
      if (!parent.has(next)) {
        parent.set(next, node);
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * Ajouter les prérequis `prerequisites` à `ueNodeId` créerait-il un cycle ? Les arêtes déjà présentes de `ueNodeId`
 * sont REMPLACÉES (on remplace la liste). Renvoie le cycle trouvé (`ue -> … -> ue`) ou `null`.
 */
export function wouldCreateCycle(graph: PrerequisiteGraph, ueNodeId: Uuid, prerequisites: readonly Uuid[]): Uuid[] | null {
  const without = new Map(graph);
  without.delete(ueNodeId);
  for (const p of prerequisites) {
    if (p === ueNodeId) return [ueNodeId, ueNodeId];
    // Il y a un cycle si le prérequis `p` mène déjà (par ses propres prérequis) à `ueNodeId`.
    const path = findPath(without, p, ueNodeId);
    if (path) return [ueNodeId, ...path];
  }
  return null;
}

export interface AcquiredUe {
  readonly ueNodeId: Uuid;
  readonly averageExact: DecimalString | null;
}

/** Plus petit-ou-égal entre deux chaînes décimales positives, sans passer par le flottant. */
export function decimalGte(a: DecimalString, b: DecimalString): boolean {
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const ni = Number(ai);
  const nj = Number(bi);
  if (ni !== nj) return ni > nj;
  const width = Math.max(af.length, bf.length);
  return af.padEnd(width, "0") >= bf.padEnd(width, "0");
}

/**
 * Satisfaction des prérequis d'une UE. `acquired` : écritures valables du registre (ACQUIRED, non expirées) ;
 * `attended` : UE que l'étudiant a suivies (mode ATTENDED, fourni par le registre de cours d'`academic`).
 */
export function evaluatePrerequisites(
  prerequisites: readonly Prerequisite[],
  acquired: ReadonlyArray<Pick<LedgerEntry, "ueNodeId" | "averageExact">>,
  attended: ReadonlySet<Uuid> = new Set(),
): PrerequisiteCheck {
  const byUe = new Map(acquired.map((e) => [e.ueNodeId, e]));
  const missing: MissingPrerequisite[] = [];
  for (const p of prerequisites) {
    const entry = byUe.get(p.prerequisiteNodeId);
    const base = { prerequisiteNodeId: p.prerequisiteNodeId, mode: p.mode, minAverage: p.minAverage };
    switch (p.mode) {
      case "VALIDATED":
        if (!entry) missing.push({ ...base, reason: "NOT_ACQUIRED" });
        break;
      case "ATTENDED":
        if (!entry && !attended.has(p.prerequisiteNodeId)) missing.push({ ...base, reason: "NOT_ATTENDED" });
        break;
      case "MIN_AVERAGE":
        if (!entry) missing.push({ ...base, reason: "NOT_ACQUIRED" });
        else if (p.minAverage !== null && (entry.averageExact === null || !decimalGte(entry.averageExact, p.minAverage))) missing.push({ ...base, reason: "AVERAGE_TOO_LOW" });
        break;
    }
  }
  return { satisfied: missing.length === 0, missing };
}
