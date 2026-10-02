/**
 * Colonnes SQL et mappeurs ligne -> domaine. `numeric` lu en chaîne (jamais converti en flottant) ; dates calendaires en texte.
 */
import type { AppreciationRecord, ClosureRecord, DecisionRecord, DeliberationRecord, LineRecord, OverrideRecord, PeriodState, RecomputeRequest, ResultHeader, ResultsSettings } from "../domain/records";

export const STATE_COLUMNS = `s.id, s.classroom_id, s.academic_period_id, s.academic_year_id, s.scope, s.status, s.contract_id, s.rule_version_kind,
  s.rule_version_id, s.rule_set_code, s.rule_version_no, s.definition_hash, s.pinned_at, s.pinned_by, s.locked_at, s.locked_by,
  s.deliberated_at, s.deliberated_by, s.closed_at, s.closed_by, s.reopen_count, s.last_reopen_kind, s.last_reopen_reason,
  s.results_version, s.row_version`;

export const toState = (r: any): PeriodState => ({
  id: r.id,
  classroomId: r.classroom_id,
  academicPeriodId: r.academic_period_id,
  academicYearId: r.academic_year_id,
  scope: r.scope,
  status: r.status,
  contractId: r.contract_id,
  ruleVersionKind: r.rule_version_kind,
  ruleVersionId: r.rule_version_id,
  ruleSetCode: r.rule_set_code,
  ruleVersionNo: r.rule_version_no,
  definitionHash: r.definition_hash,
  pinnedAt: r.pinned_at,
  pinnedBy: r.pinned_by,
  lockedAt: r.locked_at,
  lockedBy: r.locked_by,
  deliberatedAt: r.deliberated_at,
  deliberatedBy: r.deliberated_by,
  closedAt: r.closed_at,
  closedBy: r.closed_by,
  reopenCount: r.reopen_count,
  lastReopenKind: r.last_reopen_kind,
  lastReopenReason: r.last_reopen_reason,
  resultsVersion: r.results_version,
  rowVersion: r.row_version,
});

export const HEADER_COLUMNS = `r.id, r.state_id, r.enrollment_id, r.student_id, r.classroom_id, r.academic_period_id, r.academic_year_id, r.scope, r.version,
  r.status, r.contract_id, r.rule_version_kind, r.rule_version_id, r.rule_set_code, r.rule_version_no, r.definition_hash, r.engine_version,
  r.inputs_hash, r.outputs_hash, r.inputs, r.error, r.average::text AS average, r.average_display::text AS average_display, r.rank, r.cohort_size,
  r.mention_code, r.decision_code, r.decision_outcome, r.credits_acquired::text AS credits_acquired, r.credits_required::text AS credits_required,
  r.validated, r.summary, r.closure_id, r.line_count, r.computed_at, r.finalized_at, r.superseded_at`;

export const toHeader = (r: any): ResultHeader => ({
  id: r.id,
  stateId: r.state_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  classroomId: r.classroom_id,
  academicPeriodId: r.academic_period_id,
  academicYearId: r.academic_year_id,
  scope: r.scope,
  version: r.version,
  status: r.status,
  contractId: r.contract_id,
  ruleVersionKind: r.rule_version_kind,
  ruleVersionId: r.rule_version_id,
  ruleSetCode: r.rule_set_code,
  ruleVersionNo: r.rule_version_no,
  definitionHash: r.definition_hash,
  engineVersion: r.engine_version,
  inputsHash: r.inputs_hash,
  outputsHash: r.outputs_hash,
  inputs: r.inputs,
  error: r.error,
  average: r.average,
  averageDisplay: r.average_display,
  rank: r.rank,
  cohortSize: r.cohort_size,
  mentionCode: r.mention_code,
  decisionCode: r.decision_code,
  decisionOutcome: r.decision_outcome,
  creditsAcquired: r.credits_acquired,
  creditsRequired: r.credits_required,
  validated: r.validated,
  summary: r.summary ?? {},
  closureId: r.closure_id,
  lineCount: r.line_count,
  computedAt: r.computed_at,
  finalizedAt: r.finalized_at,
  supersededAt: r.superseded_at,
});

export const LINE_COLUMNS = `l.id, l.period_result_id, l.level, l.curriculum_node_id, l.parent_node_id, l.value::text AS value, l.display_value::text AS display_value,
  l.credits::text AS credits, l.coefficient::text AS coefficient, l.validated, l.status_code, l.session_obtained, l.resit_eligible, l.rank,
  l.cohort_size, l.overridden, l.override_id, l.outputs, l.trace, l.position`;

export const toLine = (r: any): LineRecord => ({
  id: r.id,
  periodResultId: r.period_result_id,
  level: r.level,
  curriculumNodeId: r.curriculum_node_id,
  parentNodeId: r.parent_node_id,
  value: r.value,
  displayValue: r.display_value,
  credits: r.credits,
  coefficient: r.coefficient,
  validated: r.validated,
  statusCode: r.status_code,
  sessionObtained: r.session_obtained,
  resitEligible: r.resit_eligible,
  rank: r.rank,
  cohortSize: r.cohort_size,
  overridden: r.overridden,
  overrideId: r.override_id,
  outputs: r.outputs ?? {},
  trace: r.trace,
  position: r.position,
});

export const CLOSURE_COLUMNS = "c.id, c.state_id, c.results_version, c.results_count, c.closure_hash, c.excluded, c.forced_reason, c.closed_at, c.closed_by, c.closed_by_name";
export const toClosure = (r: any): ClosureRecord => ({
  id: r.id,
  stateId: r.state_id,
  resultsVersion: r.results_version,
  resultsCount: r.results_count,
  closureHash: r.closure_hash,
  excluded: r.excluded,
  forcedReason: r.forced_reason,
  closedAt: r.closed_at,
  closedBy: r.closed_by,
  closedByName: r.closed_by_name,
});

export const OVERRIDE_COLUMNS = `o.id, o.state_id, o.enrollment_id, o.level, o.curriculum_node_id, o.rule_key, o.kind, o.original_value, o.override_value::text AS override_value,
  o.override_flag, o.justification, o.requested_by, o.requested_by_name, o.requested_at, o.status, o.decided_by, o.decided_by_name, o.decided_at,
  o.decision_comment, o.revoked_reason, o.four_eyes_waived`;
export const toOverride = (r: any): OverrideRecord => ({
  id: r.id,
  stateId: r.state_id,
  enrollmentId: r.enrollment_id,
  level: r.level,
  curriculumNodeId: r.curriculum_node_id,
  ruleKey: r.rule_key,
  kind: r.kind,
  originalValue: r.original_value,
  overrideValue: r.override_value,
  overrideFlag: r.override_flag,
  justification: r.justification,
  requestedBy: r.requested_by,
  requestedByName: r.requested_by_name,
  requestedAt: r.requested_at,
  status: r.status,
  decidedBy: r.decided_by,
  decidedByName: r.decided_by_name,
  decidedAt: r.decided_at,
  decisionComment: r.decision_comment,
  revokedReason: r.revoked_reason,
  fourEyesWaived: r.four_eyes_waived,
});

export const DELIBERATION_COLUMNS = "d.id, d.classroom_id, d.state_id, d.kind, d.held_on::text AS held_on, d.status, d.participants, d.minutes_object_key, d.created_by, d.created_at, d.updated_at";
export const toDeliberation = (r: any): DeliberationRecord => ({
  id: r.id,
  classroomId: r.classroom_id,
  stateId: r.state_id,
  kind: r.kind,
  heldOn: r.held_on,
  status: r.status,
  participants: r.participants,
  minutesObjectKey: r.minutes_object_key,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const DECISION_COLUMNS = `d.id, d.state_id, d.enrollment_id, d.scope, d.kind, d.source_result_id, d.proposed_code, d.proposed_outcome, d.final_code, d.final_outcome,
  d.status, d.deliberation_id, d.justification, d.decided_by, d.decided_by_name, d.decided_at, d.origin, d.council_ref`;
export const toDecision = (r: any): DecisionRecord => ({
  id: r.id,
  stateId: r.state_id,
  enrollmentId: r.enrollment_id,
  scope: r.scope,
  kind: r.kind,
  sourceResultId: r.source_result_id,
  proposedCode: r.proposed_code,
  proposedOutcome: r.proposed_outcome,
  finalCode: r.final_code,
  finalOutcome: r.final_outcome,
  status: r.status,
  deliberationId: r.deliberation_id,
  justification: r.justification,
  decidedBy: r.decided_by,
  decidedByName: r.decided_by_name,
  decidedAt: r.decided_at,
  origin: r.origin ?? "RULE",
  councilRef: r.council_ref ?? null,
});

export const APPRECIATION_COLUMNS = "a.id, a.state_id, a.enrollment_id, a.curriculum_node_id, a.author_staff_id, a.author_role, a.body, a.updated_at";
export const toAppreciation = (r: any): AppreciationRecord => ({
  id: r.id,
  stateId: r.state_id,
  enrollmentId: r.enrollment_id,
  curriculumNodeId: r.curriculum_node_id,
  authorStaffId: r.author_staff_id,
  authorRole: r.author_role,
  body: r.body,
  updatedAt: r.updated_at,
});

export const RECOMPUTE_COLUMNS = `q.id, q.classroom_id, q.academic_period_id, q.scope_enrollments, q.causes, q.not_before, q.status, q.blocked_reason,
  q.attempts, q.last_error, q.requested_at, q.started_at, q.finished_at`;
export const toRecompute = (r: any): RecomputeRequest => ({
  id: r.id,
  classroomId: r.classroom_id,
  academicPeriodId: r.academic_period_id,
  scopeEnrollments: r.scope_enrollments,
  causes: r.causes ?? [],
  notBefore: r.not_before,
  status: r.status,
  blockedReason: r.blocked_reason,
  attempts: r.attempts,
  lastError: r.last_error,
  requestedAt: r.requested_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export const SETTINGS_COLUMNS = "require_deliberation, require_separate_approver, recompute_delay_seconds, updated_at";
export const toSettings = (r: any): ResultsSettings => ({
  requireDeliberation: r.require_deliberation,
  requireSeparateApprover: r.require_separate_approver,
  recomputeDelaySeconds: r.recompute_delay_seconds,
  updatedAt: r.updated_at,
});
