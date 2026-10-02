/**
 * Contrat `secondary-annual@1` — secondaire : même pipeline que `coef-semester@1` pour un nombre QUELCONQUE de périodes
 * (trimestres ou semestres), sans « second semestre » deviné.
 *
 * Référence fonctionnelle : specs/v2/006-secondary/spec.md §6.4 et §7.4. Différences avec `coef-semester@1` (le reste est
 * identique : mêmes clés, mêmes codes de sortie `PROMOTED`/`REPEAT`/`EXAM_REFERRAL`, même rang) :
 *   - `moyenne_annuelle` reçoit TOUTES les périodes de l'année `{ moyenne, poids }` ; le poids est celui du plan de périodes
 *     d'academic (`slots[].weight`, 1 par défaut — la spec 006 parle de « poids de période (`poids_periodes`) » : ils sont
 *     une DONNÉE du plan, comme pour `coef-period@1`) ; un RuleSet qui reproduit `(S1 + 2·S2)/3` fournit les poids 1 et 2 ;
 *   - `decision_fin_annee` reçoit `derniere_periode` (donnée de calendrier : la période est la dernière de l'année, plus
 *     jamais le nom ni le rang « 2ᵉ semestre ») à la place de `second_semestre`.
 * AUCUNE règle réglementaire n'est écrite : le contrat est une STRUCTURE.
 */
import type { ContractRule, RuleContract } from "./types";
import { contractRule as rule } from "./builder";
import { COUNCIL_DECISION_CODES, DISTINCTION_CODES, END_OF_YEAR_DECISION_CODES } from "./coef-semester";
import { COUNCIL_APPRECIATION_CODES, MENTION_CODES } from "./credit-semester";

export const SECONDARY_ANNUAL_ID = "secondary-annual@1";

export const SECONDARY_ANNUAL_RULES = {
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

const R = SECONDARY_ANNUAL_RULES;
const COURSES = { list: { object: { score: "number?", coef: "number" } } } as const;

const rules: readonly ContractRule[] = Object.freeze([
  rule(
    R.MOYENNE_MATIERE,
    "assessment_aggregation",
    { variables: { notes: { list: { object: { note: "number", bareme: "number", poids: "number", type: "string" } } } } },
    "number?",
    "Moyenne d'une matière : notes ramenées sur 20, pondérées par le poids de l'évaluation.",
  ),
  rule(R.MOYENNE_PONDEREE, "period_average", { variables: { matieres: COURSES } }, "number?", "Moyenne de période pondérée par les coefficients, sur les matières notées."),
  rule(R.MOYENNE_SECTION, "period_average", { variables: { matieres: COURSES } }, "number?", "Sous-moyenne d'une section (type de bilan), même formule que la moyenne pondérée."),
  rule(
    R.MOYENNE_ANNUELLE,
    "annual_average",
    { variables: { periodes: { list: { object: { moyenne: "number?", poids: "number" } } } } },
    "number?",
    "Moyenne annuelle : moyenne des périodes NOTÉES de l'année pondérée par le poids de période (plan de périodes), pour un nombre quelconque de périodes.",
  ),
  rule(R.MENTION, "mention", { variables: { moyenne: "number?" } }, "string", "Mention de la moyenne.", { outputCodes: MENTION_CODES }),
  rule(R.DECISION_CONSEIL, "promotion", { variables: { moyenne: "number?" } }, "string", "Décision du conseil de période (suggestion).", { outputCodes: COUNCIL_DECISION_CODES }),
  rule(
    R.DECISION_FIN_ANNEE,
    "repetition",
    { variables: { moyenne: "number?", derniere_periode: "boolean", examen_terminal_requis: "boolean" } },
    "string",
    "Décision de fin d'année (suggestion) : passage, redoublement ou renvoi à l'examen terminal ; en attente hors dernière période.",
    { outputCodes: END_OF_YEAR_DECISION_CODES },
  ),
  rule(R.DISTINCTION, "mention", { variables: { moyenne: "number?" } }, "string", "Tableau d'honneur de fin d'année.", { outputCodes: DISTINCTION_CODES }),
  rule(R.APPRECIATION_CONSEIL, "mention", { variables: { moyenne: "number?" } }, "string", "Suggestion d'appréciation générale du conseil (jamais appliquée sans validation).", { outputCodes: COUNCIL_APPRECIATION_CODES }),
  rule(R.ARRONDI_AFFICHAGE, "rounding", { variables: { valeur: "number?" } }, "number?", "Arrondi d'AFFICHAGE : jamais réinjecté dans un calcul ni un seuil."),
  rule(R.RANG, "ranking", { variables: { moyenne: "number?", cohorte: { list: "number?" } } }, "number?", "Rang de compétition (ex æquo partagés) dans le groupe de classement."),
]);

export const secondaryAnnualContract: RuleContract = Object.freeze({
  id: SECONDARY_ANNUAL_ID,
  name: "Secondaire — matières à coefficients sur N périodes",
  description: "Moyennes pondérées par coefficient, moyenne annuelle sur un nombre quelconque de périodes pondérées, mentions, décisions du conseil et de fin d'année, distinctions, classement.",
  rules,
  pipeline: Object.freeze([
    { stage: "matiere", rules: [R.MOYENNE_MATIERE], description: "Par matière : moyenne des notes de la période." },
    { stage: "periode", rules: [R.MOYENNE_SECTION, R.MOYENNE_PONDEREE, R.MENTION, R.DECISION_CONSEIL], description: "Par période : sous-moyennes de section, moyenne pondérée, mention, décision du conseil." },
    { stage: "classement", rules: [R.RANG], description: "Rang par matière, section, global : après le calcul de toute la classe." },
    {
      stage: "annee",
      rules: [R.MOYENNE_ANNUELLE, R.DECISION_FIN_ANNEE, R.DISTINCTION, R.APPRECIATION_CONSEIL],
      description: "À la dernière période de l'année : moyenne annuelle, décision de fin d'année, distinction, appréciation.",
    },
    { stage: "affichage", rules: [R.ARRONDI_AFFICHAGE], description: "Valeurs d'affichage arrondies." },
  ]),
});
