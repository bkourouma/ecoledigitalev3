/**
 * Domaine -> DTO HTTP (contrats de `packages/contracts/src/v2/results.ts`). Instants ISO 8601 UTC, décimaux en chaînes.
 * Les entrées de calcul (`inputs`) et la trace ne sont JAMAIS exposées ici : elles ne sortent que par `explain`.
 */
import type { AppreciationRecord, DecisionRecord, DeliberationRecord, LineRecord, OverrideRecord, PeriodState, ResultHeader, ResultsSettings } from "../domain/records";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const stateDto = (s: PeriodState) => ({
  id: s.id,
  classroomId: s.classroomId,
  academicPeriodId: s.academicPeriodId,
  academicYearId: s.academicYearId,
  scope: s.scope,
  status: s.status,
  contractId: s.contractId,
  ruleSetCode: s.ruleSetCode,
  ruleVersionNo: s.ruleVersionNo,
  ruleVersionId: s.ruleVersionId,
  definitionHash: s.definitionHash,
  pinnedAt: s.pinnedAt.toISOString(),
  lockedAt: iso(s.lockedAt),
  deliberatedAt: iso(s.deliberatedAt),
  closedAt: iso(s.closedAt),
  reopenCount: s.reopenCount,
  lastReopenKind: s.lastReopenKind,
  lastReopenReason: s.lastReopenReason,
  resultsVersion: s.resultsVersion,
});

export const headerDto = (h: ResultHeader) => ({
  id: h.id,
  enrollmentId: h.enrollmentId,
  studentId: h.studentId,
  academicPeriodId: h.academicPeriodId,
  scope: h.scope,
  version: h.version,
  status: h.status,
  contractId: h.contractId,
  ruleSetCode: h.ruleSetCode,
  ruleVersionNo: h.ruleVersionNo,
  definitionHash: h.definitionHash,
  engineVersion: h.engineVersion,
  inputsHash: h.inputsHash,
  outputsHash: h.outputsHash,
  average: h.average,
  averageDisplay: h.averageDisplay,
  rank: h.rank,
  cohortSize: h.cohortSize,
  mentionCode: h.mentionCode,
  decisionCode: h.decisionCode,
  decisionOutcome: h.decisionOutcome,
  creditsAcquired: h.creditsAcquired,
  creditsRequired: h.creditsRequired,
  validated: h.validated,
  summary: h.summary,
  error: h.error ?? null,
  computedAt: h.computedAt.toISOString(),
  finalizedAt: iso(h.finalizedAt),
});

export const lineDto = (l: LineRecord) => ({
  level: l.level,
  curriculumNodeId: l.curriculumNodeId,
  parentNodeId: l.parentNodeId,
  value: l.value,
  displayValue: l.displayValue,
  credits: l.credits,
  coefficient: l.coefficient,
  validated: l.validated,
  statusCode: l.statusCode,
  sessionObtained: l.sessionObtained,
  resitEligible: l.resitEligible,
  rank: l.rank,
  cohortSize: l.cohortSize,
  overridden: l.overridden,
  outputs: l.outputs,
});

export const decisionDto = (d: DecisionRecord) => ({
  id: d.id,
  stateId: d.stateId,
  enrollmentId: d.enrollmentId,
  scope: d.scope,
  kind: d.kind,
  proposedCode: d.proposedCode,
  proposedOutcome: d.proposedOutcome,
  finalCode: d.finalCode,
  finalOutcome: d.finalOutcome,
  status: d.status,
  deliberationId: d.deliberationId,
  justification: d.justification,
  decidedBy: d.decidedBy,
  decidedAt: iso(d.decidedAt),
});

export const overrideDto = (o: OverrideRecord) => ({
  id: o.id,
  stateId: o.stateId,
  enrollmentId: o.enrollmentId,
  level: o.level,
  curriculumNodeId: o.curriculumNodeId,
  ruleKey: o.ruleKey,
  kind: o.kind,
  originalValue: o.originalValue,
  overrideValue: o.overrideValue,
  overrideFlag: o.overrideFlag,
  justification: o.justification,
  requestedBy: o.requestedBy,
  requestedByName: o.requestedByName,
  requestedAt: o.requestedAt.toISOString(),
  status: o.status,
  decidedBy: o.decidedBy,
  decidedByName: o.decidedByName,
  decidedAt: iso(o.decidedAt),
  decisionComment: o.decisionComment,
  revokedReason: o.revokedReason,
  fourEyesWaived: o.fourEyesWaived,
});

export const deliberationDto = (d: DeliberationRecord) => ({
  id: d.id,
  stateId: d.stateId,
  classroomId: d.classroomId,
  kind: d.kind,
  heldOn: d.heldOn,
  status: d.status,
  participants: d.participants,
  minutesObjectKey: d.minutesObjectKey,
});

export const appreciationDto = (a: AppreciationRecord) => ({
  id: a.id,
  stateId: a.stateId,
  enrollmentId: a.enrollmentId,
  curriculumNodeId: a.curriculumNodeId,
  authorStaffId: a.authorStaffId,
  authorRole: a.authorRole,
  body: a.body,
  updatedAt: a.updatedAt.toISOString(),
});

export const settingsDto = (s: ResultsSettings) => ({ requireDeliberation: s.requireDeliberation, requireSeparateApprover: s.requireSeparateApprover, recomputeDelaySeconds: s.recomputeDelaySeconds, updatedAt: iso(s.updatedAt) });
