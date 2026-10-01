/** Registre d'idempotence (`sync_ops`) et file de conflits (`sync_conflicts`) de la synchronisation hors-ligne. */
import type { Tx } from "@ecoledigitale/database";
import type { Uuid } from "../domain/types";
import { decodeCursor, encodeCursor } from "./rows";

export type SyncOpOutcome = "OPENED" | "EXISTING" | "APPLIED" | "UNCHANGED" | "CONFLICT";

export interface SyncOp {
  readonly clientId: Uuid;
  readonly kind: "SESSION" | "RECORD";
  readonly payloadHash: string;
  readonly outcome: SyncOpOutcome;
  readonly sessionId: Uuid | null;
  readonly recordId: Uuid | null;
  readonly conflictId: Uuid | null;
}

interface SyncOpRow {
  client_id: Uuid;
  kind: "SESSION" | "RECORD";
  payload_hash: string;
  outcome: SyncOpOutcome;
  session_id: Uuid | null;
  record_id: Uuid | null;
  conflict_id: Uuid | null;
}

const toOp = (r: SyncOpRow): SyncOp => ({
  clientId: r.client_id,
  kind: r.kind,
  payloadHash: r.payload_hash,
  outcome: r.outcome,
  sessionId: r.session_id,
  recordId: r.record_id,
  conflictId: r.conflict_id,
});

/** Verrou consultatif de transaction par clé d'opération : deux rejeux simultanés s'exécutent l'un après l'autre. */
export async function lockOp(tx: Tx, tenantId: Uuid, clientId: Uuid): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`attendance:sync:${tenantId}:${clientId}`]);
}

export async function getOp(tx: Tx, clientId: Uuid): Promise<SyncOp | null> {
  const r = await tx.queryOne<SyncOpRow>(
    "SELECT client_id, kind, payload_hash, outcome, session_id, record_id, conflict_id FROM attendance.sync_ops WHERE client_id = $1",
    [clientId],
  );
  return r ? toOp(r) : null;
}

export async function insertOp(
  tx: Tx,
  o: SyncOp & { tenantId: Uuid; deviceId: string | null; userId: Uuid; clientAt: Date | null; receivedAt: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO attendance.sync_ops (tenant_id, client_id, kind, payload_hash, outcome, session_id, record_id, conflict_id, device_id, user_id, client_at, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [o.tenantId, o.clientId, o.kind, o.payloadHash, o.outcome, o.sessionId, o.recordId, o.conflictId, o.deviceId, o.userId, o.clientAt?.toISOString() ?? null, o.receivedAt.toISOString()],
  );
}

// --- conflits ---------------------------------------------------------------

export type ConflictKind = "SESSION_LOCKED" | "WINDOW_CLOSED" | "STALE";

export interface SyncConflict {
  readonly id: Uuid;
  readonly kind: ConflictKind;
  readonly sessionId: Uuid;
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly clientOpId: Uuid;
  readonly incoming: Record<string, unknown>;
  readonly existing: Record<string, unknown> | null;
  readonly deviceId: string | null;
  readonly submittedBy: Uuid;
  readonly clientMarkedAt: Date | null;
  readonly receivedAt: Date;
  readonly status: "OPEN" | "RESOLVED";
  readonly resolution: "ACCEPT_INCOMING" | "KEEP_EXISTING" | null;
  readonly resolvedBy: Uuid | null;
  readonly resolvedAt: Date | null;
  readonly resolutionNote: string | null;
}

interface ConflictRow {
  id: Uuid; kind: ConflictKind; session_id: Uuid; enrollment_id: Uuid; student_id: Uuid; client_op_id: Uuid;
  incoming: Record<string, unknown>; existing: Record<string, unknown> | null; device_id: string | null; submitted_by: Uuid;
  client_marked_at: Date | null; received_at: Date; status: "OPEN" | "RESOLVED"; resolution: "ACCEPT_INCOMING" | "KEEP_EXISTING" | null;
  resolved_by: Uuid | null; resolved_at: Date | null; resolution_note: string | null;
}
const CONFLICT_COLUMNS = `id, kind, session_id, enrollment_id, student_id, client_op_id, incoming, existing, device_id, submitted_by,
  client_marked_at, received_at, status, resolution, resolved_by, resolved_at, resolution_note`;
const toConflict = (r: ConflictRow): SyncConflict => ({
  id: r.id, kind: r.kind, sessionId: r.session_id, enrollmentId: r.enrollment_id, studentId: r.student_id, clientOpId: r.client_op_id,
  incoming: r.incoming, existing: r.existing, deviceId: r.device_id, submittedBy: r.submitted_by, clientMarkedAt: r.client_marked_at,
  receivedAt: r.received_at, status: r.status, resolution: r.resolution, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, resolutionNote: r.resolution_note,
});

export async function insertConflict(
  tx: Tx,
  c: {
    id: Uuid; tenantId: Uuid; kind: ConflictKind; sessionId: Uuid; enrollmentId: Uuid; studentId: Uuid; clientOpId: Uuid;
    incoming: Record<string, unknown>; existing: Record<string, unknown> | null; deviceId: string | null; submittedBy: Uuid;
    clientMarkedAt: Date | null; receivedAt: Date;
  },
): Promise<SyncConflict> {
  const rows = await tx.many<ConflictRow>(
    `INSERT INTO attendance.sync_conflicts (id, tenant_id, kind, session_id, enrollment_id, student_id, client_op_id, incoming, existing, device_id,
                                            submitted_by, client_marked_at, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13) RETURNING ${CONFLICT_COLUMNS}`,
    [
      c.id, c.tenantId, c.kind, c.sessionId, c.enrollmentId, c.studentId, c.clientOpId, JSON.stringify(c.incoming),
      c.existing ? JSON.stringify(c.existing) : null, c.deviceId, c.submittedBy, c.clientMarkedAt?.toISOString() ?? null, c.receivedAt.toISOString(),
    ],
  );
  return toConflict(rows[0] as ConflictRow);
}

export async function getConflict(tx: Tx, id: Uuid, forUpdate = false): Promise<SyncConflict | null> {
  const r = await tx.queryOne<ConflictRow>(`SELECT ${CONFLICT_COLUMNS} FROM attendance.sync_conflicts WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [id]);
  return r ? toConflict(r) : null;
}

export async function listConflicts(
  tx: Tx,
  f: { status?: "OPEN" | "RESOLVED" | undefined; sessionId?: Uuid | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<{ items: SyncConflict[]; nextCursor: string | null }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.sessionId) { params.push(f.sessionId); where.push(`session_id = $${params.length}`); }
  const cursor = decodeCursor<{ t: string; i: string }>(f.cursor);
  if (cursor) {
    params.push(cursor.t, cursor.i);
    where.push(`(received_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  params.push(limit + 1);
  const rows = await tx.many<ConflictRow>(
    `SELECT ${CONFLICT_COLUMNS} FROM attendance.sync_conflicts ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY received_at, id LIMIT $${params.length}`,
    params,
  );
  const items = rows.slice(0, limit).map(toConflict);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ t: last.receivedAt.toISOString(), i: last.id }) : null };
}

export async function resolveConflictRow(
  tx: Tx,
  id: Uuid,
  r: { resolution: "ACCEPT_INCOMING" | "KEEP_EXISTING"; resolvedBy: Uuid; resolvedAt: Date; note: string | null },
): Promise<SyncConflict> {
  const rows = await tx.many<ConflictRow>(
    `UPDATE attendance.sync_conflicts SET status = 'RESOLVED', resolution = $2, resolved_by = $3, resolved_at = $4, resolution_note = $5
      WHERE id = $1 RETURNING ${CONFLICT_COLUMNS}`,
    [id, r.resolution, r.resolvedBy, r.resolvedAt.toISOString(), r.note],
  );
  return toConflict(rows[0] as ConflictRow);
}
