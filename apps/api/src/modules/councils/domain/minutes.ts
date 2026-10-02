/**
 * Procès-verbal `council-minutes/1` : construction DÉTERMINISTE du snapshot (spec 006 AC4.2) — domaine pur.
 *
 *  - Même entrée = même snapshot octet pour octet (ordre des participants et des élèves fixé, clés dans un ordre fixe) : le hash
 *    est calculé par la base sur ce texte `jsonb`, la signature porte sur ce hash.
 *  - Chaînes, entiers, booléens, `null` UNIQUEMENT (jamais un flottant) ; aucune valeur calculée par le module.
 *  - La suggestion de la règle et la décision figurent côte à côte ; la mention « jeu de règles de démonstration, non
 *    réglementaire » est imprimée quand le jeu épinglé est `placeholder`.
 *  - Le nom des participants et des élèves est celui FIGÉ à la convocation / à la préparation.
 */
import {
  COUNCIL_MINUTES_SCHEMA,
  COUNCIL_PLACEHOLDER_NOTICE,
  councilsMinutesSnapshotSchema,
  findNonExactNumber,
  type CouncilsFacts,
  type CouncilsMinutesSnapshot,
} from "@ecoledigitale/contracts/src/v2/councils";
import { requiredSigners } from "./quorum";

export interface MinutesCouncil {
  readonly id: string;
  readonly institutionId: string;
  readonly institutionName: string | null;
  readonly classroomId: string;
  readonly classroomName: string | null;
  readonly gradeLevelCode: string | null;
  readonly academicYearId: string;
  readonly academicPeriodId: string | null;
  readonly periodLabel: string | null;
  readonly typeCode: string;
  readonly typeLabel: string;
  readonly scope: "PERIOD" | "YEAR";
  readonly heldOn: string;
  readonly location: string | null;
  readonly reopenCount: number;
  readonly quorumWaived: boolean;
  readonly quorumWaiverReason: string | null;
  readonly signerFunctions: readonly string[];
  readonly signerRoleCodes: readonly string[];
  readonly ruleVersionRef: string | null;
  readonly ruleSourceKind: "regulation" | "institution" | "platform" | "placeholder" | null;
}

export interface MinutesParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly roleCode: string;
  readonly roleLabel: string | null;
  readonly councilFunction: "PRESIDENT" | "SECRETARY" | null;
  readonly presence: "INVITED" | "PRESENT" | "ABSENT" | "EXCUSED";
}

export interface MinutesDecision {
  readonly agendaItemId: string;
  readonly decisionTypeCode: string;
  readonly decisionTypeLabel: string | null;
  readonly family: string;
  readonly suggestedCode: string | null;
  readonly differsFromSuggestion: boolean;
  readonly justification: string | null;
  readonly mode: "CONSENSUS" | "VOTE" | "PRESIDENT_CASTING_VOTE";
  readonly votesFor: number | null;
  readonly votesAgainst: number | null;
  readonly votesAbstain: number | null;
  readonly targetLabel: string | null;
  readonly deciderName: string;
}

export interface MinutesProposal {
  readonly agendaItemId: string;
  readonly kind: string;
  readonly code: string | null;
  readonly body: string | null;
  readonly status: string;
  readonly createdAt: string;
}

export interface MinutesStudent {
  readonly agendaItemId: string;
  readonly enrollmentId: string;
  readonly studentId: string;
  readonly name: string;
  readonly position: number;
  readonly factsVersion: number;
  readonly factsHash: string | null;
  readonly facts: CouncilsFacts;
}

export interface MinutesInput {
  readonly council: MinutesCouncil;
  readonly participants: readonly MinutesParticipant[];
  readonly students: readonly MinutesStudent[];
  readonly decisions: readonly MinutesDecision[];
  readonly proposals: readonly MinutesProposal[];
}

export class InvalidMinutesError extends Error {
  constructor(readonly path: string) {
    super(`Procès-verbal refusé : valeur non exacte ou invalide en ${path}.`);
    this.name = "InvalidMinutesError";
  }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const FUNCTION_ORDER: Readonly<Record<string, number>> = { PRESIDENT: 0, SECRETARY: 1 };

export function buildMinutesSnapshot(input: MinutesInput): CouncilsMinutesSnapshot {
  const c = input.council;
  const participants = [...input.participants].sort(
    (a, b) => (FUNCTION_ORDER[a.councilFunction ?? ""] ?? 9) - (FUNCTION_ORDER[b.councilFunction ?? ""] ?? 9) || cmp(a.displayName, b.displayName) || cmp(a.id, b.id),
  );
  const signers = requiredSigners(participants, { signerFunctions: c.signerFunctions, signerRoleCodes: c.signerRoleCodes });
  const students = [...input.students].sort((a, b) => a.position - b.position || cmp(a.name, b.name) || cmp(a.agendaItemId, b.agendaItemId));
  const snapshot: CouncilsMinutesSnapshot = {
    schema: COUNCIL_MINUTES_SCHEMA,
    institution: { institutionId: c.institutionId, name: c.institutionName },
    classroom: { classroomId: c.classroomId, name: c.classroomName, gradeLevelCode: c.gradeLevelCode },
    period: { periodId: c.academicPeriodId, label: c.periodLabel, academicYearId: c.academicYearId },
    council: {
      councilId: c.id,
      typeCode: c.typeCode,
      typeLabel: c.typeLabel,
      scope: c.scope,
      heldOn: c.heldOn,
      location: c.location,
      reopenCount: c.reopenCount,
      quorumWaived: c.quorumWaived,
      quorumWaiverReason: c.quorumWaived ? c.quorumWaiverReason : null,
    },
    participants: participants.map((p) => ({ participantId: p.id, name: p.displayName, roleCode: p.roleCode, roleLabel: p.roleLabel, function: p.councilFunction, presence: p.presence })),
    students: students.map((s) => {
      const accepted = input.proposals.filter((p) => p.agendaItemId === s.agendaItemId && (p.status === "ACCEPTED" || p.status === "MODIFIED"));
      const appreciation = accepted.filter((p) => p.kind === "APPRECIATION").sort((a, b) => cmp(a.createdAt, b.createdAt)).at(-1)?.body ?? null;
      const distinctions = [...new Set(accepted.filter((p) => p.kind === "DISTINCTION" && p.code !== null).map((p) => p.code as string))].sort(cmp);
      return {
        enrollmentId: s.enrollmentId,
        studentId: s.studentId,
        name: s.name,
        factsVersion: s.factsVersion,
        factsHash: s.factsHash,
        facts: s.facts,
        decisions: input.decisions
          .filter((d) => d.agendaItemId === s.agendaItemId)
          .sort((a, b) => cmp(a.decisionTypeCode, b.decisionTypeCode))
          .map((d) => ({
            decisionTypeCode: d.decisionTypeCode,
            decisionTypeLabel: d.decisionTypeLabel,
            family: d.family as CouncilsMinutesSnapshot["students"][number]["decisions"][number]["family"],
            suggestedCode: d.suggestedCode,
            differsFromSuggestion: d.differsFromSuggestion,
            justification: d.justification,
            mode: d.mode,
            votesFor: d.votesFor,
            votesAgainst: d.votesAgainst,
            votesAbstain: d.votesAbstain,
            targetLabel: d.targetLabel,
            deciderName: d.deciderName,
          })),
        appreciation,
        distinctions,
      };
    }),
    signers: signers.map((p) => ({ participantId: p.id, name: p.displayName, roleCode: p.roleCode })),
    references: { ruleVersionRef: c.ruleVersionRef, ruleSourceKind: c.ruleSourceKind },
    placeholderNotice: c.ruleSourceKind === "placeholder" ? COUNCIL_PLACEHOLDER_NOTICE : null,
  };
  const bad = findNonExactNumber(snapshot);
  if (bad) throw new InvalidMinutesError(bad);
  const parsed = councilsMinutesSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new InvalidMinutesError(parsed.error.issues[0]?.path.join(".") ?? "$");
  return parsed.data;
}
