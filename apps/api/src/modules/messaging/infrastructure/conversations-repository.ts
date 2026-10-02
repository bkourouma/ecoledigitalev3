/**
 * SQL des conversations, participants, messages et pièces jointes. Une fonction par requête, SQL paramétré, `Tx` reçu.
 * Les `bigint` (seq) sont convertis en `int` en SQL (un fil n'atteint jamais 2^31 messages). Les insertions de masse
 * (diffusions) passent par `unnest` : une requête par table, jamais une par destinataire.
 */
import type { Tx } from "@ecoledigitale/database";
import type { MessagingPriority, Uuid } from "../domain/types";

export interface ConversationRow {
  id: Uuid;
  kind: "DIRECT" | "GROUP" | "SYSTEM";
  subject: string | null;
  priority: MessagingPriority;
  broadcastId: Uuid | null;
  createdBy: Uuid | null;
  aboutStudentId: Uuid | null;
  classroomId: Uuid | null;
  directKey: string | null;
  allowReplies: boolean;
  closedAt: Date | null;
  lastSeq: number;
  lastMessageAt: Date | null;
  lastPreview: string | null;
  createdAt: Date;
}

const CONV_COLS = `c.id, c.kind, c.subject, c.priority, c.broadcast_id AS "broadcastId", c.created_by AS "createdBy",
  c.about_student_id AS "aboutStudentId", c.classroom_id AS "classroomId", c.direct_key AS "directKey",
  c.allow_replies AS "allowReplies", c.closed_at AS "closedAt", c.last_seq::int AS "lastSeq",
  c.last_message_at AS "lastMessageAt", c.last_preview AS "lastPreview", c.created_at AS "createdAt"`;

export interface NewConversation {
  id: Uuid;
  kind: "DIRECT" | "GROUP" | "SYSTEM";
  subject: string | null;
  priority: MessagingPriority;
  broadcastId: Uuid | null;
  createdBy: Uuid | null;
  aboutStudentId: Uuid | null;
  classroomId: Uuid | null;
  directKey: string | null;
  allowReplies: boolean;
  createdAt: Date;
}

/** Insère des conversations ; une clé de fil direct déjà prise (course) n'est pas insérée et n'est pas renvoyée. */
export async function insertConversations(tx: Tx, tenantId: Uuid, rows: readonly NewConversation[]): Promise<Array<{ id: Uuid; directKey: string | null }>> {
  if (rows.length === 0) return [];
  return tx.many<{ id: Uuid; directKey: string | null }>(
    `INSERT INTO messaging.conversations (id, tenant_id, kind, subject, priority, broadcast_id, created_by, about_student_id, classroom_id, direct_key, allow_replies, created_at, updated_at)
     SELECT u.id, $1, u.kind, u.subject, u.priority, u.broadcast_id, u.created_by, u.about_student_id, u.classroom_id, u.direct_key, u.allow_replies, u.created_at, u.created_at
       FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::uuid[], $7::uuid[], $8::uuid[], $9::uuid[], $10::text[], $11::boolean[], $12::timestamptz[])
            AS u(id, kind, subject, priority, broadcast_id, created_by, about_student_id, classroom_id, direct_key, allow_replies, created_at)
     ON CONFLICT (tenant_id, direct_key) DO NOTHING
     RETURNING id, direct_key AS "directKey"`,
    [
      tenantId,
      rows.map((r) => r.id),
      rows.map((r) => r.kind),
      rows.map((r) => r.subject),
      rows.map((r) => r.priority),
      rows.map((r) => r.broadcastId),
      rows.map((r) => r.createdBy),
      rows.map((r) => r.aboutStudentId),
      rows.map((r) => r.classroomId),
      rows.map((r) => r.directKey),
      rows.map((r) => r.allowReplies),
      rows.map((r) => r.createdAt),
    ],
  );
}

export async function findConversationsByKeys(tx: Tx, tenantId: Uuid, keys: readonly string[]): Promise<ConversationRow[]> {
  if (keys.length === 0) return [];
  return tx.many<ConversationRow>(`SELECT ${CONV_COLS} FROM messaging.conversations c WHERE c.tenant_id = $1 AND c.direct_key = ANY($2::text[])`, [tenantId, [...keys]]);
}

export async function getConversation(tx: Tx, tenantId: Uuid, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<ConversationRow | null> {
  return tx.queryOne<ConversationRow>(`SELECT ${CONV_COLS} FROM messaging.conversations c WHERE c.tenant_id = $1 AND c.id = $2${options.forUpdate ? " FOR UPDATE" : ""}`, [tenantId, id]);
}

export async function touchConversation(tx: Tx, tenantId: Uuid, id: Uuid, input: { seq: number; at: Date; preview: string | null }): Promise<void> {
  await tx.query(
    "UPDATE messaging.conversations SET last_seq = $3, last_message_at = $4, last_preview = $5, updated_at = $4 WHERE tenant_id = $1 AND id = $2",
    [tenantId, id, input.seq, input.at, input.preview],
  );
}

export async function setConversationPreview(tx: Tx, tenantId: Uuid, id: Uuid, preview: string | null): Promise<void> {
  await tx.query("UPDATE messaging.conversations SET last_preview = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2", [tenantId, id, preview]);
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export interface ParticipantRow {
  conversationId: Uuid;
  userId: Uuid;
  role: "OWNER" | "MEMBER";
  displayName: string;
  lastReadSeq: number;
  lastReadAt: Date | null;
  archivedAt: Date | null;
  muted: boolean;
  starred: boolean;
  leftAt: Date | null;
}

const PART_COLS = `p.conversation_id AS "conversationId", p.user_id AS "userId", p.role, p.display_name AS "displayName",
  p.last_read_seq::int AS "lastReadSeq", p.last_read_at AS "lastReadAt", p.archived_at AS "archivedAt", p.muted, p.starred, p.left_at AS "leftAt"`;

export interface NewParticipant {
  conversationId: Uuid;
  userId: Uuid;
  role: "OWNER" | "MEMBER";
  displayName: string;
  addedAt: Date;
  lastReadSeq: number;
  lastReadAt: Date | null;
  archivedAt: Date | null;
}

export async function insertParticipants(tx: Tx, tenantId: Uuid, rows: readonly NewParticipant[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.query(
    `INSERT INTO messaging.conversation_participants (tenant_id, conversation_id, user_id, role, display_name, added_at, last_read_seq, last_read_at, archived_at)
     SELECT $1, u.conversation_id, u.user_id, u.role, u.display_name, u.added_at, u.last_read_seq, u.last_read_at, u.archived_at
       FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::timestamptz[], $7::bigint[], $8::timestamptz[], $9::timestamptz[])
            AS u(conversation_id, user_id, role, display_name, added_at, last_read_seq, last_read_at, archived_at)
     ON CONFLICT DO NOTHING`,
    [
      tenantId,
      rows.map((r) => r.conversationId),
      rows.map((r) => r.userId),
      rows.map((r) => r.role),
      rows.map((r) => r.displayName),
      rows.map((r) => r.addedAt),
      rows.map((r) => r.lastReadSeq),
      rows.map((r) => r.lastReadAt),
      rows.map((r) => r.archivedAt),
    ],
  );
}

export async function listParticipants(tx: Tx, tenantId: Uuid, conversationId: Uuid): Promise<ParticipantRow[]> {
  return tx.many<ParticipantRow>(
    `SELECT ${PART_COLS} FROM messaging.conversation_participants p WHERE p.tenant_id = $1 AND p.conversation_id = $2 ORDER BY p.added_at, p.user_id`,
    [tenantId, conversationId],
  );
}

export async function getParticipant(tx: Tx, tenantId: Uuid, conversationId: Uuid, userId: Uuid): Promise<ParticipantRow | null> {
  return tx.queryOne<ParticipantRow>(
    `SELECT ${PART_COLS} FROM messaging.conversation_participants p WHERE p.tenant_id = $1 AND p.conversation_id = $2 AND p.user_id = $3`,
    [tenantId, conversationId, userId],
  );
}

/** Marque lu jusqu'à `seq` (jamais en arrière). */
export async function markRead(tx: Tx, tenantId: Uuid, conversationId: Uuid, userId: Uuid, seq: number, at: Date): Promise<void> {
  await tx.query(
    `UPDATE messaging.conversation_participants SET last_read_seq = greatest(last_read_seq, $4), last_read_at = $5
      WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3`,
    [tenantId, conversationId, userId, seq, at],
  );
}

/** Un nouveau message désarchive le fil des AUTRES participants. */
export async function unarchiveOthers(tx: Tx, tenantId: Uuid, conversationId: Uuid, exceptUserId: Uuid): Promise<void> {
  await tx.query(
    "UPDATE messaging.conversation_participants SET archived_at = NULL WHERE tenant_id = $1 AND conversation_id = $2 AND user_id <> $3 AND archived_at IS NOT NULL AND left_at IS NULL",
    [tenantId, conversationId, exceptUserId],
  );
}

export async function updateParticipantState(
  tx: Tx,
  tenantId: Uuid,
  conversationId: Uuid,
  userId: Uuid,
  patch: { archived?: boolean | undefined; muted?: boolean | undefined; starred?: boolean | undefined },
  now: Date,
): Promise<void> {
  await tx.query(
    `UPDATE messaging.conversation_participants
        SET archived_at = CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN coalesce(archived_at, $7) ELSE NULL END,
            muted = coalesce($5::boolean, muted),
            starred = coalesce($6::boolean, starred)
      WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3`,
    [tenantId, conversationId, userId, patch.archived ?? null, patch.muted ?? null, patch.starred ?? null, now],
  );
}

export async function leaveConversation(tx: Tx, tenantId: Uuid, conversationId: Uuid, userId: Uuid, now: Date): Promise<void> {
  await tx.query(
    "UPDATE messaging.conversation_participants SET left_at = $4 WHERE tenant_id = $1 AND conversation_id = $2 AND user_id = $3 AND left_at IS NULL",
    [tenantId, conversationId, userId, now],
  );
}

export async function countActiveParticipants(tx: Tx, tenantId: Uuid, conversationId: Uuid): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM messaging.conversation_participants WHERE tenant_id = $1 AND conversation_id = $2 AND left_at IS NULL",
    [tenantId, conversationId],
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Listes de la boîte
// ---------------------------------------------------------------------------

export interface InboxRow extends ConversationRow {
  lastReadSeq: number;
  archivedAt: Date | null;
  muted: boolean;
  starred: boolean;
  /** Diffusion (dossier « envoyés » : une ligne par diffusion) : nombre de fils. */
  broadcastCount: number | null;
}

export interface InboxQuery {
  folder: "inbox" | "archived" | "starred" | "sent";
  q?: string | undefined;
  unreadOnly?: boolean | undefined;
  cursor?: { t: string; id: Uuid } | null;
  limit: number;
}

/** Une page de la boîte d'un utilisateur : tri par dernier message décroissant, curseur (date, identifiant). */
export async function listInbox(tx: Tx, tenantId: Uuid, userId: Uuid, query: InboxQuery): Promise<InboxRow[]> {
  const params: unknown[] = [tenantId, userId];
  const where: string[] = ["p.tenant_id = $1", "p.user_id = $2", "p.left_at IS NULL"];
  switch (query.folder) {
    case "inbox":
      where.push("p.archived_at IS NULL");
      break;
    case "archived":
      where.push("p.archived_at IS NOT NULL");
      break;
    case "starred":
      where.push("p.starred");
      break;
    case "sent":
      where.push("c.created_by = $2");
      break;
  }
  if (query.unreadOnly) where.push("c.last_seq > p.last_read_seq");
  if (query.q) {
    params.push(query.q);
    where.push(
      `(messaging.normalize_search(coalesce(c.subject, '')) LIKE '%' || messaging.normalize_search($${params.length}) || '%'
        OR EXISTS (SELECT 1 FROM messaging.conversation_participants o WHERE o.tenant_id = c.tenant_id AND o.conversation_id = c.id AND o.user_id <> $2
                    AND messaging.normalize_search(o.display_name) LIKE '%' || messaging.normalize_search($${params.length}) || '%'))`,
    );
  }
  const sortKey = "coalesce(c.last_message_at, c.created_at)";
  if (query.cursor) {
    params.push(query.cursor.t, query.cursor.id);
    where.push(`(${sortKey}, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  params.push(query.limit);
  const limitParam = `$${params.length}`;
  const base = `SELECT ${CONV_COLS}, p.last_read_seq::int AS "lastReadSeq", p.archived_at AS "archivedAt", p.muted, p.starred,
         CASE WHEN c.broadcast_id IS NULL THEN NULL
              ELSE (SELECT count(*)::int FROM messaging.conversations b WHERE b.tenant_id = c.tenant_id AND b.broadcast_id = c.broadcast_id) END AS "broadcastCount"
    FROM messaging.conversation_participants p
    JOIN messaging.conversations c ON c.tenant_id = p.tenant_id AND c.id = p.conversation_id
   WHERE ${where.join(" AND ")}`;
  if (query.folder === "sent") {
    // Une ligne par diffusion : on garde le fil le plus récent de chaque envoi.
    return tx.many<InboxRow>(
      `SELECT * FROM (
         SELECT DISTINCT ON (coalesce(s."broadcastId", s.id)) s.*
           FROM (${base}) s
          ORDER BY coalesce(s."broadcastId", s.id), coalesce(s."lastMessageAt", s."createdAt") DESC, s.id DESC
       ) d ORDER BY coalesce(d."lastMessageAt", d."createdAt") DESC, d.id DESC LIMIT ${limitParam}`,
      params,
    );
  }
  return tx.many<InboxRow>(`${base} ORDER BY ${sortKey} DESC, c.id DESC LIMIT ${limitParam}`, params);
}

/** Une conversation vue par UN participant (sans filtre de dossier) ; `null` s'il n'y participe plus ou pas du tout. */
export async function getInboxRow(tx: Tx, tenantId: Uuid, userId: Uuid, conversationId: Uuid): Promise<InboxRow | null> {
  return tx.queryOne<InboxRow>(
    `SELECT ${CONV_COLS}, p.last_read_seq::int AS "lastReadSeq", p.archived_at AS "archivedAt", p.muted, p.starred,
            CASE WHEN c.broadcast_id IS NULL THEN NULL
                 ELSE (SELECT count(*)::int FROM messaging.conversations b WHERE b.tenant_id = c.tenant_id AND b.broadcast_id = c.broadcast_id) END AS "broadcastCount"
       FROM messaging.conversation_participants p
       JOIN messaging.conversations c ON c.tenant_id = p.tenant_id AND c.id = p.conversation_id
      WHERE p.tenant_id = $1 AND p.user_id = $2 AND p.conversation_id = $3 AND p.left_at IS NULL`,
    [tenantId, userId, conversationId],
  );
}

/**
 * Diffusion avec pièces jointes : chaque fil privé reçoit sa PROPRE ligne de pièce (même objet de stockage, même empreinte).
 * Les pièces ne sont jamais supprimées une fois liées : l'objet partagé n'est donc jamais orphelin.
 */
export async function insertAttachmentClones(tx: Tx, tenantId: Uuid, sourceIds: readonly Uuid[], messageIds: ReadonlyArray<{ messageId: Uuid; newIds: readonly Uuid[] }>, at: Date): Promise<void> {
  if (sourceIds.length === 0 || messageIds.length === 0) return;
  const pairs = messageIds.flatMap((m) => sourceIds.map((s, i) => ({ source: s, messageId: m.messageId, id: m.newIds[i]! })));
  await tx.query(
    `INSERT INTO messaging.attachments (id, tenant_id, uploaded_by, message_id, storage_key, file_name, detected_mime, size_bytes, sha256, uploaded_at, bound_at)
     SELECT u.id, a.tenant_id, a.uploaded_by, u.message_id, a.storage_key, a.file_name, a.detected_mime, a.size_bytes, a.sha256, a.uploaded_at, $2
       FROM unnest($3::uuid[], $4::uuid[], $5::uuid[]) AS u(id, message_id, source_id)
       JOIN messaging.attachments a ON a.tenant_id = $1 AND a.id = u.source_id`,
    [tenantId, at, pairs.map((p) => p.id), pairs.map((p) => p.messageId), pairs.map((p) => p.source)],
  );
}

export interface ParticipantBrief {
  conversationId: Uuid;
  userId: Uuid;
  role: "OWNER" | "MEMBER";
  displayName: string;
  left: boolean;
  total: number;
}

/** Au plus 6 AUTRES participants par fil (affichage de la liste) et le nombre total d'autres participants actifs. */
export async function listParticipantBriefs(tx: Tx, tenantId: Uuid, conversationIds: readonly Uuid[], exceptUserId: Uuid): Promise<ParticipantBrief[]> {
  if (conversationIds.length === 0) return [];
  return tx.many<ParticipantBrief>(
    `SELECT t."conversationId", t."userId", t.role, t."displayName", t.left, t.total FROM (
       SELECT p.conversation_id AS "conversationId", p.user_id AS "userId", p.role, p.display_name AS "displayName", (p.left_at IS NOT NULL) AS left,
              row_number() OVER (PARTITION BY p.conversation_id ORDER BY p.added_at, p.user_id) AS rn,
              (count(*) OVER (PARTITION BY p.conversation_id))::int AS total
         FROM messaging.conversation_participants p
        WHERE p.tenant_id = $1 AND p.conversation_id = ANY($2::uuid[]) AND p.user_id <> $3 AND p.left_at IS NULL
     ) t WHERE t.rn <= 6 ORDER BY t."conversationId", t.rn`,
    [tenantId, [...conversationIds], exceptUserId],
  );
}

/** Pastille de la boîte : fils non lus (hors archivés, en sourdine ou quittés). */
export async function countUnreadConversations(tx: Tx, tenantId: Uuid, userId: Uuid): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM messaging.conversation_participants p
       JOIN messaging.conversations c ON c.tenant_id = p.tenant_id AND c.id = p.conversation_id
      WHERE p.tenant_id = $1 AND p.user_id = $2 AND p.left_at IS NULL AND p.archived_at IS NULL AND NOT p.muted AND c.last_seq > p.last_read_seq`,
    [tenantId, userId],
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface MessageRow {
  id: Uuid;
  conversationId: Uuid;
  seq: number;
  kind: "USER" | "SYSTEM";
  senderId: Uuid | null;
  senderName: string | null;
  body: string;
  systemCode: string | null;
  broadcastId: Uuid | null;
  clientId: Uuid | null;
  createdAt: Date;
  removedAt: Date | null;
  removedBy: Uuid | null;
  removalKind: "SENDER" | "MODERATOR" | null;
  removalReason: string | null;
}

const MSG_COLS = `m.id, m.conversation_id AS "conversationId", m.seq::int AS seq, m.kind, m.sender_id AS "senderId", m.sender_name AS "senderName",
  m.body, m.system_code AS "systemCode", m.broadcast_id AS "broadcastId", m.client_id AS "clientId", m.created_at AS "createdAt",
  m.removed_at AS "removedAt", m.removed_by AS "removedBy", m.removal_kind AS "removalKind", m.removal_reason AS "removalReason"`;

export interface NewMessage {
  id: Uuid;
  conversationId: Uuid;
  seq: number;
  kind: "USER" | "SYSTEM";
  senderId: Uuid | null;
  senderName: string | null;
  body: string;
  systemCode?: string | null;
  systemPayload?: Record<string, unknown> | null;
  broadcastId?: Uuid | null;
  clientId?: Uuid | null;
  dedupeKey?: string | null;
  createdAt: Date;
}

/** Insère des messages ; un `client_id` / `dedupe_key` déjà vu n'est pas réinséré (idempotence) et n'est pas renvoyé. */
export async function insertMessages(tx: Tx, tenantId: Uuid, rows: readonly NewMessage[]): Promise<Uuid[]> {
  if (rows.length === 0) return [];
  const inserted = await tx.many<{ id: Uuid }>(
    `INSERT INTO messaging.messages (id, tenant_id, conversation_id, seq, kind, sender_id, sender_name, body, system_code, system_payload, broadcast_id, client_id, dedupe_key, created_at)
     SELECT u.id, $1, u.conversation_id, u.seq, u.kind, u.sender_id, u.sender_name, u.body, u.system_code, u.system_payload::jsonb, u.broadcast_id, u.client_id, u.dedupe_key, u.created_at
       FROM unnest($2::uuid[], $3::uuid[], $4::bigint[], $5::text[], $6::uuid[], $7::text[], $8::text[], $9::text[], $10::text[], $11::uuid[], $12::uuid[], $13::text[], $14::timestamptz[])
            AS u(id, conversation_id, seq, kind, sender_id, sender_name, body, system_code, system_payload, broadcast_id, client_id, dedupe_key, created_at)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      tenantId,
      rows.map((r) => r.id),
      rows.map((r) => r.conversationId),
      rows.map((r) => r.seq),
      rows.map((r) => r.kind),
      rows.map((r) => r.senderId),
      rows.map((r) => r.senderName),
      rows.map((r) => r.body),
      rows.map((r) => r.systemCode ?? null),
      rows.map((r) => (r.systemPayload ? JSON.stringify(r.systemPayload) : null)),
      rows.map((r) => r.broadcastId ?? null),
      rows.map((r) => r.clientId ?? null),
      rows.map((r) => r.dedupeKey ?? null),
      rows.map((r) => r.createdAt),
    ],
  );
  return inserted.map((r) => r.id);
}

export async function findMessageByClientId(tx: Tx, tenantId: Uuid, conversationId: Uuid, senderId: Uuid, clientId: Uuid): Promise<MessageRow | null> {
  return tx.queryOne<MessageRow>(
    `SELECT ${MSG_COLS} FROM messaging.messages m WHERE m.tenant_id = $1 AND m.conversation_id = $2 AND m.sender_id = $3 AND m.client_id = $4`,
    [tenantId, conversationId, senderId, clientId],
  );
}

export async function findMessageByDedupeKey(tx: Tx, tenantId: Uuid, conversationId: Uuid, dedupeKey: string): Promise<MessageRow | null> {
  return tx.queryOne<MessageRow>(
    `SELECT ${MSG_COLS} FROM messaging.messages m WHERE m.tenant_id = $1 AND m.conversation_id = $2 AND m.dedupe_key = $3`,
    [tenantId, conversationId, dedupeKey],
  );
}

/** Une diffusion déjà envoyée avec ce `client_id` (réessai du client) : un message suffit à la reconnaître. */
export async function findBroadcastByClientId(tx: Tx, tenantId: Uuid, senderId: Uuid, clientId: Uuid): Promise<{ broadcastId: Uuid; count: number } | null> {
  return tx.queryOne<{ broadcastId: Uuid; count: number }>(
    `SELECT m.broadcast_id AS "broadcastId", count(*)::int AS count FROM messaging.messages m
      WHERE m.tenant_id = $1 AND m.sender_id = $2 AND m.client_id = $3 AND m.broadcast_id IS NOT NULL GROUP BY m.broadcast_id LIMIT 1`,
    [tenantId, senderId, clientId],
  );
}

/** Messages déjà envoyés par cet expéditeur avec ce `client_id` depuis `since` (rejeu d'un envoi, tous fils confondus). */
export async function findMessagesByClientId(tx: Tx, tenantId: Uuid, senderId: Uuid, clientId: Uuid, since: Date): Promise<Array<{ id: Uuid; conversationId: Uuid; broadcastId: Uuid | null }>> {
  return tx.many(
    `SELECT id, conversation_id AS "conversationId", broadcast_id AS "broadcastId" FROM messaging.messages
      WHERE tenant_id = $1 AND sender_id = $2 AND client_id = $3 AND created_at > $4 ORDER BY created_at LIMIT 5000`,
    [tenantId, senderId, clientId, since],
  );
}

/** Rattache un fil existant à une diffusion (sans écraser une diffusion antérieure). */
export async function setBroadcastIdIfNull(tx: Tx, tenantId: Uuid, conversationId: Uuid, broadcastId: Uuid): Promise<void> {
  await tx.query("UPDATE messaging.conversations SET broadcast_id = coalesce(broadcast_id, $3) WHERE tenant_id = $1 AND id = $2", [tenantId, conversationId, broadcastId]);
}

export async function getMessage(tx: Tx, tenantId: Uuid, id: Uuid): Promise<MessageRow | null> {
  return tx.queryOne<MessageRow>(`SELECT ${MSG_COLS} FROM messaging.messages m WHERE m.tenant_id = $1 AND m.id = $2`, [tenantId, id]);
}

/** Page de messages en ordre DÉCROISSANT de `seq` (l'appelant inverse pour l'affichage). */
export async function listMessages(tx: Tx, tenantId: Uuid, conversationId: Uuid, input: { before?: number | undefined; limit: number }): Promise<MessageRow[]> {
  return tx.many<MessageRow>(
    `SELECT ${MSG_COLS} FROM messaging.messages m
      WHERE m.tenant_id = $1 AND m.conversation_id = $2 AND ($3::bigint IS NULL OR m.seq < $3)
      ORDER BY m.seq DESC LIMIT $4`,
    [tenantId, conversationId, input.before ?? null, input.limit],
  );
}

/** Voisins d'un message (contexte de modération) : `radius` avant et après. */
export async function listMessagesAround(tx: Tx, tenantId: Uuid, conversationId: Uuid, seq: number, radius: number): Promise<MessageRow[]> {
  return tx.many<MessageRow>(
    `SELECT ${MSG_COLS} FROM messaging.messages m
      WHERE m.tenant_id = $1 AND m.conversation_id = $2 AND m.seq BETWEEN $3 AND $4 ORDER BY m.seq`,
    [tenantId, conversationId, Math.max(1, seq - radius), seq + radius],
  );
}

export async function lastVisibleMessage(tx: Tx, tenantId: Uuid, conversationId: Uuid): Promise<{ body: string; createdAt: Date } | null> {
  return tx.queryOne<{ body: string; createdAt: Date }>(
    `SELECT m.body, m.created_at AS "createdAt" FROM messaging.messages m
      WHERE m.tenant_id = $1 AND m.conversation_id = $2 AND m.removed_at IS NULL ORDER BY m.seq DESC LIMIT 1`,
    [tenantId, conversationId],
  );
}

export async function markMessageRemoved(tx: Tx, tenantId: Uuid, id: Uuid, input: { by: Uuid; kind: "SENDER" | "MODERATOR"; reason: string | null; at: Date }): Promise<boolean> {
  const rows = await tx.many<{ id: Uuid }>(
    `UPDATE messaging.messages SET removed_at = $3, removed_by = $4, removal_kind = $5, removal_reason = $6
      WHERE tenant_id = $1 AND id = $2 AND removed_at IS NULL RETURNING id`,
    [tenantId, id, input.at, input.by, input.kind, input.reason],
  );
  return rows.length > 0;
}

export interface SearchHitRow {
  conversationId: Uuid;
  messageId: Uuid;
  seq: number;
  subject: string | null;
  senderName: string | null;
  body: string;
  createdAt: Date;
}

/** Recherche dans les fils DU DEMANDEUR seulement (jointure sur ses participations), messages non retirés. */
export async function searchMessages(tx: Tx, tenantId: Uuid, userId: Uuid, query: string, limit: number): Promise<SearchHitRow[]> {
  return tx.many<SearchHitRow>(
    `SELECT m.conversation_id AS "conversationId", m.id AS "messageId", m.seq::int AS seq, c.subject, m.sender_name AS "senderName", m.body, m.created_at AS "createdAt"
       FROM messaging.conversation_participants p
       JOIN messaging.messages m ON m.tenant_id = p.tenant_id AND m.conversation_id = p.conversation_id
       JOIN messaging.conversations c ON c.tenant_id = m.tenant_id AND c.id = m.conversation_id
      WHERE p.tenant_id = $1 AND p.user_id = $2 AND p.left_at IS NULL AND m.removed_at IS NULL
        AND m.search_text LIKE '%' || messaging.normalize_search($3) || '%'
      ORDER BY m.created_at DESC, m.id DESC LIMIT $4`,
    [tenantId, userId, query, limit],
  );
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

/** Envois de l'expéditeur depuis `since` (une diffusion compte pour UN envoi). */
export async function countRecentSends(tx: Tx, tenantId: Uuid, senderId: Uuid, since: Date): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    "SELECT count(DISTINCT coalesce(broadcast_id, id))::int AS n FROM messaging.messages WHERE tenant_id = $1 AND sender_id = $2 AND created_at > $3",
    [tenantId, senderId, since],
  );
  return row?.n ?? 0;
}

/** Conversations ouvertes par l'utilisateur depuis `since` (une diffusion compte pour UNE conversation). */
export async function countRecentConversations(tx: Tx, tenantId: Uuid, userId: Uuid, since: Date): Promise<number> {
  const row = await tx.queryOne<{ n: number }>(
    "SELECT count(DISTINCT coalesce(broadcast_id, id))::int AS n FROM messaging.conversations WHERE tenant_id = $1 AND created_by = $2 AND kind <> 'SYSTEM' AND created_at > $3",
    [tenantId, userId, since],
  );
  return row?.n ?? 0;
}

/** Date du plus ancien envoi de la fenêtre (calcul du `Retry-After`). */
export async function oldestSendSince(tx: Tx, tenantId: Uuid, senderId: Uuid, since: Date): Promise<Date | null> {
  const row = await tx.queryOne<{ at: Date | null }>("SELECT min(created_at) AS at FROM messaging.messages WHERE tenant_id = $1 AND sender_id = $2 AND created_at > $3", [tenantId, senderId, since]);
  return row?.at ?? null;
}

// ---------------------------------------------------------------------------
// Pièces jointes
// ---------------------------------------------------------------------------

export interface AttachmentRow {
  id: Uuid;
  uploadedBy: Uuid;
  messageId: Uuid | null;
  announcementId: Uuid | null;
  storageKey: string;
  fileName: string;
  detectedMime: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
  boundAt: Date | null;
}

const ATT_COLS = `a.id, a.uploaded_by AS "uploadedBy", a.message_id AS "messageId", a.announcement_id AS "announcementId", a.storage_key AS "storageKey",
  a.file_name AS "fileName", a.detected_mime AS "detectedMime", a.size_bytes AS "sizeBytes", a.sha256, a.uploaded_at AS "uploadedAt", a.bound_at AS "boundAt"`;

export async function insertAttachment(tx: Tx, tenantId: Uuid, a: Omit<AttachmentRow, "messageId" | "announcementId" | "boundAt">): Promise<AttachmentRow> {
  const row = await tx.queryOne<AttachmentRow>(
    `INSERT INTO messaging.attachments (id, tenant_id, uploaded_by, storage_key, file_name, detected_mime, size_bytes, sha256, uploaded_at)
     VALUES ($2, $1, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, uploaded_by AS "uploadedBy", message_id AS "messageId", announcement_id AS "announcementId", storage_key AS "storageKey",
               file_name AS "fileName", detected_mime AS "detectedMime", size_bytes AS "sizeBytes", sha256, uploaded_at AS "uploadedAt", bound_at AS "boundAt"`,
    [tenantId, a.id, a.uploadedBy, a.storageKey, a.fileName, a.detectedMime, a.sizeBytes, a.sha256, a.uploadedAt],
  );
  return row as AttachmentRow;
}

export async function getAttachment(tx: Tx, tenantId: Uuid, id: Uuid): Promise<AttachmentRow | null> {
  return tx.queryOne<AttachmentRow>(`SELECT ${ATT_COLS} FROM messaging.attachments a WHERE a.tenant_id = $1 AND a.id = $2`, [tenantId, id]);
}

export async function getAttachments(tx: Tx, tenantId: Uuid, ids: readonly Uuid[]): Promise<AttachmentRow[]> {
  if (ids.length === 0) return [];
  return tx.many<AttachmentRow>(`SELECT ${ATT_COLS} FROM messaging.attachments a WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])`, [tenantId, [...ids]]);
}

export async function listAttachmentsOfMessages(tx: Tx, tenantId: Uuid, messageIds: readonly Uuid[]): Promise<AttachmentRow[]> {
  if (messageIds.length === 0) return [];
  return tx.many<AttachmentRow>(`SELECT ${ATT_COLS} FROM messaging.attachments a WHERE a.tenant_id = $1 AND a.message_id = ANY($2::uuid[]) ORDER BY a.uploaded_at, a.id`, [tenantId, [...messageIds]]);
}

export async function listAttachmentsOfAnnouncements(tx: Tx, tenantId: Uuid, announcementIds: readonly Uuid[]): Promise<AttachmentRow[]> {
  if (announcementIds.length === 0) return [];
  return tx.many<AttachmentRow>(`SELECT ${ATT_COLS} FROM messaging.attachments a WHERE a.tenant_id = $1 AND a.announcement_id = ANY($2::uuid[]) ORDER BY a.uploaded_at, a.id`, [tenantId, [...announcementIds]]);
}

/** Lie des pièces NON liées déposées par `uploader` ; retourne le nombre lié (l'appelant le compare à l'attendu). */
export async function bindAttachments(tx: Tx, tenantId: Uuid, ids: readonly Uuid[], target: { messageId?: Uuid; announcementId?: Uuid }, uploader: Uuid, at: Date): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx.many<{ id: Uuid }>(
    `UPDATE messaging.attachments SET message_id = $4, announcement_id = $5, bound_at = $6
      WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND uploaded_by = $3 AND bound_at IS NULL RETURNING id`,
    [tenantId, [...ids], uploader, target.messageId ?? null, target.announcementId ?? null, at],
  );
  return rows.length;
}

/** Détache les pièces d'une annonce qui ne figurent plus dans la liste (édition d'un brouillon). */
export async function unbindAnnouncementAttachments(tx: Tx, tenantId: Uuid, announcementId: Uuid, keep: readonly Uuid[]): Promise<AttachmentRow[]> {
  return tx.many<AttachmentRow>(
    `DELETE FROM messaging.attachments a WHERE a.tenant_id = $1 AND a.announcement_id = $2 AND NOT (a.id = ANY($3::uuid[])) RETURNING ${ATT_COLS}`,
    [tenantId, announcementId, [...keep]],
  );
}

export async function listOrphanAttachments(tx: Tx, tenantId: Uuid, before: Date, limit: number): Promise<AttachmentRow[]> {
  return tx.many<AttachmentRow>(
    `SELECT ${ATT_COLS} FROM messaging.attachments a WHERE a.tenant_id = $1 AND a.bound_at IS NULL AND a.uploaded_at < $2 ORDER BY a.uploaded_at LIMIT $3`,
    [tenantId, before, limit],
  );
}

export async function deleteAttachments(tx: Tx, tenantId: Uuid, ids: readonly Uuid[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.query("DELETE FROM messaging.attachments WHERE tenant_id = $1 AND id = ANY($2::uuid[])", [tenantId, [...ids]]);
}
