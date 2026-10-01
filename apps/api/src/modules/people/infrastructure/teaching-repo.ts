/**
 * Dépôt SQL des affectations d'enseignement (`teaching_assignments`) et de leur journal append-only. Les objets
 * d'academic (année, classe, nœud, période) sont des UUID SANS clé étrangère : leur cohérence est vérifiée par le cas
 * d'usage via `AcademicQuery`. Une affectation ne se supprime jamais et ne se réactive pas.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AssignmentFact } from "../domain/assignments";
import { Where, numOrNull, updateById } from "./sql";

export interface AssignmentRow {
  id: string;
  staffId: string;
  staffDisplayName: string | null;
  academicYearId: string;
  classroomId: string;
  curriculumNodeId: string | null;
  periodId: string | null;
  roleCode: "LEAD" | "CO_TEACHER" | "HOMEROOM" | "SUBSTITUTE" | "SUPERVISOR";
  replacesAssignmentId: string | null;
  coversAllSubjects: boolean;
  plannedHours: string | null;
  startsOn: string;
  endsOn: string | null;
  status: "ACTIVE" | "ENDED" | "CANCELLED";
  source: string;
  note: string | null;
  createdAt: Date;
}

const ASSIGNMENT_COLUMNS = `
  a.id, a.staff_id AS "staffId", upper(p.last_name) || ' ' || p.first_name AS "staffDisplayName", a.academic_year_id AS "academicYearId",
  a.classroom_id AS "classroomId", a.curriculum_node_id AS "curriculumNodeId", a.period_id AS "periodId", a.role_code AS "roleCode",
  a.replaces_assignment_id AS "replacesAssignmentId", a.covers_all_subjects AS "coversAllSubjects", a.planned_hours::text AS "plannedHours",
  a.starts_on::text AS "startsOn", a.ends_on::text AS "endsOn", a.status, a.source, a.note, a.created_at AS "createdAt"`;
const ASSIGNMENT_FROM = `
  FROM people.teaching_assignments a
  JOIN people.staff st ON st.tenant_id = a.tenant_id AND st.id = a.staff_id
  JOIN people.persons p ON p.tenant_id = st.tenant_id AND p.id = st.person_id`;

export const plannedHoursOfAssignment = (row: Pick<AssignmentRow, "plannedHours">): number | null => numOrNull(row.plannedHours);

export async function getAssignment(tx: Tx, tenantId: string, id: string, options: { forUpdate?: boolean } = {}): Promise<AssignmentRow | null> {
  return tx.queryOne<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS} ${ASSIGNMENT_FROM} WHERE a.tenant_id = $1 AND a.id = $2${options.forUpdate ? " FOR UPDATE OF a" : ""}`,
    [tenantId, id],
  );
}

export interface NewAssignment {
  id: string;
  staffId: string;
  academicYearId: string;
  classroomId: string;
  curriculumNodeId: string | null;
  periodId: string | null;
  roleCode: string;
  replacesAssignmentId: string | null;
  coversAllSubjects: boolean;
  plannedHours: number | null;
  startsOn: string;
  endsOn: string | null;
  source: string;
  note: string | null;
  createdBy: string | null;
}

export async function insertAssignment(tx: Tx, tenantId: string, a: NewAssignment, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO people.teaching_assignments
       (id, tenant_id, staff_id, academic_year_id, classroom_id, curriculum_node_id, period_id, role_code, replaces_assignment_id,
        covers_all_subjects, planned_hours, starts_on, ends_on, status, source, note, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date,'ACTIVE',$14,$15,$16,$17,$17)`,
    [a.id, tenantId, a.staffId, a.academicYearId, a.classroomId, a.curriculumNodeId, a.periodId, a.roleCode, a.replacesAssignmentId, a.coversAllSubjects, a.plannedHours, a.startsOn, a.endsOn, a.source, a.note, a.createdBy, now],
  );
}

export async function updateAssignmentFields(
  tx: Tx,
  tenantId: string,
  id: string,
  p: { plannedHours?: number | null | undefined; endsOn?: string | null | undefined; note?: string | null | undefined; status?: string | undefined },
  now: Date,
): Promise<void> {
  await updateById(tx, "people.teaching_assignments", tenantId, id, { planned_hours: p.plannedHours, ends_on: p.endsOn, note: p.note, status: p.status }, now);
}

export async function insertAssignmentHistory(
  tx: Tx,
  tenantId: string,
  h: { id: string; assignmentId: string; kind: "CREATED" | "UPDATED" | "ENDED" | "CANCELLED" | "REPLACED"; fromValue?: unknown; toValue?: unknown; reason?: string | null | undefined; actorId: string | null },
  now: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO people.teaching_assignment_history (id, tenant_id, assignment_id, kind, from_value, to_value, reason, actor_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`,
    [h.id, tenantId, h.assignmentId, h.kind, h.fromValue === undefined ? null : JSON.stringify(h.fromValue), h.toValue === undefined ? null : JSON.stringify(h.toValue), h.reason ?? null, h.actorId, now],
  );
}

export async function listAssignmentHistory(tx: Tx, tenantId: string, assignmentId: string): Promise<Array<{ id: string; kind: string; reason: string | null; actorId: string | null; occurredAt: Date }>> {
  return tx.many(
    `SELECT id, kind, reason, actor_id AS "actorId", occurred_at AS "occurredAt" FROM people.teaching_assignment_history WHERE tenant_id = $1 AND assignment_id = $2 ORDER BY occurred_at, id`,
    [tenantId, assignmentId],
  );
}

export interface AssignmentListFilter {
  staffId?: string | undefined;
  classroomId?: string | undefined;
  yearId?: string | undefined;
  status?: string | undefined;
  /** Affectations couvrant cette date (statut ACTIVE implicite). */
  onDate?: string | undefined;
}

export async function listAssignmentRows(tx: Tx, tenantId: string, f: AssignmentListFilter): Promise<AssignmentRow[]> {
  const w = new Where([tenantId]);
  if (f.staffId) w.and(`a.staff_id = ${w.bind(f.staffId)}`);
  if (f.classroomId) w.and(`a.classroom_id = ${w.bind(f.classroomId)}`);
  if (f.yearId) w.and(`a.academic_year_id = ${w.bind(f.yearId)}`);
  if (f.status) w.and(`a.status = ${w.bind(f.status)}`);
  if (f.onDate) {
    const d = w.bind(f.onDate);
    w.and(`a.status = 'ACTIVE' AND a.starts_on <= ${d}::date AND (a.ends_on IS NULL OR a.ends_on >= ${d}::date)`);
  }
  return tx.many<AssignmentRow>(`SELECT ${ASSIGNMENT_COLUMNS} ${ASSIGNMENT_FROM} WHERE a.tenant_id = $1${w.sql} ORDER BY a.classroom_id, a.role_code, a.starts_on, a.id`, w.params);
}

/** Affectations ACTIVES des classes données (faits purs pour la résolution du responsable). */
export async function listAssignmentFacts(tx: Tx, tenantId: string, classroomIds: readonly string[]): Promise<AssignmentFact[]> {
  if (classroomIds.length === 0) return [];
  return tx.many<AssignmentFact>(
    `SELECT id, staff_id AS "staffId", classroom_id AS "classroomId", curriculum_node_id AS "curriculumNodeId", period_id AS "periodId", role_code AS "roleCode",
            replaces_assignment_id AS "replacesAssignmentId", covers_all_subjects AS "coversAllSubjects", status, starts_on::text AS "startsOn", ends_on::text AS "endsOn"
       FROM people.teaching_assignments WHERE tenant_id = $1 AND classroom_id = ANY($2::uuid[]) AND status = 'ACTIVE'`,
    [tenantId, classroomIds],
  );
}

/** Classes où le membre du personnel est affecté à la date (visibilité des élèves d'un enseignant). */
export async function listClassroomIdsOfStaff(tx: Tx, tenantId: string, staffId: string, onDate: string, roles: readonly string[]): Promise<string[]> {
  const rows = await tx.many<{ classroomId: string }>(
    `SELECT DISTINCT classroom_id AS "classroomId" FROM people.teaching_assignments
      WHERE tenant_id = $1 AND staff_id = $2 AND status = 'ACTIVE' AND role_code = ANY($4::text[])
        AND starts_on <= $3::date AND (ends_on IS NULL OR ends_on >= $3::date)`,
    [tenantId, staffId, onDate, roles],
  );
  return rows.map((r) => r.classroomId);
}

/** Termine (`ENDED`) toutes les affectations ACTIVES d'un membre ; renvoie les affectations touchées. */
export async function endAllActiveOfStaff(tx: Tx, tenantId: string, staffId: string, endsOn: string, now: Date): Promise<Array<{ id: string; classroomId: string }>> {
  return tx.many(
    `UPDATE people.teaching_assignments
        SET status = 'ENDED', ends_on = GREATEST(starts_on, LEAST(COALESCE(ends_on, $3::date), $3::date)), updated_at = $4
      WHERE tenant_id = $1 AND staff_id = $2 AND status = 'ACTIVE'
      RETURNING id, classroom_id AS "classroomId"`,
    [tenantId, staffId, endsOn, now],
  );
}

/** Affectations ACTIVES en conflit avec une nouvelle (LEAD sur le même objet, HOMEROOM de la classe, doublon strict). */
export async function findActiveConflicts(
  tx: Tx,
  tenantId: string,
  q: { classroomId: string; curriculumNodeId: string | null; periodId: string | null; roleCode: string; staffId: string },
): Promise<AssignmentRow[]> {
  const nil = "00000000-0000-0000-0000-000000000000";
  return tx.many<AssignmentRow>(
    `SELECT ${ASSIGNMENT_COLUMNS} ${ASSIGNMENT_FROM}
      WHERE a.tenant_id = $1 AND a.classroom_id = $2 AND a.status = 'ACTIVE' AND a.role_code = $3
        AND ( ($3 = 'HOMEROOM')
              OR ($3 = 'LEAD' AND COALESCE(a.curriculum_node_id, $7::uuid) = COALESCE($4::uuid, $7::uuid) AND COALESCE(a.period_id, $7::uuid) = COALESCE($5::uuid, $7::uuid))
              OR (a.staff_id = $6 AND COALESCE(a.curriculum_node_id, $7::uuid) = COALESCE($4::uuid, $7::uuid) AND COALESCE(a.period_id, $7::uuid) = COALESCE($5::uuid, $7::uuid)) )
      ORDER BY a.id`,
    [tenantId, q.classroomId, q.roleCode, q.curriculumNodeId, q.periodId, q.staffId, nil],
  );
}

/** Termine les affectations ACTIVES d'une classe ou d'une année (événements academic) ; renvoie les affectations touchées. */
export async function endActiveByScope(
  tx: Tx,
  tenantId: string,
  scope: { classroomId?: string | undefined; yearId?: string | undefined },
  endsOn: string,
  now: Date,
): Promise<Array<{ id: string; staffId: string; classroomId: string }>> {
  if (!scope.classroomId && !scope.yearId) return [];
  const w = new Where([tenantId, endsOn, now]);
  if (scope.classroomId) w.and(`classroom_id = ${w.bind(scope.classroomId)}`);
  if (scope.yearId) w.and(`academic_year_id = ${w.bind(scope.yearId)}`);
  return tx.many(
    `UPDATE people.teaching_assignments
        SET status = 'ENDED', ends_on = GREATEST(starts_on, LEAST(COALESCE(ends_on, $2::date), $2::date)), updated_at = $3
      WHERE tenant_id = $1 AND status = 'ACTIVE'${w.sql}
      RETURNING id, staff_id AS "staffId", classroom_id AS "classroomId"`,
    w.params,
  );
}

export async function activeAssignmentsOfStaffForYear(tx: Tx, tenantId: string, staffId: string, yearId: string): Promise<Array<{ classroomId: string; periodId: string | null; plannedHours: string | null }>> {
  return tx.many(
    `SELECT classroom_id AS "classroomId", period_id AS "periodId", planned_hours::text AS "plannedHours"
       FROM people.teaching_assignments WHERE tenant_id = $1 AND staff_id = $2 AND academic_year_id = $3 AND status = 'ACTIVE'`,
    [tenantId, staffId, yearId],
  );
}
