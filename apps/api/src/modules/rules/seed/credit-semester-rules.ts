/**
 * Règles du jeu `CI-HIGHER-LMD` (contrat `credit-semester@1`) : portage des formules déjà en production
 * (bulletin-calc.ts, professional-bulletin.service.ts, professional-results.service.ts, bulletin-format.ts).
 *
 * Toutes les « constantes » du legacy sont ici des PARAMÈTRES bornés. Décisions métier validées (2026-10-01) :
 *   - `note_examen_retenue.mode_session2 = REPLACE` : la note de session 2 REMPLACE toujours celle de session 1,
 *     même plus faible ;
 *   - `semestre_valide.mode_validation = ALL_UE` : un semestre est validé si TOUTES ses UE sont validées, sans
 *     compensation entre UE ; l'année l'est si toutes les UE de ses semestres le sont. Les règles « 20 crédits »
 *     et « > 48 crédits » du legacy (jamais appliquées) ne sont PAS reprises : leurs valeurs ne subsistent que
 *     comme valeurs par défaut des modes alternatifs `CREDITS`, inactifs.
 *
 * Aucune règle réglementaire ivoirienne n'est inventée : seuils et pondérations sont ceux du code existant.
 */
import { labels, mode, num, threshold } from "./helpers";
import type { SeedRule } from "./types";

const MENTION_LABELS = labels({
  PENDING: "En attente",
  INSUFFICIENT: "Insuffisant",
  PASSABLE: "Passable",
  FAIRLY_GOOD: "Assez Bien",
  GOOD: "Bien",
  VERY_GOOD: "Très Bien",
  EXCELLENT: "Excellent",
});

const MENTION_PARAMS = {
  passable: threshold(10, "Moyenne /20 à partir de laquelle la mention est « Passable »"),
  assez_bien: threshold(12, "Moyenne /20 à partir de laquelle la mention est « Assez Bien »"),
  bien: threshold(14, "Moyenne /20 à partir de laquelle la mention est « Bien »"),
  tres_bien: threshold(16, "Moyenne /20 à partir de laquelle la mention est « Très Bien »"),
  excellent: threshold(18, "Moyenne /20 à partir de laquelle la mention est « Excellent »"),
} as const;

const MENTION_EXPRESSION =
  'if(is_null(moyenne), "PENDING", ' +
  'if(moyenne >= params.excellent, "EXCELLENT", ' +
  'if(moyenne >= params.tres_bien, "VERY_GOOD", ' +
  'if(moyenne >= params.bien, "GOOD", ' +
  'if(moyenne >= params.assez_bien, "FAIRLY_GOOD", ' +
  'if(moyenne >= params.passable, "PASSABLE", "INSUFFICIENT"))))))';

const SEUILS = {
  seuil_validation: threshold(10, "Note /20 à partir de laquelle une ECUE / UE est validée"),
  seuil_eliminatoire: threshold(5, "Une note d'ECUE strictement inférieure bloque toute l'UE (sauf validation du jury)"),
} as const;

const SESSION2_MODE = mode(
  "REPLACE",
  "REPLACE : la note de session 2 remplace toujours celle de session 1 (même plus faible). BEST : la meilleure des deux.",
);

const SUM_VALIDATED_CREDITS = "sum(map(filter(ues, u => u.validee), u => u.credits))";
const ALL_UE_VALIDATED = "len(ues) > 0 && all(ues, u => u.validee)";

export const creditSemesterRules: readonly SeedRule[] = Object.freeze<SeedRule[]>([
  {
    key: "note_sur_20",
    type: "grading_scale",
    description:
      "Ramène une note brute sur 20 : (note / barème) × 20. Un barème nul ou négatif est une donnée invalide : la règle ÉCHOUE (division par zéro) au lieu de renvoyer 0 en silence comme le legacy.",
    expression: "note / if(bareme > 0, bareme, 0) * 20",
  },
  {
    key: "moyenne_devoirs",
    type: "assessment_aggregation",
    description:
      "Moyenne arithmétique simple des devoirs ramenés sur 20 (le coefficient d'évaluation est ignoré, comme dans le legacy) ; absente sans devoir. Un barème invalide fait échouer la règle.",
    expression: "if(len(devoirs) == 0, null, avg(map(devoirs, d => d.note / if(d.bareme > 0, d.bareme, 0) * 20)))",
  },
  {
    key: "note_examen_retenue",
    type: "assessment_aggregation",
    description: "Note d'examen retenue : en mode REPLACE, la session 2 (si elle existe) remplace la session 1.",
    expression:
      'if(is_null(note_s2), note_s1, if(params.mode_session2 == "BEST", if(is_null(note_s1), note_s2, max(note_s1, note_s2)), note_s2))',
    parameters: { mode_session2: SESSION2_MODE },
  },
  {
    key: "session_examen_retenue",
    type: "assessment_aggregation",
    description: "Session (1 ou 2) dont la note d'examen est retenue, cohérente avec `note_examen_retenue`.",
    expression:
      'if(is_null(note_s2), 1, if(params.mode_session2 == "BEST" && !is_null(note_s1), if(note_s1 >= note_s2, 1, 2), 2))',
    parameters: { mode_session2: SESSION2_MODE },
  },
  {
    key: "note_ecue",
    type: "assessment_aggregation",
    description:
      "Note ECUE = moyenne des devoirs × 0,4 + examen × 0,6 (devoirs absents = 0 ; sans examen : pas de note). Le continu absent compte pour 0 (comportement historique).",
    expression:
      "if(is_null(note_examen), null, coalesce(moyenne_devoirs, 0) * params.poids_devoirs + note_examen * params.poids_examen)",
    parameters: {
      poids_devoirs: num(0.4, 0, 1, "Poids du contrôle continu dans la note d'ECUE"),
      poids_examen: num(0.6, 0, 1, "Poids de l'examen dans la note d'ECUE"),
    },
  },
  {
    key: "note_ecue_directe",
    type: "assessment_aggregation",
    description: "ECUE à saisie directe (ex. conduite) : vaut sa note brute, sans pondération devoirs/examen.",
    expression: "note_examen",
  },
  {
    key: "ecue_eliminee",
    type: "eliminatory_grade",
    description: "Note d'ECUE strictement inférieure au seuil éliminatoire (testée sur la valeur NON arrondie).",
    expression: "!is_null(note) && note < params.seuil_eliminatoire",
    parameters: { seuil_eliminatoire: SEUILS.seuil_eliminatoire },
  },
  {
    key: "ecue_validee",
    type: "credit_validation",
    description: "ECUE validée si la note atteint le seuil (valeur non arrondie) ou par validation manuelle du jury.",
    expression: "(!is_null(note) && note >= params.seuil_validation) || validation_manuelle",
    parameters: { seuil_validation: SEUILS.seuil_validation },
  },
  {
    key: "eligible_rattrapage",
    type: "promotion",
    description: "L'étudiant peut passer la session 2 : ECUE notée, non validée, session 2 non encore tentée, rattrapage autorisé par le curriculum.",
    expression: "rattrapage_autorise && !is_null(note) && !validee && !session2_tentee",
  },
  {
    key: "moyenne_ue",
    type: "period_average",
    description: "Moyenne UE = Σ(note ECUE × crédits ECUE) / Σ crédits, sur les ECUE notées (valeur non arrondie).",
    expression: "wavg(ecues.note, ecues.credits)",
  },
  {
    key: "credits_ue",
    type: "credit_validation",
    description: "Crédits de l'UE = somme des crédits de ses ECUE.",
    expression: "sum(ecues.credits)",
  },
  {
    key: "ue_validee",
    type: "credit_validation",
    description:
      "UE validée si moyenne ≥ seuil (non arrondie), aucune ECUE éliminatoire non levée par le jury, toutes les ECUE notées. Pas de compensation entre UE.",
    expression:
      "!is_null(moyenne) && moyenne >= params.seuil_validation" +
      " && !any(ecues, e => !is_null(e.note) && e.note < params.seuil_eliminatoire && !e.validation_manuelle)" +
      " && !any(ecues, e => is_null(e.note))",
    parameters: { seuil_validation: SEUILS.seuil_validation, seuil_eliminatoire: SEUILS.seuil_eliminatoire },
  },
  {
    key: "statut_ecue",
    type: "compensation",
    description: "Statut final d'une ECUE : entre le seuil éliminatoire et le seuil de validation, elle est « compensée » si l'UE est validée.",
    expression:
      'if(is_null(note), "PENDING", if(note < params.seuil_eliminatoire, "ELIMINATORY", ' +
      'if(note >= params.seuil_validation, "VALIDATED", if(ue_validee, "COMPENSATED", "INSUFFICIENT"))))',
    parameters: { seuil_validation: SEUILS.seuil_validation, seuil_eliminatoire: SEUILS.seuil_eliminatoire },
    labelMap: labels({
      PENDING: "En cours",
      ELIMINATORY: "Éliminatoire",
      VALIDATED: "Validée",
      COMPENSATED: "Compensée",
      INSUFFICIENT: "Insuffisant",
    }),
  },
  {
    key: "etat_ue",
    type: "credit_validation",
    description: "État LMD d'une UE : validée ; à repasser (session 2 non tentée) ; en dette (encore non validée après la session 2).",
    expression: 'if(validee, "VALIDATED", if(session2_tentee, "DEBT", "RESIT"))',
    labelMap: labels({ VALIDATED: "Validée", RESIT: "Rattrapage", DEBT: "Dette" }),
  },
  {
    key: "session_validation_ue",
    type: "credit_validation",
    description: "Session de validation d'une UE : la plus élevée des sessions d'obtention de ses ECUE (au moins 1) ; absente si l'UE n'est pas validée.",
    expression: "if(validee, max(1, max(sessions)), null)",
  },
  {
    key: "moyenne_session",
    type: "period_average",
    description: "Moyenne du semestre = Σ(moyenne UE × crédits UE) / Σ crédits UE, sur les moyennes d'UE non arrondies (pas de cascade d'arrondis).",
    expression: "wavg(ues.moyenne, ues.credits)",
  },
  {
    key: "credits_valides",
    type: "credit_validation",
    description: "Crédits acquis = Σ crédits des UE validées.",
    expression: SUM_VALIDATED_CREDITS,
  },
  {
    key: "credits_total",
    type: "credit_validation",
    description: "Crédits engagés = Σ crédits des UE.",
    expression: "sum(ues.credits)",
  },
  {
    key: "semestre_valide",
    type: "promotion",
    description:
      "Semestre validé. ALL_UE (décision métier du 2026-10-01) : toutes les UE sont validées, sans compensation entre UE. CREDITS : au moins `credits_requis` crédits acquis. ALL_UE_OR_CREDITS : l'un ou l'autre.",
    expression:
      `if(params.mode_validation == "CREDITS", ${SUM_VALIDATED_CREDITS} >= params.credits_requis, ` +
      `if(params.mode_validation == "ALL_UE_OR_CREDITS", (${ALL_UE_VALIDATED}) || ${SUM_VALIDATED_CREDITS} >= params.credits_requis, ` +
      `${ALL_UE_VALIDATED}))`,
    parameters: {
      mode_validation: mode("ALL_UE", "ALL_UE : toutes les UE validées. CREDITS : seuil de crédits. ALL_UE_OR_CREDITS : l'un ou l'autre."),
      credits_requis: num(20, 0, undefined, "Crédits acquis requis dans les modes CREDITS et ALL_UE_OR_CREDITS (valeur historique, inactive par défaut)"),
    },
  },
  {
    key: "decision_semestre",
    type: "promotion",
    description: "Décision du semestre : admis si validé ; rattrapage si au moins une UE est à repasser (session 2 non tentée) ; sinon ajourné (dette).",
    expression: 'if(semestre_valide, "ADMITTED", if(ue_en_rattrapage > 0, "RESIT", "ADJOURNED"))',
    labelMap: labels({ ADMITTED: "Admis", RESIT: "Rattrapage", ADJOURNED: "Ajourné" }),
  },
  {
    key: "mention_releve",
    type: "mention",
    description: "Mention du relevé de notes (bornes inférieures incluses).",
    expression: MENTION_EXPRESSION,
    parameters: MENTION_PARAMS,
    labelMap: MENTION_LABELS,
  },
  {
    key: "appreciation_generale",
    type: "mention",
    description: "Appréciation générale du conseil (phrase du visa).",
    expression:
      'if(is_null(moyenne), "PENDING", ' +
      'if(moyenne >= params.excellent, "WORK_EXCELLENT", ' +
      'if(moyenne >= params.tres_bon, "WORK_VERY_GOOD", ' +
      'if(moyenne >= params.bon, "WORK_GOOD", ' +
      'if(moyenne >= params.assez_bon, "WORK_FAIRLY_GOOD", ' +
      'if(moyenne >= params.passable, "WORK_PASSABLE", ' +
      'if(moyenne >= params.fragile, "WORK_FRAGILE", "WORK_INSUFFICIENT")))))))',
    parameters: {
      fragile: threshold(8, "Moyenne /20 à partir de laquelle le travail n'est plus « insuffisant »"),
      passable: threshold(10, "Moyenne /20 à partir de laquelle le travail est « passable »"),
      assez_bon: threshold(12, "Moyenne /20 à partir de laquelle le travail est « assez bon »"),
      bon: threshold(14, "Moyenne /20 à partir de laquelle c'est un « bon travail »"),
      tres_bon: threshold(16, "Moyenne /20 à partir de laquelle c'est un « très bon travail »"),
      excellent: threshold(18, "Moyenne /20 à partir de laquelle c'est un « excellent travail »"),
    },
    labelMap: labels({
      PENDING: "—",
      WORK_INSUFFICIENT: "Travail insuffisant.",
      WORK_FRAGILE: "Travail fragile.",
      WORK_PASSABLE: "Travail passable.",
      WORK_FAIRLY_GOOD: "Travail assez bon.",
      WORK_GOOD: "Bon travail.",
      WORK_VERY_GOOD: "Très bon travail.",
      WORK_EXCELLENT: "Excellent travail.",
    }),
  },
  {
    key: "distinction_semestre",
    type: "mention",
    description: "Tableau d'honneur (avec ou sans encouragement) ou avertissement du semestre.",
    expression:
      'if(is_null(moyenne), "NONE", if(moyenne >= params.encouragement, "HONOR_ROLL_ENCOURAGEMENT", ' +
      'if(moyenne >= params.honneur, "HONOR_ROLL", if(moyenne < params.avertissement, "WARNING", "NONE"))))',
    parameters: {
      honneur: threshold(12, "Moyenne /20 à partir de laquelle l'étudiant est au tableau d'honneur"),
      encouragement: threshold(15, "Moyenne /20 à partir de laquelle le tableau d'honneur s'accompagne d'encouragements"),
      avertissement: threshold(10, "Moyenne /20 strictement inférieure à laquelle un avertissement est prononcé"),
    },
    labelMap: labels({
      NONE: "Aucune",
      HONOR_ROLL: "Tableau d'honneur",
      HONOR_ROLL_ENCOURAGEMENT: "Tableau d'honneur + Encouragement",
      WARNING: "Avertissement",
    }),
  },
  {
    key: "arrondi_affichage",
    type: "rounding",
    description: "Arrondi demi-supérieur pour l'AFFICHAGE uniquement (jamais réinjecté dans un calcul ni un seuil).",
    expression: "if(is_null(valeur), null, round_half_up(valeur, params.decimales))",
    parameters: { decimales: num(2, 0, 6, "Nombre de décimales affichées (entier)") },
  },
  {
    key: "rang",
    type: "ranking",
    description: "Classement de compétition (ex æquo partagés, rang suivant sauté), égalité jugée à 4 décimales.",
    expression: "rank(moyenne, cohorte, 4)",
  },
  {
    key: "moyenne_annuelle",
    type: "annual_average",
    description: "Moyenne annuelle / de cycle = Σ(moyenne de semestre × crédits du semestre) / Σ crédits.",
    expression: "wavg(semestres.moyenne, semestres.credits)",
  },
  {
    key: "annee_validee",
    type: "promotion",
    description:
      "Année validée. ALL_UE (décision métier du 2026-10-01) : toutes les UE des semestres de l'année sont validées. CREDITS : strictement plus de `credits_exclusifs` crédits acquis (valeur historique 48, inactive).",
    expression:
      `if(params.mode_validation == "CREDITS", ${SUM_VALIDATED_CREDITS} > params.credits_exclusifs, ${ALL_UE_VALIDATED})`,
    parameters: {
      mode_validation: mode("ALL_UE", "ALL_UE : toutes les UE de l'année validées. CREDITS : seuil de crédits."),
      credits_exclusifs: num(48, 0, undefined, "Mode CREDITS : l'année est validée au-delà de ce nombre de crédits acquis (strictement)"),
    },
  },
  {
    key: "diplome_eligible",
    type: "promotion",
    description: "Éligibilité au diplôme : toutes les exigences obligatoires validées ET total d'UV des exigences validées au moins égal au requis.",
    expression: "all(filter(exigences, e => e.obligatoire), e => e.valide) && sum(map(filter(exigences, e => e.valide), e => e.uv)) >= uv_requises",
  },
  {
    key: "mention_diplome",
    type: "mention",
    description: "Mention du diplôme / du cycle (échelle distincte de celle du relevé : un établissement peut la modifier à part).",
    expression: MENTION_EXPRESSION,
    parameters: MENTION_PARAMS,
    labelMap: MENTION_LABELS,
  },
]);
