/**
 * Aides des golden tests contre les snapshots de caractérisation du legacy (tests/characterization).
 *
 * Règle : les RuleSets de départ DOIVENT reproduire les sorties du legacy ; les seuls écarts acceptés sont ceux couverts par un
 * BOGUE CONNU du catalogue (`knownLegacyDefects`, statuts `bug` et `dead`). `compareWithTolerance` les classe en
 * `acceptedDivergences` ; tout autre écart est une dérive (`differences`) qui fait échouer le test.
 */
import { compareWithTolerance, loadScenario, loadSnapshot, type CompareOptions, type ComparisonResult, type Snapshot } from "../../../../../../../tests/characterization/compare";

export { compareWithTolerance, loadScenario, loadSnapshot };
export type { ComparisonResult, Snapshot };

/**
 * Ajoute des portées de CONSÉQUENCE aux occurrences d'un défaut : `consequences(path)` renvoie les motifs de chemins qui
 * divergent PAR CONSÉQUENCE de ce défaut (ex. le statut d'une ECUE qui change parce que sa validation à 10 change). Le
 * défaut reste l'unique cause acceptée ; les consequences ne sont déclarées que champ par champ, jamais pour tout un objet.
 */
export function withConsequences(snapshot: Snapshot, consequences: Record<string, (path: string) => string[]>): Snapshot {
  return {
    ...snapshot,
    knownLegacyDefects: snapshot.knownLegacyDefects.map((d) => {
      const extra = consequences[d.id]?.(d.path) ?? [];
      return extra.length === 0 ? d : { ...d, scope: [...d.scope, ...extra] };
    }),
  };
}

export function describeDifferences(result: ComparisonResult, limit = 25): string {
  const lines = result.differences.slice(0, limit).map((d) => `  ${d.path} : legacy=${JSON.stringify(d.expected)} v2=${JSON.stringify(d.actual)} (${d.kind})`);
  return `${result.differences.length} écart(s) non expliqué(s)\n${lines.join("\n")}${result.differences.length > limit ? "\n  …" : ""}`;
}

export function compareStrict(actual: unknown, snapshot: Snapshot, options: CompareOptions = {}): ComparisonResult {
  return compareWithTolerance(actual, snapshot, { knownDefects: "bugs", tolerance: 1e-9, ...options });
}
