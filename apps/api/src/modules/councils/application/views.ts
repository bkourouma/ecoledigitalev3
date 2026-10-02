/** Lignes SQL -> DTO du contrat (`packages/contracts/src/v2/councils.ts`). Aucune règle ici : de la mise en forme. */
import type {
  CouncilsAgendaItemDto,
  CouncilsCouncilDto,
  CouncilsCouncilTypeDto,
  CouncilsDecisionDto,
  CouncilsDecisionTypeDto,
  CouncilsEffectDto,
  CouncilsEventDto,
  CouncilsFacts,
  CouncilsMinutesDto,
  CouncilsOrientationFileDto,
  CouncilsOrientationPathDto,
  CouncilsParticipantDto,
  CouncilsParticipantRoleDto,
  CouncilsProposalDto,
  CouncilsSeriesTransferDto,
  CouncilsSettingsDto,
  CouncilsUnlockDto,
} from "@ecoledigitale/contracts/src/v2/councils";
import { COUNCIL_PLACEHOLDER_NOTICE } from "@ecoledigitale/contracts/src/v2/councils";
import type { CouncilCounts, AgendaCounts } from "../infrastructure/councils-repository";
import type {
  AgendaItemRow,
  CouncilRow,
  CouncilTypeRow,
  DecisionRow,
  DecisionTypeRow,
  EffectRow,
  EventRow,
  MinutesRow,
  OrientationFileRow,
  OrientationPathRow,
  ParticipantRow,
  ProposalRow,
  RoleRow,
  SettingsRow,
  SignatureRow,
  TransferRow,
  UnlockRow,
  WishRow,
} from "../infrastructure/rows";
import type { RuleSourceKind } from "./ports";

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoReq = (d: Date): string => d.toISOString();

export const roleDto = (r: RoleRow): CouncilsParticipantRoleDto => ({ ...r });
export const councilTypeDto = (t: CouncilTypeRow): CouncilsCouncilTypeDto => ({ ...t });
export const decisionTypeDto = (t: DecisionTypeRow): CouncilsDecisionTypeDto => ({
  id: t.id,
  code: t.code,
  label: t.label,
  family: t.family,
  appliesTo: t.appliesTo,
  exclusiveGroup: t.exclusiveGroup,
  requiresJustification: t.requiresJustification,
  requiresVote: t.requiresVote,
  requiresTarget: t.requiresTarget,
  resultsDecisionKind: t.resultsDecisionKind,
  resultsFinalCode: t.resultsFinalCode,
  academicOutcomeCode: t.academicOutcomeCode,
  needsHumanApplication: t.needsHumanApplication,
  studentStatus: t.studentStatus,
  isSystem: t.isSystem,
  sortOrder: t.sortOrder,
  active: t.active,
});
export const settingsDto = (s: SettingsRow): CouncilsSettingsDto => ({ ...s });

export interface CouncilContext {
  readonly type: CouncilTypeRow | undefined;
  readonly classroomName: string | null;
  readonly periodLabel: string | null;
  readonly ruleSourceKind: RuleSourceKind | null;
  readonly counts: CouncilCounts | undefined;
}

export function councilDto(c: CouncilRow, x: CouncilContext): CouncilsCouncilDto {
  return {
    id: c.id,
    institutionId: c.institutionId,
    academicYearId: c.academicYearId,
    classroomId: c.classroomId,
    classroomName: x.classroomName,
    academicPeriodId: c.academicPeriodId,
    periodLabel: x.periodLabel,
    councilTypeId: c.councilTypeId,
    councilTypeCode: x.type?.code ?? "",
    councilTypeLabel: x.type?.label ?? "",
    scope: c.scope,
    status: c.status,
    title: c.title,
    scheduledAt: iso(c.scheduledAt),
    location: c.location,
    heldOn: c.heldOn,
    openedAt: iso(c.openedAt),
    closedAt: iso(c.closedAt),
    signedAt: iso(c.signedAt),
    quorumWaived: c.quorumWaived,
    quorumWaiverReason: c.quorumWaiverReason,
    reopenCount: c.reopenCount,
    cancelReason: c.cancelReason,
    resultsStateId: c.resultsStateId,
    resultsDeliberationId: c.resultsDeliberationId,
    ruleSourceKind: x.ruleSourceKind,
    rowVersion: c.rowVersion,
    counts: { agendaItems: x.counts?.agendaItems ?? 0, decided: x.counts?.decided ?? 0, participants: x.counts?.participants ?? 0, present: x.counts?.present ?? 0 },
    createdAt: isoReq(c.createdAt),
  };
}

export function participantDto(p: ParticipantRow, roles: ReadonlyMap<string, RoleRow>): CouncilsParticipantDto {
  const role = roles.get(p.roleCode);
  return {
    id: p.id,
    councilId: p.councilId,
    roleCode: p.roleCode,
    roleLabel: role?.label ?? null,
    councilFunction: p.councilFunction,
    staffId: p.staffId,
    personId: p.personId,
    displayName: p.displayName,
    isVoting: p.isVoting,
    canDecide: role?.canDecide ?? false,
    presence: p.presence,
    convokedAt: iso(p.convokedAt),
    notifiedAt: iso(p.notifiedAt),
  };
}

export const factsOf = (row: AgendaItemRow): CouncilsFacts | null => (row.facts && (row.facts as { schema?: unknown }).schema ? (row.facts as CouncilsFacts) : null);

export function agendaItemDto(a: AgendaItemRow, counts: AgendaCounts | undefined): CouncilsAgendaItemDto {
  const facts = factsOf(a);
  return {
    id: a.id,
    councilId: a.councilId,
    enrollmentId: a.enrollmentId,
    studentId: a.studentId,
    studentName: a.studentDisplayName,
    position: a.position,
    status: a.status,
    factsVersion: a.factsVersion,
    factsHash: a.factsHash,
    preparedAt: iso(a.preparedAt),
    missingResults: facts === null ? null : facts.results === null ? true : facts.results.missingResults,
    ruleVersionRef: a.ruleVersionRef,
    decisionCount: counts?.decisionCount ?? 0,
    pendingProposals: counts?.pendingProposals ?? 0,
  };
}

export const proposalDto = (p: ProposalRow): CouncilsProposalDto => ({
  id: p.id,
  agendaItemId: p.agendaItemId,
  kind: p.kind,
  code: p.code,
  body: p.body,
  origin: p.origin,
  proposedBy: p.proposedBy,
  proposedByName: p.proposedByName,
  status: p.status,
  resolvedBy: p.resolvedBy,
  resolvedAt: iso(p.resolvedAt),
  resolutionNote: p.resolutionNote,
  ruleVersionRef: p.ruleVersionRef,
  createdAt: isoReq(p.createdAt),
});

export function decisionDto(d: DecisionRow, x: { typeLabel: string | null; deciderName: string | null }): CouncilsDecisionDto {
  return {
    id: d.id,
    councilId: d.councilId,
    agendaItemId: d.agendaItemId,
    enrollmentId: d.enrollmentId,
    studentId: d.studentId,
    decisionTypeId: d.decisionTypeId,
    decisionTypeCode: d.decisionTypeCode,
    decisionTypeLabel: x.typeLabel,
    family: d.family,
    exclusiveGroup: d.exclusiveGroup,
    suggestedCode: d.suggestedCode,
    suggestionRef: d.suggestionRef,
    differsFromSuggestion: d.differsFromSuggestion,
    justification: d.justification,
    mode: d.decisionMode,
    votesFor: d.votesFor,
    votesAgainst: d.votesAgainst,
    votesAbstain: d.votesAbstain,
    targetProgramId: d.targetProgramId,
    targetGradeLevelId: d.targetGradeLevelId,
    targetLabel: d.targetLabel,
    deciderParticipantId: d.deciderParticipantId,
    deciderName: x.deciderName,
    recordedBy: d.recordedBy,
    recordedByName: d.recordedByName,
    factsVersion: d.factsVersion,
    factsHash: d.factsHash,
    decidedAt: isoReq(d.decidedAt),
    status: d.status,
    withdrawnReason: d.withdrawnReason,
    supersedesId: d.supersedesId,
  };
}

export function effectDto(e: EffectRow, x: { studentId: string | null; studentName: string | null; decisionTypeCode: string | null }): CouncilsEffectDto {
  return {
    id: e.id,
    councilId: e.councilId,
    decisionId: e.decisionId,
    proposalId: e.proposalId,
    kind: e.effectKind,
    status: e.status,
    attempts: e.attempts,
    lastError: e.lastError,
    externalRef: e.externalRef,
    irreversible: e.irreversible,
    appliedAt: iso(e.appliedAt),
    appliedBy: e.appliedBy,
    revertedAt: iso(e.revertedAt),
    revertReason: e.revertReason,
    studentId: x.studentId,
    studentName: x.studentName,
    decisionTypeCode: x.decisionTypeCode,
    createdAt: isoReq(e.createdAt),
  };
}

export function minutesDto(m: MinutesRow, x: { signatures: readonly SignatureRow[]; missing: ReadonlyArray<{ participantId: string; displayName: string; roleCode: string }>; placeholderNotice: string | null }): CouncilsMinutesDto {
  return {
    id: m.id,
    councilId: m.councilId,
    version: m.version,
    status: m.status,
    schemaName: m.schemaName,
    snapshotHash: m.snapshotHash,
    generatedAt: isoReq(m.generatedAt),
    generatedBy: m.generatedBy,
    renderStatus: m.renderStatus,
    renderHash: m.renderHash,
    signedAt: iso(m.signedAt),
    supersedesId: m.supersedesId,
    revokedReason: m.revokedReason,
    signatures: x.signatures.map((s) => ({ id: s.id, participantId: s.participantId, roleCode: s.roleCode, signerName: s.signerName, method: s.method, signedHash: s.signedHash, signedAt: isoReq(s.signedAt) })),
    missingSigners: x.missing.map((p) => ({ ...p })),
    placeholderNotice: x.placeholderNotice,
  };
}

export const placeholderNoticeOf = (snapshot: unknown): string | null =>
  typeof snapshot === "object" && snapshot !== null && (snapshot as { placeholderNotice?: unknown }).placeholderNotice === COUNCIL_PLACEHOLDER_NOTICE ? COUNCIL_PLACEHOLDER_NOTICE : null;

export const unlockDto = (u: UnlockRow): CouncilsUnlockDto => ({
  id: u.id,
  councilId: u.councilId,
  requestedBy: u.requestedBy,
  requestedByName: u.requestedByName,
  requestedAt: isoReq(u.requestedAt),
  reason: u.reason,
  status: u.status,
  decidedBy: u.decidedBy,
  decidedByName: u.decidedByName,
  decidedAt: iso(u.decidedAt),
  decisionNote: u.decisionNote,
  fourEyesWaived: u.fourEyesWaived,
  consumedAt: iso(u.consumedAt),
});

export const eventDto = (e: EventRow): CouncilsEventDto => ({ id: e.id, councilId: e.councilId, kind: e.kind, actorId: e.actorId, actorKind: e.actorKind, reason: e.reason, occurredAt: isoReq(e.occurredAt), data: e.data });

export const pathDto = (p: OrientationPathRow): CouncilsOrientationPathDto => ({ ...p });

export function fileDto(f: OrientationFileRow, wishes: readonly WishRow[], studentName: string | null): CouncilsOrientationFileDto {
  return {
    id: f.id,
    institutionId: f.institutionId,
    academicYearId: f.academicYearId,
    enrollmentId: f.enrollmentId,
    studentId: f.studentId,
    studentName,
    currentProgramId: f.currentProgramId,
    currentGradeLevelId: f.currentGradeLevelId,
    status: f.status,
    guardianConsent: f.guardianConsent,
    consentRecordedAt: iso(f.consentRecordedAt),
    decisionId: f.decisionId,
    notes: f.notes,
    wishes: wishes.filter((w) => w.fileId === f.id).map((w) => ({ id: w.id, fileId: w.fileId, rank: w.rank, toProgramId: w.toProgramId, toGradeLevelId: w.toGradeLevelId, optionIds: w.optionIds, source: w.source, expressedBy: w.expressedBy, expressedAt: isoReq(w.expressedAt), comment: w.comment, withdrawnAt: iso(w.withdrawnAt) })),
    createdAt: isoReq(f.createdAt),
  };
}

export const transferDto = (t: TransferRow): CouncilsSeriesTransferDto => ({
  id: t.id,
  institutionId: t.institutionId,
  enrollmentId: t.enrollmentId,
  studentId: t.studentId,
  fromProgramId: t.fromProgramId,
  fromGradeLevelId: t.fromGradeLevelId,
  toProgramId: t.toProgramId,
  toGradeLevelId: t.toGradeLevelId,
  effectiveKind: t.effectiveKind,
  effectiveOn: t.effectiveOn,
  decidedVia: t.decidedVia,
  decisionId: t.decisionId,
  actReference: t.actReference,
  pathId: t.pathId,
  overridden: t.pathOverrideReason !== null,
  status: t.status,
  appliedAt: iso(t.appliedAt),
  lastError: t.lastError,
  cancelReason: t.cancelReason,
  createdAt: isoReq(t.createdAt),
});
