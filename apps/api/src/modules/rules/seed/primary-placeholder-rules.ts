/**
 * Règles FICTIVES du primaire (`CI-PRIMARY-PLACEHOLDER`) : contrats `coef-period@1` et `competency-period@1`.
 *
 * Référence : specs/v2/005-primary/rule-contract.md §1.5, §2 et §3. AUCUNE règle réglementaire ivoirienne officielle n'est
 * écrite ici : les valeurs servent UNIQUEMENT à exercer le mécanisme (décimal exact, valeur absente, ex æquo, chaînage).
 * Le seuil de passage 10 est le milieu du barème /20, choisi pour la démonstration. La version porte
 * `source.kind = "placeholder"` ; chaque description est préfixée « (fictif) » et chaque libellé suffixé « (fictif) ».
 */
import { labels, num } from "./helpers";
import type { SeedRule } from "./types";

const MARK = "(fictif) ";

const YEAR_DECISION_LABELS = labels({
  PENDING: "Décision en attente (fictif)",
  PROMOTED: "Passage en classe supérieure (fictif)",
  REPEAT: "Redoublement (fictif)",
  COUNCIL_REVIEW: "Dossier à examiner par le conseil (fictif)",
});

export const coefPeriodPlaceholderRules: readonly SeedRule[] = Object.freeze<SeedRule[]>([
  {
    key: "note_sur_20",
    type: "grading_scale",
    description: `${MARK}Note ramenée sur 20.`,
    expression: "note / bareme * 20",
  },
  {
    key: "moyenne_matiere",
    type: "assessment_aggregation",
    description: `${MARK}Moyenne des notes ramenées sur 20 pondérée par le poids de l'évaluation ; aucune note ⇒ absente (jamais 0).`,
    expression: "wavg(map(notes, n => n.note / n.bareme * 20), notes.poids)",
  },
  {
    key: "moyenne_periode",
    type: "period_average",
    description: `${MARK}Moyenne pondérée par coefficient ; une matière sans note est ignorée (ni 0, ni coefficient compté) ; valeur non arrondie.`,
    expression: "wavg(matieres.score, matieres.coef)",
  },
  {
    key: "moyenne_section",
    type: "period_average",
    description: `${MARK}Sous-moyenne d'un groupe de matières (mêmes règles que la moyenne de période).`,
    expression: "wavg(matieres.score, matieres.coef)",
    isOptional: true,
  },
  {
    key: "rang_matiere",
    type: "ranking",
    description: `${MARK}Rang de compétition (ex æquo partagés, rang suivant sauté), égalité à 4 décimales.`,
    expression: "rank(moyenne, cohorte, 4)",
  },
  {
    key: "rang_periode",
    type: "ranking",
    description: `${MARK}Rang de période : calculé ; son affichage est un réglage du gabarit de bulletin.`,
    expression: "rank(moyenne, cohorte, 4)",
  },
  {
    key: "arrondi_affichage",
    type: "rounding",
    description: `${MARK}Arrondi demi-supérieur pour l'AFFICHAGE uniquement.`,
    expression: "if(is_null(valeur), null, round_half_up(valeur, params.decimales))",
    parameters: { decimales: num(2, 0, 4, `${MARK}Nombre de décimales affichées`) },
  },
  {
    key: "moyenne_generale_annuelle",
    type: "annual_average",
    description: `${MARK}Moyenne des périodes notées pondérée par le poids de période (plan de périodes) ; non arrondie. Hypothèse de mécanisme, pas la définition officielle.`,
    expression: "wavg(periodes.moyenne, periodes.poids)",
  },
  {
    key: "rang_annuel",
    type: "ranking",
    description: `${MARK}Rang annuel de compétition.`,
    expression: "rank(moyenne, cohorte, 4)",
  },
  {
    key: "cas_limite",
    type: "promotion",
    description: `${MARK}Moyenne proche du seuil de passage (à la marge près) : le conseil examine.`,
    expression: "!is_null(mga) && abs(mga - params.seuil_passage) <= params.marge_conseil",
    parameters: {
      seuil_passage: num(10, 0, 20, `${MARK}Seuil de passage /20 (milieu du barème, choisi pour exercer le mécanisme)`),
      marge_conseil: num(1, 0, 5, `${MARK}Marge autour du seuil à examiner par le conseil`),
    },
  },
  {
    key: "cas_absences",
    type: "promotion",
    description: `${MARK}Part des journées d'absence supérieure au pourcentage fixé (arithmétique décimale exacte, aucune division).`,
    expression: "jours_ouverts > 0 && absences_journees * 100 > params.pourcentage_absences * jours_ouverts",
    parameters: { pourcentage_absences: num(20, 0, 100, `${MARK}Pourcentage de journées d'absence au-delà duquel le conseil examine`) },
  },
  {
    key: "cas_deja_redoublant",
    type: "promotion",
    description: `${MARK}Nombre de redoublements du cycle au moins égal au seuil d'alerte.`,
    expression: "redoublements_cycle >= params.redoublements_alerte",
    parameters: { redoublements_alerte: num(1, 0, 10, `${MARK}Nombre de redoublements du cycle déclenchant l'examen par le conseil`) },
  },
  {
    key: "cas_a_examiner",
    type: "promotion",
    description: `${MARK}Dossier à examiner dès qu'un des trois cas est vrai.`,
    expression: "limite || absences || redoublant",
  },
  {
    key: "decision_fin_annee",
    type: "repetition",
    description: `${MARK}Proposition de décision : en attente sans moyenne ou avec des périodes non notées ; dossier à examiner ; sinon passage au seuil, redoublement en dessous. Le conseil confirme.`,
    expression:
      'if(is_null(mga) || periodes_notees < periodes_attendues, "PENDING", if(cas_examen, "COUNCIL_REVIEW", if(mga >= params.seuil_passage, "PROMOTED", "REPEAT")))',
    parameters: { seuil_passage: num(10, 0, 20, `${MARK}Seuil de passage /20 (milieu du barème, choisi pour exercer le mécanisme)`) },
    labelMap: YEAR_DECISION_LABELS,
  },
  {
    key: "quorum_conseil",
    type: "promotion",
    description: `${MARK}Quorum atteint quand les présents représentent au moins le pourcentage fixé des convoqués. Le quorum officiel est inconnu.`,
    expression: "convoques > 0 && presents * 100 >= params.quorum_pourcent * convoques",
    parameters: { quorum_pourcent: num(50, 0, 100, `${MARK}Pourcentage de présents requis`) },
  },
]);

export const competencyPeriodPlaceholderRules: readonly SeedRule[] = Object.freeze<SeedRule[]>([
  {
    key: "decision_fin_annee",
    type: "repetition",
    description: `${MARK}Sans note : en attente tant que toutes les compétences attendues ne sont pas évaluées, puis dossier à examiner. La règle ne décide jamais seule.`,
    expression: 'if(competences_evaluees < competences_attendues, "PENDING", "COUNCIL_REVIEW")',
    labelMap: labels({ PENDING: "Décision en attente (fictif)", COUNCIL_REVIEW: "Dossier à examiner par le conseil (fictif)" }),
  },
  {
    key: "quorum_conseil",
    type: "promotion",
    description: `${MARK}Quorum atteint quand les présents représentent au moins le pourcentage fixé des convoqués.`,
    expression: "convoques > 0 && presents * 100 >= params.quorum_pourcent * convoques",
    parameters: { quorum_pourcent: num(50, 0, 100, `${MARK}Pourcentage de présents requis`) },
  },
]);
