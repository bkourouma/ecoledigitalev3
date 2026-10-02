/**
 * SQL des partages explicites, de l'historique du document (append-only) et de la quarantaine.
 */
import type { Tx } from "@ecoledigitale/database";
import type { DocumentShareLevel, Uuid } from "../domain/types";

// ---------------------------------------------------------------------------
// Partages
// ---------------------------------------------------------------------------

export interface ShareRow {
  id: Uuid;
  documentId: Uuid;
  userId: Uuid;
  level: DocumentShareLevel;
  expiresAt: Date | null;
  note: string | null;
  createdBy: Uuid;
  createdAt: Date;
  revokedAt: Date | null;
}

const SHARE_COLS = `id, document_id AS "documentId", user_id AS "userId", level, expires_at AS "expiresAt", note, created_by AS "createdBy", created_at AS "createdAt", revoked_at AS "revokedAt"`;

export async function listShares(tx: Tx, tenantId: Uuid, documentId: Uuid): Promise<ShareRow[]> {
  return tx.many<ShareRow>(`SELECT ${SHARE_COLS} FROM documents.shares WHERE tenant_id = $1 AND document_id = $2 ORDER BY created_at DESC, id`, [tenantId, documentId]);
}

export async function getShare(tx: Tx, tenantId: Uuid, documentId: Uuid, id: Uuid): Promise<ShareRow | null> {
  return tx.queryOne<ShareRow>(`SELECT ${SHARE_COLS} FROM documents.shares WHERE tenant_id = $1 AND document_id = $2 AND id = $3 FOR UPDATE`, [tenantId, documentId, id]);
}

export async function getActiveShareOfUser(tx: Tx, tenantId: Uuid, documentId: Uuid, userId: Uuid, now: Date): Promise<ShareRow | null> {
  return tx.queryOne<ShareRow>(
    `SELECT ${SHARE_COLS} FROM documents.shares
      WHERE tenant_id = $1 AND document_id = $2 AND user_id = $3 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $4) FOR UPDATE`,
    [tenantId, documentId, userId, now],
  );
}

export async function insertShare(tx: Tx, tenantId: Uuid, s: { id: Uuid; documentId: Uuid; userId: Uuid; level: DocumentShareLevel; expiresAt: Date | null; note: string | null; createdBy: Uuid }, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.shares (id, tenant_id, document_id, user_id, level, expires_at, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [s.id, tenantId, s.documentId, s.userId, s.level, s.expiresAt, s.note, s.createdBy, now],
  );
}

/** Retire les partages ACTIFS ou expirés mais non marqués d'une personne (un partage périmé laisse la place à un nouveau). */
export async function revokeStaleShares(tx: Tx, tenantId: Uuid, documentId: Uuid, userId: Uuid, by: Uuid, now: Date): Promise<void> {
  await tx.query(
    `UPDATE documents.shares SET revoked_at = $4, revoked_by = $5 WHERE tenant_id = $1 AND document_id = $2 AND user_id = $3 AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= $4`,
    [tenantId, documentId, userId, now, by],
  );
}

export async function revokeShare(tx: Tx, tenantId: Uuid, id: Uuid, by: Uuid, now: Date): Promise<void> {
  await tx.query(`UPDATE documents.shares SET revoked_at = $3, revoked_by = $4 WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`, [tenantId, id, now, by]);
}

// ---------------------------------------------------------------------------
// Historique du document
// ---------------------------------------------------------------------------

export interface HistoryRow {
  id: Uuid;
  action: string;
  versionNo: number | null;
  actorId: Uuid | null;
  occurredAt: Date;
  detail: Record<string, unknown>;
}

export async function insertHistory(tx: Tx, tenantId: Uuid, e: { id: Uuid; documentId: Uuid; versionNo?: number | null; action: string; actorId: Uuid | null; detail?: Record<string, unknown> }, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.document_events (id, tenant_id, document_id, version_no, action, actor_id, occurred_at, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [e.id, tenantId, e.documentId, e.versionNo ?? null, e.action, e.actorId, now, JSON.stringify(e.detail ?? {})],
  );
}

export async function listHistory(tx: Tx, tenantId: Uuid, documentId: Uuid, cursor: { at: string; id: Uuid } | null, limit: number): Promise<HistoryRow[]> {
  return tx.many<HistoryRow>(
    `SELECT id, action, version_no AS "versionNo", actor_id AS "actorId", occurred_at AS "occurredAt", detail
       FROM documents.document_events
      WHERE tenant_id = $1 AND document_id = $2 AND ($3::timestamptz IS NULL OR (occurred_at, id) < ($3::timestamptz, $4::uuid))
      ORDER BY occurred_at DESC, id DESC LIMIT $5`,
    [tenantId, documentId, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
  );
}

// ---------------------------------------------------------------------------
// Quarantaine
// ---------------------------------------------------------------------------

export interface QuarantineRow {
  id: Uuid;
  status: "HELD" | "RELEASED" | "DELETED";
  storageKey: string;
  fileName: string;
  extension: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  signature: string;
  engine: string;
  intent: QuarantineIntent;
  uploadedBy: Uuid;
  createdAt: Date;
  decidedBy: Uuid | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  releasedDocumentId: Uuid | null;
}

/** Ce que l'upload voulait faire (rejoué à la libération). Les descripteurs sont ceux déjà validés au dépôt. */
export type QuarantineIntent =
  | { mode: "CREATE"; fields: Record<string, unknown> }
  | { mode: "VERSION"; documentId: Uuid; fields: Record<string, unknown> };

type RawQuarantine = Omit<QuarantineRow, "sizeBytes"> & { sizeBytes: string };

const Q_COLS = `id, status, storage_key AS "storageKey", file_name AS "fileName", extension, detected_mime AS "mime", size_bytes::text AS "sizeBytes", sha256,
  signature, engine, intent, uploaded_by AS "uploadedBy", created_at AS "createdAt", decided_by AS "decidedBy", decided_at AS "decidedAt",
  decision_note AS "decisionNote", released_document_id AS "releasedDocumentId"`;

const toQuarantine = (r: RawQuarantine): QuarantineRow => ({ ...r, sizeBytes: Number(r.sizeBytes) });

export async function insertQuarantine(tx: Tx, tenantId: Uuid, q: Omit<QuarantineRow, "status" | "createdAt" | "decidedBy" | "decidedAt" | "decisionNote" | "releasedDocumentId">, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO documents.quarantine (id, tenant_id, storage_key, file_name, extension, detected_mime, size_bytes, sha256, signature, engine, intent, uploaded_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`,
    [q.id, tenantId, q.storageKey, q.fileName, q.extension, q.mime, q.sizeBytes, q.sha256, q.signature, q.engine, JSON.stringify(q.intent), q.uploadedBy, now],
  );
}

export async function listQuarantine(tx: Tx, tenantId: Uuid, status: string | null, cursor: { at: string; id: Uuid } | null, limit: number): Promise<QuarantineRow[]> {
  const rows = await tx.many<RawQuarantine>(
    `SELECT ${Q_COLS} FROM documents.quarantine
      WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2) AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
      ORDER BY created_at DESC, id DESC LIMIT $5`,
    [tenantId, status, cursor?.at ?? null, cursor?.id ?? null, limit + 1],
  );
  return rows.map(toQuarantine);
}

export async function getQuarantine(tx: Tx, tenantId: Uuid, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<QuarantineRow | null> {
  const row = await tx.queryOne<RawQuarantine>(`SELECT ${Q_COLS} FROM documents.quarantine WHERE tenant_id = $1 AND id = $2${options.forUpdate ? " FOR UPDATE" : ""}`, [tenantId, id]);
  return row ? toQuarantine(row) : null;
}

export async function decideQuarantine(tx: Tx, tenantId: Uuid, id: Uuid, d: { status: "RELEASED" | "DELETED"; by: Uuid | null; note: string; releasedDocumentId?: Uuid | null }, now: Date): Promise<void> {
  await tx.query(
    `UPDATE documents.quarantine SET status = $3, decided_by = $4, decided_at = $5, decision_note = $6, released_document_id = $7 WHERE tenant_id = $1 AND id = $2 AND status = 'HELD'`,
    [tenantId, id, d.status, d.by, now, d.note, d.releasedDocumentId ?? null],
  );
}

export async function countHeldQuarantine(tx: Tx, tenantId: Uuid): Promise<number> {
  const r = await tx.queryOne<{ n: string }>(`SELECT count(*)::text AS n FROM documents.quarantine WHERE tenant_id = $1 AND status = 'HELD'`, [tenantId]);
  return Number(r?.n ?? 0);
}

/** Fichiers HELD plus anciens que la rétention (job). */
export async function listExpiredQuarantine(tx: Tx, tenantId: Uuid, before: Date, limit: number): Promise<QuarantineRow[]> {
  const rows = await tx.many<RawQuarantine>(`SELECT ${Q_COLS} FROM documents.quarantine WHERE tenant_id = $1 AND status = 'HELD' AND created_at <= $2 ORDER BY created_at LIMIT $3`, [tenantId, before, limit]);
  return rows.map(toQuarantine);
}
