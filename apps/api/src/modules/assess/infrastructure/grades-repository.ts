/**
 * Accès SQL : notes, reçus de lots idempotents, lectures de notes publiées. Les écritures de masse passent par `unnest`
 * (une requête par lot) ; les déclencheurs de la base (1105) revérifient chaque ligne.
 */
import type { Tx } from "@ecoledigitale/database";
import type { Grade, PublishedGrade } from "../domain/types";
import { GRADE_COLUMNS, PUBLISHED_COLUMNS, toGrade, toPublished, type GradeRow, type PublishedRow } from "./rows";

export async function listGradesOf(tx: Tx, assessmentId: string): Promise<Grade[]> {
  const rows = await tx.many<GradeRow>(`SELECT ${GRADE_COLUMNS} FROM assess.grades g WHERE g.assessment_id = $1 ORDER BY g.created_at, g.id`, [assessmentId]);
  return rows.map(toGrade);
}

export async function getGradeById(tx: Tx, id: string, forUpdate = false): Promise<Grade | null> {
  const row = await tx.queryOne<GradeRow>(`SELECT ${GRADE_COLUMNS} FROM assess.grades g WHERE g.id = $1${forUpdate ? " FOR UPDATE OF g" : ""}`, [id]);
  return row ? toGrade(row) : null;
}

export async function getGradeByEnrollment(tx: Tx, assessmentId: string, enrollmentId: string): Promise<Grade | null> {
  const row = await tx.queryOne<GradeRow>(`SELECT ${GRADE_COLUMNS} FROM assess.grades g WHERE g.assessment_id = $1 AND g.enrollment_id = $2`, [assessmentId, enrollmentId]);
  return row ? toGrade(row) : null;
}

export interface GradeInsert {
  id: string;
  assessmentId: string;
  enrollmentId: string;
  studentId: string;
  score: string | null;
  entryStatus: string;
  comment: string | null;
}

export async function insertGrades(tx: Tx, tenantId: string, rows: readonly GradeInsert[], by: string | null, now: Date): Promise<Grade[]> {
  if (rows.length === 0) return [];
  const res = await tx.many<GradeRow>(
    `INSERT INTO assess.grades AS g (id, tenant_id, assessment_id, enrollment_id, student_id, score, entry_status, comment, entered_by, entered_at, created_at, updated_at)
     SELECT v.id, $1, v.assessment_id, v.enrollment_id, v.student_id, v.score::numeric, v.entry_status, v.comment, $2, $3, $3, $3
       FROM unnest($4::uuid[], $5::uuid[], $6::uuid[], $7::uuid[], $8::text[], $9::text[], $10::text[])
            AS v(id, assessment_id, enrollment_id, student_id, score, entry_status, comment)
     RETURNING ${GRADE_COLUMNS}`,
    [
      tenantId,
      by,
      now,
      rows.map((r) => r.id),
      rows.map((r) => r.assessmentId),
      rows.map((r) => r.enrollmentId),
      rows.map((r) => r.studentId),
      rows.map((r) => r.score),
      rows.map((r) => r.entryStatus),
      rows.map((r) => r.comment),
    ],
  );
  return res.map(toGrade);
}

export interface GradeUpdate {
  id: string;
  expectedVersion: number;
  score: string | null;
  entryStatus: string;
  comment: string | null;
}

/** Mise à jour atomique par `row_version` : retourne les notes écrites (moins que demandé ⇒ écrasement concurrent). */
export async function updateGrades(tx: Tx, tenantId: string, rows: readonly GradeUpdate[], by: string | null, now: Date): Promise<Grade[]> {
  if (rows.length === 0) return [];
  const res = await tx.many<GradeRow>(
    `UPDATE assess.grades g SET score = v.score::numeric, entry_status = v.entry_status, comment = v.comment,
            entered_by = $2, entered_at = $3, updated_at = $3
       FROM unnest($4::uuid[], $5::int[], $6::text[], $7::text[], $8::text[]) AS v(id, row_version, score, entry_status, comment)
      WHERE g.tenant_id = $1 AND g.id = v.id AND g.row_version = v.row_version
     RETURNING ${GRADE_COLUMNS}`,
    [
      tenantId,
      by,
      now,
      rows.map((r) => r.id),
      rows.map((r) => r.expectedVersion),
      rows.map((r) => r.score),
      rows.map((r) => r.entryStatus),
      rows.map((r) => r.comment),
    ],
  );
  return res.map(toGrade);
}

// ---------------------------------------------------------------------------
// Reçus de lots (idempotence)
// ---------------------------------------------------------------------------

export interface Receipt {
  payloadHash: string;
  result: unknown;
}

export async function getReceipt(tx: Tx, assessmentId: string, key: string): Promise<Receipt | null> {
  const row = await tx.queryOne<{ payload_hash: string; result: unknown }>(
    "SELECT payload_hash, result FROM assess.batch_receipts WHERE assessment_id = $1 AND idempotency_key = $2",
    [assessmentId, key],
  );
  return row ? { payloadHash: row.payload_hash, result: row.result } : null;
}

export async function insertReceipt(
  tx: Tx,
  r: { id: string; tenantId: string; assessmentId: string; key: string; payloadHash: string; result: unknown; by: string | null; now: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO assess.batch_receipts (id, tenant_id, assessment_id, idempotency_key, payload_hash, result, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    [r.id, r.tenantId, r.assessmentId, r.key, r.payloadHash, JSON.stringify(r.result), r.by, r.now],
  );
}

export async function purgeReceiptsOlderThan(tx: Tx, before: Date): Promise<number> {
  const res = await tx.query("DELETE FROM assess.batch_receipts WHERE created_at < $1", [before]);
  return res.rowCount;
}

// ---------------------------------------------------------------------------
// Lectures de notes publiées (module results, élève, tuteur)
// ---------------------------------------------------------------------------

export interface PublishedFilter {
  classroomId?: string | undefined;
  academicPeriodId?: string | undefined;
  nodeIds?: readonly string[] | undefined;
  sessionNo?: number | undefined;
  enrollmentIds?: readonly string[] | undefined;
  studentId?: string | undefined;
  /** Inclut les notes des types masqués aux élèves (calcul) ; faux pour les lectures de la famille. */
  includeHidden: boolean;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/** Notes PUBLISHED uniquement (statut de la note ET de l'évaluation) ; tri déterministe (date, puis identifiant). */
export async function listPublished(tx: Tx, f: PublishedFilter): Promise<PublishedGrade[]> {
  const where = ["g.status = 'PUBLISHED'", "a.status = 'PUBLISHED'"];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.classroomId) add("a.classroom_id = ?", f.classroomId);
  if (f.academicPeriodId) add("a.academic_period_id = ?", f.academicPeriodId);
  if (f.nodeIds) add("a.curriculum_node_id = ANY(?::uuid[])", [...f.nodeIds]);
  if (f.sessionNo) add("a.session_no = ?", f.sessionNo);
  if (f.enrollmentIds) add("g.enrollment_id = ANY(?::uuid[])", [...f.enrollmentIds]);
  if (f.studentId) add("g.student_id = ?", f.studentId);
  if (!f.includeHidden) where.push("t.visible_to_students");
  if (f.cursor) {
    const [day = "", id = ""] = f.cursor.split("|");
    params.push(day, id);
    where.push(`(a.assessed_on, g.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  let sql = `SELECT ${PUBLISHED_COLUMNS}
      FROM assess.grades g
      JOIN assess.assessments a ON a.tenant_id = g.tenant_id AND a.id = g.assessment_id
      JOIN assess.assessment_types t ON t.tenant_id = a.tenant_id AND t.id = a.type_id
     WHERE ${where.join(" AND ")}`;
  if (f.cursor || f.limit) {
    params.push(Math.min(f.limit ?? 50, 200) + 1);
    sql += ` ORDER BY a.assessed_on DESC, g.id DESC LIMIT $${params.length}`;
  } else {
    sql += " ORDER BY a.assessed_on, a.id, g.enrollment_id";
  }
  const rows = await tx.many<PublishedRow>(sql, params);
  return rows.map(toPublished);
}

export async function listAssessmentsAwaiting(tx: Tx, classroomId: string, academicPeriodId: string): Promise<Array<{ id: string; title: string; status: string; sessionNo: number; curriculumNodeId: string }>> {
  const rows = await tx.many<{ id: string; title: string; status: string; session_no: number; curriculum_node_id: string }>(
    `SELECT id, title, status, session_no, curriculum_node_id FROM assess.assessments
      WHERE classroom_id = $1 AND academic_period_id = $2 AND status NOT IN ('PUBLISHED', 'CANCELLED') ORDER BY assessed_on, id`,
    [classroomId, academicPeriodId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, sessionNo: r.session_no, curriculumNodeId: r.curriculum_node_id }));
}
