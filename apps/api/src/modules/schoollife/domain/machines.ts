/**
 * Machines à états de la vie scolaire — MIROIR PUR des déclencheurs de la base (migration 2202/2203). Un test lit les
 * transitions autorisées directement dans le SQL et exige l'égalité avec ces tables : la base impose, le domaine explique
 * (messages clairs avant l'aller-retour SQL, boutons d'écran).
 */
export type Transition<S extends string> = readonly [S, S];

export const INCIDENT_TRANSITIONS: ReadonlyArray<Transition<string>> = [
  ["DECLARED", "UNDER_REVIEW"],
  ["DECLARED", "DISMISSED"],
  ["UNDER_REVIEW", "CONFIRMED"],
  ["UNDER_REVIEW", "DISMISSED"],
  ["CONFIRMED", "CLOSED"],
  ["DISMISSED", "CLOSED"],
];

export const MEASURE_TRANSITIONS: ReadonlyArray<Transition<string>> = [
  ["PROPOSED", "VALIDATED"],
  ["PROPOSED", "REJECTED"],
  ["PROPOSED", "CANCELLED"],
  ["VALIDATED", "NOTIFIED"],
  ["VALIDATED", "EXECUTED"],
  ["VALIDATED", "CANCELLED"],
  ["NOTIFIED", "EXECUTED"],
  ["NOTIFIED", "APPEALED"],
  ["NOTIFIED", "REVOKED"],
  ["EXECUTED", "APPEALED"],
  ["EXECUTED", "REVOKED"],
  ["APPEALED", "EXECUTED"],
  ["APPEALED", "REVOKED"],
];
export const MEASURE_FINAL_STATUSES: readonly string[] = ["REJECTED", "CANCELLED", "REVOKED"];

export const CONVOCATION_TRANSITIONS: ReadonlyArray<Transition<string>> = [
  ["DRAFT", "SENT"],
  ["DRAFT", "CANCELLED"],
  ["SENT", "ACKNOWLEDGED"],
  ["SENT", "HELD"],
  ["SENT", "NO_SHOW"],
  ["SENT", "CANCELLED"],
  ["SENT", "RESCHEDULED"],
  ["ACKNOWLEDGED", "HELD"],
  ["ACKNOWLEDGED", "NO_SHOW"],
  ["ACKNOWLEDGED", "CANCELLED"],
  ["ACKNOWLEDGED", "RESCHEDULED"],
];
export const CONVOCATION_FINAL_STATUSES: readonly string[] = ["HELD", "NO_SHOW", "CANCELLED", "RESCHEDULED"];

export const SCALE_TRANSITIONS: ReadonlyArray<Transition<string>> = [
  ["DRAFT", "ACTIVE"],
  ["DRAFT", "RETIRED"],
  ["ACTIVE", "RETIRED"],
];

export const EFFECT_TRANSITIONS: ReadonlyArray<Transition<string>> = [
  ["AWAITING_HUMAN", "APPLIED"],
  ["AWAITING_HUMAN", "SKIPPED"],
  ["AWAITING_HUMAN", "FAILED"],
  ["FAILED", "APPLIED"],
  ["FAILED", "SKIPPED"],
  ["APPLIED", "REVERTED"],
];

export const canTransition = (table: ReadonlyArray<Transition<string>>, from: string, to: string): boolean => table.some(([f, t]) => f === from && t === to);

/** Statuts d'une exclusion « en vigueur » : ils participent à la contrainte de non-chevauchement (la base la porte). */
export const LIVE_EXCLUSION_STATUSES: readonly string[] = ["VALIDATED", "NOTIFIED", "EXECUTED", "APPEALED"];

/** Mesures qu'une famille peut contester (le type doit aussi être `appealable`). */
export const APPEALABLE_MEASURE_STATUSES: readonly string[] = ["NOTIFIED", "EXECUTED"];

/** Statuts de mesure qui produisent un mouvement de points (le barème actif s'applique à la validation). */
export const POINT_BEARING_MEASURE_STATUSES: readonly string[] = ["VALIDATED", "NOTIFIED", "EXECUTED"];
