/**
 * Enregistrements persistés du module `results` (lecture). Décimaux exacts en CHAÎNES, instants en `Date` (UTC).
 */
import type { DecisionOutcome, Level, OverrideKind, PeriodStatus, ReopenKind, ResultStatus, StateScope } from "./types";

export interface PeriodState {
  id: string;
  classroomId: string;
  academicPeriodId: string | null;
  academicYearId: string;
  scope: StateScope;
  status: PeriodStatus;
  contractId: string;
  ruleVersionKind: "TENANT" | "NATIONAL";
  ruleVersionId: string;
  ruleSetCode: string;
  ruleVersionNo: number;
  definitionHash: string;
  pinnedAt: Date;
  pinnedBy: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  deliberatedAt: Date | null;
  deliberatedBy: string | null;
  closedAt: Date | null;
  closedBy: string | null;
  reopenCount: number;
  lastReopenKind: ReopenKind | null;
  lastReopenReason: string | null;
  resultsVersion: number;
  rowVersion: number;
}

export interface ResultHeader {
  id: string;
  stateId: string;
  enrollmentId: string;
  studentId: string;
  classroomId: string;
  academicPeriodId: string | null;
  academicYearId: string;
  scope: StateScope;
  version: number;
  status: ResultStatus;
  contractId: string;
  ruleVersionKind: string;
  ruleVersionId: string;
  ruleSetCode: string;
  ruleVersionNo: number;
  definitionHash: string;
  engineVersion: string;
  inputsHash: string;
  outputsHash: string | null;
  inputs: unknown;
  error: unknown;
  average: string | null;
  averageDisplay: string | null;
  rank: number | null;
  cohortSize: number | null;
  mentionCode: string | null;
  decisionCode: string | null;
  decisionOutcome: DecisionOutcome | null;
  creditsAcquired: string | null;
  creditsRequired: string | null;
  validated: boolean | null;
  summary: Record<string, unknown>;
  closureId: string | null;
  lineCount: number | null;
  computedAt: Date;
  finalizedAt: Date | null;
  supersededAt: Date | null;
}

export interface LineRecord {
  id: string;
  periodResultId: string;
  level: Level;
  curriculumNodeId: string | null;
  parentNodeId: string | null;
  value: string | null;
  displayValue: string | null;
  credits: string | null;
  coefficient: string | null;
  validated: boolean | null;
  statusCode: string | null;
  sessionObtained: 1 | 2 | null;
  resitEligible: boolean | null;
  rank: number | null;
  cohortSize: number | null;
  overridden: boolean;
  overrideId: string | null;
  outputs: Record<string, unknown>;
  trace: unknown;
  position: number;
}

export interface ClosureRecord {
  id: string;
  stateId: string;
  resultsVersion: number;
  resultsCount: number;
  closureHash: string;
  excluded: unknown;
  forcedReason: string | null;
  closedAt: Date;
  closedBy: string;
  closedByName: string;
}

export interface OverrideRecord {
  id: string;
  stateId: string;
  enrollmentId: string;
  level: Level;
  curriculumNodeId: string | null;
  ruleKey: string;
  kind: OverrideKind;
  originalValue: string | null;
  overrideValue: string | null;
  overrideFlag: boolean | null;
  justification: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "REVOKED";
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  revokedReason: string | null;
  fourEyesWaived: boolean;
}

export interface DeliberationRecord {
  id: string;
  classroomId: string;
  stateId: string;
  kind: "COUNCIL" | "JURY";
  heldOn: string | null;
  status: "PLANNED" | "HELD" | "SIGNED" | "CANCELLED";
  participants: unknown;
  minutesObjectKey: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DecisionRecord {
  id: string;
  stateId: string;
  enrollmentId: string;
  scope: StateScope;
  kind: string;
  sourceResultId: string | null;
  proposedCode: string | null;
  proposedOutcome: string | null;
  finalCode: string | null;
  finalOutcome: string | null;
  status: "PROPOSED" | "CONFIRMED" | "PUBLISHED" | "WITHDRAWN";
  deliberationId: string | null;
  justification: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  /** `RULE` : proposée par une règle ; `COUNCIL` : écrite par un conseil (aucune proposition de règle). */
  origin: "RULE" | "COUNCIL";
  /** Référence OPAQUE de l'acte source d'un conseil (séance, décision), `null` pour une décision de règle. */
  councilRef: string | null;
}

export interface AppreciationRecord {
  id: string;
  stateId: string;
  enrollmentId: string;
  curriculumNodeId: string | null;
  authorStaffId: string;
  authorRole: "TEACHER" | "COUNCIL" | "DIRECTOR";
  body: string;
  updatedAt: Date;
}

export interface RecomputeRequest {
  id: string;
  classroomId: string;
  academicPeriodId: string;
  scopeEnrollments: string[] | null;
  causes: Array<{ event: string; id: string | null; at: string }>;
  notBefore: Date;
  status: "PENDING" | "RUNNING" | "DONE" | "BLOCKED" | "FAILED";
  blockedReason: string | null;
  attempts: number;
  lastError: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ResultsSettings {
  requireDeliberation: boolean;
  requireSeparateApprover: boolean;
  recomputeDelaySeconds: number;
  updatedAt: Date | null;
}

export const DEFAULT_RESULTS_SETTINGS: ResultsSettings = Object.freeze({ requireDeliberation: true, requireSeparateApprover: true, recomputeDelaySeconds: 10, updatedAt: null });
