/**
 * SQL des annonces : annonce, cibles, destinataires (instantané à la publication) et accusés.
 */
import type { Tx } from "@ecoledigitale/database";
import type { AnnouncementStatus, StoredTarget } from "../domain/announcements";
import type { MessagingAudience, MessagingPriority, Uuid } from "../domain/types";

export interface AnnouncementRow {
  id: Uuid;
  title: string;
  body: string;
  priority: MessagingPriority;
  status: AnnouncementStatus;
  authorId: Uuid;
  authorName: string;
  audiences: MessagingAudience[];
  requireAck: boolean;
  pinned: boolean;
  publishAt: Date | null;
  expiresAt: Date | null;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
  withdrawnBy: Uuid | null;
  withdrawalReason: string | null;
  recipientCount: number;
  recipientsTruncated: boolean;
  createdAt: Date;
}

const COLS = `a.id, a.title, a.body, a.priority, a.status, a.author_id AS "authorId", a.author_name AS "authorName", a.audiences,
  a.require_ack AS "requireAck", a.pinned, a.publish_at AS "publishAt", a.expires_at AS "expiresAt", a.published_at AS "publishedAt",
  a.withdrawn_at AS "withdrawnAt", a.withdrawn_by AS "withdrawnBy", a.withdrawal_reason AS "withdrawalReason",
  a.recipient_count AS "recipientCount", a.recipients_truncated AS "recipientsTruncated", a.created_at AS "createdAt"`;

export interface NewAnnouncement {
  id: Uuid;
  title: string;
  body: string;
  priority: MessagingPriority;
  authorId: Uuid;
  authorName: string;
  audiences: readonly MessagingAudience[];
  requireAck: boolean;
  pinned: boolean;
  publishAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export async function insertAnnouncement(tx: Tx, tenantId: Uuid, a: NewAnnouncement): Promise<void> {
  await tx.query(
    `INSERT INTO messaging.announcements (id, tenant_id, title, body, priority, author_id, author_name, audiences, require_ack, pinned, publish_at, expires_at, created_at, updated_at)
     VALUES ($2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
    [tenantId, a.id, a.title, a.body, a.priority, a.authorId, a.authorName, [...a.audiences], a.requireAck, a.pinned, a.publishAt, a.expiresAt, a.createdAt],
  );
}

export async function getAnnouncement(tx: Tx, tenantId: Uuid, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<AnnouncementRow | null> {
  return tx.queryOne<AnnouncementRow>(`SELECT ${COLS} FROM messaging.announcements a WHERE a.tenant_id = $1 AND a.id = $2${options.forUpdate ? " FOR UPDATE" : ""}`, [tenantId, id]);
}

export interface AnnouncementPatch {
  title?: string;
  body?: string;
  priority?: MessagingPriority;
  audiences?: readonly MessagingAudience[];
  requireAck?: boolean;
  pinned?: boolean;
  publishAt?: Date | null;
  expiresAt?: Date | null;
}

export async function patchAnnouncement(tx: Tx, tenantId: Uuid, id: Uuid, p: AnnouncementPatch, now: Date): Promise<void> {
  await tx.query(
    `UPDATE messaging.announcements SET
        title = coalesce($3, title), body = coalesce($4, body), priority = coalesce($5, priority), audiences = coalesce($6::text[], audiences),
        require_ack = coalesce($7, require_ack), pinned = coalesce($8, pinned),
        publish_at = CASE WHEN $9::boolean THEN $10::timestamptz ELSE publish_at END,
        expires_at = CASE WHEN $11::boolean THEN $12::timestamptz ELSE expires_at END,
        updated_at = $13
      WHERE tenant_id = $1 AND id = $2`,
    [
      tenantId,
      id,
      p.title ?? null,
      p.body ?? null,
      p.priority ?? null,
      p.audiences ? [...p.audiences] : null,
      p.requireAck ?? null,
      p.pinned ?? null,
      p.publishAt !== undefined,
      p.publishAt ?? null,
      p.expiresAt !== undefined,
      p.expiresAt ?? null,
      now,
    ],
  );
}

export async function setAnnouncementStatus(
  tx: Tx,
  tenantId: Uuid,
  id: Uuid,
  s: { status: AnnouncementStatus; publishedAt?: Date | null; publishAt?: Date | null; recipientCount?: number; truncated?: boolean; withdrawnAt?: Date | null; withdrawnBy?: Uuid | null; withdrawalReason?: string | null },
  now: Date,
): Promise<void> {
  await tx.query(
    `UPDATE messaging.announcements SET status = $3, published_at = coalesce($4, published_at), publish_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE publish_at END,
        recipient_count = coalesce($7, recipient_count), recipients_truncated = coalesce($8, recipients_truncated),
        withdrawn_at = $9, withdrawn_by = $10, withdrawal_reason = $11, updated_at = $12
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, s.status, s.publishedAt ?? null, s.publishAt !== undefined, s.publishAt ?? null, s.recipientCount ?? null, s.truncated ?? null, s.withdrawnAt ?? null, s.withdrawnBy ?? null, s.withdrawalReason ?? null, now],
  );
}

export async function deleteAnnouncement(tx: Tx, tenantId: Uuid, id: Uuid): Promise<void> {
  await tx.query("DELETE FROM messaging.announcements WHERE tenant_id = $1 AND id = $2", [tenantId, id]);
}

// ---------------------------------------------------------------------------
// Cibles
// ---------------------------------------------------------------------------

export async function replaceTargets(tx: Tx, tenantId: Uuid, announcementId: Uuid, targets: readonly StoredTarget[]): Promise<void> {
  await tx.query("DELETE FROM messaging.announcement_targets WHERE tenant_id = $1 AND announcement_id = $2", [tenantId, announcementId]);
  if (targets.length === 0) return;
  await tx.query(
    `INSERT INTO messaging.announcement_targets (tenant_id, announcement_id, kind, ref)
     SELECT $1, $2, u.kind, u.ref FROM unnest($3::text[], $4::text[]) AS u(kind, ref)`,
    [tenantId, announcementId, targets.map((t) => t.kind), targets.map((t) => t.ref)],
  );
}

export async function listTargets(tx: Tx, tenantId: Uuid, announcementIds: readonly Uuid[]): Promise<Array<{ announcementId: Uuid; kind: StoredTarget["kind"]; ref: string }>> {
  if (announcementIds.length === 0) return [];
  return tx.many(
    `SELECT announcement_id AS "announcementId", kind, ref FROM messaging.announcement_targets
      WHERE tenant_id = $1 AND announcement_id = ANY($2::uuid[]) ORDER BY kind, ref`,
    [tenantId, [...announcementIds]],
  );
}

// ---------------------------------------------------------------------------
// Destinataires et accusés
// ---------------------------------------------------------------------------

export async function insertRecipients(tx: Tx, tenantId: Uuid, announcementId: Uuid, userIds: readonly Uuid[], now: Date): Promise<void> {
  if (userIds.length === 0) return;
  await tx.query(
    `INSERT INTO messaging.announcement_recipients (tenant_id, announcement_id, user_id, delivered_at)
     SELECT $1, $2, u, $4 FROM unnest($3::uuid[]) AS u ON CONFLICT DO NOTHING`,
    [tenantId, announcementId, [...userIds], now],
  );
}

export async function clearRecipients(tx: Tx, tenantId: Uuid, announcementId: Uuid): Promise<void> {
  await tx.query("DELETE FROM messaging.announcement_recipients WHERE tenant_id = $1 AND announcement_id = $2", [tenantId, announcementId]);
}

export async function countRecipients(tx: Tx, tenantId: Uuid, announcementId: Uuid): Promise<number> {
  const row = await tx.queryOne<{ n: number }>("SELECT count(*)::int AS n FROM messaging.announcement_recipients WHERE tenant_id = $1 AND announcement_id = $2", [tenantId, announcementId]);
  return row?.n ?? 0;
}

export interface RecipientState {
  announcementId: Uuid;
  readAt: Date | null;
  acknowledgedAt: Date | null;
}

export async function getRecipientState(tx: Tx, tenantId: Uuid, announcementId: Uuid, userId: Uuid, options: { forUpdate?: boolean } = {}): Promise<RecipientState | null> {
  return tx.queryOne<RecipientState>(
    `SELECT announcement_id AS "announcementId", read_at AS "readAt", acknowledged_at AS "acknowledgedAt"
       FROM messaging.announcement_recipients WHERE tenant_id = $1 AND announcement_id = $2 AND user_id = $3${options.forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId, announcementId, userId],
  );
}

export async function listRecipientStates(tx: Tx, tenantId: Uuid, userId: Uuid, announcementIds: readonly Uuid[]): Promise<RecipientState[]> {
  if (announcementIds.length === 0) return [];
  return tx.many<RecipientState>(
    `SELECT announcement_id AS "announcementId", read_at AS "readAt", acknowledged_at AS "acknowledgedAt"
       FROM messaging.announcement_recipients WHERE tenant_id = $1 AND user_id = $2 AND announcement_id = ANY($3::uuid[])`,
    [tenantId, userId, [...announcementIds]],
  );
}

export async function markRecipientRead(tx: Tx, tenantId: Uuid, announcementId: Uuid, userId: Uuid, now: Date): Promise<void> {
  await tx.query("UPDATE messaging.announcement_recipients SET read_at = coalesce(read_at, $4) WHERE tenant_id = $1 AND announcement_id = $2 AND user_id = $3", [tenantId, announcementId, userId, now]);
}

export async function markRecipientAcknowledged(tx: Tx, tenantId: Uuid, announcementId: Uuid, userId: Uuid, now: Date): Promise<void> {
  await tx.query(
    `UPDATE messaging.announcement_recipients SET read_at = coalesce(read_at, $4), acknowledged_at = coalesce(acknowledged_at, $4)
      WHERE tenant_id = $1 AND announcement_id = $2 AND user_id = $3`,
    [tenantId, announcementId, userId, now],
  );
}

export async function announcementStats(tx: Tx, tenantId: Uuid, announcementIds: readonly Uuid[]): Promise<Array<{ announcementId: Uuid; recipients: number; read: number; acknowledged: number }>> {
  if (announcementIds.length === 0) return [];
  return tx.many(
    `SELECT announcement_id AS "announcementId", count(*)::int AS recipients, count(read_at)::int AS read, count(acknowledged_at)::int AS acknowledged
       FROM messaging.announcement_recipients WHERE tenant_id = $1 AND announcement_id = ANY($2::uuid[]) GROUP BY announcement_id`,
    [tenantId, [...announcementIds]],
  );
}

/** Pastille : annonces publiées, non expirées, non lues. */
export async function countUnreadAnnouncements(tx: Tx, tenantId: Uuid, userId: Uuid, now: Date): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM messaging.announcement_recipients r
       JOIN messaging.announcements a ON a.tenant_id = r.tenant_id AND a.id = r.announcement_id
      WHERE r.tenant_id = $1 AND r.user_id = $2 AND r.read_at IS NULL AND a.status = 'PUBLISHED' AND (a.expires_at IS NULL OR a.expires_at > $3)`,
    [tenantId, userId, now],
  );
  return row?.n ?? 0;
}

export interface InboxAnnouncementQuery {
  includeExpired: boolean;
  unreadOnly: boolean;
  cursor: { t: string; id: Uuid; p: boolean } | null;
  limit: number;
  now: Date;
}

/** Annonces d'un destinataire : épinglées d'abord, puis publication décroissante ; curseur (épinglage, date, identifiant). */
export async function listInboxAnnouncements(tx: Tx, tenantId: Uuid, userId: Uuid, q: InboxAnnouncementQuery): Promise<AnnouncementRow[]> {
  return tx.many<AnnouncementRow>(
    `SELECT ${COLS} FROM messaging.announcement_recipients r
       JOIN messaging.announcements a ON a.tenant_id = r.tenant_id AND a.id = r.announcement_id
      WHERE r.tenant_id = $1 AND r.user_id = $2 AND a.status = 'PUBLISHED'
        AND ($3::boolean OR a.expires_at IS NULL OR a.expires_at > $4)
        AND ($5::boolean IS NOT TRUE OR r.read_at IS NULL)
        AND ($6::timestamptz IS NULL OR (a.pinned, a.published_at, a.id) < ($7::boolean, $6::timestamptz, $8::uuid))
      ORDER BY a.pinned DESC, a.published_at DESC, a.id DESC LIMIT $9`,
    [tenantId, userId, q.includeExpired, q.now, q.unreadOnly, q.cursor?.t ?? null, q.cursor?.p ?? false, q.cursor?.id ?? null, q.limit],
  );
}

export interface ManagedAnnouncementQuery {
  /** `null` = toutes (gestionnaire) ; sinon uniquement celles de cet auteur. */
  authorId: Uuid | null;
  status?: AnnouncementStatus | undefined;
  cursor: { t: string; id: Uuid } | null;
  limit: number;
}

export async function listManagedAnnouncements(tx: Tx, tenantId: Uuid, q: ManagedAnnouncementQuery): Promise<AnnouncementRow[]> {
  return tx.many<AnnouncementRow>(
    `SELECT ${COLS} FROM messaging.announcements a
      WHERE a.tenant_id = $1 AND ($2::uuid IS NULL OR a.author_id = $2) AND ($3::text IS NULL OR a.status = $3)
        AND ($4::timestamptz IS NULL OR (coalesce(a.published_at, a.created_at), a.id) < ($4::timestamptz, $5::uuid))
      ORDER BY coalesce(a.published_at, a.created_at) DESC, a.id DESC LIMIT $6`,
    [tenantId, q.authorId, q.status ?? null, q.cursor?.t ?? null, q.cursor?.id ?? null, q.limit],
  );
}

export interface ReceiptRow {
  userId: Uuid;
  deliveredAt: Date;
  readAt: Date | null;
  acknowledgedAt: Date | null;
}

export async function listReceipts(
  tx: Tx,
  tenantId: Uuid,
  announcementId: Uuid,
  q: { state: "all" | "unread" | "read" | "acknowledged" | "pending_ack"; cursor: { t: string; id: Uuid } | null; limit: number },
): Promise<ReceiptRow[]> {
  return tx.many<ReceiptRow>(
    `SELECT r.user_id AS "userId", r.delivered_at AS "deliveredAt", r.read_at AS "readAt", r.acknowledged_at AS "acknowledgedAt"
       FROM messaging.announcement_recipients r
      WHERE r.tenant_id = $1 AND r.announcement_id = $2
        AND CASE $3 WHEN 'unread' THEN r.read_at IS NULL WHEN 'read' THEN r.read_at IS NOT NULL
                    WHEN 'acknowledged' THEN r.acknowledged_at IS NOT NULL WHEN 'pending_ack' THEN r.acknowledged_at IS NULL ELSE true END
        AND ($4::uuid IS NULL OR r.user_id > $4::uuid)
      ORDER BY r.user_id LIMIT $5`,
    [tenantId, announcementId, q.state, q.cursor?.id ?? null, q.limit],
  );
}

/** Annonces programmées dont l'échéance est atteinte (job). */
export async function listDueScheduled(tx: Tx, tenantId: Uuid, now: Date, limit: number): Promise<AnnouncementRow[]> {
  return tx.many<AnnouncementRow>(
    `SELECT ${COLS} FROM messaging.announcements a WHERE a.tenant_id = $1 AND a.status = 'SCHEDULED' AND a.publish_at <= $2 ORDER BY a.publish_at LIMIT $3 FOR UPDATE SKIP LOCKED`,
    [tenantId, now, limit],
  );
}

export async function listRecipientIds(tx: Tx, tenantId: Uuid, announcementId: Uuid): Promise<Uuid[]> {
  const rows = await tx.many<{ userId: Uuid }>("SELECT user_id AS \"userId\" FROM messaging.announcement_recipients WHERE tenant_id = $1 AND announcement_id = $2 ORDER BY user_id", [tenantId, announcementId]);
  return rows.map((r) => r.userId);
}
