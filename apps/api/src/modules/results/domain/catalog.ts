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
  "secondary-annual@1": Object.freeze([
    { ruleKey: "moyenne_matiere", level: "SUBJECT", kind: "VALUE" },
    { ruleKey: "moyenne_ponderee", level: "PERIOD", kind: "VALUE" },
  ] as const),
  "coef-period@1": Object.freeze([
    { ruleKey: "moyenne_matiere", level: "SUBJECT", kind: "VALUE" },
    { ruleKey: "moyenne_periode", level: "PERIOD", kind: "VALUE" },
  ] as const),
  // competency-period@1 : aucune note, aucune moyenne — rien à surcharger.
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
  "secondary-annual@1": [
    { ruleKey: "decision_conseil", kind: "COUNCIL", scope: "PERIOD" },
    { ruleKey: "decision_fin_annee", kind: "YEAR_END", scope: "YEAR" },
  ],
  // La proposition de fin d'année vit sur la ligne `YEAR` du dernier résultat de période (pas de décision de période).
  "coef-period@1": [{ ruleKey: "decision_fin_annee", kind: "YEAR_END", scope: "YEAR" }],
  "competency-period@1": [{ ruleKey: "decision_fin_annee", kind: "YEAR_END", scope: "YEAR" }],
});

/**
 * Codes qu'une décision FINALE de fin d'année peut prendre quand elle est tranchée par un humain (conseil), par contrat. Pour les
 * contrats historiques, l'ensemble est celui des codes de sortie de la règle (comportement inchangé) ; pour `coef-period@1` et
 * `competency-period@1`, la règle ne propose que `PENDING` / `COUNCIL_REVIEW` / passage / redoublement : le conseil choisit parmi
 * le passage et le redoublement (jamais `COUNCIL_REVIEW`, qui n'est pas une décision).
 */
export const YEAR_END_FINAL_CODES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "coef-period@1": Object.freeze(["PROMOTED", "REPEAT"]),
  "competency-period@1": Object.freeze(["PROMOTED", "REPEAT"]),
});

/** Codes de PROPOSITION qui ne sont jamais confirmés automatiquement ni acceptés comme décision finale : le conseil tranche. */
export const NON_FINAL_DECISION_CODES: readonly string[] = Object.freeze(["COUNCIL_REVIEW"]);

export const isFinalDecisionCode = (code: string): boolean => !NON_FINAL_DECISION_CODES.includes(code);

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
  COUNCIL_REVIEW: "COUNCIL_REVIEW",
});

/** Issue d'une décision d'après son CODE (jamais son libellé). Code inconnu : `OTHER`. */
export const outcomeOf = (code: string): DecisionOutcome => OUTCOME_BY_CODE[code] ?? "OTHER";

/**
 * Groupe d'agrégation des types d'évaluation qui forment l'EXAMEN d'une ECUE (les autres forment le contrôle continu).
 * Fait partie du CHAÎNAGE du contrat `credit-semester@1` (structure versionnée en code), pas d'une valeur de règle :
 * les types eux-mêmes (codes, barèmes, poids) restent des données du tenant.
 */
export const EXAM_AGGREGATION_GROUP = "EXAM";
