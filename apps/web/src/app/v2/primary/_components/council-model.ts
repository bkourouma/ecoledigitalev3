/**
 * Modèle du conseil des maîtres : logique PURE (testée sans DOM). Des CODES, jamais des libellés comparés ; aucune décision de
 * passage calculée ici (la règle propose, le conseil confirme, l'API tranche). Les contrôles ci-dessous sont des contrôles de FORME
 * (longueur d'une justification, présence d'un code) qui évitent un aller-retour inutile.
 */

import {
  PRIMARY_RULE_PROPOSALS,
  type PrimaryCouncilAttendanceDto,
  type PrimaryDecideCaseBody,
  type PrimaryPutAttendanceBody,
  type PrimaryQuorumDto,
} from "@ecoledigitale/contracts/v2/primary_school";

/** Justification d'un écart avec la proposition de la règle (spec AC8.3) : 20 caractères au moins. */
export const COUNCIL_JUSTIFICATION_MIN = 20;

/** Codes qu'un conseil peut retenir : les propositions « tranchantes » (ni « en attente » ni « le conseil décide »). */
export const DECIDABLE_CODES: readonly string[] = PRIMARY_RULE_PROPOSALS.filter((c) => c !== "PENDING" && c !== "COUNCIL_REVIEW");

/** La proposition de la règle peut être confirmée telle quelle seulement si elle tranche. */
export const canConfirmRuleProposal = (ruleProposalCode: string | null): boolean => ruleProposalCode !== null && DECIDABLE_CODES.includes(ruleProposalCode);

export type DecisionMode = "confirm" | "other";
export type DecisionProblem = "cannot_confirm" | "code_required" | "justification_short";

/**
 * Corps de `POST …/decide`. Confirmer la proposition : aucun code (l'API confirme la proposition de la règle). Retenir un code :
 * il est envoyé ; une justification est exigée (20 caractères) dès que le code diffère de la proposition de la règle.
 */
export function buildDecision(input: { mode: DecisionMode; ruleProposalCode: string | null; finalCode: string; justification: string }): { ok: true; body: PrimaryDecideCaseBody } | { ok: false; problem: DecisionProblem } {
  if (input.mode === "confirm") {
    if (!canConfirmRuleProposal(input.ruleProposalCode)) return { ok: false, problem: "cannot_confirm" };
    return { ok: true, body: {} };
  }
  if (!input.finalCode) return { ok: false, problem: "code_required" };
  const justification = input.justification.trim();
  const differs = input.finalCode !== input.ruleProposalCode;
  if (differs && justification.length < COUNCIL_JUSTIFICATION_MIN) return { ok: false, problem: "justification_short" };
  return { ok: true, body: { finalCode: input.finalCode, ...(justification ? { justification } : {}) } };
}

export type QuorumView = "none" | "met" | "unmet";

/** `met` peut être `null` = « aucun quorum bloquant » (aucune règle liée) : la présence est affichée, rien n'est bloqué. */
export function quorumView(q: PrimaryQuorumDto): QuorumView {
  if (q.source === "none" || q.met === null) return "none";
  return q.met ? "met" : "unmet";
}

export interface AttendanceRow {
  staffId: string;
  staffName: string | null;
  roleCode: PrimaryCouncilAttendanceDto["roleCode"];
  convened: boolean;
  present: boolean | null;
  note: string | null;
  /** Instant de signature d'une présence DÉJÀ signée (figée). */
  signedAt: string | null;
  /** Signature cochée dans cette saisie (exige la présence). */
  sign: boolean;
}

export const rowsFromAttendance = (attendance: ReadonlyArray<PrimaryCouncilAttendanceDto>): AttendanceRow[] =>
  attendance.map((a) => ({ staffId: a.staffId, staffName: a.staffName, roleCode: a.roleCode, convened: a.convened, present: a.present, note: a.note, signedAt: a.signedAt, sign: false }));

/**
 * Corps de `PUT …/attendance` : seules les lignes NON signées partent (une présence signée est figée et ne se réécrit pas) ;
 * les signatures cochées exigent la présence.
 */
export function attendancePayload(rows: ReadonlyArray<AttendanceRow>): PrimaryPutAttendanceBody {
  const editable = rows.filter((r) => r.signedAt === null);
  return {
    participants: editable.map((r) => ({ staffId: r.staffId, roleCode: r.roleCode, convened: r.convened, present: r.present, ...(r.note ? { note: r.note } : {}) })),
    signedStaffIds: editable.filter((r) => r.sign && r.present === true).map((r) => r.staffId),
  };
}

/** Une signature cochée sans présence confirmée : problème de forme à corriger avant l'envoi. */
export const signaturesWithoutPresence = (rows: ReadonlyArray<AttendanceRow>): string[] => rows.filter((r) => r.signedAt === null && r.sign && r.present !== true).map((r) => r.staffId);
