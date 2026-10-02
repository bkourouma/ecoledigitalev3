/**
 * Règles FICTIVES d'examen (`CI-EXAM-PLACEHOLDER`) : contrat `exam-national@1`.
 *
 * Référence : specs/v2/018-examinations/rule-contract.md §2 et §4. AUCUNE règle d'examen officielle n'est écrite : le seuil
 * d'admission 10 est le milieu du barème /20, choisi pour exercer le mécanisme et calculer des examens BLANCS. Pour un examen
 * officiel, l'admission est prononcée par l'autorité et importée : ce jeu ne la calcule jamais.
 */
import { labels, num } from "./helpers";
import type { SeedRule } from "./types";

const MARK = "(fictif) ";

export const examPlaceholderRules: readonly SeedRule[] = Object.freeze<SeedRule[]>([
  {
    key: "eligibilite",
    type: "promotion",
    description: `${MARK}Candidat éligible s'il est dans la classe d'examen et que son dossier est complet ; dossier incomplet ⇒ à examiner. Les vraies conditions (âge, tentatives…) s'ajouteront comme expression de la version.`,
    expression: 'if(!en_classe_examen, "INELIGIBLE", if(!pieces_completes, "NEEDS_REVIEW", "ELIGIBLE"))',
    labelMap: labels({ ELIGIBLE: "Éligible (fictif)", INELIGIBLE: "Non éligible (fictif)", NEEDS_REVIEW: "À examiner (fictif)" }),
  },
  {
    key: "motif_eligibilite",
    type: "promotion",
    description: `${MARK}Premier motif bloquant de l'éligibilité.`,
    expression: 'if(!en_classe_examen, "NOT_IN_EXAM_GRADE", if(!pieces_completes, "DOCUMENTS_MISSING", "NONE"))',
    labelMap: labels({
      NONE: "Aucun",
      NOT_IN_EXAM_GRADE: "Hors classe d'examen (fictif)",
      AGE_NOT_MET: "Âge non atteint (fictif)",
      DOCUMENTS_MISSING: "Pièces manquantes (fictif)",
      ATTEMPTS_EXCEEDED: "Tentatives dépassées (fictif)",
      OTHER: "Autre motif (fictif)",
    }),
  },
  {
    key: "note_epreuve_sur_20",
    type: "grading_scale",
    description: `${MARK}Note d'épreuve ramenée sur 20.`,
    expression: "note / bareme * 20",
  },
  {
    key: "moyenne_candidat",
    type: "period_average",
    description: `${MARK}Moyenne des épreuves notées (ramenées sur 20) pondérée par les coefficients ; une épreuve absente est ignorée ou compte 0 selon le paramètre ; aucune épreuve notée ⇒ absente.`,
    expression:
      "wavg(map(epreuves, e => if(e.absent, if(params.absence_vaut_zero == 1, 0, null), if(is_null(e.note), null, e.note / e.bareme * 20))), epreuves.coef)",
    parameters: { absence_vaut_zero: num(0, 0, 1, `${MARK}1 : une épreuve absente compte 0 ; 0 : elle est ignorée`) },
  },
  {
    key: "resultat_candidat",
    type: "promotion",
    description: `${MARK}Absent sans moyenne ; ajourné si une épreuve éliminatoire est échouée ; admis au seuil, ajourné en dessous. Le résultat officiel n'est jamais calculé.`,
    expression:
      'if(is_null(moyenne), "ABSENT", if(epreuves_eliminatoires_echouees > 0, "FAILED", if(moyenne >= params.seuil_admission, "ADMITTED", "FAILED")))',
    parameters: { seuil_admission: num(10, 0, 20, `${MARK}Seuil d'admission /20 (milieu du barème, choisi pour exercer le mécanisme)`) },
    labelMap: labels({ ADMITTED: "Admis (fictif)", FAILED: "Ajourné (fictif)", ABSENT: "Absent (fictif)", DEFERRED: "Différé (fictif)" }),
  },
  {
    key: "rang_candidat",
    type: "ranking",
    description: `${MARK}Rang de compétition dans la cohorte de la session, égalité à 4 décimales.`,
    expression: "rank(moyenne, cohorte, 4)",
  },
  {
    key: "taux_reussite",
    type: "period_average",
    description: `${MARK}Admis / présents (ou / inscrits selon le paramètre) en %, valeur exacte ; dénominateur nul ⇒ absent. La définition officielle du taux est inconnue.`,
    expression:
      "if(params.denominateur == 1, if(presents > 0, admis * 100 / presents, null), if(inscrits > 0, admis * 100 / inscrits, null))",
    parameters: { denominateur: num(1, 0, 1, `${MARK}1 : taux sur les présents ; 0 : taux sur les inscrits`) },
  },
  {
    key: "arrondi_affichage",
    type: "rounding",
    description: `${MARK}Arrondi demi-supérieur pour l'AFFICHAGE uniquement.`,
    expression: "if(is_null(valeur), null, round_half_up(valeur, params.decimales))",
    parameters: { decimales: num(2, 0, 4, `${MARK}Nombre de décimales affichées`) },
  },
]);
