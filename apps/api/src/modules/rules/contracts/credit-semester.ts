/**
 * Contrat `credit-semester@1` — enseignement supérieur à crédits (ECUE / UE / semestre / année / diplôme).
 *
 * Référence fonctionnelle : specs/v2/012-rules-engine/rule-contracts.md §2. Formules déjà en production
 * (apps/api/src/services/bulletin-calc.ts, professional-bulletin.service.ts, professional-results.service.ts) ;
 * AUCUNE règle réglementaire n'est inventée ici : le contrat fixe des NOMS, des TYPES et des VARIABLES.
 *
 * Évolutions par rapport au texte de rule-contracts.md (décisions métier validées du 2026-10-01,
 * specs/v2/DECISIONS-METIER.md) :
 *   - `note_examen_retenue` / `session_examen_retenue` portent le paramètre de mode `mode_session2`
 *     (`REPLACE` = la session 2 remplace TOUJOURS la session 1 ; `BEST` = la meilleure des deux) ;
 *   - `semestre_valide` et `annee_validee` portent le paramètre de mode `mode_validation` (`ALL_UE` = toutes les
 *     UE validées, sans compensation entre UE ; `CREDITS` = seuil de crédits ; `ALL_UE_OR_CREDITS` pour le semestre) ;
 *     les anciennes règles « 20 crédits » et « > 48 crédits » (jamais appliquées) ne sont plus des règles
 *     distinctes : leurs valeurs historiques ne subsistent que comme valeurs par défaut INACTIVES de ces paramètres.
 */
import type { RuleSchemaSpec, ResultTypeSpec, RuleType } from "../engine";
import type { ContractParameter, ContractRule, RuleContract } from "./types";

export const CREDIT_SEMESTER_ID = "credit-semester@1";

/** Clés de règle du contrat (les modules `results` et `higher` s'y réfèrent, jamais par littéral). */
export const CREDIT_SEMESTER_RULES = {
  NOTE_SUR_20: "note_sur_20",
  MOYENNE_DEVOIRS: "moyenne_devoirs",
  NOTE_EXAMEN_RETENUE: "note_examen_retenue",
  SESSION_EXAMEN_RETENUE: "session_examen_retenue",
  NOTE_ECUE: "note_ecue",
  NOTE_ECUE_DIRECTE: "note_ecue_directe",
  ECUE_ELIMINEE: "ecue_eliminee",
  ECUE_VALIDEE: "ecue_validee",
  ELIGIBLE_RATTRAPAGE: "eligible_rattrapage",
  MOYENNE_UE: "moyenne_ue",
  CREDITS_UE: "credits_ue",
  UE_VALIDEE: "ue_validee",
  STATUT_ECUE: "statut_ecue",
  ETAT_UE: "etat_ue",
  SESSION_VALIDATION_UE: "session_validation_ue",
  MOYENNE_SESSION: "moyenne_session",
  CREDITS_VALIDES: "credits_valides",
  CREDITS_TOTAL: "credits_total",
  SEMESTRE_VALIDE: "semestre_valide",
  DECISION_SEMESTRE: "decision_semestre",
  MENTION_RELEVE: "mention_releve",
  APPRECIATION_GENERALE: "appreciation_generale",
  DISTINCTION_SEMESTRE: "distinction_semestre",
  ARRONDI_AFFICHAGE: "arrondi_affichage",
  RANG: "rang",
  MOYENNE_ANNUELLE: "moyenne_annuelle",
  ANNEE_VALIDEE: "annee_validee",
  DIPLOME_ELIGIBLE: "diplome_eligible",
  MENTION_DIPLOME: "mention_diplome",
} as const;

/** Codes de sortie (anglais, majuscules) des règles à code. Les libellés français viennent de `label_map`. */
export const ECUE_STATUS_CODES = ["PENDING", "ELIMINATORY", "VALIDATED", "COMPENSATED", "INSUFFICIENT"] as const;
export const UE_STATE_CODES = ["VALIDATED", "RESIT", "DEBT"] as const;
export const SEMESTER_DECISION_CODES = ["ADMITTED", "RESIT", "ADJOURNED"] as const;
export const MENTION_CODES = ["PENDING", "INSUFFICIENT", "PASSABLE", "FAIRLY_GOOD", "GOOD", "VERY_GOOD", "EXCELLENT"] as const;
export const COUNCIL_APPRECIATION_CODES = [
  "PENDING",
  "WORK_INSUFFICIENT",
  "WORK_FRAGILE",
  "WORK_PASSABLE",
  "WORK_FAIRLY_GOOD",
  "WORK_GOOD",
  "WORK_VERY_GOOD",
  "WORK_EXCELLENT",
] as const;
export const SEMESTER_DISTINCTION_CODES = ["NONE", "HONOR_ROLL", "HONOR_ROLL_ENCOURAGEMENT", "WARNING"] as const;

/** Valeurs du paramètre `mode_session2` (décision métier : `REPLACE` par défaut). */
export const SESSION2_MODES = ["REPLACE", "BEST"] as const;
export const SEMESTER_VALIDATION_MODES = ["ALL_UE", "CREDITS", "ALL_UE_OR_CREDITS"] as const;
export const YEAR_VALIDATION_MODES = ["ALL_UE", "CREDITS"] as const;

const MODE_SESSION2: ContractParameter = { type: "string", allowed: SESSION2_MODES };

const none: Readonly<Record<string, ContractParameter>> = Object.freeze({});

function rule(
  key: string,
  type: RuleType,
  inputs: RuleSchemaSpec,
  result: ResultTypeSpec,
  description: string,
  extra: { optional?: boolean; outputCodes?: readonly string[]; parameters?: Record<string, ContractParameter> } = {},
): ContractRule {
  return Object.freeze({
    key,
    type,
    optional: extra.optional ?? false,
    inputs,
    result,
    outputCodes: Object.freeze([...(extra.outputCodes ?? [])]),
    parameters: Object.freeze({ ...(extra.parameters ?? none) }),
    description,
  });
}

const ECUE_LINE = { object: { note: "number?", credits: "number", validation_manuelle: "boolean" } } as const;
const UE_LINE = { object: { moyenne: "number?", credits: "number", validee: "boolean" } } as const;

const R = CREDIT_SEMESTER_RULES;

const rules: readonly ContractRule[] = Object.freeze([
  // ---------------------------------------------------------------- ECUE
  rule(R.NOTE_SUR_20, "grading_scale", { variables: { note: "number", bareme: "number" } }, "number", "Ramène une note brute sur 20 (barème strictement positif garanti par `assess`)."),
  rule(
    R.MOYENNE_DEVOIRS,
    "assessment_aggregation",
    { variables: { devoirs: { list: { object: { note: "number", bareme: "number", poids: "number" } } } } },
    "number?",
    "Moyenne des devoirs ramenés sur 20 ; absente quand il n'y a aucun devoir.",
  ),
  rule(
    R.NOTE_EXAMEN_RETENUE,
    "assessment_aggregation",
    { variables: { note_s1: "number?", note_s2: "number?" } },
    "number?",
    "Note d'examen retenue entre la session 1 et la session 2 (mode `mode_session2`).",
    { parameters: { mode_session2: MODE_SESSION2 } },
  ),
  rule(
    R.SESSION_EXAMEN_RETENUE,
    "assessment_aggregation",
    { variables: { note_s1: "number?", note_s2: "number?" } },
    "number",
    "Session dont la note d'examen est retenue (1 ou 2), cohérente avec `note_examen_retenue`.",
    { parameters: { mode_session2: MODE_SESSION2 } },
  ),
  rule(
    R.NOTE_ECUE,
    "assessment_aggregation",
    { variables: { moyenne_devoirs: "number?", note_examen: "number?" } },
    "number?",
    "Note d'ECUE = moyenne des devoirs × poids des devoirs + examen × poids de l'examen ; absente sans examen.",
  ),
  rule(R.NOTE_ECUE_DIRECTE, "assessment_aggregation", { variables: { note_examen: "number?" } }, "number?", "ECUE à saisie directe (ex. conduite) : vaut sa note brute."),
  rule(R.ECUE_ELIMINEE, "eliminatory_grade", { variables: { note: "number?", validation_manuelle: "boolean" } }, "boolean", "Note d'ECUE strictement inférieure au seuil éliminatoire (valeur non arrondie)."),
  rule(R.ECUE_VALIDEE, "credit_validation", { variables: { note: "number?", validation_manuelle: "boolean" } }, "boolean", "ECUE validée : note au moins égale au seuil de validation, ou validation manuelle du jury."),
  rule(
    R.ELIGIBLE_RATTRAPAGE,
    "promotion",
    { variables: { note: "number?", validee: "boolean", session2_tentee: "boolean", rattrapage_autorise: "boolean" } },
    "boolean",
    "L'étudiant peut passer la session 2 de cette ECUE.",
  ),
  // ------------------------------------------------------------------ UE
  rule(R.MOYENNE_UE, "period_average", { variables: { ecues: { list: ECUE_LINE } } }, "number?", "Moyenne d'UE pondérée par les crédits d'ECUE, sur les ECUE notées (valeur non arrondie)."),
  rule(R.CREDITS_UE, "credit_validation", { variables: { ecues: { list: ECUE_LINE } } }, "number", "Crédits de l'UE = somme des crédits de ses ECUE."),
  rule(
    R.UE_VALIDEE,
    "credit_validation",
    { variables: { moyenne: "number?", ecues: { list: ECUE_LINE } } },
    "boolean",
    "UE validée : moyenne au seuil, aucune ECUE éliminatoire non levée par le jury, toutes les ECUE notées.",
  ),
  rule(
    R.STATUT_ECUE,
    "compensation",
    { variables: { note: "number?", ue_validee: "boolean" } },
    "string",
    "Statut final d'une ECUE ; une ECUE entre le seuil éliminatoire et le seuil de validation est compensée si l'UE est validée.",
    { outputCodes: ECUE_STATUS_CODES },
  ),
  rule(
    R.ETAT_UE,
    "credit_validation",
    { variables: { validee: "boolean", session2_tentee: "boolean" } },
    "string",
    "État LMD d'une UE : validée, à repasser (session 2 non tentée) ou en dette.",
    { outputCodes: UE_STATE_CODES },
  ),
  rule(
    R.SESSION_VALIDATION_UE,
    "credit_validation",
    { variables: { validee: "boolean", sessions: { list: "number" } } },
    "number?",
    "Session de validation d'une UE (la plus élevée des sessions d'obtention de ses ECUE) ; absente si non validée.",
  ),
  // ------------------------------------------------------------ semestre
  rule(R.MOYENNE_SESSION, "period_average", { variables: { ues: { list: UE_LINE } } }, "number?", "Moyenne du semestre pondérée par les crédits d'UE, sur les moyennes d'UE NON arrondies."),
  rule(R.CREDITS_VALIDES, "credit_validation", { variables: { ues: { list: UE_LINE } } }, "number", "Crédits acquis = somme des crédits des UE validées."),
  rule(R.CREDITS_TOTAL, "credit_validation", { variables: { ues: { list: UE_LINE } } }, "number", "Crédits engagés = somme des crédits des UE."),
  rule(
    R.SEMESTRE_VALIDE,
    "promotion",
    { variables: { ues: { list: { object: { validee: "boolean", credits: "number" } } } } },
    "boolean",
    "Semestre validé selon `mode_validation` : toutes les UE validées (sans compensation entre UE), ou seuil de crédits.",
    { parameters: { mode_validation: { type: "string", allowed: SEMESTER_VALIDATION_MODES } } },
  ),
  rule(
    R.DECISION_SEMESTRE,
    "promotion",
    { variables: { semestre_valide: "boolean", ue_en_rattrapage: "number" } },
    "string",
    "Décision du semestre : admis, rattrapage (au moins une UE à repasser) ou ajourné (dette).",
    { outputCodes: SEMESTER_DECISION_CODES },
  ),
  rule(R.MENTION_RELEVE, "mention", { variables: { moyenne: "number?" } }, "string", "Mention du relevé de notes.", { outputCodes: MENTION_CODES }),
  rule(R.APPRECIATION_GENERALE, "mention", { variables: { moyenne: "number?" } }, "string", "Appréciation générale du conseil.", { outputCodes: COUNCIL_APPRECIATION_CODES }),
  rule(R.DISTINCTION_SEMESTRE, "mention", { variables: { moyenne: "number?" } }, "string", "Tableau d'honneur, encouragement ou avertissement du semestre.", { outputCodes: SEMESTER_DISTINCTION_CODES }),
  rule(R.ARRONDI_AFFICHAGE, "rounding", { variables: { valeur: "number?" } }, "number?", "Arrondi d'AFFICHAGE : jamais réinjecté dans un calcul ni un seuil."),
  rule(R.RANG, "ranking", { variables: { moyenne: "number?", cohorte: { list: "number?" } } }, "number?", "Rang de compétition (ex æquo partagés) dans la cohorte."),
  // -------------------------------------------------------- année, diplôme
  rule(
    R.MOYENNE_ANNUELLE,
    "annual_average",
    { variables: { semestres: { list: { object: { moyenne: "number?", credits: "number" } } } } },
    "number?",
    "Moyenne annuelle (ou de cycle) pondérée par les crédits de semestre.",
  ),
  rule(
    R.ANNEE_VALIDEE,
    "promotion",
    { variables: { ues: { list: { object: { validee: "boolean", credits: "number" } } } } },
    "boolean",
    "Année validée selon `mode_validation` : toutes les UE des semestres de l'année validées, ou seuil de crédits.",
    { parameters: { mode_validation: { type: "string", allowed: YEAR_VALIDATION_MODES } } },
  ),
  rule(
    R.DIPLOME_ELIGIBLE,
    "promotion",
    { variables: { exigences: { list: { object: { valide: "boolean", obligatoire: "boolean", uv: "number" } } }, uv_requises: "number" } },
    "boolean",
    "Éligibilité au diplôme : exigences obligatoires validées et total d'UV suffisant (contexte dédoublonné par UE).",
  ),
  rule(R.MENTION_DIPLOME, "mention", { variables: { moyenne: "number?" } }, "string", "Mention du diplôme (échelle distincte de celle du relevé, au besoin).", { outputCodes: MENTION_CODES }),
]);

export const creditSemesterContract: RuleContract = Object.freeze({
  id: CREDIT_SEMESTER_ID,
  name: "Supérieur à crédits (UE / ECUE)",
  description:
    "Calcul des notes d'ECUE, des moyennes d'UE et de semestre, validation par crédits, décisions, mentions, moyenne annuelle et éligibilité au diplôme.",
  rules,
  pipeline: Object.freeze([
    {
      stage: "ecue",
      rules: [R.NOTE_SUR_20, R.MOYENNE_DEVOIRS, R.NOTE_EXAMEN_RETENUE, R.SESSION_EXAMEN_RETENUE, R.NOTE_ECUE, R.NOTE_ECUE_DIRECTE],
      description: "Pour chaque ECUE du semestre : notes ramenées sur 20, moyenne des devoirs, examen retenu, note d'ECUE (ou saisie directe).",
    },
    {
      stage: "ue",
      rules: [R.MOYENNE_UE, R.UE_VALIDEE, R.ECUE_ELIMINEE, R.ECUE_VALIDEE, R.STATUT_ECUE, R.CREDITS_UE, R.ETAT_UE, R.SESSION_VALIDATION_UE, R.ELIGIBLE_RATTRAPAGE],
      description: "Pour chaque UE : moyenne, validation, statut des ECUE, état LMD, session de validation.",
    },
    {
      stage: "semestre",
      rules: [R.MOYENNE_SESSION, R.CREDITS_VALIDES, R.CREDITS_TOTAL, R.SEMESTRE_VALIDE, R.DECISION_SEMESTRE, R.MENTION_RELEVE, R.APPRECIATION_GENERALE, R.DISTINCTION_SEMESTRE, R.ARRONDI_AFFICHAGE],
      description: "Pour le semestre : moyenne, crédits, validation, décision, mentions (affichage arrondi à part).",
    },
    { stage: "classement", rules: [R.RANG], description: "Deuxième phase : rang, après le calcul de toute la cohorte." },
    {
      stage: "annee",
      rules: [R.MOYENNE_ANNUELLE, R.ANNEE_VALIDEE, R.MENTION_DIPLOME, R.DIPLOME_ELIGIBLE],
      description: "Année / cycle : moyenne annuelle, validation d'année, mention et éligibilité du diplôme.",
    },
  ]),
});
