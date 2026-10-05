/** Inscriptions, sélections de cours, placements, historique, registre des numéros d'inscription. */
import type { Tx } from "@ecoledigitale/database";
import type { AcademicCourseStatus, AcademicEnrollmentStatus } from "@ecoledigitale/contracts/src/v2/academic";
import type { Enrollment, EnrollmentCourse, HistoryEntry, Placement } from "../domain/records";
import { COURSE_COLS, ENROLLMENT_COLS, HISTORY_COLS, PLACEMENT_COLS, mapCourse, mapEnrollment, mapHistory, mapPlacement } from "./mappers";

export interface EnrollmentFilter {
  institutionId?: string | null;
  campusId?: string | null;
  academicYearId?: string | null;
  classroomId?: string | null;
  studentId?: string | null;
  studentIds?: readonly string[] | null;
  status?: string | null;
  mode?: string | null;
  fundingType?: string | null;
  registrationNumber?: string | null;
  limit?: number;
  offset?: number;
}

export async function listEnrollments(tx: Tx, f: EnrollmentFilter): Promise<{ items: Enrollment[]; total: number }> {
  const where = `($1::uuid IS NULL OR e.institution_id = $1) AND ($2::uuid IS NULL OR e.campus_id IS NULL OR e.campus_id = $2) AND ($3::uuid IS NULL OR e.academic_year_id = $3)
        AND ($4::uuid IS NULL OR e.classroom_id = $4) AND ($5::uuid IS NULL OR e.student_id = $5) AND ($6::text IS NULL OR e.status = $6)
        AND ($7::text IS NULL OR e.mode = $7) AND ($8::text IS NULL OR e.funding_type = $8) AND ($9::text IS NULL OR e.registration_number = $9)
        AND ($10::uuid[] IS NULL OR e.student_id = ANY($10::uuid[]))`;
  const params = [
    f.institutionId ?? null,
    f.campusId ?? null,
    f.academicYearId ?? null,
    f.classroomId ?? null,
    f.studentId ?? null,
    f.status ?? null,
    f.mode ?? null,
    f.fundingType ?? null,
    f.registrationNumber ?? null,
    f.studentIds ? [...f.studentIds] : null,
  ];
  const rows = await tx.many(`SELECT ${ENROLLMENT_COLS} FROM academic.enrollments e WHERE ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT $11 OFFSET $12`, [...params, f.limit ?? 50, f.offset ?? 0]);
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM academic.enrollments e WHERE ${where}`, params);
  return { items: rows.map(mapEnrollment), total: total?.n ?? 0 };
}

export async function getEnrollment(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<Enrollment | null> {
  const r = await tx.queryOne(`SELECT ${ENROLLMENT_COLS} FROM academic.enrollments e WHERE e.id = $1${options.forUpdate ? " FOR UPDATE OF e" : ""}`, [id]);
  return r ? mapEnrollment(r) : null;
}

export async function listEnrollmentsByStudent(tx: Tx, studentId: string): Promise<Enrollment[]> {
  const rows = await tx.many(`SELECT ${ENROLLMENT_COLS} FROM academic.enrollments e WHERE e.student_id = $1 ORDER BY e.academic_year_id DESC, e.created_at DESC, e.id DESC`, [studentId]);
  return rows.map(mapEnrollment);
}

export async function findLiveEnrollmentInClass(tx: Tx, studentId: string, classroomId: string): Promise<Enrollment | null> {
  const r = await tx.queryOne(
    `SELECT ${ENROLLMENT_COLS} FROM academic.enrollments e WHERE e.student_id = $1 AND e.classroom_id = $2 AND e.status IN ('PENDING','ACTIVE','SUSPENDED','COMPLETED') LIMIT 1`,
    [studentId, classroomId],
  );
  return r ? mapEnrollment(r) : null;
}

export async function findClassModeEnrollmentOfYear(tx: Tx, studentId: string, yearId: string, institutionId: string): Promise<Enrollment | null> {
  const r = await tx.queryOne(
    `SELECT ${ENROLLMENT_COLS} FROM academic.enrollments e
      WHERE e.student_id = $1 AND e.academic_year_id = $2 AND e.institution_id = $3 AND e.mode = 'CLASS' AND e.status IN ('PENDING','ACTIVE','SUSPENDED','COMPLETED') LIMIT 1`,
    [studentId, yearId, institutionId],
  );
  return r ? mapEnrollment(r) : null;
}

export interface EnrollmentInsert {
  id: string;
  institutionId: string;
  campusId: string | null;
  academicYearId: string;
  studentId: string;
  classroomId: string;
  mode: string;
  status: AcademicEnrollmentStatus;
  registrationNumber: string | null;
  enrolledOn: string;
  isRepeating: boolean;
  isTransferIn: boolean;
  originSchool: string | null;
  previousEnrollmentId: string | null;
  fundingType: string;
  assignmentReference: string | null;
  assignmentIssuedOn: string | null;
  funderLabel: string | null;
  fundingNotes: string | null;
  sourceKind: string | null;
  sourceRef: string | null;
  confirmedAt: boolean;
}

export async function insertEnrollment(tx: Tx, v: EnrollmentInsert): Promise<void> {
  await tx.query(
    `INSERT INTO academic.enrollments (id, tenant_id, institution_id, campus_id, academic_year_id, student_id, classroom_id, mode, status, registration_number, enrolled_on,
        is_repeating, is_transfer_in, origin_school, previous_enrollment_id, funding_type, assignment_reference, assignment_issued_on, funder_label, funding_notes,
        source_kind, source_ref, confirmed_at, confirmation_mode)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, $13, $14, $15, $16, $17::date, $18, $19, $20, $21, CASE WHEN $22::boolean THEN now() ELSE NULL END, CASE WHEN $22::boolean THEN 'AUTO' ELSE NULL END)`,
    [v.id, v.institutionId, v.campusId, v.academicYearId, v.studentId, v.classroomId, v.mode, v.status, v.registrationNumber, v.enrolledOn, v.isRepeating, v.isTransferIn, v.originSchool, v.previousEnrollmentId, v.fundingType, v.assignmentReference, v.assignmentIssuedOn, v.funderLabel, v.fundingNotes, v.sourceKind, v.sourceRef, v.confirmedAt],
  );
}

export async function setEnrollmentStatus(
  tx: Tx,
  id: string,
  v: {
    status: AcademicEnrollmentStatus;
    endedOn: string | null;
    endReason: string | null;
    confirmed?: boolean;
    cancelled?: boolean;
    /** O-01 : mode, motif et auteur de la confirmation (posés avec `confirmed`). */
    confirmation?: { mode: "PAYMENT" | "MANUAL" | "OVERRIDE"; reason: string | null; by: string | null };
  },
): Promise<void> {
  await tx.query(
    `UPDATE academic.enrollments SET status = $2, ended_on = $3::date, end_reason = $4,
        confirmed_at = CASE WHEN $5::boolean THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END,
        confirmation_mode = CASE WHEN $5::boolean AND $7::text IS NOT NULL THEN $7::text ELSE confirmation_mode END,
        confirmation_reason = CASE WHEN $5::boolean AND $7::text IS NOT NULL THEN $8::text ELSE confirmation_reason END,
        confirmed_by = CASE WHEN $5::boolean AND $7::text IS NOT NULL THEN $9::uuid ELSE confirmed_by END,
        cancelled_at = CASE WHEN $6::boolean THEN now() ELSE cancelled_at END, updated_at = now()
      WHERE id = $1`,
    [id, v.status, v.endedOn, v.endReason, v.confirmed === true, v.cancelled === true, v.confirmation?.mode ?? null, v.confirmation?.reason ?? null, v.confirmation?.by ?? null],
  );
}

export async function setEnrollmentClassroom(tx: Tx, id: string, classroomId: string, campusId: string | null): Promise<void> {
  await tx.query("UPDATE academic.enrollments SET classroom_id = $2, campus_id = $3, updated_at = now() WHERE id = $1", [id, classroomId, campusId]);
}

export async function setEnrollmentFunding(
  tx: Tx,
  id: string,
  v: { fundingType: string; assignmentReference: string | null; assignmentIssuedOn: string | null; funderLabel: string | null; fundingNotes: string | null },
): Promise<void> {
  await tx.query(
    `UPDATE academic.enrollments SET funding_type = $2, assignment_reference = $3, assignment_issued_on = $4::date, funder_label = $5, funding_notes = $6, updated_at = now() WHERE id = $1`,
    [id, v.fundingType, v.assignmentReference, v.assignmentIssuedOn, v.funderLabel, v.fundingNotes],
  );
}

export async function setEnrollmentOutcome(tx: Tx, id: string, v: { outcomeCode: string; decidedAt: string; sourceRef: string | null }): Promise<void> {
  await tx.query("UPDATE academic.enrollments SET outcome_code = $2, outcome_decided_at = $3::timestamptz, outcome_source_ref = $4, updated_at = now() WHERE id = $1", [id, v.outcomeCode, v.decidedAt, v.sourceRef]);
}

export async function setEnrollmentRegistrationNumber(tx: Tx, id: string, registrationNumber: string): Promise<void> {
  await tx.query("UPDATE academic.enrollments SET registration_number = $2, updated_at = now() WHERE id = $1", [id, registrationNumber]);
}

/** Inscriptions vivantes d'un apprenant (retrait automatique quand son dossier est clos). */
export async function listLiveEnrollmentsOfStudent(tx: Tx, studentId: string): Promise<Enrollment[]> {
  const rows = await tx.many(`SELECT ${ENROLLMENT_COLS} FROM academic.enrollments e WHERE e.student_id = $1 AND e.status IN ('PENDING','ACTIVE','SUSPENDED') ORDER BY e.created_at, e.id`, [studentId]);
  return rows.map(mapEnrollment);
}

// ---------------------------------------------------------------------------
// Sélections de cours
// ---------------------------------------------------------------------------

export async function listCourses(tx: Tx, enrollmentId: string): Promise<EnrollmentCourse[]> {
  const rows = await tx.many(`SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.enrollment_id = $1 ORDER BY c.requested_at, c.id`, [enrollmentId]);
  return rows.map(mapCourse);
}

export async function getCourse(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<EnrollmentCourse | null> {
  const r = await tx.queryOne(`SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.id = $1${options.forUpdate ? " FOR UPDATE OF c" : ""}`, [id]);
  return r ? mapCourse(r) : null;
}

export async function listCoursesByIds(tx: Tx, ids: readonly string[]): Promise<EnrollmentCourse[]> {
  if (ids.length === 0) return [];
  const rows = await tx.many(`SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.id = ANY($1::uuid[])`, [ids]);
  return rows.map(mapCourse);
}

export async function insertCourse(
  tx: Tx,
  v: {
    id: string;
    enrollmentId: string;
    curriculumNodeId: string;
    offeringId: string | null;
    source: string;
    status: AcademicCourseStatus;
    holdExpiresAt: string | null;
    requestedAt: string;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.enrollment_courses (id, tenant_id, enrollment_id, curriculum_node_id, offering_id, source, status, hold_expires_at, requested_at, confirmed_at)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, CASE WHEN $6 = 'CONFIRMED' THEN now() ELSE NULL END)`,
    [v.id, v.enrollmentId, v.curriculumNodeId, v.offeringId, v.source, v.status, v.holdExpiresAt, v.requestedAt],
  );
}

export async function setCourseStatus(tx: Tx, id: string, v: { status: AcademicCourseStatus; reason?: string | null; completedAt?: string | null }): Promise<void> {
  await tx.query(
    `UPDATE academic.enrollment_courses SET status = $2,
        confirmed_at = CASE WHEN $2 = 'CONFIRMED' THEN now() ELSE confirmed_at END,
        completed_at = CASE WHEN $2 = 'COMPLETED' THEN COALESCE($4::timestamptz, now()) ELSE completed_at END,
        cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() ELSE cancelled_at END,
        cancel_reason = CASE WHEN $2 = 'CANCELLED' THEN $3 ELSE cancel_reason END, updated_at = now()
      WHERE id = $1`,
    [id, v.status, v.reason ?? null, v.completedAt ?? null],
  );
}

export async function markCourseLinePaid(tx: Tx, id: string): Promise<void> {
  await tx.query("UPDATE academic.enrollment_courses SET line_paid_at = COALESCE(line_paid_at, now()), updated_at = now() WHERE id = $1", [id]);
}

/** Sélections vivantes (PENDING/CONFIRMED) d'une inscription : annulation en cascade. */
export async function listLiveCourses(tx: Tx, enrollmentId: string): Promise<EnrollmentCourse[]> {
  const rows = await tx.many(`SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.enrollment_id = $1 AND c.status IN ('PENDING','CONFIRMED') ORDER BY c.requested_at, c.id`, [enrollmentId]);
  return rows.map(mapCourse);
}

/** Sélections vivantes d'une offre (annulation de l'offre). */
export async function listLiveCoursesOfOffering(tx: Tx, offeringId: string): Promise<Array<EnrollmentCourse & { studentId: string; academicYearId: string; institutionId: string; classroomId: string }>> {
  const rows = await tx.many(
    `SELECT ${COURSE_COLS}, e.student_id, e.academic_year_id, e.institution_id, e.classroom_id AS enrollment_classroom_id
       FROM academic.enrollment_courses c JOIN academic.enrollments e ON e.tenant_id = c.tenant_id AND e.id = c.enrollment_id
      WHERE c.offering_id = $1 AND c.status IN ('PENDING','CONFIRMED') ORDER BY c.requested_at, c.id`,
    [offeringId],
  );
  return rows.map((r) => ({ ...mapCourse(r), studentId: r.student_id, academicYearId: r.academic_year_id, institutionId: r.institution_id, classroomId: r.enrollment_classroom_id }));
}

/** Sélections PENDING dont la réservation est expirée (job `expirePendingHolds`). */
export async function listExpiredHolds(tx: Tx, limit: number): Promise<EnrollmentCourse[]> {
  const rows = await tx.many(
    `SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.status = 'PENDING' AND c.hold_expires_at IS NOT NULL AND c.hold_expires_at <= now()
      ORDER BY c.hold_expires_at, c.id LIMIT $1 FOR UPDATE OF c SKIP LOCKED`,
    [limit],
  );
  return rows.map(mapCourse);
}

/** Sélections PENDING expirées de MON inscription pour un nœud (expiration paresseuse avant un nouvel ajout). */
export async function listOwnExpiredHoldsForNode(tx: Tx, enrollmentId: string, nodeId: string): Promise<EnrollmentCourse[]> {
  const rows = await tx.many(
    `SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.enrollment_id = $1 AND c.curriculum_node_id = $2 AND c.status = 'PENDING' AND c.hold_expires_at IS NOT NULL AND c.hold_expires_at <= now()`,
    [enrollmentId, nodeId],
  );
  return rows.map(mapCourse);
}

/** Sélections en attente de confirmation d'une inscription (confirmation en cascade). */
export async function listPendingCourses(tx: Tx, enrollmentId: string): Promise<EnrollmentCourse[]> {
  const rows = await tx.many(`SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.enrollment_id = $1 AND c.status = 'PENDING' ORDER BY c.requested_at, c.id`, [enrollmentId]);
  return rows.map(mapCourse);
}

/** Même nœud (vivant, non expiré) la même année, quelle que soit la classe, hors une inscription donnée. */
export async function hasLiveDuplicate(tx: Tx, studentId: string, yearId: string, nodeId: string, exceptEnrollmentId?: string | null): Promise<boolean> {
  const r = await tx.queryOne<{ used: boolean }>(
    `SELECT EXISTS (
        SELECT 1 FROM academic.enrollment_courses c JOIN academic.enrollments e ON e.tenant_id = c.tenant_id AND e.id = c.enrollment_id
         WHERE e.student_id = $1 AND e.academic_year_id = $2 AND c.curriculum_node_id = $3 AND c.status <> 'CANCELLED'
           AND NOT (c.status = 'PENDING' AND c.hold_expires_at IS NOT NULL AND c.hold_expires_at <= now())
           AND ($4::uuid IS NULL OR c.enrollment_id <> $4)) AS used`,
    [studentId, yearId, nodeId, exceptEnrollmentId ?? null],
  );
  return r?.used === true;
}

/** Places réservées d'une offre, hors les lignes de l'apprenant (D1). */
export async function heldByOthers(tx: Tx, offeringId: string, studentId: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM academic.enrollment_courses c JOIN academic.enrollments e ON e.tenant_id = c.tenant_id AND e.id = c.enrollment_id
      WHERE c.offering_id = $1 AND e.student_id <> $2
        AND (c.status IN ('CONFIRMED','COMPLETED') OR (c.status = 'PENDING' AND (c.hold_expires_at IS NULL OR c.hold_expires_at > now())))`,
    [offeringId, studentId],
  );
  return r?.n ?? 0;
}

/** Repli local de `CompletionLookup` : une sélection `COMPLETED` sur un nœud de cette lignée. */
export async function hasCompletedLineage(tx: Tx, studentId: string, lineageId: string): Promise<boolean> {
  const r = await tx.queryOne<{ done: boolean }>(
    `SELECT EXISTS (
        SELECT 1 FROM academic.enrollment_courses c
          JOIN academic.enrollments e ON e.tenant_id = c.tenant_id AND e.id = c.enrollment_id
          JOIN academic.curriculum_nodes n ON n.tenant_id = c.tenant_id AND n.id = c.curriculum_node_id
         WHERE e.student_id = $1 AND n.lineage_id = $2 AND c.status = 'COMPLETED') AS done`,
    [studentId, lineageId],
  );
  return r?.done === true;
}

// ---------------------------------------------------------------------------
// Placements et historique
// ---------------------------------------------------------------------------

export async function listPlacements(tx: Tx, enrollmentId: string): Promise<Placement[]> {
  const rows = await tx.many(`SELECT ${PLACEMENT_COLS} FROM academic.enrollment_placements WHERE enrollment_id = $1 ORDER BY starts_on, id`, [enrollmentId]);
  return rows.map(mapPlacement);
}

export async function getOpenPlacement(tx: Tx, enrollmentId: string): Promise<Placement | null> {
  const r = await tx.queryOne(`SELECT ${PLACEMENT_COLS} FROM academic.enrollment_placements WHERE enrollment_id = $1 AND ends_on IS NULL`, [enrollmentId]);
  return r ? mapPlacement(r) : null;
}

export async function insertPlacement(tx: Tx, v: { id: string; enrollmentId: string; classroomId: string; startsOn: string; reason: string | null; createdBy: string | null }): Promise<void> {
  await tx.query(
    `INSERT INTO academic.enrollment_placements (id, tenant_id, enrollment_id, classroom_id, starts_on, reason, created_by) VALUES ($1, kernel.current_tenant_id(), $2, $3, $4::date, $5, $6)`,
    [v.id, v.enrollmentId, v.classroomId, v.startsOn, v.reason, v.createdBy],
  );
}

export async function closePlacement(tx: Tx, id: string, endsOn: string): Promise<void> {
  await tx.query("UPDATE academic.enrollment_placements SET ends_on = $2::date WHERE id = $1", [id, endsOn]);
}

export async function rewritePlacementClassroom(tx: Tx, id: string, classroomId: string, reason: string | null): Promise<void> {
  await tx.query("UPDATE academic.enrollment_placements SET classroom_id = $2, reason = COALESCE($3, reason) WHERE id = $1", [id, classroomId, reason]);
}

export async function insertHistory(
  tx: Tx,
  v: { id: string; enrollmentId: string; kind: string; from: unknown; to: unknown; reason: string | null; actorId: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.enrollment_history (id, tenant_id, enrollment_id, kind, from_value, to_value, reason, actor_id)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [v.id, v.enrollmentId, v.kind, v.from === null || v.from === undefined ? null : JSON.stringify(v.from), v.to === null || v.to === undefined ? null : JSON.stringify(v.to), v.reason, v.actorId],
  );
}

export async function listHistory(tx: Tx, enrollmentId: string): Promise<HistoryEntry[]> {
  const rows = await tx.many(`SELECT ${HISTORY_COLS} FROM academic.enrollment_history WHERE enrollment_id = $1 ORDER BY occurred_at, id`, [enrollmentId]);
  return rows.map(mapHistory);
}

export async function latestOutcomeDetails(tx: Tx, enrollmentId: string): Promise<{ targetProgramId: string | null; targetGradeLevelId: string | null } | null> {
  const r = await tx.queryOne<{ to_value: { targetProgramId?: string | null; targetGradeLevelId?: string | null } | null }>(
    "SELECT to_value FROM academic.enrollment_history WHERE enrollment_id = $1 AND kind = 'OUTCOME' ORDER BY occurred_at DESC, id DESC LIMIT 1",
    [enrollmentId],
  );
  if (!r || !r.to_value) return null;
  return { targetProgramId: r.to_value.targetProgramId ?? null, targetGradeLevelId: r.to_value.targetGradeLevelId ?? null };
}

// ---------------------------------------------------------------------------
// Registre des numéros d'inscription
// ---------------------------------------------------------------------------

export async function findRegistrationNumber(tx: Tx, institutionId: string, studentId: string, programId: string, gradeLevelId: string): Promise<string | null> {
  const r = await tx.queryOne<{ registration_number: string }>(
    "SELECT registration_number FROM academic.registration_numbers WHERE institution_id = $1 AND student_id = $2 AND program_id = $3 AND grade_level_id = $4",
    [institutionId, studentId, programId, gradeLevelId],
  );
  return r ? r.registration_number : null;
}

/** `INSERT … ON CONFLICT DO NOTHING` sur la clé (apprenant, programme, niveau) : deux créations concurrentes convergent. */
export async function insertRegistrationNumber(
  tx: Tx,
  v: { id: string; institutionId: string; studentId: string; programId: string; gradeLevelId: string; registrationNumber: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.registration_numbers (id, tenant_id, institution_id, student_id, program_id, grade_level_id, registration_number)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, institution_id, student_id, program_id, grade_level_id) DO NOTHING`,
    [v.id, v.institutionId, v.studentId, v.programId, v.gradeLevelId, v.registrationNumber],
  );
}

// ---------------------------------------------------------------------------
// Lectures pour l'annuaire, l'effectif, la reconduction
// ---------------------------------------------------------------------------

export interface RosterRow {
  enrollment: Enrollment;
  selectionNodeIds: string[];
}

/**
 * Effectif d'une classe à une date : inscriptions dont un PLACEMENT dans la classe couvre la date (un transfert
 * déplace l'élève sans le dupliquer), au statut qui ouvre la scolarité ; sélections confirmées/terminées en plus.
 */
export async function rosterOfClassroom(tx: Tx, classroomId: string, onDate: string, schoolingStatuses: readonly string[], courseStatuses: readonly string[]): Promise<RosterRow[]> {
  const rows = await tx.many(
    `SELECT ${ENROLLMENT_COLS},
        COALESCE((SELECT array_agg(c.curriculum_node_id ORDER BY c.requested_at, c.id) FROM academic.enrollment_courses c
                   WHERE c.tenant_id = e.tenant_id AND c.enrollment_id = e.id AND c.status = ANY($4::text[])), '{}') AS selection_node_ids
       FROM academic.enrollments e
       JOIN academic.enrollment_placements p ON p.tenant_id = e.tenant_id AND p.enrollment_id = e.id AND p.classroom_id = $1
        AND p.starts_on <= $2::date AND (p.ends_on IS NULL OR p.ends_on >= $2::date)
      WHERE e.status = ANY($3::text[]) AND e.enrolled_on <= $2::date
      ORDER BY e.created_at, e.id`,
    [classroomId, onDate, [...schoolingStatuses], [...courseStatuses]],
  );
  return rows.map((r) => ({ enrollment: mapEnrollment(r), selectionNodeIds: r.selection_node_ids }));
}

export async function listSelectionsOfEnrollment(tx: Tx, enrollmentId: string, statuses: readonly string[]): Promise<EnrollmentCourse[]> {
  const rows = await tx.many(`SELECT ${COURSE_COLS} FROM academic.enrollment_courses c WHERE c.enrollment_id = $1 AND c.status = ANY($2::text[]) ORDER BY c.requested_at, c.id`, [enrollmentId, [...statuses]]);
  return rows.map(mapCourse);
}

export interface RolloverSourceRow {
  enrollment: Enrollment;
  programId: string;
  gradeLevelId: string;
  outcomeKind: string | null;
  outcomeTargets: { targetProgramId?: string | null; targetGradeLevelId?: string | null } | null;
}

export async function listRolloverSources(tx: Tx, fromYearId: string, institutionId: string, classroomIds: readonly string[] | null): Promise<RolloverSourceRow[]> {
  const rows = await tx.many(
    `SELECT ${ENROLLMENT_COLS}, c.program_id, c.grade_level_id,
        (SELECT o.kind FROM academic.enrollment_outcomes o WHERE o.tenant_id = e.tenant_id AND o.code = e.outcome_code) AS outcome_kind,
        (SELECT h.to_value FROM academic.enrollment_history h WHERE h.tenant_id = e.tenant_id AND h.enrollment_id = e.id AND h.kind = 'OUTCOME' ORDER BY h.occurred_at DESC, h.id DESC LIMIT 1) AS outcome_to
       FROM academic.enrollments e JOIN academic.classrooms c ON c.tenant_id = e.tenant_id AND c.id = e.classroom_id
      WHERE e.academic_year_id = $1 AND e.institution_id = $2 AND ($3::uuid[] IS NULL OR e.classroom_id = ANY($3::uuid[]))
      ORDER BY e.created_at, e.id`,
    [fromYearId, institutionId, classroomIds ? [...classroomIds] : null],
  );
  return rows.map((r) => ({
    enrollment: mapEnrollment(r),
    programId: r.program_id,
    gradeLevelId: r.grade_level_id,
    outcomeKind: r.outcome_kind,
    outcomeTargets: r.outcome_to,
  }));
}

export async function listRolledOverPreviousIds(tx: Tx, toYearId: string, institutionId: string): Promise<Set<string>> {
  const rows = await tx.many<{ previous_enrollment_id: string }>(
    "SELECT previous_enrollment_id FROM academic.enrollments WHERE academic_year_id = $1 AND institution_id = $2 AND source_kind = 'ROLLOVER' AND status <> 'CANCELLED' AND previous_enrollment_id IS NOT NULL",
    [toYearId, institutionId],
  );
  return new Set(rows.map((r) => r.previous_enrollment_id));
}
