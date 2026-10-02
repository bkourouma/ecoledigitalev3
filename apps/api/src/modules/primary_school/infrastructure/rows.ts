/**
 * Colonnes SQL et mappeurs ligne -> domaine. Dates calendaires lues en TEXTE (`::text`), instants en `Date`.
 */
import type {
  AnnualReview,
  CompetencyAssessment,
  CompetencyRevision,
  CouncilAttendanceRow,
  CouncilCase,
  Phrase,
  Settings,
  YearArchive,
} from "../domain/types";

export const ASSESSMENT_COLUMNS = `a.id, a.classroom_id, a.academic_period_id, a.enrollment_id, a.student_id, a.framework_id, a.competency_id, a.scale_id,
  a.rating_level_id, a.observed_on::text AS observed_on, a.recorded_by_staff_id, a.note, a.status, a.validated_by, a.validated_at, a.row_version`;

export const toAssessment = (r: any): CompetencyAssessment => ({
  id: r.id,
  classroomId: r.classroom_id,
  academicPeriodId: r.academic_period_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  frameworkId: r.framework_id,
  competencyId: r.competency_id,
  scaleId: r.scale_id,
  ratingLevelId: r.rating_level_id,
  observedOn: r.observed_on,
  recordedByStaffId: r.recorded_by_staff_id,
  note: r.note,
  status: r.status,
  validatedBy: r.validated_by,
  validatedAt: r.validated_at,
  rowVersion: r.row_version,
});

export const REVISION_COLUMNS = `r.id, r.assessment_id, r.from_level_id, r.to_level_id, r.reason, r.requested_by, r.created_at`;
export const toRevision = (r: any): CompetencyRevision => ({
  id: r.id,
  assessmentId: r.assessment_id,
  fromLevelId: r.from_level_id,
  toLevelId: r.to_level_id,
  reason: r.reason,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
});

export const toSettings = (r: any): Settings => ({
  institutionId: r.institution_id,
  requireHomeroomForActivation: r.require_homeroom_for_activation,
  councilRequiredForBilan: r.council_required_for_bilan,
  phraseBankEnabled: r.phrase_bank_enabled,
  defaultRatingScaleId: r.default_rating_scale_id,
  archiveRetentionYears: r.archive_retention_years,
});

export const PHRASE_COLUMNS = `p.id, p.code, p.scope, p.body, p.rating_level_code, p.grade_level_code, p.source_kind, p.active`;
export const toPhrase = (r: any): Phrase => ({
  id: r.id,
  code: r.code,
  scope: r.scope,
  body: r.body,
  ratingLevelCode: r.rating_level_code,
  gradeLevelCode: r.grade_level_code,
  sourceKind: r.source_kind,
  active: r.active,
});

export const CASE_COLUMNS = `c.id, c.deliberation_id, c.classroom_id, c.academic_period_id, c.enrollment_id, c.student_id, c.reason_codes, c.proposal_code, c.proposal_note,
  c.discussion_note, c.proposed_by_staff_id, c.status, c.decision_ref`;
export const toCase = (r: any): CouncilCase & { academicPeriodId: string | null } => ({
  id: r.id,
  deliberationId: r.deliberation_id,
  classroomId: r.classroom_id,
  academicPeriodId: r.academic_period_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  reasonCodes: r.reason_codes ?? [],
  proposalCode: r.proposal_code,
  proposalNote: r.proposal_note,
  discussionNote: r.discussion_note,
  proposedByStaffId: r.proposed_by_staff_id,
  status: r.status,
  decisionRef: r.decision_ref,
});

export const ATTENDANCE_COLUMNS = `a.deliberation_id, a.staff_id, a.role_code, a.convened, a.present, a.signed_at, a.note`;
export const toAttendance = (r: any): CouncilAttendanceRow => ({
  deliberationId: r.deliberation_id,
  staffId: r.staff_id,
  roleCode: r.role_code,
  convened: r.convened,
  present: r.present,
  signedAt: r.signed_at,
  note: r.note,
});

export const REVIEW_COLUMNS = `v.id, v.institution_id, v.academic_year_id, v.enrollment_id, v.student_id, v.classroom_id, v.grade_level_code, v.version, v.status,
  v.year_result_ref, v.decision_ref, v.outcome_code, v.competency_summary, v.attendance_summary, v.rule_version_ref, v.content_hash, v.sealed_at, v.sealed_by,
  v.reportcard_id, v.supersedes_id, v.supersede_reason, v.created_at`;
export const toReview = (r: any): AnnualReview => ({
  id: r.id,
  institutionId: r.institution_id,
  academicYearId: r.academic_year_id,
  enrollmentId: r.enrollment_id,
  studentId: r.student_id,
  classroomId: r.classroom_id,
  gradeLevelCode: r.grade_level_code,
  version: r.version,
  status: r.status,
  yearResultRef: r.year_result_ref,
  decisionRef: r.decision_ref,
  outcomeCode: r.outcome_code,
  competencySummary: r.competency_summary ?? {},
  attendanceSummary: r.attendance_summary ?? {},
  ruleVersionRef: r.rule_version_ref,
  contentHash: r.content_hash,
  sealedAt: r.sealed_at,
  sealedBy: r.sealed_by,
  reportcardId: r.reportcard_id,
  supersedesId: r.supersedes_id,
  supersedeReason: r.supersede_reason,
  createdAt: r.created_at,
});

export const ARCHIVE_COLUMNS = `y.id, y.institution_id, y.academic_year_id, y.status, y.reviews_total, y.reviews_sealed, y.manifest, y.manifest_hash, y.prepared_at, y.frozen_at`;
export const toArchive = (r: any): YearArchive => ({
  id: r.id,
  institutionId: r.institution_id,
  academicYearId: r.academic_year_id,
  status: r.status,
  reviewsTotal: r.reviews_total,
  reviewsSealed: r.reviews_sealed,
  manifest: r.manifest,
  manifestHash: r.manifest_hash,
  preparedAt: r.prepared_at,
  frozenAt: r.frozen_at,
});
