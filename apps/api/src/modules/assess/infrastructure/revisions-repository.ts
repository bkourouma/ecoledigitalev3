/**
 * Accès SQL : révisions de notes et verrous de période. `assess.apply_revision` (SQL) est la seule voie
 * d'application d'une révision.
 */
import type { Tx } from "@ecoledigitale/database";
import type { GradeRevision, PeriodLock, RevisionKind, SessionNo } from "../domain/types";
import { LOCK_COLUMNS, REVISION_COLUMNS, toLock, toRevision, type LockRow, type RevisionRow } from "./rows";

export interface RevisionInsert {
  id: string;
  tenantId: string;
  assessmentId: string;
  gradeId: string | null;
  enrollmentId: string;
  studentId: string | null;
  kind: RevisionKind;
  newScore: string | null;
  newEntryStatus: string;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  batchId: string | null;
}

export async function insertRevision(tx: Tx, r: RevisionInsert): Promise<GradeRevision> {
  const row = await tx.queryOne<RevisionRow>(
    `INSERT INTO assess.grade_revisions AS r (id, tenant_id, assessment_id, grade_id, enrollment_id, student_id, kind, new_score, new_entry_status,
        reason, requested_by, requested_by_name, requested_at, batch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13,$14)
     RETURNING ${REVISION_COLUMNS}`,
    [r.id, r.tenantId, r.assessmentId, r.gradeId, r.enrollmentId, r.studentId, r.kind, r.newScore, r.newEntryStatus, r.reason, r.requestedBy, r.requestedByName, r.requestedAt, r.batchId],
  );
  return toRevision(row as RevisionRow);
}

export async function getRevision(tx: Tx, id: string, forUpdate = false): Promise<GradeRevision | null> {
  const row = await tx.queryOne<RevisionRow>(`SELECT ${REVISION_COLUMNS} FROM assess.grade_revisions r WHERE r.id = $1${forUpdate ? " FOR UPDATE OF r" : ""}`, [id]);
  return row ? toRevision(row) : null;
}

export async function listRevisionsOfBatch(tx: Tx, batchId: string): Promise<GradeRevision[]> {
  const rows = await tx.many<RevisionRow>(`SELECT ${REVISION_COLUMNS} FROM assess.grade_revisions r WHERE r.batch_id = $1 ORDER BY r.requested_at, r.id`, [batchId]);
  return rows.map(toRevision);
}

export async function listRevisionsOfGrade(tx: Tx, gradeId: string): Promise<GradeRevision[]> {
  const rows = await tx.many<RevisionRow>(`SELECT ${REVISION_COLUMNS} FROM assess.grade_revisions r WHERE r.grade_id = $1 ORDER BY r.requested_at, r.id`, [gradeId]);
  return rows.map(toRevision);
}

export interface RevisionFilter {
  status?: string | undefined;
  assessmentId?: string | undefined;
  classroomId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export async function listRevisions(tx: Tx, f: RevisionFilter): Promise<{ items: GradeRevision[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.status) add("r.status = ?", f.status);
  if (f.assessmentId) add("r.assessment_id = ?", f.assessmentId);
  if (f.classroomId) add("r.assessment_id IN (SELECT id FROM assess.assessments WHERE classroom_id = ?)", f.classroomId);
  if (f.cursor) {
    const [ts = "", id = ""] = f.cursor.split("|");
    params.push(ts, id);
    where.push(`(r.requested_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = Math.min(f.limit ?? 50, 200);
  params.push(limit + 1);
  const rows = await tx.many<RevisionRow>(
    `SELECT ${REVISION_COLUMNS} FROM assess.grade_revisions r ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.requested_at DESC, r.id DESC LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, limit).map(toRevision);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? `${last.requestedAt.toISOString()}|${last.id}` : null };
}

export async function decideRevision(
  tx: Tx,
  d: { id: string; status: "APPROVED" | "REJECTED"; by: string; byName: string; at: Date; comment: string | null; fourEyesWaived: boolean },
): Promise<GradeRevision | null> {
  const row = await tx.queryOne<RevisionRow>(
    `UPDATE assess.grade_revisions r SET status = $2, decided_by = $3, decided_by_name = $4, decided_at = $5, decision_comment = $6, four_eyes_waived = $7
      WHERE r.id = $1 AND r.status = 'REQUESTED'
      RETURNING ${REVISION_COLUMNS}`,
    [d.id, d.status, d.by, d.byName, d.at, d.comment, d.fourEyesWaived],
  );
  return row ? toRevision(row) : null;
}

/** SEULE voie d'application : `assess.apply_revision` (SQL) ; le déclencheur des notes revérifie tout. */
export async function applyRevisionSql(tx: Tx, revisionId: string, at: Date): Promise<GradeRevision> {
  await tx.query("SELECT assess.apply_revision($1::uuid, $2::timestamptz)", [revisionId, at]);
  const rev = await getRevision(tx, revisionId);
  return rev as GradeRevision;
}

/** Pose le lot d'annulation pour la transaction (relu et revérifié par le déclencheur des évaluations). */
export async function setCancellationBatch(tx: Tx, batchId: string): Promise<void> {
  await tx.query("SELECT set_config('app.grade_revision_batch', $1, true)", [batchId]);
}

export async function clearCancellationBatch(tx: Tx): Promise<void> {
  await tx.query("SELECT set_config('app.grade_revision_batch', '', true)");
}

export async function listApprovedUnapplied(tx: Tx, classroomId: string, academicPeriodId: string): Promise<GradeRevision[]> {
  const rows = await tx.many<RevisionRow>(
    `SELECT ${REVISION_COLUMNS} FROM assess.grade_revisions r
       JOIN assess.assessments a ON a.tenant_id = r.tenant_id AND a.id = r.assessment_id
      WHERE r.status = 'APPROVED' AND r.batch_id IS NULL AND a.classroom_id = $1 AND a.academic_period_id = $2 ORDER BY r.requested_at, r.id`,
    [classroomId, academicPeriodId],
  );
  return rows.map(toRevision);
}

// ---------------------------------------------------------------------------
// Verrous de période
// ---------------------------------------------------------------------------

export async function getActiveLock(tx: Tx, classroomId: string, academicPeriodId: string, forUpdate = false): Promise<PeriodLock | null> {
  const row = await tx.queryOne<LockRow>(
    `SELECT ${LOCK_COLUMNS} FROM assess.period_locks l WHERE l.classroom_id = $1 AND l.academic_period_id = $2 AND l.released_at IS NULL${forUpdate ? " FOR UPDATE OF l" : ""}`,
    [classroomId, academicPeriodId],
  );
  return row ? toLock(row) : null;
}

export async function listLocks(tx: Tx, classroomId: string, academicPeriodId: string): Promise<PeriodLock[]> {
  const rows = await tx.many<LockRow>(
    `SELECT ${LOCK_COLUMNS} FROM assess.period_locks l WHERE l.classroom_id = $1 AND l.academic_period_id = $2 ORDER BY l.locked_at, l.id`,
    [classroomId, academicPeriodId],
  );
  return rows.map(toLock);
}

export async function insertLock(
  tx: Tx,
  l: { id: string; tenantId: string; classroomId: string; academicPeriodId: string; lockedBy: string; reason: string | null; sessions: readonly SessionNo[]; at: Date },
): Promise<PeriodLock> {
  const row = await tx.queryOne<LockRow>(
    `INSERT INTO assess.period_locks AS l (id, tenant_id, classroom_id, academic_period_id, locked_at, locked_by, lock_reason, locked_sessions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::smallint[])
     RETURNING ${LOCK_COLUMNS}`,
    [l.id, l.tenantId, l.classroomId, l.academicPeriodId, l.at, l.lockedBy, l.reason, [...l.sessions]],
  );
  return toLock(row as LockRow);
}

export async function shrinkLock(tx: Tx, id: string, sessions: readonly SessionNo[]): Promise<PeriodLock> {
  const row = await tx.queryOne<LockRow>(
    `UPDATE assess.period_locks l SET locked_sessions = $2::smallint[] WHERE l.id = $1 AND l.released_at IS NULL RETURNING ${LOCK_COLUMNS}`,
    [id, [...sessions]],
  );
  return toLock(row as LockRow);
}

export async function releaseLock(tx: Tx, id: string, by: string, reason: string, at: Date): Promise<PeriodLock> {
  const row = await tx.queryOne<LockRow>(
    `UPDATE assess.period_locks l SET released_at = $2, released_by = $3, release_reason = $4 WHERE l.id = $1 AND l.released_at IS NULL RETURNING ${LOCK_COLUMNS}`,
    [id, at, by, reason],
  );
  return toLock(row as LockRow);
}
