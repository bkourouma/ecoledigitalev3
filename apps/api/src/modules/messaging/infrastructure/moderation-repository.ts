/**
 * SQL de la modération : signalements et supervision des fils.
 */
import type { Tx } from "@ecoledigitale/database";
import type { Uuid } from "../domain/types";

export interface ReportRow {
  id: Uuid;
  messageId: Uuid;
  conversationId: Uuid;
  reporterId: Uuid;
  reason: "SPAM" | "HARASSMENT" | "INAPPROPRIATE" | "PRIVACY" | "OTHER";
  details: string | null;
  status: "OPEN" | "DISMISSED" | "ACTIONED";
  decidedBy: Uuid | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
}

const COLS = `r.id, r.message_id AS "messageId", r.conversation_id AS "conversationId", r.reporter_id AS "reporterId", r.reason, r.details, r.status,
  r.decided_by AS "decidedBy", r.decided_at AS "decidedAt", r.decision_note AS "decisionNote", r.created_at AS "createdAt"`;

export async function insertReport(tx: Tx, tenantId: Uuid, r: Pick<ReportRow, "id" | "messageId" | "conversationId" | "reporterId" | "reason" | "details" | "createdAt">): Promise<boolean> {
  const rows = await tx.many<{ id: Uuid }>(
    `INSERT INTO messaging.reports (id, tenant_id, message_id, conversation_id, reporter_id, reason, details, created_at)
     VALUES ($2, $1, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id, message_id, reporter_id) DO NOTHING RETURNING id`,
    [tenantId, r.id, r.messageId, r.conversationId, r.reporterId, r.reason, r.details, r.createdAt],
  );
  return rows.length > 0;
}

export async function getReport(tx: Tx, tenantId: Uuid, id: Uuid, options: { forUpdate?: boolean } = {}): Promise<ReportRow | null> {
  return tx.queryOne<ReportRow>(`SELECT ${COLS} FROM messaging.reports r WHERE r.tenant_id = $1 AND r.id = $2${options.forUpdate ? " FOR UPDATE" : ""}`, [tenantId, id]);
}

export async function listReports(tx: Tx, tenantId: Uuid, q: { status?: string | undefined; cursor: { t: string; id: Uuid } | null; limit: number }): Promise<ReportRow[]> {
  return tx.many<ReportRow>(
    `SELECT ${COLS} FROM messaging.reports r
      WHERE r.tenant_id = $1 AND ($2::text IS NULL OR r.status = $2) AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
      ORDER BY r.created_at DESC, r.id DESC LIMIT $5`,
    [tenantId, q.status ?? null, q.cursor?.t ?? null, q.cursor?.id ?? null, q.limit],
  );
}

export async function decideReport(tx: Tx, tenantId: Uuid, id: Uuid, d: { status: "DISMISSED" | "ACTIONED"; by: Uuid; at: Date; note: string }): Promise<void> {
  await tx.query(
    "UPDATE messaging.reports SET status = $3, decided_by = $4, decided_at = $5, decision_note = $6 WHERE tenant_id = $1 AND id = $2",
    [tenantId, id, d.status, d.by, d.at, d.note],
  );
}

/** Clôt tous les signalements ouverts d'un même message (une décision vaut pour tous). */
export async function decideOpenReportsOfMessage(tx: Tx, tenantId: Uuid, messageId: Uuid, d: { status: "DISMISSED" | "ACTIONED"; by: Uuid; at: Date; note: string }): Promise<Uuid[]> {
  const rows = await tx.many<{ id: Uuid }>(
    `UPDATE messaging.reports SET status = $3, decided_by = $4, decided_at = $5, decision_note = $6
      WHERE tenant_id = $1 AND message_id = $2 AND status = 'OPEN' RETURNING id`,
    [tenantId, messageId, d.status, d.by, d.at, d.note],
  );
  return rows.map((r) => r.id);
}

export interface SuperviseRow {
  id: Uuid;
  kind: "DIRECT" | "GROUP" | "SYSTEM";
  subject: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  broadcastId: Uuid | null;
  aboutStudentId: Uuid | null;
  classroomId: Uuid | null;
  allowReplies: boolean;
  closedAt: Date | null;
  lastSeq: number;
  lastMessageAt: Date | null;
  lastPreview: string | null;
  createdAt: Date;
}

/** Fils de l'établissement (métadonnées) pour la supervision ; recherche par objet ou nom d'un participant. Jamais l'aperçu. */
export async function listConversationsForSupervision(
  tx: Tx,
  tenantId: Uuid,
  q: { q?: string | undefined; cursor: { t: string; id: Uuid } | null; limit: number },
): Promise<SuperviseRow[]> {
  return tx.many<SuperviseRow>(
    `SELECT c.id, c.kind, c.subject, c.priority, c.broadcast_id AS "broadcastId", c.about_student_id AS "aboutStudentId", c.classroom_id AS "classroomId",
            c.allow_replies AS "allowReplies", c.closed_at AS "closedAt", c.last_seq::int AS "lastSeq", c.last_message_at AS "lastMessageAt",
            NULL::text AS "lastPreview", c.created_at AS "createdAt"
       FROM messaging.conversations c
      WHERE c.tenant_id = $1 AND c.kind <> 'SYSTEM'
        AND ($2::text IS NULL OR messaging.normalize_search(coalesce(c.subject, '')) LIKE '%' || messaging.normalize_search($2) || '%'
             OR EXISTS (SELECT 1 FROM messaging.conversation_participants p WHERE p.tenant_id = c.tenant_id AND p.conversation_id = c.id
                         AND messaging.normalize_search(p.display_name) LIKE '%' || messaging.normalize_search($2) || '%'))
        AND ($3::timestamptz IS NULL OR (coalesce(c.last_message_at, c.created_at), c.id) < ($3::timestamptz, $4::uuid))
      ORDER BY coalesce(c.last_message_at, c.created_at) DESC, c.id DESC LIMIT $5`,
    [tenantId, q.q ?? null, q.cursor?.t ?? null, q.cursor?.id ?? null, q.limit],
  );
}
