/**
 * Structure (pas de valeur) propre aux contrats pris en charge : surcharges permises, correspondance code → issue de
 * décision, clés de règle. Les VALEURS (seuils, pondérations) appartiennent aux RuleSets ; la logique s'appuie sur les
 * CODES de sortie (R-RES-07), jamais sur un libellé.
 */
import type { DecisionOutcome, Level, OverrideKind } from "./types";

export interface OverridableTarget {
  readonly ruleKey: string;
  readonly level: Level;
  readonly kind: OverrideKind;
}

/** Étapes où une surcharge justifiée peut être injectée (le recalcul la rejoue, la trace la marque). */
export const OVERRIDABLE: Readonly<Record<string, readonly OverridableTarget[]>> = Object.freeze({
  "credit-semester@1": Object.freeze([
    { ruleKey: "note_ecue", level: "ECUE", kind: "VALUE" },
    { ruleKey: "ecue_validee", level: "ECUE", kind: "VALIDATION" },
    { ruleKey: "moyenne_ue", level: "UE", kind: "VALUE" },
    { ruleKey: "ue_validee", level: "UE", kind: "VALIDATION" },
    { ruleKey: "moyenne_session", level: "PERIOD", kind: "VALUE" },
    { ruleKey: "semestre_valide", level: "PERIOD", kind: "VALIDATION" },
  ] as const),
  "coef-semester@1": Object.freeze([
    { ruleKey: "moyenne_matiere", level: "SUBJECT", kind: "VALUE" },
    { ruleKey: "moyenne_ponderee", level: "PERIOD", kind: "VALUE" },
  ] as const),
});

export function findOverridable(contractId: string, ruleKey: string, level: Level, kind: OverrideKind): OverridableTarget | undefined {
  return OVERRIDABLE[contractId]?.find((t) => t.ruleKey === ruleKey && t.level === level && t.kind === kind);
}

/** Décisions proposées par les règles : clé de règle → type de décision matérialisé. */
export const DECISION_RULES: Readonly<Record<string, ReadonlyArray<{ ruleKey: string; kind: string; scope: "PERIOD" | "YEAR" }>>> = Object.freeze({
  "credit-semester@1": [{ ruleKey: "decision_semestre", kind: "SEMESTER_STATUS", scope: "PERIOD" }],
  "coef-semester@1": [
    { ruleKey: "decision_conseil", kind: "COUNCIL", scope: "PERIOD" },
    { ruleKey: "decision_fin_annee", kind: "YEAR_END", scope: "YEAR" },
  ],
});

const OUTCOME_BY_CODE: Readonly<Record<string, DecisionOutcome>> = Object.freeze({
  ADMITTED: "ADMITTED",
  RESIT: "RESIT",
  ADJOURNED: "ADJOURNED",
  PROMOTED: "PROMOTED",
  REPEAT: "REPEAT",
  PENDING: "PENDING",
  EXAM_REFERRAL: "EXAM_REFERRAL",
  INCOMPLETE: "PENDING",
  PERIOD_VALIDATED: "ADMITTED",
  PERIOD_NOT_VALIDATED: "ADJOURNED",
  REINFORCEMENT_ADVISED: "OTHER",
});

/** Issue d'une décision d'après son CODE (jamais son libellé). Code inconnu : `OTHER`. */
export const outcomeOf = (code: string): DecisionOutcome => OUTCOME_BY_CODE[code] ?? "OTHER";

/**
 * Groupe d'agrégation des types d'évaluation qui forment l'EXAMEN d'une ECUE (les autres forment le contrôle continu).
 * Fait partie du CHAÎNAGE du contrat `credit-semester@1` (structure versionnée en code), pas d'une valeur de règle :
 * les types eux-mêmes (codes, barèmes, poids) restent des données du tenant.
 */
export const EXAM_AGGREGATION_GROUP = "EXAM";
