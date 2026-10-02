/**
 * Règles PURES du conseil des maîtres. Le quorum n'est JAMAIS une constante : il est évalué par la règle `quorum_conseil` du
 * RuleSet lié (port `rules`) ; ce module compte seulement les convoqués et les présents.
 */
import { canonicalJson, sha256Hex } from "./review";
import type { CouncilAttendanceRow, CouncilCase } from "./types";

export function countAttendance(rows: readonly Pick<CouncilAttendanceRow, "convened" | "present">[]): { convened: number; present: number } {
  return { convened: rows.filter((r) => r.convened).length, present: rows.filter((r) => r.present === true).length };
}

/** Une décision différente de la proposition de la règle exige une justification (20 caractères au moins, comportement de `results`). */
export const JUSTIFICATION_MIN_LENGTH = 20;

export function decisionNeedsJustification(ruleProposalCode: string | null, finalCode: string | undefined): boolean {
  return finalCode !== undefined && finalCode !== ruleProposalCode;
}

/** Une signature exige la présence ; une présence signée est figée (déclencheur SQL). */
export function signatureProblems(participants: ReadonlyArray<{ staffId: string; present?: boolean | null | undefined }>, signedStaffIds: readonly string[]): string[] {
  const byId = new Map(participants.map((p) => [p.staffId, p]));
  const problems: string[] = [];
  for (const id of signedStaffIds) {
    const p = byId.get(id);
    if (!p) problems.push(`Le signataire ${id} ne figure pas sur la feuille de présence.`);
    else if (p.present !== true) problems.push(`Le signataire ${id} n'est pas marqué présent.`);
  }
  return problems;
}

/** Contenu FIGÉ du procès-verbal (le document est rendu depuis ce contenu, jamais depuis les tables vivantes). */
export interface MinutesContent {
  schema: 1;
  deliberationId: string;
  classroomId: string;
  periodId: string;
  /** Date RÉELLE de la séance. */
  heldOn: string;
  ruleSourceKind: string | null;
  participants: Array<{ staffId: string; staffName: string | null; roleCode: string; present: boolean; signed: boolean }>;
  decisions: Array<{ enrollmentId: string; studentId: string; ruleProposalCode: string | null; finalCode: string | null; justification: string | null; reasonCodes: string[] }>;
}

export function buildMinutes(input: {
  deliberationId: string;
  classroomId: string;
  periodId: string;
  heldOn: string;
  ruleSourceKind: string | null;
  attendance: ReadonlyArray<CouncilAttendanceRow & { staffName: string | null }>;
  cases: ReadonlyArray<CouncilCase & { ruleProposalCode: string | null; finalCode: string | null; justification: string | null }>;
}): { content: MinutesContent; contentHash: string } {
  const content: MinutesContent = {
    schema: 1,
    deliberationId: input.deliberationId,
    classroomId: input.classroomId,
    periodId: input.periodId,
    heldOn: input.heldOn,
    ruleSourceKind: input.ruleSourceKind,
    participants: input.attendance
      .filter((a) => a.convened)
      .map((a) => ({ staffId: a.staffId, staffName: a.staffName, roleCode: a.roleCode, present: a.present === true, signed: a.signedAt !== null }))
      .sort((a, b) => (a.staffId < b.staffId ? -1 : 1)),
    decisions: input.cases
      .map((c) => ({ enrollmentId: c.enrollmentId, studentId: c.studentId, ruleProposalCode: c.ruleProposalCode, finalCode: c.finalCode, justification: c.justification, reasonCodes: [...c.reasonCodes].sort() }))
      .sort((a, b) => (a.enrollmentId < b.enrollmentId ? -1 : 1)),
  };
  return { content, contentHash: sha256Hex(canonicalJson(content)) };
}
