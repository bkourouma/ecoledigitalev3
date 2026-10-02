/**
 * Contrat `coef-period@1` — matières à coefficients sur N périodes pondérées (primaire).
 *
 * Référence fonctionnelle : specs/v2/005-primary/rule-contract.md §1. Distinct de `coef-semester@1`, qui connaît
 * « semestre 1 / semestre 2 » (`(S1 + 2·S2)/3`) : ici le nombre de périodes est PARAMÉTRABLE et chaque période porte un
 * poids (donnée du plan de périodes d'academic, `slots[].weight`, 1 par défaut). Un RuleSet peut reproduire
 * `(S1 + 2·S2)/3` en fournissant les poids 1 et 2.
 *
 * Le contrat est volontairement GÉNÉRIQUE (N périodes pondérées, moyenne générale annuelle, décision en quatre codes dont
 * `COUNCIL_REVIEW`, cas à examiner, quorum) : un texte officiel s'y loge sans nouveau code dans la plupart des cas.
 * AUCUNE règle réglementaire n'est écrite ici : les formules et seuils officiels sont inconnus (question métier).
 *
 * `moyenne_matiere` : le poids d'une évaluation (`poids`) est celui d'`assess`. La spec évoque un paramètre
 * `poids_par_type` (objet code → poids) : le DSL n'a que des paramètres scalaires, un RuleSet qui veut pondérer par
 * type d'évaluation le fait DANS l'expression (`if(n.type == "CODE", …)`), sans nouveau contrat.
 */
import type { ContractRule, RuleContract } from "./types";
import { contractRule as rule } from "./builder";
import { MENTION_CODES, COUNCIL_APPRECIATION_CODES } from "./credit-semester";

export const COEF_PERIOD_ID = "coef-period@1";

export const COEF_PERIOD_RULES = {
  NOTE_SUR_20: "note_sur_20",
  MOYENNE_MATIERE: "moyenne_matiere",
  MOYENNE_PERIODE: "moyenne_periode",
  MOYENNE_SECTION: "moyenne_section",
  RANG_MATIERE: "rang_matiere",
  RANG_PERIODE: "rang_periode",
  MENTION_PERIODE: "mention_periode",
  APPRECIATION_PERIODE: "appreciation_periode",
  ARRONDI_AFFICHAGE: "arrondi_affichage",
  MOYENNE_GENERALE_ANNUELLE: "moyenne_generale_annuelle",
  RANG_ANNUEL: "rang_annuel",
  CAS_LIMITE: "cas_limite",
  CAS_ABSENCES: "cas_absences",
  CAS_DEJA_REDOUBLANT: "cas_deja_redoublant",
  CAS_A_EXAMINER: "cas_a_examiner",
  DECISION_FIN_ANNEE: "decision_fin_annee",
  QUORUM_CONSEIL: "quorum_conseil",
} as const;

/** Décision de fin d'année : `COUNCIL_REVIEW` = « la règle ne tranche pas, le conseil décide ». */
export const PERIOD_YEAR_DECISION_CODES = ["PENDING", "PROMOTED", "REPEAT", "COUNCIL_REVIEW"] as const;
/** Motifs du dossier à examiner (un par entrée booléenne de `cas_a_examiner`). */
export const COUNCIL_REASON_CODES = ["BORDERLINE", "LONG_ABSENCE", "ALREADY_REPEATED"] as const;

const R = COEF_PERIOD_RULES;
const SUBJECTS = { list: { object: { score: "number?", coef: "number" } } } as const;
const COHORT = { variables: { moyenne: "number?", cohorte: { list: "number?" } } } as const;

const rules: readonly ContractRule[] = Object.freeze([
  rule(R.NOTE_SUR_20, "grading_scale", { variables: { note: "number", bareme: "number" } }, "number", "Note ramenée sur 20 (`bareme` > 0 garanti par assess)."),
  rule(
    R.MOYENNE_MATIERE,
    "assessment_aggregation",
    { variables: { notes: { list: { object: { note: "number", bareme: "number", poids: "number", type: "string" } } } } },
    "number?",
    "Moyenne d'une matière : notes ramenées sur 20, pondérées par le poids de l'évaluation ; aucune note ⇒ absente (jamais 0).",
  ),
  rule(R.MOYENNE_PERIODE, "period_average", { variables: { matieres: SUBJECTS } }, "number?", "Moyenne de période pondérée par les coefficients, sur les matières notées (valeur non arrondie)."),
  rule(R.MOYENNE_SECTION, "period_average", { variables: { matieres: SUBJECTS } }, "number?", "Sous-moyenne d'un groupe de matières (section du bulletin).", { optional: true }),
  rule(R.RANG_MATIERE, "ranking", COHORT, "number?", "Rang de compétition d'une matière dans la classe (ex æquo partagés, égalité à 4 décimales)."),
  rule(R.RANG_PERIODE, "ranking", COHORT, "number?", "Rang de période dans la classe : CALCULÉ ; son affichage est un réglage de gabarit."),
  rule(R.MENTION_PERIODE, "mention", { variables: { moyenne: "number?" } }, "string", "Mention de la période (le primaire a-t-il des mentions ? question métier).", { optional: true, outputCodes: MENTION_CODES }),
  rule(R.APPRECIATION_PERIODE, "mention", { variables: { moyenne: "number?" } }, "string", "Suggestion d'appréciation : jamais appliquée sans validation.", { optional: true, outputCodes: COUNCIL_APPRECIATION_CODES }),
  rule(R.ARRONDI_AFFICHAGE, "rounding", { variables: { valeur: "number?" } }, "number?", "Arrondi d'AFFICHAGE : jamais réinjecté dans un calcul ni un seuil."),
  rule(
    R.MOYENNE_GENERALE_ANNUELLE,
    "annual_average",
    { variables: { periodes: { list: { object: { moyenne: "number?", poids: "number" } } } } },
    "number?",
    "Moyenne générale annuelle : moyenne des périodes NOTÉES pondérée par le poids de période (plan de périodes) ; non arrondie.",
  ),
  rule(R.RANG_ANNUEL, "ranking", COHORT, "number?", "Rang annuel de compétition dans la classe."),
  rule(
    R.CAS_LIMITE,
    "promotion",
    { variables: { mga: "number?" } },
    "boolean",
    "Élève proche du seuil de passage : le conseil examine.",
  ),
  rule(
    R.CAS_ABSENCES,
    "promotion",
    { variables: { absences_journees: "number", jours_ouverts: "number" } },
    "boolean",
    "Absences prolongées (part des journées ouvertes) : arithmétique décimale exacte, aucune division.",
  ),
  rule(R.CAS_DEJA_REDOUBLANT, "promotion", { variables: { redoublements_cycle: "number" } }, "boolean", "Élève ayant déjà redoublé dans le cycle (entrée fournie par academic)."),
  rule(R.CAS_A_EXAMINER, "promotion", { variables: { limite: "boolean", absences: "boolean", redoublant: "boolean" } }, "boolean", "Dossier à examiner par le conseil : au moins un des trois cas."),
  rule(
    R.DECISION_FIN_ANNEE,
    "repetition",
    { variables: { mga: "number?", periodes_notees: "number", periodes_attendues: "number", cas_examen: "boolean" } },
    "string",
    "Décision de fin d'année en quatre codes : en attente, passage, redoublement ou dossier à examiner par le conseil.",
    { outputCodes: PERIOD_YEAR_DECISION_CODES },
  ),
  rule(R.QUORUM_CONSEIL, "promotion", { variables: { convoques: "number", presents: "number" } }, "boolean", "Quorum du conseil des maîtres (le quorum officiel est inconnu : valeur fictive, sans effet bloquant par défaut)."),
]);

export const coefPeriodContract: RuleContract = Object.freeze({
  id: COEF_PERIOD_ID,
  name: "Matières à coefficients — N périodes pondérées",
  description: "Moyennes pondérées par coefficient, rangs, moyenne générale annuelle sur N périodes pondérées, cas à examiner, décision de fin d'année en quatre codes et quorum du conseil.",
  rules,
  pipeline: Object.freeze([
    { stage: "matiere", rules: [R.NOTE_SUR_20, R.MOYENNE_MATIERE], description: "Par matière : moyenne des notes publiées de la période." },
    { stage: "periode", rules: [R.MOYENNE_SECTION, R.MOYENNE_PERIODE, R.MENTION_PERIODE, R.APPRECIATION_PERIODE], description: "Par période : moyenne pondérée, sous-moyennes de section, mention et suggestion d'appréciation (optionnelles)." },
    { stage: "classement", rules: [R.RANG_MATIERE, R.RANG_PERIODE], description: "Deuxième phase : rangs, après le calcul de toute la classe." },
    { stage: "affichage", rules: [R.ARRONDI_AFFICHAGE], description: "Valeurs d'affichage arrondies." },
    {
      stage: "annee",
      rules: [R.MOYENNE_GENERALE_ANNUELLE, R.RANG_ANNUEL, R.CAS_LIMITE, R.CAS_ABSENCES, R.CAS_DEJA_REDOUBLANT, R.CAS_A_EXAMINER, R.DECISION_FIN_ANNEE],
      description: "À la clôture de la dernière période : moyenne générale annuelle, rang, cas à examiner, proposition de décision.",
    },
    { stage: "conseil", rules: [R.QUORUM_CONSEIL], description: "Par séance du conseil (module primary_school) : quorum." },
  ]),
});
