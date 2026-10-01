/**
 * Règles du contrat `coef-semester@1` : pile « classique » (`CI-CLASSIC-SEMESTRE`) et BTS (`CI-HIGHER-BTS`).
 *
 * Portage de apps/api/src/routes/semester-averages.ts (fermetures `buildAverageMention`, `buildCouncilDecision`,
 * `buildEndYearDecision`, `buildDistinctionSanctionsFromAverage`, `buildCouncilAppreciationFromAverage`,
 * `computeWeightedAverage`, `computeAnnualAverage`, `computeCompetitionRanks`). Les libellés sont ceux du legacy,
 * portés par `label_map` ; la logique ne repose que sur les CODES.
 *
 * CI-HIGHER-BTS est une COPIE de CI-CLASSIC-SEMESTRE v1 (pas un héritage) : le BTS relève de textes distincts et doit
 * pouvoir évoluer sans toucher la pile classique. `decision_fin_annee` renvoie `EXAM_REFERRAL` au 2ᵉ semestre d'une
 * classe où l'examen terminal est requis — attribut de la DONNÉE de curriculum (`examen_terminal_requis`), plus un nom de classe.
 */
import { labels, num, threshold } from "./helpers";
import type { SeedRule } from "./types";

const MENTION_LABELS = labels({
  PENDING: "En attente",
  INSUFFICIENT: "Insuffisant",
  PASSABLE: "Passable",
  FAIRLY_GOOD: "Assez bien",
  GOOD: "Bien",
  VERY_GOOD: "Très bien",
  EXCELLENT: "Excellent",
});

export const coefSemesterRules: readonly SeedRule[] = Object.freeze<SeedRule[]>([
  {
    key: "moyenne_matiere",
    type: "assessment_aggregation",
    description:
      "Moyenne d'une matière : notes ramenées sur 20, pondérées par le poids de l'évaluation. Valeur par défaut PROPOSÉE : le legacy n'avait aucune formule (la moyenne de matière était saisie à la main) — question métier Q-23.",
    expression: "wavg(map(notes, n => n.note / if(n.bareme > 0, n.bareme, 0) * 20), notes.poids)",
  },
  {
    key: "moyenne_ponderee",
    type: "period_average",
    description: "Moyenne pondérée par coefficient sur les matières notées (valeur non arrondie).",
    expression: "wavg(matieres.score, matieres.coef)",
  },
  {
    key: "moyenne_section",
    type: "period_average",
    description: "Sous-moyenne d'une section (type de bilan) : même formule que la moyenne pondérée, sur les matières de la section.",
    expression: "wavg(matieres.score, matieres.coef)",
  },
  {
    key: "moyenne_annuelle",
    type: "annual_average",
    description: "Moyenne annuelle = (S1 × poids S1 + S2 × poids S2) / (poids S1 + poids S2) au 2ᵉ semestre quand S1 et S2 existent ; sinon la moyenne du semestre.",
    expression:
      "if(second_semestre && !is_null(s1) && !is_null(s2), " +
      "(s1 * params.poids_s1 + s2 * params.poids_s2) / (params.poids_s1 + params.poids_s2), s2)",
    parameters: {
      poids_s1: num(1, 0, undefined, "Poids du 1er semestre dans la moyenne annuelle"),
      poids_s2: num(2, 0, undefined, "Poids du 2ᵉ semestre dans la moyenne annuelle"),
    },
  },
  {
    key: "mention",
    type: "mention",
    description: "Mention par seuils 16 / 14 / 12 / 10 / 8 (bornes inférieures incluses).",
    expression:
      'if(is_null(moyenne), "PENDING", ' +
      'if(moyenne >= params.excellent, "EXCELLENT", ' +
      'if(moyenne >= params.tres_bien, "VERY_GOOD", ' +
      'if(moyenne >= params.bien, "GOOD", ' +
      'if(moyenne >= params.assez_bien, "FAIRLY_GOOD", ' +
      'if(moyenne >= params.passable, "PASSABLE", "INSUFFICIENT"))))))',
    parameters: {
      excellent: threshold(16, "Moyenne /20 à partir de laquelle la mention est « Excellent »"),
      tres_bien: threshold(14, "Moyenne /20 à partir de laquelle la mention est « Très bien »"),
      bien: threshold(12, "Moyenne /20 à partir de laquelle la mention est « Bien »"),
      assez_bien: threshold(10, "Moyenne /20 à partir de laquelle la mention est « Assez bien »"),
      passable: threshold(8, "Moyenne /20 à partir de laquelle la mention est « Passable »"),
    },
    labelMap: MENTION_LABELS,
  },
  {
    key: "decision_conseil",
    type: "promotion",
    description: "Décision du conseil de période.",
    expression:
      'if(is_null(moyenne), "INCOMPLETE", if(moyenne >= params.validation, "PERIOD_VALIDATED", ' +
      'if(moyenne >= params.renforcement, "REINFORCEMENT_ADVISED", "PERIOD_NOT_VALIDATED")))',
    parameters: {
      validation: threshold(10, "Moyenne /20 à partir de laquelle la période est validée"),
      renforcement: threshold(8, "Moyenne /20 à partir de laquelle un renforcement est recommandé (en dessous : période non validée)"),
    },
    labelMap: labels({
      INCOMPLETE: "Notes incompletes",
      PERIOD_VALIDATED: "Periode validee",
      REINFORCEMENT_ADVISED: "Renforcement recommande",
      PERIOD_NOT_VALIDATED: "Periode non validee",
    }),
  },
  {
    key: "decision_fin_annee",
    type: "repetition",
    description:
      "Décision de fin d'année : en attente sans moyenne ; renvoi à l'examen terminal au 2ᵉ semestre quand il est requis ; sinon passage au-delà du seuil, redoublement en dessous. L'indicateur « redoublant » se déduit du code REPEAT, jamais d'un libellé.",
    expression:
      'if(is_null(moyenne), "PENDING", if(second_semestre && examen_terminal_requis, "EXAM_REFERRAL", ' +
      'if(moyenne >= params.passage, "PROMOTED", "REPEAT")))',
    parameters: { passage: threshold(10, "Moyenne annuelle /20 à partir de laquelle l'élève passe en année supérieure") },
    labelMap: labels({
      PENDING: "Décision en attente",
      EXAM_REFERRAL: "Redouble en cas d'échec au BTS",
      PROMOTED: "Admis(e) en année supérieure",
      REPEAT: "Redoublement",
    }),
  },
  {
    key: "distinction",
    type: "mention",
    description: "Distinctions de fin d'année (tableau d'honneur).",
    expression:
      'if(is_null(moyenne), "NONE", if(moyenne >= params.felicitations, "HONOR_ROLL_CONGRATS", ' +
      'if(moyenne >= params.encouragement, "HONOR_ROLL_ENCOURAGEMENT", if(moyenne >= params.honneur, "HONOR_ROLL", "NONE"))))',
    parameters: {
      felicitations: threshold(17, "Moyenne annuelle /20 à partir de laquelle le tableau d'honneur s'accompagne de félicitations"),
      encouragement: threshold(15, "Moyenne annuelle /20 à partir de laquelle le tableau d'honneur s'accompagne d'encouragements"),
      honneur: threshold(12, "Moyenne annuelle /20 à partir de laquelle l'élève est au tableau d'honneur"),
    },
    labelMap: labels({
      NONE: "",
      HONOR_ROLL: "Tableau d'honneur",
      HONOR_ROLL_ENCOURAGEMENT: "Tableau d'honneur + Encouragement",
      HONOR_ROLL_CONGRATS: "Tableau d'honneur + félicitations",
    }),
  },
  {
    key: "appreciation_conseil",
    type: "mention",
    description: "Appréciation générale du conseil de classe.",
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
      PENDING: "",
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
    key: "arrondi_affichage",
    type: "rounding",
    description: "Arrondi demi-supérieur pour l'AFFICHAGE uniquement (jamais réinjecté dans un calcul ni un seuil).",
    expression: "if(is_null(valeur), null, round_half_up(valeur, params.decimales))",
    parameters: { decimales: num(2, 0, 6, "Nombre de décimales affichées (entier)") },
  },
  {
    key: "rang",
    type: "ranking",
    description: "Classement de compétition (ex æquo partagés), égalité jugée à 4 décimales.",
    expression: "rank(moyenne, cohorte, 4)",
  },
]);
