/**
 * Notifications dispatcher
 *
 * Generic, channel-fanout orchestrator on top of the existing per-channel services
 * (EmailService for SMTP, wasender.ts + whatsapp-delivery-log.ts for WhatsApp).
 * Writes to the new in-app `notifications` table for the bell UI.
 *
 * Intentionally separate from the existing payment-specific notification.service.ts which
 * has its own narrow API and mock dispatchers.
 *
 * Use shape:
 *   await dispatchNotification(pool, fastify.log, {
 *     tenantId, recipients: [{ userId, email, phone, displayName }],
 *     type: 'live_session.invite',
 *     title: 'Cours en direct ce soir à 18h',
 *     body: '...',
 *     payload: { liveSessionId },
 *     actionUrl: 'https://app.../live/abc',
 *     channels: ['inapp', 'email', 'whatsapp'],
 *   });
 */

import type { FastifyBaseLogger } from "fastify";
import { EmailService } from "./email.service";
import { isWasenderConfigured, normalizeToE164, wasenderSendText } from "./wasender";
import { resolveUserPhone } from "./whatsapp-delivery-log";

export type NotificationChannel = "inapp" | "email" | "whatsapp";
export type SubjectKind = "tenant_user" | "public_user";

export interface NotificationRecipient {
  /** 'tenant_user' for school-side users (apps/web), 'public_user' for formation-pro learners. */
  subjectKind: SubjectKind;
  /** Either users.id (UUID, tenant_user) or public_users.id (cuid, public_user). */
  subjectUserId: string;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
}

export interface DispatchInput {
  tenantId: string;
  recipients: NotificationRecipient[];
  type: string;                 // e.g. 'live_session.invite'
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  actionUrl?: string;
  /** Channels to attempt. Defaults to all three. */
  channels?: NotificationChannel[];
  /** Optional per-channel content overrides — defaults to title/body for all. */
  email?: { subject?: string; html?: string; text?: string };
  whatsapp?: { text?: string };
}

export interface DispatchResult {
  perRecipient: Array<{
    subjectKind: SubjectKind;
    subjectUserId: string;
    notificationId: string | null;
    channelsSent: NotificationChannel[];
    channelsFailed: Array<{ channel: NotificationChannel; reason: string }>;
  }>;
}

const DEFAULT_CHANNELS: NotificationChannel[] = ["inapp", "email", "whatsapp"];

let _email: EmailService | null = null;
function emailSvc(): EmailService {
  if (!_email) _email = new EmailService();
  return _email;
}

function buildHtmlBody(input: DispatchInput): string {
  if (input.email?.html) return input.email.html;
  const cta = input.actionUrl
    ? `<p style="margin-top:24px"><a href="${input.actionUrl}" style="background:#3b82f6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Ouvrir</a></p>`
    : "";
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1f2937;margin:0 0 12px">${escapeHtml(input.title)}</h2>
      ${input.body ? `<p style="white-space:pre-wrap;color:#374151">${escapeHtml(input.body)}</p>` : ""}
      ${cta}
    </div>
  `;
}

function buildTextBody(input: DispatchInput): string {
  if (input.email?.text) return input.email.text;
  return [input.title, input.body ?? "", input.actionUrl ?? ""].filter(Boolean).join("\n\n");
}

function buildWhatsappText(input: DispatchInput): string {
  if (input.whatsapp?.text) return input.whatsapp.text;
  return [input.title, input.body ?? "", input.actionUrl ?? ""].filter(Boolean).join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function setTenantContext(client: any, tenantId: string): Promise<void> {
  await client.query("SELECT set_config($1, $2, true)", ["app.tenant_id", tenantId]);
}

async function writeInApp(
  client: any,
  input: DispatchInput,
  recipient: NotificationRecipient,
  channelsSent: NotificationChannel[]
): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO app_notifications (
        tenant_id, subject_kind, subject_user_id, type, title, body, payload, action_url, channels_sent
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
     RETURNING id`,
    [
      input.tenantId,
      recipient.subjectKind,
      recipient.subjectUserId,
      input.type,
      input.title,
      input.body ?? null,
      JSON.stringify(input.payload ?? {}),
      input.actionUrl ?? null,
      JSON.stringify(channelsSent),
    ]
  );
  return res.rows[0].id;
}

async function logEmailDelivery(
  client: any,
  tenantId: string,
  notificationId: string | null,
  recipient: NotificationRecipient,
  recipientEmail: string | null,
  subject: string,
  status: "sent" | "failed" | "skipped_no_email" | "skipped_not_configured",
  providerResponse: any,
  errorMessage: string | null
): Promise<void> {
  await client.query(
    `INSERT INTO app_email_delivery_log (
        tenant_id, notification_id, recipient_subject_kind, recipient_subject_user_id,
        recipient_email, subject, status, provider_response, error_message
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    [
      tenantId,
      notificationId,
      recipient.subjectKind,
      recipient.subjectUserId,
      recipientEmail,
      subject.slice(0, 510),
      status,
      providerResponse ? JSON.stringify(providerResponse) : null,
      errorMessage,
    ]
  );
}

async function logWhatsappDelivery(
  client: any,
  tenantId: string,
  recipient: NotificationRecipient,
  phone: string | null,
  preview: string,
  status: "sent" | "failed" | "skipped_no_phone" | "skipped_not_configured",
  providerResponse: any,
  errorMessage: string | null
): Promise<void> {
  // Reuse the existing app_whatsapp_delivery_log table; source_type 'notification_dispatch'
  // distinguishes these rows from chat-driven sends. recipient_user_id is constrained to
  // users(id), so we only populate it for tenant_user recipients — for public_user we leave
  // it NULL (the message_preview + tenant_id is enough for retry/audit).
  await client.query(
    `INSERT INTO app_whatsapp_delivery_log (
        tenant_id, source_type, source_id, recipient_user_id, phone_e164,
        message_preview, status, provider_response, error_message
     )
     VALUES ($1, 'notification_dispatch', NULL, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      tenantId,
      recipient.subjectKind === "tenant_user" ? recipient.subjectUserId : null,
      phone,
      preview.slice(0, 500),
      status,
      providerResponse ? JSON.stringify(providerResponse) : null,
      errorMessage,
    ]
  );
}

async function tryEmail(
  client: any,
  input: DispatchInput,
  recipient: NotificationRecipient,
  notificationId: string | null,
  log: FastifyBaseLogger
): Promise<{ ok: boolean; reason?: string }> {
  const subject = input.email?.subject ?? input.title;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    await logEmailDelivery(
      client,
      input.tenantId,
      notificationId,
      recipient,
      recipient.email ?? null,
      subject,
      "skipped_not_configured",
      null,
      "SMTP env vars missing"
    );
    return { ok: false, reason: "smtp_not_configured" };
  }
  if (!recipient.email) {
    await logEmailDelivery(
      client,
      input.tenantId,
      notificationId,
      recipient,
      null,
      subject,
      "skipped_no_email",
      null,
      "Recipient has no email"
    );
    return { ok: false, reason: "no_email" };
  }
  try {
    await emailSvc().sendEmail({
      to: recipient.email,
      subject,
      html: buildHtmlBody(input),
      text: buildTextBody(input),
    });
    await logEmailDelivery(
      client,
      input.tenantId,
      notificationId,
      recipient,
      recipient.email,
      subject,
      "sent",
      null,
      null
    );
    return { ok: true };
  } catch (err: any) {
    log.warn({ err, recipient: recipient.subjectUserId }, "notification email failed");
    await logEmailDelivery(
      client,
      input.tenantId,
      notificationId,
      recipient,
      recipient.email,
      subject,
      "failed",
      null,
      err?.message ?? String(err)
    );
    return { ok: false, reason: err?.message ?? "email_failed" };
  }
}

async function tryWhatsapp(
  client: any,
  pool: any,
  input: DispatchInput,
  recipient: NotificationRecipient,
  log: FastifyBaseLogger
): Promise<{ ok: boolean; reason?: string }> {
  const text = buildWhatsappText(input);
  if (!isWasenderConfigured()) {
    await logWhatsappDelivery(
      client,
      input.tenantId,
      recipient,
      null,
      text,
      "skipped_not_configured",
      null,
      "WASENDER_API_KEY missing"
    );
    return { ok: false, reason: "wasender_not_configured" };
  }
  // Prefer explicit phone if given; otherwise derive from teachers/student_profiles via the helper
  // (only available for tenant_user — public_user must always provide phone explicitly).
  let phone = normalizeToE164(recipient.phone ?? null);
  if (!phone && recipient.subjectKind === "tenant_user") {
    phone = await resolveUserPhone(pool, input.tenantId, recipient.subjectUserId);
  }
  if (!phone) {
    await logWhatsappDelivery(
      client,
      input.tenantId,
      recipient,
      null,
      text,
      "skipped_no_phone",
      null,
      "Recipient has no usable phone"
    );
    return { ok: false, reason: "no_phone" };
  }
  const send = await wasenderSendText(phone, text);
  if (send.ok) {
    await logWhatsappDelivery(
      client,
      input.tenantId,
      recipient,
      phone,
      text,
      "sent",
      send.detail,
      null
    );
    return { ok: true };
  }
  log.warn({ err: send.error, recipient: recipient.subjectUserId }, "notification whatsapp failed");
  await logWhatsappDelivery(
    client,
    input.tenantId,
    recipient,
    phone,
    text,
    "failed",
    send.detail,
    send.error ?? "send_failed"
  );
  return { ok: false, reason: send.error ?? "whatsapp_failed" };
}

/**
 * Dispatch a notification to one or many recipients across the requested channels.
 * Failures on one channel never abort the others — every attempt is logged and the per-recipient
 * result is returned to the caller.
 */
export async function dispatchNotification(
  pool: any,
  log: FastifyBaseLogger,
  input: DispatchInput
): Promise<DispatchResult> {
  const channels = input.channels ?? DEFAULT_CHANNELS;
  const result: DispatchResult = { perRecipient: [] };

  for (const recipient of input.recipients) {
    const client = await pool.connect();
    const channelsSent: NotificationChannel[] = [];
    const channelsFailed: Array<{ channel: NotificationChannel; reason: string }> = [];
    let notificationId: string | null = null;

    try {
      await setTenantContext(client, input.tenantId);

      // In-app first so subsequent channel logs can FK to notification_id.
      if (channels.includes("inapp")) {
        try {
          notificationId = await writeInApp(client, input, recipient, []);
          channelsSent.push("inapp");
        } catch (err: any) {
          log.error({ err, recipient: recipient.subjectUserId }, "failed to write in-app notification");
          channelsFailed.push({ channel: "inapp", reason: err?.message ?? "inapp_write_failed" });
        }
      }

      if (channels.includes("email")) {
        const r = await tryEmail(client, input, recipient, notificationId, log);
        if (r.ok) channelsSent.push("email");
        else channelsFailed.push({ channel: "email", reason: r.reason ?? "email_failed" });
      }

      if (channels.includes("whatsapp")) {
        const r = await tryWhatsapp(client, pool, input, recipient, log);
        if (r.ok) channelsSent.push("whatsapp");
        else channelsFailed.push({ channel: "whatsapp", reason: r.reason ?? "whatsapp_failed" });
      }

      // Update channels_sent on the in-app row if we wrote one.
      if (notificationId && channelsSent.length > 0) {
        await client.query(
          `UPDATE app_notifications SET channels_sent = $2::jsonb WHERE id = $1`,
          [notificationId, JSON.stringify(channelsSent)]
        );
      }

      result.perRecipient.push({
        subjectKind: recipient.subjectKind,
        subjectUserId: recipient.subjectUserId,
        notificationId,
        channelsSent,
        channelsFailed,
      });
    } finally {
      client.release();
    }
  }

  return result;
}
