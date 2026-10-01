/**
 * Contrat `coef-semester@1` — matières à coefficients (pile « classique » et BTS).
 *
 * Référence fonctionnelle : specs/v2/012-rules-engine/rule-contracts.md §3. Formules déjà en production
 * (apps/api/src/routes/semester-averages.ts) ; aucune règle réglementaire n'est inventée.
 *
 * Défauts du legacy volontairement NON reproduits : « 2ᵉ semestre » deviné d'après le NOM de la période (le module
 * fournit `second_semestre`, issu du type/rang de la période), BTS 2ᵉ année deviné d'après le NOM de la classe
 * (`examen_terminal_requis`, attribut de la donnée de curriculum), décision lue dans un libellé
 * (`buildAssignmentFlagsFromDecision` : l'indicateur « redoublant » se déduit du CODE `REPEAT`), flottants binaires.
 */
import type { ContractRule, RuleContract } from "./types";
import type { RuleSchemaSpec, ResultTypeSpec, RuleType } from "../engine";
import type { ContractParameter } from "./types";
import { COUNCIL_APPRECIATION_CODES, MENTION_CODES } from "./credit-semester";

export const COEF_SEMESTER_ID = "coef-semester@1";

export const COEF_SEMESTER_RULES = {
  MOYENNE_MATIERE: "moyenne_matiere",
  MOYENNE_PONDEREE: "moyenne_ponderee",
  MOYENNE_SECTION: "moyenne_section",
  MOYENNE_ANNUELLE: "moyenne_annuelle",
  MENTION: "mention",
  DECISION_CONSEIL: "decision_conseil",
  DECISION_FIN_ANNEE: "decision_fin_annee",
  DISTINCTION: "distinction",
  APPRECIATION_CONSEIL: "appreciation_conseil",
  ARRONDI_AFFICHAGE: "arrondi_affichage",
  RANG: "rang",
} as const;

export const COUNCIL_DECISION_CODES = ["INCOMPLETE", "PERIOD_VALIDATED", "REINFORCEMENT_ADVISED", "PERIOD_NOT_VALIDATED"] as const;
export const END_OF_YEAR_DECISION_CODES = ["PENDING", "EXAM_REFERRAL", "PROMOTED", "REPEAT"] as const;
export const DISTINCTION_CODES = ["NONE", "HONOR_ROLL", "HONOR_ROLL_ENCOURAGEMENT", "HONOR_ROLL_CONGRATS"] as const;

const none: Readonly<Record<string, ContractParameter>> = Object.freeze({});

function rule(
  key: string,
  type: RuleType,
  inputs: RuleSchemaSpec,
  result: ResultTypeSpec,
  description: string,
  outputCodes: readonly string[] = [],
): ContractRule {
  return Object.freeze({ key, type, optional: false, inputs, result, outputCodes: Object.freeze([...outputCodes]), parameters: none, description });
}

const COURSES = { list: { object: { score: "number?", coef: "number" } } } as const;
const R = COEF_SEMESTER_RULES;

const rules: readonly ContractRule[] = Object.freeze([
  rule(
    R.MOYENNE_MATIERE,
    "assessment_aggregation",
    { variables: { notes: { list: { object: { note: "number", bareme: "number", poids: "number", type: "string" } } } } },
    "number?",
    "Moyenne d'une matière : notes ramenées sur 20, pondérées par le poids de l'évaluation (valeur par défaut proposée : aucune formule n'existait, la moyenne était saisie à la main).",
  ),
  rule(R.MOYENNE_PONDEREE, "period_average", { variables: { matieres: COURSES } }, "number?", "Moyenne de période pondérée par les coefficients, sur les matières notées."),
  rule(R.MOYENNE_SECTION, "period_average", { variables: { matieres: COURSES } }, "number?", "Sous-moyenne d'une section (type de bilan), même formule que la moyenne pondérée."),
  rule(
    R.MOYENNE_ANNUELLE,
    "annual_average",
    { variables: { s1: "number?", s2: "number?", second_semestre: "boolean" } },
    "number?",
    "Moyenne annuelle pondérée entre les deux semestres au 2ᵉ semestre ; sinon moyenne du semestre.",
  ),
  rule(R.MENTION, "mention", { variables: { moyenne: "number?" } }, "string", "Mention de la moyenne.", MENTION_CODES),
  rule(R.DECISION_CONSEIL, "promotion", { variables: { moyenne: "number?" } }, "string", "Décision du conseil de période.", COUNCIL_DECISION_CODES),
  rule(
    R.DECISION_FIN_ANNEE,
    "repetition",
    { variables: { moyenne: "number?", second_semestre: "boolean", examen_terminal_requis: "boolean" } },
    "string",
    "Décision de fin d'année : passage, redoublement ou renvoi à l'examen terminal.",
    END_OF_YEAR_DECISION_CODES,
  ),
  rule(R.DISTINCTION, "mention", { variables: { moyenne: "number?" } }, "string", "Tableau d'honneur de fin d'année.", DISTINCTION_CODES),
  rule(R.APPRECIATION_CONSEIL, "mention", { variables: { moyenne: "number?" } }, "string", "Appréciation générale du conseil.", COUNCIL_APPRECIATION_CODES),
  rule(R.ARRONDI_AFFICHAGE, "rounding", { variables: { valeur: "number?" } }, "number?", "Arrondi d'AFFICHAGE : jamais réinjecté dans un calcul ni un seuil."),
  rule(R.RANG, "ranking", { variables: { moyenne: "number?", cohorte: { list: "number?" } } }, "number?", "Rang de compétition (ex æquo partagés) dans le groupe de classement."),
]);

export const coefSemesterContract: RuleContract = Object.freeze({
  id: COEF_SEMESTER_ID,
  name: "Matières à coefficients",
  description: "Moyennes pondérées par coefficient, moyenne annuelle, mentions, décisions du conseil et de fin d'année, distinctions, classement.",
  rules,
  pipeline: Object.freeze([
    { stage: "matiere", rules: [R.MOYENNE_MATIERE], description: "Par matière : moyenne des notes de la période." },
    { stage: "periode", rules: [R.MOYENNE_SECTION, R.MOYENNE_PONDEREE, R.MENTION, R.DECISION_CONSEIL], description: "Par période : sous-moyennes de section, moyenne pondérée, mention, décision du conseil." },
    { stage: "classement", rules: [R.RANG], description: "Rang par matière, section, global : après le calcul de tout le groupe." },
    {
      stage: "annee",
      rules: [R.MOYENNE_ANNUELLE, R.DECISION_FIN_ANNEE, R.DISTINCTION, R.APPRECIATION_CONSEIL],
      description: "Au 2ᵉ semestre : moyenne annuelle, décision de fin d'année, distinction, appréciation.",
    },
    { stage: "affichage", rules: [R.ARRONDI_AFFICHAGE], description: "Valeurs d'affichage arrondies." },
  ]),
});
