/**
 * Machines à états du conseil, EN MIROIR de la base (`2104_councils_guards.sql`) : le domaine TypeScript les applique pour
 * répondre proprement avant d'écrire, la base les IMPOSE (un test de parité compare ces tables aux tuples du SQL).
 * Domaine pur.
 */
export type Transitions<S extends string> = ReadonlyArray<readonly [S, S]>;

export const canTransition = <S extends string>(table: Transitions<S>, from: S, to: S): boolean => table.some(([a, b]) => a === from && b === to);

export type CouncilStatus = "PLANNED" | "OPEN" | "CLOSED" | "SIGNED" | "CANCELLED";
export const COUNCIL_TRANSITIONS: Transitions<CouncilStatus> = Object.freeze([
  ["PLANNED", "OPEN"],
  ["PLANNED", "CANCELLED"],
  ["OPEN", "CLOSED"],
  ["OPEN", "CANCELLED"],
  ["CLOSED", "SIGNED"],
  ["CLOSED", "OPEN"],
  ["SIGNED", "OPEN"],
] as const);
/** États VERROUILLÉS : plus aucune écriture sur participants, ordre du jour, propositions, décisions. */
export const LOCKED_COUNCIL_STATUSES: readonly CouncilStatus[] = Object.freeze(["CLOSED", "SIGNED"]);
export const isLocked = (s: CouncilStatus): boolean => LOCKED_COUNCIL_STATUSES.includes(s);

export type EffectStatus = "PENDING" | "AWAITING_HUMAN" | "APPLIED" | "FAILED" | "REVERTED" | "SKIPPED";
export const EFFECT_TRANSITIONS: Transitions<EffectStatus> = Object.freeze([
  ["PENDING", "APPLIED"],
  ["PENDING", "FAILED"],
  ["PENDING", "SKIPPED"],
  ["FAILED", "PENDING"],
  ["FAILED", "APPLIED"],
  ["FAILED", "SKIPPED"],
  ["AWAITING_HUMAN", "APPLIED"],
  ["AWAITING_HUMAN", "SKIPPED"],
  ["APPLIED", "REVERTED"],
  ["SKIPPED", "PENDING"],
  ["SKIPPED", "AWAITING_HUMAN"],
] as const);

export type UnlockStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CONSUMED" | "EXPIRED";
export const UNLOCK_TRANSITIONS: Transitions<UnlockStatus> = Object.freeze([
  ["REQUESTED", "APPROVED"],
  ["REQUESTED", "REJECTED"],
  ["REQUESTED", "EXPIRED"],
  ["APPROVED", "CONSUMED"],
  ["APPROVED", "EXPIRED"],
] as const);

export type TransferStatus = "PLANNED" | "APPLIED" | "CANCELLED" | "FAILED";
export const TRANSFER_TRANSITIONS: Transitions<TransferStatus> = Object.freeze([
  ["PLANNED", "APPLIED"],
  ["PLANNED", "CANCELLED"],
  ["PLANNED", "FAILED"],
  ["FAILED", "PLANNED"],
  ["FAILED", "CANCELLED"],
] as const);

export type MinutesStatus = "GENERATED" | "SIGNED" | "SUPERSEDED" | "REVOKED";

/** Rang d'un état de résultats : la séance délibère sur des résultats AU MOINS aussi avancés que le minimum du type. */
export const RESULTS_STATUS_RANK: Readonly<Record<string, number>> = Object.freeze({ OPEN: 0, GRADING_LOCKED: 1, DELIBERATED: 2, CLOSED: 3 });
export const resultsReady = (actual: string, minimum: string): boolean => (RESULTS_STATUS_RANK[actual] ?? -1) >= (RESULTS_STATUS_RANK[minimum] ?? Number.POSITIVE_INFINITY);
