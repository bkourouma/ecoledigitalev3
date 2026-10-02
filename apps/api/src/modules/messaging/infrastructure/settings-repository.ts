/**
 * SQL des paramètres d'établissement, des gabarits de messages système et des restrictions d'envoi.
 */
import type { Tx } from "@ecoledigitale/database";
import { DEFAULT_MESSAGING_SETTINGS, type MessagingSettings, type Uuid } from "../domain/types";

interface SettingsRow {
  studentPolicy: MessagingSettings["studentPolicy"];
  adminContactRoles: string[];
  attachmentsEnabled: boolean;
  attachmentMaxBytes: number;
  attachmentMaxPerItem: number;
  allowedAttachmentTypes: string[];
  maxMessagesPerHour: number;
  maxNewConversationsPerDay: number;
  maxGroupParticipants: number;
  maxBroadcastParticipants: number;
  messageMaxLength: number;
  notificationRetentionDays: number;
}

const COLS = `student_policy AS "studentPolicy", admin_contact_roles AS "adminContactRoles", attachments_enabled AS "attachmentsEnabled",
  attachment_max_bytes AS "attachmentMaxBytes", attachment_max_per_item AS "attachmentMaxPerItem", allowed_attachment_types AS "allowedAttachmentTypes",
  max_messages_per_hour AS "maxMessagesPerHour", max_new_conversations_per_day AS "maxNewConversationsPerDay",
  max_group_participants AS "maxGroupParticipants", max_broadcast_participants AS "maxBroadcastParticipants",
  message_max_length AS "messageMaxLength", notification_retention_days AS "notificationRetentionDays"`;

/** Paramètres du tenant de la transaction ; sans ligne, les défauts du code. */
export async function getSettings(tx: Tx, tenantId: Uuid): Promise<MessagingSettings> {
  const row = await tx.queryOne<SettingsRow>(`SELECT ${COLS} FROM messaging.settings WHERE tenant_id = $1`, [tenantId]);
  return row ?? DEFAULT_MESSAGING_SETTINGS;
}

export async function upsertSettings(tx: Tx, tenantId: Uuid, s: MessagingSettings, by: Uuid | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO messaging.settings (tenant_id, student_policy, admin_contact_roles, attachments_enabled, attachment_max_bytes, attachment_max_per_item,
        allowed_attachment_types, max_messages_per_hour, max_new_conversations_per_day, max_group_participants, max_broadcast_participants,
        message_max_length, notification_retention_days, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (tenant_id) DO UPDATE SET student_policy = EXCLUDED.student_policy, admin_contact_roles = EXCLUDED.admin_contact_roles,
        attachments_enabled = EXCLUDED.attachments_enabled, attachment_max_bytes = EXCLUDED.attachment_max_bytes,
        attachment_max_per_item = EXCLUDED.attachment_max_per_item, allowed_attachment_types = EXCLUDED.allowed_attachment_types,
        max_messages_per_hour = EXCLUDED.max_messages_per_hour, max_new_conversations_per_day = EXCLUDED.max_new_conversations_per_day,
        max_group_participants = EXCLUDED.max_group_participants, max_broadcast_participants = EXCLUDED.max_broadcast_participants,
        message_max_length = EXCLUDED.message_max_length, notification_retention_days = EXCLUDED.notification_retention_days,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [
      tenantId,
      s.studentPolicy,
      [...s.adminContactRoles],
      s.attachmentsEnabled,
      s.attachmentMaxBytes,
      s.attachmentMaxPerItem,
      [...s.allowedAttachmentTypes],
      s.maxMessagesPerHour,
      s.maxNewConversationsPerDay,
      s.maxGroupParticipants,
      s.maxBroadcastParticipants,
      s.messageMaxLength,
      s.notificationRetentionDays,
      by,
      now,
    ],
  );
}

// ---------------------------------------------------------------------------
// Gabarits de messages système
// ---------------------------------------------------------------------------

export interface TemplateRow {
  code: string;
  title: string;
  body: string;
  enabled: boolean;
}

export async function listTemplateOverrides(tx: Tx, tenantId: Uuid): Promise<TemplateRow[]> {
  return tx.many<TemplateRow>("SELECT code, title, body, enabled FROM messaging.system_templates WHERE tenant_id = $1 ORDER BY code", [tenantId]);
}

export async function getTemplateOverride(tx: Tx, tenantId: Uuid, code: string): Promise<TemplateRow | null> {
  return tx.queryOne<TemplateRow>("SELECT code, title, body, enabled FROM messaging.system_templates WHERE tenant_id = $1 AND code = $2", [tenantId, code]);
}

export async function upsertTemplate(tx: Tx, tenantId: Uuid, t: TemplateRow, by: Uuid | null, now: Date): Promise<void> {
  await tx.query(
    `INSERT INTO messaging.system_templates (tenant_id, code, title, body, enabled, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, code) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [tenantId, t.code, t.title, t.body, t.enabled, by, now],
  );
}

// ---------------------------------------------------------------------------
// Restrictions d'envoi
// ---------------------------------------------------------------------------

export interface RestrictionRow {
  userId: Uuid;
  restrictedUntil: Date | null;
  reason: string;
  setBy: Uuid;
  setAt: Date;
  reportId: Uuid | null;
}

const RESTRICTION_COLS = `user_id AS "userId", restricted_until AS "restrictedUntil", reason, set_by AS "setBy", set_at AS "setAt", report_id AS "reportId"`;

/** Restriction ACTIVE (non échue) de l'utilisateur, sinon `null`. */
export async function getActiveRestriction(tx: Tx, tenantId: Uuid, userId: Uuid, now: Date): Promise<RestrictionRow | null> {
  return tx.queryOne<RestrictionRow>(
    `SELECT ${RESTRICTION_COLS} FROM messaging.restrictions WHERE tenant_id = $1 AND user_id = $2 AND (restricted_until IS NULL OR restricted_until > $3)`,
    [tenantId, userId, now],
  );
}

export async function listRestrictions(tx: Tx, tenantId: Uuid, now: Date): Promise<RestrictionRow[]> {
  return tx.many<RestrictionRow>(
    `SELECT ${RESTRICTION_COLS} FROM messaging.restrictions WHERE tenant_id = $1 AND (restricted_until IS NULL OR restricted_until > $2) ORDER BY set_at DESC`,
    [tenantId, now],
  );
}

export async function upsertRestriction(tx: Tx, tenantId: Uuid, r: RestrictionRow): Promise<void> {
  await tx.query(
    `INSERT INTO messaging.restrictions (tenant_id, user_id, restricted_until, reason, set_by, set_at, report_id) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET restricted_until = EXCLUDED.restricted_until, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by,
        set_at = EXCLUDED.set_at, report_id = EXCLUDED.report_id`,
    [tenantId, r.userId, r.restrictedUntil, r.reason, r.setBy, r.setAt, r.reportId],
  );
}

export async function deleteRestriction(tx: Tx, tenantId: Uuid, userId: Uuid): Promise<boolean> {
  const rows = await tx.many<{ userId: Uuid }>("DELETE FROM messaging.restrictions WHERE tenant_id = $1 AND user_id = $2 RETURNING user_id AS \"userId\"", [tenantId, userId]);
  return rows.length > 0;
}
