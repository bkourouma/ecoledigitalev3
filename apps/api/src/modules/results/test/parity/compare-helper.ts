/**
 * Comparaison de parité : `compareWithTolerance` (tests/characterization/compare.ts) appliquée à la projection de `results`
 * et au MÊME sous-ensemble de la snapshot du legacy. Les divergences tolérées sont (1) les bogues connus du catalogue
 * (`knownLegacyDefects`, statuts `bug` et `dead`, plus `quirk` si demandé) et (2) les DIVERGENCES DOCUMENTÉES du scénario
 * (décisions v2 qui diffèrent volontairement du legacy sans être un bogue catalogué : chacune porte sa justification).
 */
import { compareWithTolerance, pathMatches, type ComparisonResult, type Difference, type Snapshot } from "../../../../../../../tests/characterization/compare";

export interface DocumentedDivergence {
  /** Motif de chemin (même syntaxe que `compare.ts`). */
  pattern: string;
  /** Pourquoi la v2 diffère (citer la décision métier ou la règle). */
  reason: string;
}

export interface ParityOutcome {
  result: ComparisonResult;
  /** Écarts ni catalogués ni documentés : toute entrée ici est une régression ou une divergence à documenter. */
  unexplained: Difference[];
  /** Écarts couverts par une divergence documentée, avec sa justification. */
  documented: Array<Difference & { reason: string }>;
}

/**
 * Identifiants des défauts du catalogue dont le statut est `bug` (valeur fausse au regard de la règle écrite du legacy), et
 * éventuellement `quirk`. Les défauts `dead` (`RULES_NOT_WIRED_*` : fonction jamais appelée) ne sont PAS tolérés : leur portée est
 * un sous-arbre entier par étudiant, ce qui masquerait des écarts qui n'ont rien à voir avec elle ; un écart réel doit être
 * expliqué par un vrai bogue ou par une divergence documentée du scénario.
 */
export function toleratedDefectIds(snapshot: Snapshot, statuses: ReadonlyArray<"bug" | "quirk" | "dead"> = ["bug"]): string[] {
  const ids = new Set<string>();
  for (const d of snapshot.knownLegacyDefects) {
    const status = snapshot.defectCatalog[d.id]?.status as "bug" | "quirk" | "dead" | undefined;
    if (status && statuses.includes(status)) ids.add(d.id);
  }
  return [...ids];
}

export function runParity(actual: unknown, expected: unknown, snapshot: Snapshot, options: { statuses?: ReadonlyArray<"bug" | "quirk" | "dead">; documented?: DocumentedDivergence[]; tolerance?: number } = {}): ParityOutcome {
  const result = compareWithTolerance(actual, { ...snapshot, data: expected }, { knownDefects: toleratedDefectIds(snapshot, options.statuses), tolerance: options.tolerance ?? 1e-9 });
  const docs = options.documented ?? [];
  const documented: ParityOutcome["documented"] = [];
  const unexplained: Difference[] = [];
  for (const d of result.differences) {
    const hit = docs.find((x) => pathMatches(x.pattern, d.path));
    if (hit) documented.push({ ...d, reason: hit.reason });
    else unexplained.push(d);
  }
  return { result, unexplained, documented };
}

export function describeDifferences(list: readonly Difference[], limit = 60): string {
  return list
    .slice(0, limit)
    .map((d) => `${d.path}  [${d.kind}]  legacy=${JSON.stringify(d.expected)}  v2=${JSON.stringify(d.actual)}`)
    .join("\n");
}
