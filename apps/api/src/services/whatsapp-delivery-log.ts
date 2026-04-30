import type { FastifyBaseLogger } from "fastify";
import { isWasenderConfigured, normalizeToE164, wasenderSendText } from "./wasender";

export type WhatsAppSourceType =
  | "admin_parent_conversation_message"
  | "admin_teacher_message"
  | "admin_student_message"
  | "teacher_parent_message"
  | "teacher_student_message"
  | "teacher_establishment_message"
  | "parent_school_message"
  | "parent_teacher_conversation_message"
  | "student_school_message"
  | "student_teacher_message"
  | "other";

export async function ensureWhatsAppDeliveryLogTable(pool: any): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_whatsapp_delivery_log (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      source_type VARCHAR(80) NOT NULL,
      source_id UUID,
      recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      phone_e164 VARCHAR(32),
      message_preview TEXT,
      status VARCHAR(32) NOT NULL,
      provider_response JSONB,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_app_whatsapp_delivery_log_tenant_created
    ON app_whatsapp_delivery_log(tenant_id, created_at DESC)
  `);
}

/** Résout un numéro pour utilisateur (enseignant / élève parent profil). */
export async function resolveUserPhone(pool: any, tenantId: string, userId: string): Promise<string | null> {
  try {
    const r = await pool.query(
      `SELECT COALESCE(
          NULLIF(TRIM(t.phone), ''),
          NULLIF(TRIM(sp.telephone), '')
        ) AS phone
       FROM users u
       LEFT JOIN teachers t ON t.user_id = u.id AND t.tenant_id = $2
       LEFT JOIN student_profiles sp ON sp.user_id = u.id AND sp.tenant_id = $2
       WHERE u.id = $1
       LIMIT 1`,
      [userId, tenantId]
    );
    const raw = r.rows[0]?.phone;
    return normalizeToE164(raw);
  } catch {
    return null;
  }
}

export async function logAndMaybeSendWhatsapp(params: {
  pool: any;
  tenantId: string;
  sourceType: WhatsAppSourceType;
  sourceId?: string | null;
  recipientUserId: string;
  text: string;
  sendWhatsapp?: boolean;
  log?: FastifyBaseLogger;
}): Promise<{ whatsappStatus: "skipped" | "skipped_no_phone" | "skipped_not_configured" | "sent" | "failed" }> {
  const { pool, tenantId, sourceType, sourceId, recipientUserId, text, sendWhatsapp, log } = params;
  await ensureWhatsAppDeliveryLogTable(pool);

  const preview = text.length > 500 ? `${text.slice(0, 500)}…` : text;

  if (!sendWhatsapp) {
    await pool.query(
      `INSERT INTO app_whatsapp_delivery_log
       (tenant_id, source_type, source_id, recipient_user_id, phone_e164, message_preview, status, provider_response)
       VALUES ($1, $2, $3, $4, NULL, $5, 'skipped_in_app_only', NULL)`,
      [tenantId, sourceType, sourceId || null, recipientUserId, preview]
    );
    return { whatsappStatus: "skipped" };
  }

  if (!isWasenderConfigured()) {
    await pool.query(
      `INSERT INTO app_whatsapp_delivery_log
       (tenant_id, source_type, source_id, recipient_user_id, phone_e164, message_preview, status, error_message)
       VALUES ($1, $2, $3, $4, NULL, $5, 'skipped_not_configured', $6)`,
      [tenantId, sourceType, sourceId || null, recipientUserId, preview, "WASENDER_API_KEY / WHATSAPP_PROVIDER manquants"]
    );
    return { whatsappStatus: "skipped_not_configured" };
  }

  const phone = await resolveUserPhone(pool, tenantId, recipientUserId);
  if (!phone) {
    await pool.query(
      `INSERT INTO app_whatsapp_delivery_log
       (tenant_id, source_type, source_id, recipient_user_id, phone_e164, message_preview, status, error_message)
       VALUES ($1, $2, $3, $4, NULL, $5, 'skipped_no_phone', $6)`,
      [tenantId, sourceType, sourceId || null, recipientUserId, preview, "Aucun numéro exploitable pour ce destinataire"]
    );
    return { whatsappStatus: "skipped_no_phone" };
  }

  const send = await wasenderSendText(phone, text);
  if (send.ok) {
    await pool.query(
      `INSERT INTO app_whatsapp_delivery_log
       (tenant_id, source_type, source_id, recipient_user_id, phone_e164, message_preview, status, provider_response)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7::jsonb)`,
      [tenantId, sourceType, sourceId || null, recipientUserId, phone, preview, JSON.stringify(send.detail ?? {})]
    );
    log?.info({ msg: "whatsapp_sent", sourceType, recipientUserId, phone });
    return { whatsappStatus: "sent" };
  }

  await pool.query(
    `INSERT INTO app_whatsapp_delivery_log
     (tenant_id, source_type, source_id, recipient_user_id, phone_e164, message_preview, status, provider_response, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7::jsonb, $8)`,
    [
      tenantId,
      sourceType,
      sourceId || null,
      recipientUserId,
      phone,
      preview,
      JSON.stringify(send.detail ?? {}),
      send.error || "send_failed",
    ]
  );
  log?.warn({ msg: "whatsapp_failed", sourceType, recipientUserId, err: send.error });
  return { whatsappStatus: "failed" };
}
