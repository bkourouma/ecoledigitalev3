/**
 * Contrat `competency-period@1` — maternelle : évaluation par compétences, SANS note, moyenne ni rang.
 *
 * Référence fonctionnelle : specs/v2/005-primary/rule-contract.md §2. `results` n'exécute que deux règles (pipeline minimal :
 * décision sans moyenne). La règle ne décide JAMAIS seule : le conseil décide ; `competences_*` viennent des COMPTEURS du
 * module `primary_school` (nombre de compétences évaluées vs attendues), jamais d'un niveau de maîtrise.
 */
import type { ContractRule, RuleContract } from "./types";
import { contractRule as rule } from "./builder";

export const COMPETENCY_PERIOD_ID = "competency-period@1";

export const COMPETENCY_PERIOD_RULES = {
  DECISION_FIN_ANNEE: "decision_fin_annee",
  QUORUM_CONSEIL: "quorum_conseil",
} as const;

export const COMPETENCY_YEAR_DECISION_CODES = ["PENDING", "COUNCIL_REVIEW"] as const;

const R = COMPETENCY_PERIOD_RULES;

const rules: readonly ContractRule[] = Object.freeze([
  rule(
    R.DECISION_FIN_ANNEE,
    "repetition",
    { variables: { competences_evaluees: "number", competences_attendues: "number", redoublements_cycle: "number" } },
    "string",
    "Décision de fin d'année sans note : en attente tant que toutes les compétences attendues ne sont pas évaluées, puis dossier à examiner par le conseil.",
    { outputCodes: COMPETENCY_YEAR_DECISION_CODES },
  ),
  rule(R.QUORUM_CONSEIL, "promotion", { variables: { convoques: "number", presents: "number" } }, "boolean", "Quorum du conseil des maîtres."),
]);

export const competencyPeriodContract: RuleContract = Object.freeze({
  id: COMPETENCY_PERIOD_ID,
  name: "Évaluation par compétences (maternelle)",
  description: "Décision de fin d'année sans note ni moyenne (la règle ne décide jamais seule) et quorum du conseil.",
  rules,
  pipeline: Object.freeze([
    { stage: "annee", rules: [R.DECISION_FIN_ANNEE], description: "À la clôture de la dernière période : proposition de décision à partir des compteurs de compétences." },
    { stage: "conseil", rules: [R.QUORUM_CONSEIL], description: "Par séance du conseil : quorum." },
  ]),
});
