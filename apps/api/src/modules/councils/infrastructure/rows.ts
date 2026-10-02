/**
 * Lignes SQL typées. Les requêtes les produisent en camelCase (alias) avec les dates civiles en texte (`::text`) : aucun mapper,
 * aucune dérive de nom entre le SQL et le code. Les instants (`timestamptz`) arrivent en `Date`.
 */
import type { CouncilsFacts } from "@ecoledigitale/contracts/src/v2/councils";

export interface RoleRow {
  id: string;
  code: string;
  label: string;
  isVoting: boolean;
  countsForQuorum: boolean;
  maySign: boolean;
  canDecide: boolean;
  isExternal: boolean;
  sortOrder: number;
  active: boolean;
}

export interface CouncilTypeRow {
  id: string;
  code: string;
  label: string;
  scope: "PERIOD" | "YEAR";
  minResultsStatus: "OPEN" | "GRADING_LOCKED";
  minParticipants: number | null;
  requiredRoleCodes: string[];
  signerFunctions: Array<"PRESIDENT" | "SECRETARY">;
  signerRoleCodes: string[];
  requiresDecisionPerStudent: boolean;
  sortOrder: number;
  active: boolean;
}

export interface DecisionTypeRow {
  id: string;
  code: string;
  label: string;
  family: "PASSAGE" | "REPEAT" | "ORIENTATION" | "REORIENTATION" | "EXCLUSION" | "REQUIRED_OPINION" | "OTHER";
  appliesTo: "PERIOD" | "YEAR" | "BOTH";
  exclusiveGroup: string | null;
  requiresJustification: boolean;
  requiresVote: boolean;
  requiresTarget: boolean;
  resultsDecisionKind: string | null;
  resultsFinalCode: string | null;
  academicOutcomeCode: string | null;
  needsHumanApplication: boolean;
  studentStatus: "SUSPENDED" | "EXCLUDED" | null;
  isSystem: boolean;
  sortOrder: number;
  active: boolean;
}

export interface SettingsRow {
  institutionId: string;
  requireSeparateUnlocker: boolean;
  effectsTrigger: "CLOSED" | "SIGNED";
  guardianVisibility: "NEVER" | "AFTER_SIGNATURE" | "AFTER_NOTIFICATION";
  allowQuorumWaiver: boolean;
  minutesTemplateKey: string | null;
}

export type CouncilStatusValue = "PLANNED" | "OPEN" | "CLOSED" | "SIGNED" | "CANCELLED";

export interface CouncilRow {
  id: string;
  institutionId: string;
  academicYearId: string;
  classroomId: string;
  academicPeriodId: string | null;
  councilTypeId: string;
  scope: "PERIOD" | "YEAR";
  resultsStateId: string | null;
  resultsDeliberationId: string | null;
  status: CouncilStatusValue;
  title: string | null;
  scheduledAt: Date | null;
  location: string | null;
  heldOn: string | null;
  openedAt: Date | null;
  openedBy: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  signedAt: Date | null;
  quorumWaived: boolean;
  quorumWaiverReason: string | null;
  reopenCount: number;
  cancelReason: string | null;
  rowVersion: number;
  createdBy: string;
  createdAt: Date;
}

export interface ParticipantRow {
  id: string;
  councilId: string;
  roleCode: string;
  councilFunction: "PRESIDENT" | "SECRETARY" | null;
  staffId: string | null;
  personId: string | null;
  displayName: string;
  isVoting: boolean;
  presence: "INVITED" | "PRESENT" | "ABSENT" | "EXCUSED";
  convokedAt: Date | null;
  notifiedAt: Date | null;
  notificationRef: string | null;
}

export interface AgendaItemRow {
  id: string;
  councilId: string;
  enrollmentId: string;
  studentId: string;
  studentDisplayName: string;
  position: number;
  status: "PENDING" | "REVIEWED" | "DECIDED";
  facts: CouncilsFacts | Record<string, never>;
  factsHash: string | null;
  factsVersion: number;
  preparedAt: Date | null;
  ruleVersionRef: string | null;
}

export interface ProposalRow {
  id: string;
  councilId: string;
  agendaItemId: string;
  kind: "APPRECIATION" | "DISTINCTION" | "DECISION" | "REMARK";
  code: string | null;
  body: string | null;
  origin: "RULE_SUGGESTION" | "HUMAN";
  proposedBy: string | null;
  proposedByName: string | null;
  status: "PROPOSED" | "ACCEPTED" | "MODIFIED" | "REJECTED" | "WITHDRAWN";
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  ruleVersionRef: string | null;
  createdAt: Date;
}

export interface DecisionRow {
  id: string;
  councilId: string;
  agendaItemId: string;
  enrollmentId: string;
  studentId: string;
  decisionTypeId: string;
  decisionTypeCode: string;
  family: DecisionTypeRow["family"];
  exclusiveGroup: string | null;
  suggestedCode: string | null;
  suggestionRef: string | null;
  differsFromSuggestion: boolean;
  justification: string | null;
  decisionMode: "CONSENSUS" | "VOTE" | "PRESIDENT_CASTING_VOTE";
  votesFor: number | null;
  votesAgainst: number | null;
  votesAbstain: number | null;
  targetProgramId: string | null;
  targetGradeLevelId: string | null;
  targetLabel: string | null;
  deciderParticipantId: string;
  recordedBy: string;
  recordedByName: string;
  factsVersion: number;
  factsHash: string | null;
  decidedAt: Date;
  status: "RECORDED" | "WITHDRAWN" | "SUPERSEDED";
  withdrawnReason: string | null;
  supersedesId: string | null;
}

export interface EffectRow {
  id: string;
  councilId: string;
  decisionId: string | null;
  proposalId: string | null;
  effectKind: "RESULTS_DECISION" | "ENROLLMENT_OUTCOME" | "ORIENTATION_FILE" | "SERIES_TRANSFER" | "STUDENT_STATUS_REQUEST" | "NOTIFY_GUARDIANS" | "RESULTS_APPRECIATION" | "RESULTS_DISTINCTION";
  status: "PENDING" | "AWAITING_HUMAN" | "APPLIED" | "FAILED" | "REVERTED" | "SKIPPED";
  attempts: number;
  lastError: string | null;
  externalRef: string | null;
  irreversible: boolean;
  appliedAt: Date | null;
  appliedBy: string | null;
  revertedAt: Date | null;
  revertReason: string | null;
  createdAt: Date;
}

export interface MinutesRow {
  id: string;
  councilId: string;
  version: number;
  status: "GENERATED" | "SIGNED" | "SUPERSEDED" | "REVOKED";
  schemaName: string;
  snapshotHash: string;
  generatedAt: Date;
  generatedBy: string;
  renderStatus: "PENDING" | "RENDERED" | "FAILED";
  renderObjectKey: string | null;
  renderHash: string | null;
  signedAt: Date | null;
  supersedesId: string | null;
  revokedReason: string | null;
}

export interface SignatureRow {
  id: string;
  minutesId: string;
  participantId: string;
  roleCode: string;
  signerName: string;
  method: "ELECTRONIC" | "SCANNED_PAPER";
  signedHash: string;
  signedAt: Date;
  signedByUser: string;
}

export interface UnlockRow {
  id: string;
  councilId: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  reason: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "CONSUMED" | "EXPIRED";
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  fourEyesWaived: boolean;
  consumedAt: Date | null;
}

export interface EventRow {
  id: string;
  councilId: string;
  kind: string;
  actorId: string | null;
  actorKind: string | null;
  reason: string | null;
  occurredAt: Date;
  data: Record<string, unknown>;
}

export interface OrientationPathRow {
  id: string;
  institutionId: string | null;
  kind: "ORIENTATION" | "REORIENTATION" | "SERIES_CHANGE";
  fromProgramId: string | null;
  fromGradeLevelId: string;
  toProgramId: string;
  toGradeLevelId: string;
  label: string | null;
  requiresCouncilOpinion: boolean;
  requiresGuardianConsent: boolean;
  active: boolean;
  sourceKind: "regulation" | "institution" | "placeholder";
}

export interface OrientationFileRow {
  id: string;
  institutionId: string;
  academicYearId: string;
  enrollmentId: string;
  studentId: string;
  currentProgramId: string;
  currentGradeLevelId: string;
  status: "OPEN" | "WISHES_COLLECTED" | "PROPOSED" | "DECIDED" | "APPLIED" | "CLOSED" | "CANCELLED";
  guardianConsent: "NOT_REQUIRED" | "PENDING" | "GIVEN" | "REFUSED";
  consentRecordedBy: string | null;
  consentRecordedAt: Date | null;
  decisionId: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface WishRow {
  id: string;
  fileId: string;
  rank: number;
  toProgramId: string;
  toGradeLevelId: string;
  optionIds: string[];
  source: "GUARDIAN" | "STUDENT" | "STAFF" | "COUNSELLOR";
  expressedBy: string;
  expressedAt: Date;
  comment: string | null;
  withdrawnAt: Date | null;
}

export interface TransferRow {
  id: string;
  institutionId: string;
  enrollmentId: string;
  studentId: string;
  fromProgramId: string;
  fromGradeLevelId: string;
  toProgramId: string;
  toGradeLevelId: string;
  effectiveKind: "NEXT_YEAR" | "MID_YEAR";
  effectiveOn: string | null;
  decidedVia: "COUNCIL" | "DIRECTOR_ACT";
  decisionId: string | null;
  actReference: string | null;
  actIssuedBy: string | null;
  pathId: string | null;
  pathOverrideReason: string | null;
  status: "PLANNED" | "APPLIED" | "CANCELLED" | "FAILED";
  appliedAt: Date | null;
  appliedRef: string | null;
  lastError: string | null;
  cancelReason: string | null;
  createdAt: Date;
}
