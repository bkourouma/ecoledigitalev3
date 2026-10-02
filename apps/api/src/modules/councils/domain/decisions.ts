/**
 * Décision du conseil : trace de la suggestion de la règle et exigences de justification (spec 006 AC1.5, AC3.3). Domaine pur.
 *
 *  - La suggestion et la décision sont conservées CÔTE À CÔTE, jamais écrasées (parité R-RES-05 de 011).
 *  - S'écarter d'une suggestion FERME de la règle (famille PASSAGE ou REPEAT) exige une justification d'au moins 20 caractères
 *    (contrainte de table `differs_from_suggestion`) ; décider un passage ou un redoublement pour un élève SANS résultat
 *    exploitable exige la même justification.
 *  - Aucune règle de décision ici : on compare des CODES fournis par `results`, on ne calcule rien.
 */
import type { CouncilsFacts } from "@ecoledigitale/contracts/src/v2/councils";
import { isFirmSuggestion, missingResultsOf, suggestionsOf } from "./facts";

export const JUSTIFICATION_MIN_FOR_DIFFERENCE = 20;
export const YEAR_OUTCOME_FAMILIES: readonly string[] = Object.freeze(["PASSAGE", "REPEAT"]);
export const isYearOutcomeFamily = (family: string): boolean => YEAR_OUTCOME_FAMILIES.includes(family);

export interface SuggestionTrace {
  readonly suggestedCode: string | null;
  readonly suggestionRef: string | null;
  readonly differsFromSuggestion: boolean;
}

/** `finalCode` : code que le type de décision écrirait dans `results` (`decision_types.results_final_code`). */
export function traceSuggestion(input: { facts: CouncilsFacts | null; family: string; finalCode: string | null }): SuggestionTrace {
  const firm = suggestionsOf(input.facts, "DECISION").find((s) => isFirmSuggestion(s.code));
  if (!firm) return { suggestedCode: null, suggestionRef: null, differsFromSuggestion: false };
  const differs = isYearOutcomeFamily(input.family) && input.finalCode !== firm.code;
  return { suggestedCode: firm.code, suggestionRef: firm.ref, differsFromSuggestion: differs };
}

/** Longueur minimale de justification exigée par cette décision (0 : aucune exigence propre au domaine ; la base contrôle celles du type). */
export function requiredJustificationLength(input: { family: string; differsFromSuggestion: boolean; facts: CouncilsFacts | null }): number {
  if (input.differsFromSuggestion) return JUSTIFICATION_MIN_FOR_DIFFERENCE;
  if (isYearOutcomeFamily(input.family) && missingResultsOf(input.facts)) return JUSTIFICATION_MIN_FOR_DIFFERENCE;
  return 0;
}
