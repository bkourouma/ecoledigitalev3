/**
 * Colonnes SQL et mappeurs ligne -> domaine. Dates calendaires lues en TEXTE (`::text`) pour qu'aucun fuseau du
 * processus ne décale un jour ; `numeric` lu en chaîne (jamais converti en flottant).
 */
import type {
  Assessment,
  AssessmentType,
  AssessSettings,
  Grade,
  GradeRevision,
  PeriodLock,
  PublishedGrade,
  SessionNo,
  Transition,
} from "../domain/types";

export const TYPE_COLUMNS = `t.id, t.code, t.label, t.aggregation_group, t.default_scale_max::text AS default_scale_max,
  t.default_weight::text AS default_weight, t.publication_mode, t.visible_to_students, t.allows_session2, t.is_system,
  t.template_key, t.position, t.active`;

export interface TypeRow {
  id: string;
  code: string;
  label: string;
  aggregation_group: string;
  default_scale_max: string;
  default_weight: string;
  publication_mode: "MANUAL" | "AUTO_ON_APPROVAL";
  visible_to_students: boolean;
  allows_session2: boolean;
  is_system: boolean;
  template_key: string | null;
  position: number;
  active: boolean;
}

export const toType = (r: TypeRow): AssessmentType => ({
  id: r.id,
  code: r.code,
  label: r.label,
  aggregationGroup: r.aggregation_group,
  defaultScaleMax: r.default_scale_max,
  defaultWeight: r.default_weight,
  publicationMode: r.publication_mode,
  visibleToStudents: r.visible_to_students,
  allowsSession2: r.allows_session2,
  isSystem: r.is_system,
  templateKey: r.template_key,
  position: r.position,
  active: r.active,
});

export interface SettingsRow {
  require_separate_reviewer: boolean;
  require_separate_approver: boolean;
  max_score_decimals: number;
  late_grade_policy: "REVISION";
  updated_at: Date | null;
}
export const SETTINGS_COLUMNS = "require_separate_reviewer, require_separate_approver, max_score_decimals, late_grade_policy, updated_at";
export const toSettings = (r: SettingsRow): AssessSettings => ({
  requireSeparateReviewer: r.require_separate_reviewer,
  requireSeparateApprover: r.require_separate_approver,
  maxScoreDecimals: r.max_score_decimals,
  lateGradePolicy: r.late_grade_policy,
  updatedAt: r.updated_at,
});

export const ASSESSMENT_COLUMNS = `a.id, a.type_id, t.code AS type_code, t.aggregation_group, t.visible_to_students, t.publication_mode,
  a.classroom_id, a.curriculum_node_id, a.academic_period_id, a.academic_year_id, a.teacher_id, a.title,
  a.assessed_on::text AS assessed_on, a.scale_max::text AS scale_max, a.weight::text AS weight, a.session_no, a.status,
  a.submitted_at, a.submitted_by, a.reviewed_at, a.reviewed_by, a.approved_at, a.approved_by, a.published_at, a.published_by,
  a.cancelled_at, a.cancelled_by, a.cancel_reason, a.four_eyes_waived, a.return_comment, a.row_version, a.created_by, a.created_at`;
export const ASSESSMENT_FROM = "assess.assessments a JOIN assess.assessment_types t ON t.tenant_id = a.tenant_id AND t.id = a.type_id";

export interface AssessmentRow {
  id: string;
  type_id: string;
  type_code: string | null;
  aggregation_group: string | null;
  visible_to_students: boolean | null;
  publication_mode: "MANUAL" | "AUTO_ON_APPROVAL" | null;
  classroom_id: string;
  curriculum_node_id: string;
  academic_period_id: string;
  academic_year_id: string;
  teacher_id: string;
  title: string;
  assessed_on: string;
  scale_max: string;
  weight: string;
  session_no: number;
  status: Assessment["status"];
  submitted_at: Date | null;
  submitted_by: string | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  approved_at: Date | null;
  approved_by: string | null;
  published_at: Date | null;
  published_by: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  four_eyes_waived: boolean;
  return_comment: string | null;
  row_version: number;
  created_by: string;
  created_at: Date;
}

export const toAssessment = (r: AssessmentRow): Assessment => ({
  id: r.id,
  typeId: r.type_id,
  typeCode: r.type_code,
  aggregationGroup: r.aggregation_group,
  visibleToStudents: r.visible_to_students,
  publicationMode: r.publication_mode,
  classroomId: r.classroom_id,
  curriculumNodeId: r.curriculum_node_id,
  academicPeriodId: r.academic_period_id,
  academicYearId: r.academic_year_id,
  teacherId: r.teacher_id,
  title: r.title,
  assessedOn: r.assessed_on,
  scaleMax: r.scale_max,
  weight: r.weight,
  sessionNo: r.session_no as SessionNo,
  status: r.status,
  submittedAt: r.submitted_at,
  submittedBy: r.submitted_by,
  reviewedAt: r.reviewed_at,
  reviewedBy: r.reviewed_by,
  approvedAt: r.approved_at,
  approvedBy: r.approved_by,
  publishedAt: r.published_at,
  publishedBy: r.published_by,
  cancelledAt: r.cancelled_at,
  cancelledBy: r.cancelled_by,
  cancelReason: r.cancel_reason,
  fourEyesWaived: r.four_eyes_waived,
  returnComment: r.return_comment,
  rowVersion: r.row_version,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const GRADE_COLUMNS = `g.id, g.assessment_id, g.enrollment_id, g.student_id, g.score::text AS score, g.entry_status, g.comment, g.status,
  g.row_version, g.entered_by, g.entered_at,
  (SELECT max(r.applied_at) FROM assess.grade_revisions r WHERE r.tenant_id = g.tenant_id AND r.grade_id = g.id AND r.status = 'APPLIED') AS corrected_at`;

export interface GradeRow {
  id: string;
  assessment_id: string;
  enrollment_id: string;
  student_id: string;
  score: string | null;
  entry_status: Grade["entryStatus"];
  comment: string | null;
  status: Grade["status"];
  row_version: number;
  entered_by: string | null;
  entered_at: Date | null;
  corrected_at: Date | null;
}

export const toGrade = (r: GradeRow): Grade => ({
  id: r.id,
  assessmentId: r.assessment_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  score: r.score,
  entryStatus: r.entry_status,
  comment: r.comment,
  status: r.status,
  rowVersion: r.row_version,
  enteredBy: r.entered_by,
  enteredAt: r.entered_at,
  correctedAt: r.corrected_at,
});

export const REVISION_COLUMNS = `r.id, r.assessment_id, r.grade_id, r.enrollment_id, r.student_id, r.kind, r.old_score::text AS old_score,
  r.old_entry_status, r.new_score::text AS new_score, r.new_entry_status, r.reason, r.requested_by, r.requested_by_name,
  r.requested_at, r.status, r.decided_by, r.decided_by_name, r.decided_at, r.decision_comment, r.four_eyes_waived, r.applied_at, r.batch_id`;

export interface RevisionRow {
  id: string;
  assessment_id: string;
  grade_id: string | null;
  enrollment_id: string;
  student_id: string | null;
  kind: GradeRevision["kind"];
  old_score: string | null;
  old_entry_status: GradeRevision["oldEntryStatus"];
  new_score: string | null;
  new_entry_status: GradeRevision["newEntryStatus"];
  reason: string;
  requested_by: string;
  requested_by_name: string;
  requested_at: Date;
  status: GradeRevision["status"];
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: Date | null;
  decision_comment: string | null;
  four_eyes_waived: boolean;
  applied_at: Date | null;
  batch_id: string | null;
}

export const toRevision = (r: RevisionRow): GradeRevision => ({
  id: r.id,
  assessmentId: r.assessment_id,
  gradeId: r.grade_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  kind: r.kind,
  oldScore: r.old_score,
  oldEntryStatus: r.old_entry_status,
  newScore: r.new_score,
  newEntryStatus: r.new_entry_status,
  reason: r.reason,
  requestedBy: r.requested_by,
  requestedByName: r.requested_by_name,
  requestedAt: r.requested_at,
  status: r.status,
  decidedBy: r.decided_by,
  decidedByName: r.decided_by_name,
  decidedAt: r.decided_at,
  decisionComment: r.decision_comment,
  fourEyesWaived: r.four_eyes_waived,
  appliedAt: r.applied_at,
  batchId: r.batch_id,
});

export const LOCK_COLUMNS = `l.id, l.classroom_id, l.academic_period_id, l.locked_at, l.locked_by, l.lock_reason, l.locked_sessions,
  l.released_at, l.released_by, l.release_reason`;

export interface LockRow {
  id: string;
  classroom_id: string;
  academic_period_id: string;
  locked_at: Date;
  locked_by: string;
  lock_reason: string | null;
  locked_sessions: number[];
  released_at: Date | null;
  released_by: string | null;
  release_reason: string | null;
}

export const toLock = (r: LockRow): PeriodLock => ({
  id: r.id,
  classroomId: r.classroom_id,
  academicPeriodId: r.academic_period_id,
  lockedAt: r.locked_at,
  lockedBy: r.locked_by,
  lockReason: r.lock_reason,
  lockedSessions: [...r.locked_sessions].sort() as SessionNo[],
  releasedAt: r.released_at,
  releasedBy: r.released_by,
  releaseReason: r.release_reason,
});

export interface TransitionRow {
  id: string;
  assessment_id: string;
  from_status: Transition["fromStatus"];
  to_status: Transition["toStatus"];
  actor_id: string | null;
  actor_name: string | null;
  comment: string | null;
  four_eyes_waived: boolean;
  at: Date;
}
export const TRANSITION_COLUMNS = "id, assessment_id, from_status, to_status, actor_id, actor_name, comment, four_eyes_waived, at";
export const toTransition = (r: TransitionRow): Transition => ({
  id: r.id,
  assessmentId: r.assessment_id,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  actorId: r.actor_id,
  actorName: r.actor_name,
  comment: r.comment,
  fourEyesWaived: r.four_eyes_waived,
  at: r.at,
});

export const PUBLISHED_COLUMNS = `g.id AS grade_id, g.assessment_id, g.enrollment_id, g.student_id, a.curriculum_node_id, a.classroom_id,
  a.academic_period_id, a.session_no, a.assessed_on::text AS assessed_on, a.title, t.code AS type_code, t.aggregation_group,
  a.scale_max::text AS scale_max, a.weight::text AS weight, g.score::text AS score, g.entry_status, t.visible_to_students, t.label AS type_label, a.published_at,
  (SELECT max(r.applied_at) FROM assess.grade_revisions r WHERE r.tenant_id = g.tenant_id AND r.grade_id = g.id AND r.status = 'APPLIED') AS corrected_at`;

export interface PublishedRow {
  grade_id: string;
  assessment_id: string;
  enrollment_id: string;
  student_id: string;
  curriculum_node_id: string;
  classroom_id: string;
  academic_period_id: string;
  session_no: number;
  assessed_on: string;
  title: string;
  type_code: string;
  aggregation_group: string;
  scale_max: string;
  weight: string;
  score: string | null;
  entry_status: PublishedGrade["entryStatus"];
  visible_to_students: boolean;
  type_label: string;
  published_at: Date;
  corrected_at: Date | null;
}

export const toPublished = (r: PublishedRow): PublishedGrade => ({
  gradeId: r.grade_id,
  assessmentId: r.assessment_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  curriculumNodeId: r.curriculum_node_id,
  classroomId: r.classroom_id,
  academicPeriodId: r.academic_period_id,
  sessionNo: r.session_no as SessionNo,
  assessedOn: r.assessed_on,
  title: r.title,
  typeCode: r.type_code,
  aggregationGroup: r.aggregation_group,
  scaleMax: r.scale_max,
  weight: r.weight,
  score: r.score,
  entryStatus: r.entry_status,
  visibleToStudents: r.visible_to_students,
  typeLabel: r.type_label,
  publishedAt: r.published_at,
  correctedAt: r.corrected_at,
});
