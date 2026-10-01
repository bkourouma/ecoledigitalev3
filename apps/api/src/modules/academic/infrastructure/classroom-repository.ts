/** Classes / promotions et offres (ex. cohortes d'UE). */
import type { Tx } from "@ecoledigitale/database";
import type { AcademicClassroomStatus, AcademicOfferingStatus } from "@ecoledigitale/contracts/src/v2/academic";
import type { Classroom, Offering } from "../domain/records";
import { CLASSROOM_COLS, OFFERING_COLS, mapClassroom, mapOffering } from "./mappers";

export interface ClassroomFilter {
  institutionId?: string | null;
  campusId?: string | null;
  academicYearId?: string | null;
  programId?: string | null;
  gradeLevelId?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
}

export async function listClassrooms(tx: Tx, f: ClassroomFilter): Promise<{ items: Classroom[]; total: number }> {
  const where = `($1::uuid IS NULL OR c.institution_id = $1) AND ($2::uuid IS NULL OR c.campus_id IS NULL OR c.campus_id = $2) AND ($3::uuid IS NULL OR c.academic_year_id = $3)
        AND ($4::uuid IS NULL OR c.program_id = $4) AND ($5::uuid IS NULL OR c.grade_level_id = $5) AND ($6::text IS NULL OR c.status = $6)`;
  const params = [f.institutionId ?? null, f.campusId ?? null, f.academicYearId ?? null, f.programId ?? null, f.gradeLevelId ?? null, f.status ?? null];
  const rows = await tx.many(
    `SELECT ${CLASSROOM_COLS} FROM academic.classrooms c WHERE ${where} ORDER BY c.academic_year_id, c.grade_level_id, c.name LIMIT $7 OFFSET $8`,
    [...params, f.limit ?? 50, f.offset ?? 0],
  );
  const total = await tx.queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM academic.classrooms c WHERE ${where}`, params);
  return { items: rows.map(mapClassroom), total: total?.n ?? 0 };
}

export async function getClassroom(tx: Tx, id: string): Promise<Classroom | null> {
  const r = await tx.queryOne(`SELECT ${CLASSROOM_COLS} FROM academic.classrooms c WHERE c.id = $1`, [id]);
  return r ? mapClassroom(r) : null;
}

export async function insertClassroom(
  tx: Tx,
  v: {
    id: string;
    institutionId: string;
    campusId: string | null;
    academicYearId: string;
    programId: string;
    gradeLevelId: string;
    curriculumVersionId: string | null;
    kind: string;
    code: string;
    name: string;
    capacity: number | null;
    capacityIsHard: boolean;
    startsOn: string | null;
    endsOn: string | null;
    status?: AcademicClassroomStatus;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.classrooms (id, tenant_id, institution_id, campus_id, academic_year_id, program_id, grade_level_id, curriculum_version_id, kind, code, name,
        capacity, capacity_is_hard, starts_on, ends_on, status)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14::date, $15)`,
    [v.id, v.institutionId, v.campusId, v.academicYearId, v.programId, v.gradeLevelId, v.curriculumVersionId, v.kind, v.code, v.name, v.capacity, v.capacityIsHard, v.startsOn, v.endsOn, v.status ?? "DRAFT"],
  );
}

export async function updateClassroom(
  tx: Tx,
  id: string,
  v: { campusId?: string | null; curriculumVersionId?: string | null; name?: string; code?: string; capacity?: number | null; capacityIsHard?: boolean; startsOn?: string | null; endsOn?: string | null },
): Promise<void> {
  const has = (k: keyof typeof v): boolean => v[k] !== undefined;
  await tx.query(
    `UPDATE academic.classrooms SET
        campus_id = CASE WHEN $2::boolean THEN $3::uuid ELSE campus_id END,
        curriculum_version_id = CASE WHEN $4::boolean THEN $5::uuid ELSE curriculum_version_id END,
        name = COALESCE($6, name), code = COALESCE($7, code),
        capacity = CASE WHEN $8::boolean THEN $9::integer ELSE capacity END,
        capacity_is_hard = COALESCE($10::boolean, capacity_is_hard),
        starts_on = CASE WHEN $11::boolean THEN $12::date ELSE starts_on END,
        ends_on = CASE WHEN $13::boolean THEN $14::date ELSE ends_on END,
        updated_at = now()
      WHERE id = $1`,
    [id, has("campusId"), v.campusId ?? null, has("curriculumVersionId"), v.curriculumVersionId ?? null, v.name ?? null, v.code ?? null, has("capacity"), v.capacity ?? null, v.capacityIsHard ?? null, has("startsOn"), v.startsOn ?? null, has("endsOn"), v.endsOn ?? null],
  );
}

export async function setClassroomStatus(tx: Tx, id: string, status: AcademicClassroomStatus): Promise<void> {
  await tx.query("UPDATE academic.classrooms SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
}

export async function classroomEnrollmentCount(tx: Tx, classroomId: string): Promise<number> {
  const r = await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM academic.enrollments WHERE classroom_id = $1 AND status IN ('PENDING','ACTIVE','SUSPENDED','COMPLETED')", [classroomId]);
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Offres
// ---------------------------------------------------------------------------

export async function listOfferings(tx: Tx, f: { classroomId?: string | null; status?: string | null; institutionId?: string | null; programId?: string | null; openForRegistration?: boolean }): Promise<Offering[]> {
  const rows = await tx.many(
    `SELECT ${OFFERING_COLS} FROM academic.classroom_offerings o JOIN academic.classrooms c ON c.tenant_id = o.tenant_id AND c.id = o.classroom_id
      WHERE ($1::uuid IS NULL OR o.classroom_id = $1) AND ($2::text IS NULL OR o.status = $2) AND ($3::uuid IS NULL OR c.institution_id = $3)
        AND ($4::uuid IS NULL OR c.program_id = $4) AND ($5::boolean IS NOT TRUE OR o.status IN ('OPEN','FULL'))
      ORDER BY o.starts_on, o.label, o.id`,
    [f.classroomId ?? null, f.status ?? null, f.institutionId ?? null, f.programId ?? null, f.openForRegistration === true],
  );
  return rows.map(mapOffering);
}

export async function getOffering(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<Offering | null> {
  const r = await tx.queryOne(`SELECT ${OFFERING_COLS} FROM academic.classroom_offerings o WHERE o.id = $1${options.forUpdate ? " FOR UPDATE OF o" : ""}`, [id]);
  return r ? mapOffering(r) : null;
}

export async function listOfferingsOfClassroomNodes(tx: Tx, classroomId: string, nodeIds: readonly string[]): Promise<Offering[]> {
  if (nodeIds.length === 0) return [];
  const rows = await tx.many(`SELECT ${OFFERING_COLS} FROM academic.classroom_offerings o WHERE o.classroom_id = $1 AND o.curriculum_node_id = ANY($2::uuid[])`, [classroomId, nodeIds]);
  return rows.map(mapOffering);
}

export async function insertOffering(
  tx: Tx,
  v: { id: string; classroomId: string; curriculumNodeId: string; label: string; startsOn: string; endsOn: string; registrationOpensAt: string | null; registrationClosesAt: string | null; capacity: number | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.classroom_offerings (id, tenant_id, classroom_id, curriculum_node_id, label, starts_on, ends_on, registration_opens_at, registration_closes_at, capacity)
     VALUES ($1, kernel.current_tenant_id(), $2, $3, $4, $5::date, $6::date, $7::timestamptz, $8::timestamptz, $9)`,
    [v.id, v.classroomId, v.curriculumNodeId, v.label, v.startsOn, v.endsOn, v.registrationOpensAt, v.registrationClosesAt, v.capacity],
  );
}

export async function updateOffering(
  tx: Tx,
  id: string,
  v: { label?: string; startsOn?: string; endsOn?: string; windowSet?: boolean; registrationOpensAt?: string | null; registrationClosesAt?: string | null; capacity?: number | null },
): Promise<void> {
  await tx.query(
    `UPDATE academic.classroom_offerings SET label = COALESCE($2, label), starts_on = COALESCE($3::date, starts_on), ends_on = COALESCE($4::date, ends_on),
        registration_opens_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE registration_opens_at END,
        registration_closes_at = CASE WHEN $5::boolean THEN $7::timestamptz ELSE registration_closes_at END,
        capacity = CASE WHEN $8::boolean THEN $9::integer ELSE capacity END, updated_at = now()
      WHERE id = $1`,
    [id, v.label ?? null, v.startsOn ?? null, v.endsOn ?? null, v.windowSet === true, v.registrationOpensAt ?? null, v.registrationClosesAt ?? null, v.capacity !== undefined, v.capacity ?? null],
  );
}

export async function setOfferingStatus(tx: Tx, id: string, status: AcademicOfferingStatus): Promise<void> {
  await tx.query("UPDATE academic.classroom_offerings SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
}

/** Offres échues à finaliser (`OPEN`/`FULL`/`IN_PROGRESS` dont `ends_on` est passée), avec l'établissement de leur classe. */
export async function listEndedOfferingCandidates(tx: Tx): Promise<Array<{ id: string; institutionId: string; endsOn: string; status: AcademicOfferingStatus; classroomId: string; curriculumNodeId: string }>> {
  const rows = await tx.many<{ id: string; institution_id: string; ends_on: string; status: AcademicOfferingStatus; classroom_id: string; curriculum_node_id: string }>(
    `SELECT o.id, c.institution_id, to_char(o.ends_on, 'YYYY-MM-DD') AS ends_on, o.status, o.classroom_id, o.curriculum_node_id
       FROM academic.classroom_offerings o JOIN academic.classrooms c ON c.tenant_id = o.tenant_id AND c.id = o.classroom_id
      WHERE o.status IN ('OPEN','FULL','IN_PROGRESS') AND o.ends_on < (now() AT TIME ZONE 'UTC')::date + 1
      ORDER BY o.ends_on, o.id`,
  );
  return rows.map((r) => ({ id: r.id, institutionId: r.institution_id, endsOn: r.ends_on, status: r.status, classroomId: r.classroom_id, curriculumNodeId: r.curriculum_node_id }));
}
