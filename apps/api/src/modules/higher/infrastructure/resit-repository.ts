/** Fenêtres et inscriptions de rattrapage (SQL via le `Tx` de TenantDb). */
import type { Tx } from "@ecoledigitale/database";
import type { DecimalString, IsoDate, ResitRegistration, ResitWindow, Uuid } from "../domain/types";
import { REGISTRATION_COLUMNS, WINDOW_COLUMNS, decodeCursor, encodeCursor, toRegistration, toWindow, type RegistrationRow, type WindowRow } from "./rows";

export async function insertWindow(
  tx: Tx,
  w: {
    id: Uuid; tenantId: Uuid; classroomId: Uuid; academicPeriodId: Uuid; resultsStateId: Uuid | null; opensOn: IsoDate; closesOn: IsoDate;
    nodeIds: readonly Uuid[] | null; openedBy: Uuid; openedAt: Date;
  },
): Promise<ResitWindow> {
  const rows = await tx.many<WindowRow>(
    `INSERT INTO higher.resit_windows (id, tenant_id, classroom_id, academic_period_id, results_state_id, opens_on, closes_on, node_ids, status, opened_by, opened_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9,$10) RETURNING ${WINDOW_COLUMNS}`,
    [w.id, w.tenantId, w.classroomId, w.academicPeriodId, w.resultsStateId, w.opensOn, w.closesOn, w.nodeIds, w.openedBy, w.openedAt.toISOString()],
  );
  return toWindow(rows[0] as WindowRow);
}

export async function getWindow(tx: Tx, id: Uuid, forUpdate = false): Promise<ResitWindow | null> {
  const r = await tx.queryOne<WindowRow>(`SELECT ${WINDOW_COLUMNS} FROM higher.resit_windows WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return r ? toWindow(r) : null;
}

export async function findOpenWindow(tx: Tx, classroomId: Uuid, academicPeriodId: Uuid): Promise<ResitWindow | null> {
  const r = await tx.queryOne<WindowRow>(
    `SELECT ${WINDOW_COLUMNS} FROM higher.resit_windows WHERE classroom_id = $1 AND academic_period_id = $2 AND status = 'OPEN'`,
    [classroomId, academicPeriodId],
  );
  return r ? toWindow(r) : null;
}

export async function listWindows(
  tx: Tx,
  f: { classroomId?: Uuid | undefined; academicPeriodId?: Uuid | undefined; status?: ResitWindow["status"] | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<{ items: ResitWindow[]; nextCursor: string | null }> {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (f.classroomId) { params.push(f.classroomId); where.push(`classroom_id = $${params.length}`); }
  if (f.academicPeriodId) { params.push(f.academicPeriodId); where.push(`academic_period_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  const cursor = decodeCursor<{ a: string; i: string }>(f.cursor);
  if (cursor) { params.push(cursor.a, cursor.i); where.push(`(opened_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<WindowRow>(`SELECT ${WINDOW_COLUMNS} FROM higher.resit_windows WHERE ${where.join(" AND ")} ORDER BY opened_at DESC, id DESC LIMIT $${params.length}`, params);
  const items = rows.slice(0, limit).map(toWindow);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ a: last.openedAt.toISOString(), i: last.id }) : null };
}

export async function closeWindow(tx: Tx, id: Uuid, status: "CLOSED" | "CANCELLED", by: Uuid, at: Date): Promise<ResitWindow | null> {
  const r = await tx.queryOne<WindowRow>(
    `UPDATE higher.resit_windows SET status = $2, closed_by = $3, closed_at = $4 WHERE id = $1 AND status = 'OPEN' RETURNING ${WINDOW_COLUMNS}`,
    [id, status, by, at.toISOString()],
  );
  return r ? toWindow(r) : null;
}

export async function setWindowState(tx: Tx, id: Uuid, stateId: Uuid): Promise<void> {
  await tx.query(`UPDATE higher.resit_windows SET results_state_id = $2 WHERE id = $1`, [id, stateId]);
}

/** Inscription idempotente : `null` si l'étudiant est déjà inscrit à cette ECUE pour cette période (AC3.6). */
export async function insertRegistration(
  tx: Tx,
  w: {
    id: Uuid; tenantId: Uuid; windowId: Uuid; enrollmentId: Uuid; studentId: Uuid; academicPeriodId: Uuid; ecueNodeId: Uuid; ueNodeId: Uuid;
    session1Average: DecimalString | null; at: Date;
  },
): Promise<ResitRegistration | null> {
  const rows = await tx.many<RegistrationRow>(
    `INSERT INTO higher.resit_registrations (id, tenant_id, window_id, enrollment_id, student_id, academic_period_id, ecue_node_id, ue_node_id, session1_average, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'REGISTERED',$10,$10)
     ON CONFLICT (tenant_id, enrollment_id, ecue_node_id, academic_period_id) DO NOTHING
     RETURNING ${REGISTRATION_COLUMNS}`,
    [w.id, w.tenantId, w.windowId, w.enrollmentId, w.studentId, w.academicPeriodId, w.ecueNodeId, w.ueNodeId, w.session1Average, w.at.toISOString()],
  );
  return rows[0] ? toRegistration(rows[0]) : null;
}

export async function listRegistrationsOfWindow(tx: Tx, windowId: Uuid): Promise<ResitRegistration[]> {
  const rows = await tx.many<RegistrationRow>(`SELECT ${REGISTRATION_COLUMNS} FROM higher.resit_registrations WHERE window_id = $1 ORDER BY created_at, id`, [windowId]);
  return rows.map(toRegistration);
}

export async function listRegistrationsOfStudent(tx: Tx, studentId: Uuid): Promise<Array<ResitRegistration & { opensOn: IsoDate; closesOn: IsoDate; windowStatus: ResitWindow["status"] }>> {
  const rows = await tx.many<RegistrationRow & { opens_on: string; closes_on: string; window_status: ResitWindow["status"] }>(
    `SELECT r.id, r.window_id, r.enrollment_id, r.student_id, r.academic_period_id, r.ecue_node_id, r.ue_node_id,
            r.session1_average::text AS session1_average, r.status, r.outcome,
            w.opens_on::text AS opens_on, w.closes_on::text AS closes_on, w.status AS window_status
       FROM higher.resit_registrations r JOIN higher.resit_windows w ON w.tenant_id = r.tenant_id AND w.id = r.window_id
      WHERE r.student_id = $1 ORDER BY r.created_at DESC, r.id`,
    [studentId],
  );
  return rows.map((r) => ({ ...toRegistration(r), opensOn: r.opens_on, closesOn: r.closes_on, windowStatus: r.window_status }));
}

/** Règle l'issue d'une inscription (à la reclôture de la période : note de session 2 saisie, validée ou non). */
export async function settleRegistration(tx: Tx, id: Uuid, outcome: "VALIDATED" | "NOT_VALIDATED", at: Date): Promise<boolean> {
  const res = await tx.query(
    `UPDATE higher.resit_registrations SET status = 'GRADED', outcome = $2, updated_at = $3 WHERE id = $1 AND (status <> 'GRADED' OR outcome IS DISTINCT FROM $2)`,
    [id, outcome, at.toISOString()],
  );
  return res.rowCount > 0;
}

export async function listRegistrationsForPeriod(tx: Tx, academicPeriodId: Uuid, enrollmentIds: readonly Uuid[]): Promise<ResitRegistration[]> {
  if (enrollmentIds.length === 0) return [];
  const rows = await tx.many<RegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM higher.resit_registrations WHERE academic_period_id = $1 AND enrollment_id = ANY($2::uuid[])`,
    [academicPeriodId, enrollmentIds],
  );
  return rows.map(toRegistration);
}
