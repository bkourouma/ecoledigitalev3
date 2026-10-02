/**
 * Colonnes SQL et mappeurs ligne -> enregistrement du domaine.
 *
 * Conventions de lecture (indépendantes du fuseau et du `DateStyle` du serveur) :
 *  - `date`        -> `to_char(col, 'YYYY-MM-DD')` (jamais d'objet `Date` local) ;
 *  - `timestamptz` -> objet `Date` du pilote -> ISO UTC ;
 *  - `numeric`     -> chaîne du pilote -> décimal canonique (`"2.500"` -> `"2.5"`).
 */
import { normalizeDecimal } from "../domain/decimal";
import type {
  AcademicPeriod,
  AcademicYear,
  Classroom,
  CurriculumAmendment,
  CurriculumNode,
  CurriculumVersion,
  EducationLevel,
  Enrollment,
  EnrollmentCourse,
  EnrollmentOutcome,
  FundingType,
  GradeLevel,
  HistoryEntry,
  InstitutionSettings,
  NodeType,
  Offering,
  PeriodPlan,
  PeriodType,
  Placement,
  Program,
  Subject,
} from "../domain/records";

/** `to_char(<col>, 'YYYY-MM-DD') AS <alias>` */
export const D = (col: string, alias?: string): string => `to_char(${col}, 'YYYY-MM-DD') AS ${alias ?? col.split(".").pop()}`;

export type Row = Record<string, any>;

export const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
};
export const isoReq = (v: unknown): string => iso(v) as string;
const dec = (v: unknown): string | null => (v === null || v === undefined ? null : normalizeDecimal(String(v)));

// ---------------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------------

export const YEAR_COLS = `id, institution_id, code, label, ${D("starts_on")}, ${D("ends_on")}, status, is_current, opened_at, closed_at, archived_at`;
export const mapYear = (r: Row): AcademicYear => ({
  id: r.id,
  institutionId: r.institution_id,
  code: r.code,
  label: r.label,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  status: r.status,
  isCurrent: r.is_current,
  openedAt: iso(r.opened_at),
  closedAt: iso(r.closed_at),
  archivedAt: iso(r.archived_at),
});

export const PERIOD_COLS = `id, academic_year_id, parent_period_id, period_type_code, ordinal, code, label, ${D("starts_on")}, ${D("ends_on")}, status, opened_at, grading_closed_at, closed_at, closed_by, reopened_count, average_weight`;
export const mapPeriod = (r: Row): AcademicPeriod => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  parentPeriodId: r.parent_period_id,
  periodTypeCode: r.period_type_code,
  ordinal: r.ordinal,
  code: r.code,
  label: r.label,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  status: r.status,
  openedAt: iso(r.opened_at),
  gradingClosedAt: iso(r.grading_closed_at),
  closedAt: iso(r.closed_at),
  closedBy: r.closed_by,
  reopenedCount: r.reopened_count,
  averageWeight: Number(r.average_weight ?? 1),
});

// ---------------------------------------------------------------------------
// Référentiels
// ---------------------------------------------------------------------------

export const EDUCATION_LEVEL_COLS = "id, code, label, ordinal, pack, calculation_contract, active";
export const mapEducationLevel = (r: Row): EducationLevel => ({ id: r.id, code: r.code, label: r.label, ordinal: r.ordinal, pack: r.pack, calculationContract: r.calculation_contract, active: r.active });

export const GRADE_LEVEL_COLS = "id, education_level_id, code, label, short_label, ordinal, next_grade_level_id, is_final, terminal_exam_required, active";
export const mapGradeLevel = (r: Row): GradeLevel => ({
  id: r.id,
  educationLevelId: r.education_level_id,
  code: r.code,
  label: r.label,
  shortLabel: r.short_label,
  ordinal: r.ordinal,
  nextGradeLevelId: r.next_grade_level_id,
  isFinal: r.is_final,
  terminalExamRequired: r.terminal_exam_required,
  active: r.active,
});

export const PERIOD_TYPE_COLS = "id, code, label, kind, active";
export const mapPeriodType = (r: Row): PeriodType => ({ id: r.id, code: r.code, label: r.label, kind: r.kind, active: r.active });

export const PERIOD_PLAN_COLS = "id, code, label, slots, active";
export const mapPeriodPlan = (r: Row): PeriodPlan => ({ id: r.id, code: r.code, label: r.label, slots: r.slots, active: r.active });

export const FUNDING_TYPE_COLS = "id, code, label, requires_reference, requires_funder, sort_order, active";
export const mapFundingType = (r: Row): FundingType => ({
  id: r.id,
  code: r.code,
  label: r.label,
  requiresReference: r.requires_reference,
  requiresFunder: r.requires_funder,
  sortOrder: r.sort_order,
  active: r.active,
});

export const OUTCOME_COLS = "id, code, label, kind, active";
export const mapOutcome = (r: Row): EnrollmentOutcome => ({ id: r.id, code: r.code, label: r.label, kind: r.kind, active: r.active });

export const NODE_TYPE_COLS =
  "id, code, label, allowed_parent_codes, requires_grade_level, requires_period_slot, requires_subject, allows_coefficient, allows_credits, credits_must_equal_children, is_enrollable, is_system, sort_order";
export const mapNodeType = (r: Row): NodeType => ({
  id: r.id,
  code: r.code,
  label: r.label,
  allowedParentCodes: r.allowed_parent_codes,
  requiresGradeLevel: r.requires_grade_level,
  requiresPeriodSlot: r.requires_period_slot,
  requiresSubject: r.requires_subject,
  allowsCoefficient: r.allows_coefficient,
  allowsCredits: r.allows_credits,
  creditsMustEqualChildren: r.credits_must_equal_children,
  isEnrollable: r.is_enrollable,
  isSystem: r.is_system,
  sortOrder: r.sort_order,
});

export const SETTINGS_COLS =
  "institution_id, enrollment_confirmation_policy, course_confirmation_policy, pending_hold_minutes, registration_number_prefix, registration_number_pattern";
export const mapSettings = (r: Row): InstitutionSettings => ({
  institutionId: r.institution_id,
  enrollmentConfirmationPolicy: r.enrollment_confirmation_policy,
  courseConfirmationPolicy: r.course_confirmation_policy,
  pendingHoldMinutes: r.pending_hold_minutes,
  registrationNumberPrefix: r.registration_number_prefix,
  registrationNumberPattern: r.registration_number_pattern,
});

// ---------------------------------------------------------------------------
// Programmes, matières, curriculum
// ---------------------------------------------------------------------------

export const PROGRAM_COLS = `p.id, p.institution_id, p.education_level_id, p.parent_program_id, p.code, p.label, p.kind_code, p.domain_code, p.description, p.duration_months, p.attributes, p.status, p.is_cycle, p.calculation_contract,
  COALESCE((SELECT array_agg(g.grade_level_id ORDER BY g.ordinal, g.grade_level_id) FROM academic.program_grade_levels g WHERE g.tenant_id = p.tenant_id AND g.program_id = p.id), '{}') AS grade_level_ids`;
export const mapProgram = (r: Row): Program => ({
  id: r.id,
  institutionId: r.institution_id,
  educationLevelId: r.education_level_id,
  parentProgramId: r.parent_program_id,
  code: r.code,
  label: r.label,
  kindCode: r.kind_code,
  domainCode: r.domain_code,
  description: r.description,
  durationMonths: r.duration_months,
  attributes: r.attributes,
  status: r.status,
  isCycle: r.is_cycle,
  calculationContract: r.calculation_contract,
  gradeLevelIds: r.grade_level_ids,
});

export const SUBJECT_COLS = "id, institution_id, code, label, short_label, domain_code, description, attributes, status";
export const mapSubject = (r: Row): Subject => ({
  id: r.id,
  institutionId: r.institution_id,
  code: r.code,
  label: r.label,
  shortLabel: r.short_label,
  domainCode: r.domain_code,
  description: r.description,
  attributes: r.attributes,
  status: r.status,
});

export const VERSION_COLS = `v.id, v.program_id, v.academic_year_id, v.status, v.cloned_from_version_id, v.published_at, v.published_by, v.locked_at, v.note,
  (SELECT count(*)::int FROM academic.curriculum_nodes n WHERE n.tenant_id = v.tenant_id AND n.version_id = v.id) AS node_count`;
export const mapVersion = (r: Row): CurriculumVersion => ({
  id: r.id,
  programId: r.program_id,
  academicYearId: r.academic_year_id,
  status: r.status,
  clonedFromVersionId: r.cloned_from_version_id,
  publishedAt: iso(r.published_at),
  publishedBy: r.published_by,
  lockedAt: iso(r.locked_at),
  note: r.note,
  nodeCount: r.node_count,
});

export const NODE_COLS = `n.id, n.version_id, n.parent_id, n.node_type_code, n.lineage_id, n.subject_id, n.grade_level_id, n.period_type_code, n.period_ordinal, n.code, n.label, n.ordinal,
  n.coefficient::text AS coefficient, n.credits::text AS credits, n.is_mandatory, n.is_transversal, n.category_code, n.grading_mode, n.resit_allowed, n.counts_in_average, n.section_key,
  n.hours_total::text AS hours_total, n.hours_lecture::text AS hours_lecture, n.hours_tutorial::text AS hours_tutorial, n.hours_practical::text AS hours_practical,
  n.attributes, n.status,
  COALESCE((SELECT array_agg(p.required_lineage_id ORDER BY p.required_lineage_id) FROM academic.curriculum_prerequisites p WHERE p.tenant_id = n.tenant_id AND p.node_id = n.id), '{}') AS prerequisite_lineage_ids`;
export const mapNode = (r: Row): CurriculumNode => ({
  id: r.id,
  versionId: r.version_id,
  parentId: r.parent_id,
  nodeTypeCode: r.node_type_code,
  lineageId: r.lineage_id,
  subjectId: r.subject_id,
  gradeLevelId: r.grade_level_id,
  periodTypeCode: r.period_type_code,
  periodOrdinal: r.period_ordinal,
  code: r.code,
  label: r.label,
  ordinal: r.ordinal,
  coefficient: dec(r.coefficient),
  credits: dec(r.credits),
  isMandatory: r.is_mandatory,
  isTransversal: r.is_transversal,
  categoryCode: r.category_code,
  gradingMode: r.grading_mode,
  resitAllowed: r.resit_allowed,
  countsInAverage: r.counts_in_average,
  sectionKey: r.section_key,
  hoursTotal: dec(r.hours_total),
  hoursLecture: dec(r.hours_lecture),
  hoursTutorial: dec(r.hours_tutorial),
  hoursPractical: dec(r.hours_practical),
  attributes: r.attributes,
  status: r.status,
  prerequisiteLineageIds: r.prerequisite_lineage_ids,
});

export const AMENDMENT_COLS = "id, version_id, node_id, kind, old_value, new_value, reason, amended_by, amended_at";
export const mapAmendment = (r: Row): CurriculumAmendment => ({
  id: r.id,
  versionId: r.version_id,
  nodeId: r.node_id,
  kind: r.kind,
  oldValue: r.old_value,
  newValue: r.new_value,
  reason: r.reason,
  amendedBy: r.amended_by,
  amendedAt: isoReq(r.amended_at),
});

// ---------------------------------------------------------------------------
// Classes, offres, inscriptions
// ---------------------------------------------------------------------------

export const CLASSROOM_COLS = `c.id, c.institution_id, c.campus_id, c.academic_year_id, c.program_id, c.grade_level_id, c.curriculum_version_id, c.kind, c.code, c.name, c.capacity, c.capacity_is_hard, c.status,
  ${D("c.starts_on", "starts_on")}, ${D("c.ends_on", "ends_on")},
  (SELECT count(*)::int FROM academic.enrollments e WHERE e.tenant_id = c.tenant_id AND e.classroom_id = c.id AND e.status IN ('PENDING','ACTIVE','SUSPENDED','COMPLETED')) AS enrolled_count`;
export const mapClassroom = (r: Row): Classroom => ({
  id: r.id,
  institutionId: r.institution_id,
  campusId: r.campus_id,
  academicYearId: r.academic_year_id,
  programId: r.program_id,
  gradeLevelId: r.grade_level_id,
  curriculumVersionId: r.curriculum_version_id,
  kind: r.kind,
  code: r.code,
  name: r.name,
  capacity: r.capacity,
  capacityIsHard: r.capacity_is_hard,
  status: r.status,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  enrolledCount: r.enrolled_count,
});

export const OFFERING_COLS = `o.id, o.classroom_id, o.curriculum_node_id, o.label, ${D("o.starts_on", "starts_on")}, ${D("o.ends_on", "ends_on")}, o.registration_opens_at, o.registration_closes_at, o.capacity, o.status,
  (SELECT count(*)::int FROM academic.enrollment_courses c WHERE c.tenant_id = o.tenant_id AND c.offering_id = o.id
     AND (c.status IN ('CONFIRMED','COMPLETED') OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())))) AS held_places`;
export const mapOffering = (r: Row): Offering => ({
  id: r.id,
  classroomId: r.classroom_id,
  curriculumNodeId: r.curriculum_node_id,
  label: r.label,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  registrationOpensAt: iso(r.registration_opens_at),
  registrationClosesAt: iso(r.registration_closes_at),
  capacity: r.capacity,
  status: r.status,
  heldPlaces: r.held_places,
});

export const ENROLLMENT_COLS = `e.id, e.institution_id, e.campus_id, e.academic_year_id, e.student_id, e.classroom_id, e.mode, e.status, e.registration_number,
  ${D("e.enrolled_on", "enrolled_on")}, ${D("e.ended_on", "ended_on")}, e.end_reason, e.is_repeating, e.is_transfer_in, e.origin_school, e.previous_enrollment_id,
  e.funding_type, e.assignment_reference, ${D("e.assignment_issued_on", "assignment_issued_on")}, e.funder_label, e.funding_notes,
  e.outcome_code, e.outcome_decided_at, e.outcome_source_ref, e.source_kind, e.source_ref, e.confirmed_at, e.cancelled_at, e.created_at`;
export const mapEnrollment = (r: Row): Enrollment => ({
  id: r.id,
  institutionId: r.institution_id,
  campusId: r.campus_id,
  academicYearId: r.academic_year_id,
  studentId: r.student_id,
  classroomId: r.classroom_id,
  mode: r.mode,
  status: r.status,
  registrationNumber: r.registration_number,
  enrolledOn: r.enrolled_on,
  endedOn: r.ended_on,
  endReason: r.end_reason,
  isRepeating: r.is_repeating,
  isTransferIn: r.is_transfer_in,
  originSchool: r.origin_school,
  previousEnrollmentId: r.previous_enrollment_id,
  fundingType: r.funding_type,
  assignmentReference: r.assignment_reference,
  assignmentIssuedOn: r.assignment_issued_on,
  funderLabel: r.funder_label,
  fundingNotes: r.funding_notes,
  outcomeCode: r.outcome_code,
  outcomeDecidedAt: iso(r.outcome_decided_at),
  outcomeSourceRef: r.outcome_source_ref,
  sourceKind: r.source_kind,
  sourceRef: r.source_ref,
  confirmedAt: iso(r.confirmed_at),
  cancelledAt: iso(r.cancelled_at),
  createdAt: isoReq(r.created_at),
});

export const COURSE_COLS = "c.id, c.enrollment_id, c.curriculum_node_id, c.offering_id, c.source, c.status, c.hold_expires_at, c.requested_at, c.confirmed_at, c.completed_at, c.cancelled_at, c.cancel_reason, c.line_paid_at";
export const mapCourse = (r: Row): EnrollmentCourse => ({
  id: r.id,
  enrollmentId: r.enrollment_id,
  curriculumNodeId: r.curriculum_node_id,
  offeringId: r.offering_id,
  source: r.source,
  status: r.status,
  holdExpiresAt: iso(r.hold_expires_at),
  requestedAt: isoReq(r.requested_at),
  confirmedAt: iso(r.confirmed_at),
  completedAt: iso(r.completed_at),
  cancelledAt: iso(r.cancelled_at),
  cancelReason: r.cancel_reason,
  linePaidAt: iso(r.line_paid_at),
});

export const PLACEMENT_COLS = `id, enrollment_id, classroom_id, ${D("starts_on")}, ${D("ends_on")}, reason`;
export const mapPlacement = (r: Row): Placement => ({ id: r.id, enrollmentId: r.enrollment_id, classroomId: r.classroom_id, startsOn: r.starts_on, endsOn: r.ends_on, reason: r.reason });

export const HISTORY_COLS = "id, enrollment_id, kind, from_value, to_value, reason, actor_id, occurred_at";
export const mapHistory = (r: Row): HistoryEntry => ({
  id: r.id,
  enrollmentId: r.enrollment_id,
  kind: r.kind,
  fromValue: r.from_value,
  toValue: r.to_value,
  reason: r.reason,
  actorId: r.actor_id,
  occurredAt: isoReq(r.occurred_at),
});
