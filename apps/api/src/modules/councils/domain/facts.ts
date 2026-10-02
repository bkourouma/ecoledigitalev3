/**
 * Instantané de faits `council-facts/1` d'un élève (spec 006 AC1.2-AC1.7) — assemblage PUR.
 *
 * AUCUN CALCUL : le module copie ce que `results`, `attendance` et `schoollife` lui donnent (moyennes en chaînes décimales
 * exactes, comptages entiers). Il ne calcule ni moyenne, ni rang, ni mention, ni total. Le contenu n'a que des chaînes, entiers,
 * booléens et `null` (jamais un flottant) ; un flottant est refusé ici ET par le schéma du contrat. Minimisation : de la vie
 * scolaire, des comptages et des codes seulement — jamais un texte libre ni un élément confidentiel (garanti par le port).
 */
import { COUNCIL_FACTS_SCHEMA, councilsFactsSchema, findNonExactNumber, type CouncilsFacts } from "@ecoledigitale/contracts/src/v2/councils";

export type ResultsFacts = NonNullable<CouncilsFacts["results"]>;
export type AttendanceFacts = NonNullable<CouncilsFacts["attendance"]>;
export type DisciplineFacts = NonNullable<CouncilsFacts["discipline"]>;
export type FundingFacts = CouncilsFacts["funding"];

export interface FactsSources {
  readonly results: ResultsFacts | null;
  readonly attendance: AttendanceFacts | null;
  readonly discipline: DisciplineFacts | null;
  readonly funding: FundingFacts;
  readonly repeating: boolean;
}

/** Aucun résultat exploitable : pas de résultat, résultat en erreur, ou aucune note publiée (moyenne absente). */
export function isMissingResults(r: { status: string | null; average: string | null } | null): boolean {
  return r === null || r.status === null || r.status === "ERROR" || r.average === null;
}

export class InvalidFactsError extends Error {
  constructor(readonly path: string) {
    super(`Instantané de faits refusé : valeur non exacte (flottant ou type interdit) en ${path}.`);
    this.name = "InvalidFactsError";
  }
}

/** Assemble l'instantané. Lève `InvalidFactsError` si un flottant s'est glissé dans une source. */
export function buildFacts(src: FactsSources): CouncilsFacts {
  const facts: CouncilsFacts = {
    schema: COUNCIL_FACTS_SCHEMA,
    results: src.results === null ? null : { ...src.results, missingResults: isMissingResults(src.results) },
    attendance: src.attendance,
    discipline: src.discipline,
    funding: src.funding,
    repeating: src.repeating,
  };
  const bad = findNonExactNumber(facts);
  if (bad) throw new InvalidFactsError(bad);
  const parsed = councilsFactsSchema.safeParse(facts);
  if (!parsed.success) throw new InvalidFactsError(parsed.error.issues[0]?.path.join(".") ?? "$");
  return parsed.data;
}

/** Un élève dont les résultats sont absents (port `results` sans donnée pour lui) : `results: null` est lui aussi « manquant ». */
export const missingResultsOf = (facts: CouncilsFacts | null): boolean => facts === null || facts.results === null || facts.results.missingResults;

/**
 * Code proposé par une règle qui n'est PAS une décision ferme : le conseil tranche. Structure du contrat de règles (jamais une
 * valeur réglementaire) : `COUNCIL_REVIEW` renvoie au conseil, `PENDING` signale « en attente ».
 */
export const NON_FIRM_SUGGESTION_CODES: readonly string[] = Object.freeze(["COUNCIL_REVIEW", "PENDING"]);
export const isFirmSuggestion = (code: string): boolean => !NON_FIRM_SUGGESTION_CODES.includes(code);

export function suggestionsOf(facts: CouncilsFacts | null, kind: "DECISION" | "DISTINCTION" | "APPRECIATION"): Array<{ code: string; ref: string | null }> {
  return (facts?.results?.suggestions ?? []).filter((s) => s.kind === kind).map((s) => ({ code: s.code, ref: s.ref }));
}
