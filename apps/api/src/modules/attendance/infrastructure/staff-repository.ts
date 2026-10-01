/** Présence quotidienne du personnel et congés. */
import type { Tx } from "@ecoledigitale/database";
import type { IsoDate, LeaveStatus, StaffSource, Uuid } from "../domain/types";
import {
  LEAVE_COLUMNS,
  STAFF_RECORD_COLUMNS,
  decodeCursor,
  encodeCursor,
  toLeave,
  toStaffRecord,
  type LeaveRow,
  type StaffLeave,
  type StaffRecord,
  type StaffRecordRow,
} from "./rows";

export interface StaffRecordWrite {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly staffId: Uuid;
  readonly workDate: IsoDate;
  readonly occurrenceId: Uuid | null;
  readonly statusCode: string;
  readonly checkInAt: Date | null;
  readonly checkOutAt: Date | null;
  readonly minutesLate: number | null;
  readonly leaveId: Uuid | null;
  readonly note: string | null;
  readonly source: StaffSource;
  readonly markedBy: Uuid;
  readonly markedAt: Date;
  readonly clientId: Uuid | null;
}

export async function findStaffRecord(tx: Tx, staffId: Uuid, workDate: IsoDate, occurrenceId: Uuid | null, forUpdate = false): Promise<StaffRecord | null> {
  const r = await tx.queryOne<StaffRecordRow>(
    `SELECT ${STAFF_RECORD_COLUMNS} FROM attendance.staff_records
      WHERE staff_id = $1 AND work_date = $2 AND ${occurrenceId ? "occurrence_id = $3" : "occurrence_id IS NULL AND $3::uuid IS NULL"} ${forUpdate ? "FOR UPDATE" : ""}`,
    [staffId, workDate, occurrenceId],
  );
  return r ? toStaffRecord(r) : null;
}

export async function findStaffRecordByClientId(tx: Tx, clientId: Uuid): Promise<StaffRecord | null> {
  const r = await tx.queryOne<StaffRecordRow>(`SELECT ${STAFF_RECORD_COLUMNS} FROM attendance.staff_records WHERE client_id = $1`, [clientId]);
  return r ? toStaffRecord(r) : null;
}

/** Une ligne par (membre, jour) — ou par (membre, occurrence) : insertion ou mise à jour. */
export async function upsertStaffRecord(tx: Tx, w: StaffRecordWrite): Promise<StaffRecord> {
  const existing = await findStaffRecord(tx, w.staffId, w.workDate, w.occurrenceId, true);
  if (existing) {
    const rows = await tx.many<StaffRecordRow>(
      `UPDATE attendance.staff_records SET status_code = $2, check_in_at = COALESCE($3, check_in_at), check_out_at = COALESCE($4, check_out_at),
              minutes_late = $5, leave_id = $6, note = COALESCE($7, note), source = $8, marked_by = $9, marked_at = $10,
              client_id = COALESCE($11, client_id), updated_at = now()
        WHERE id = $1 RETURNING ${STAFF_RECORD_COLUMNS}`,
      [existing.id, w.statusCode, w.checkInAt?.toISOString() ?? null, w.checkOutAt?.toISOString() ?? null, w.minutesLate, w.leaveId, w.note, w.source, w.markedBy, w.markedAt.toISOString(), w.clientId],
    );
    return toStaffRecord(rows[0] as StaffRecordRow);
  }
  const rows = await tx.many<StaffRecordRow>(
    `INSERT INTO attendance.staff_records (id, tenant_id, staff_id, work_date, occurrence_id, status_code, check_in_at, check_out_at, minutes_late,
                                           leave_id, note, source, marked_by, marked_at, client_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${STAFF_RECORD_COLUMNS}`,
    [
      w.id, w.tenantId, w.staffId, w.workDate, w.occurrenceId, w.statusCode, w.checkInAt?.toISOString() ?? null, w.checkOutAt?.toISOString() ?? null,
      w.minutesLate, w.leaveId, w.note, w.source, w.markedBy, w.markedAt.toISOString(), w.clientId,
    ],
  );
  return toStaffRecord(rows[0] as StaffRecordRow);
}

export async function listStaffRecords(
  tx: Tx,
  f: { staffId?: Uuid | undefined; from: IsoDate; to: IsoDate; statusCode?: string | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<{ items: StaffRecord[]; nextCursor: string | null }> {
  const where: string[] = ["work_date BETWEEN $1::date AND $2::date"];
  const params: unknown[] = [f.from, f.to];
  if (f.staffId) { params.push(f.staffId); where.push(`staff_id = $${params.length}`); }
  if (f.statusCode) { params.push(f.statusCode); where.push(`status_code = $${params.length}`); }
  const cursor = decodeCursor<{ d: string; i: string }>(f.cursor);
  if (cursor) {
    params.push(cursor.d, cursor.i);
    where.push(`(work_date, id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<StaffRecordRow>(
    `SELECT ${STAFF_RECORD_COLUMNS} FROM attendance.staff_records WHERE ${where.join(" AND ")} ORDER BY work_date DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const items = rows.slice(0, limit).map(toStaffRecord);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ d: last.workDate, i: last.id }) : null };
}

/** Comptages de présence par membre sur une période (rapport de synthèse). */
export async function summarizeStaff(tx: Tx, from: IsoDate, to: IsoDate, staffId?: Uuid): Promise<Array<{ staffId: Uuid; statusCode: string; days: number; lateMinutes: number }>> {
  const rows = await tx.many<{ staff_id: Uuid; status_code: string; days: number; late_minutes: number }>(
    `SELECT staff_id, status_code, count(*)::int AS days, COALESCE(sum(minutes_late), 0)::int AS late_minutes
       FROM attendance.staff_records
      WHERE work_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR staff_id = $3)
      GROUP BY staff_id, status_code ORDER BY staff_id, status_code`,
    [from, to, staffId ?? null],
  );
  return rows.map((r) => ({ staffId: r.staff_id, statusCode: r.status_code, days: r.days, lateMinutes: r.late_minutes }));
}

// --- congés -----------------------------------------------------------------

export async function insertLeave(
  tx: Tx,
  l: {
    id: Uuid; tenantId: Uuid; staffId: Uuid; leaveTypeCode: string; startsOn: IsoDate; endsOn: IsoDate; halfDayStart: boolean; halfDayEnd: boolean;
    reason: string | null; requestedBy: Uuid; requestedAt: Date; documentRef: Uuid | null;
  },
): Promise<StaffLeave> {
  const rows = await tx.many<LeaveRow>(
    `INSERT INTO attendance.staff_leaves (id, tenant_id, staff_id, leave_type_code, starts_on, ends_on, half_day_start, half_day_end, reason, requested_by, requested_at, document_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${LEAVE_COLUMNS}`,
    [l.id, l.tenantId, l.staffId, l.leaveTypeCode, l.startsOn, l.endsOn, l.halfDayStart, l.halfDayEnd, l.reason, l.requestedBy, l.requestedAt.toISOString(), l.documentRef],
  );
  return toLeave(rows[0] as LeaveRow);
}

export async function getLeave(tx: Tx, id: Uuid, forUpdate = false): Promise<StaffLeave | null> {
  const r = await tx.queryOne<LeaveRow>(`SELECT ${LEAVE_COLUMNS} FROM attendance.staff_leaves WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return r ? toLeave(r) : null;
}

export async function decideLeave(
  tx: Tx,
  id: Uuid,
  patch: { status: LeaveStatus; decidedBy: Uuid | null; decidedAt: Date | null; decisionNote: string | null },
): Promise<StaffLeave> {
  const rows = await tx.many<LeaveRow>(
    `UPDATE attendance.staff_leaves SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5, updated_at = now()
      WHERE id = $1 RETURNING ${LEAVE_COLUMNS}`,
    [id, patch.status, patch.decidedBy, patch.decidedAt?.toISOString() ?? null, patch.decisionNote],
  );
  return toLeave(rows[0] as LeaveRow);
}

export async function listLeaves(
  tx: Tx,
  f: { staffId?: Uuid | undefined; status?: LeaveStatus | undefined; from?: IsoDate | undefined; to?: IsoDate | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<{ items: StaffLeave[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.staffId) { params.push(f.staffId); where.push(`staff_id = $${params.length}`); }
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.from) { params.push(f.from); where.push(`ends_on >= $${params.length}::date`); }
  if (f.to) { params.push(f.to); where.push(`starts_on <= $${params.length}::date`); }
  const cursor = decodeCursor<{ d: string; i: string }>(f.cursor);
  if (cursor) {
    params.push(cursor.d, cursor.i);
    where.push(`(starts_on, id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<LeaveRow>(
    `SELECT ${LEAVE_COLUMNS} FROM attendance.staff_leaves ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY starts_on DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  const items = rows.slice(0, limit).map(toLeave);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ d: last.startsOn, i: last.id }) : null };
}

/** Congé APPROUVÉ couvrant un jour pour un membre du personnel. */
export async function findApprovedLeaveOn(tx: Tx, staffId: Uuid, date: IsoDate): Promise<StaffLeave | null> {
  const r = await tx.queryOne<LeaveRow>(
    `SELECT ${LEAVE_COLUMNS} FROM attendance.staff_leaves WHERE staff_id = $1 AND status = 'APPROVED' AND $2::date BETWEEN starts_on AND ends_on`,
    [staffId, date],
  );
  return r ? toLeave(r) : null;
}

export async function listApprovedLeavesWithin(tx: Tx, from: IsoDate, to: IsoDate, staffId?: Uuid): Promise<StaffLeave[]> {
  return (
    await tx.many<LeaveRow>(
      `SELECT ${LEAVE_COLUMNS} FROM attendance.staff_leaves
        WHERE status = 'APPROVED' AND starts_on <= $2::date AND ends_on >= $1::date AND ($3::uuid IS NULL OR staff_id = $3)`,
      [from, to, staffId ?? null],
    )
  ).map(toLeave);
}
