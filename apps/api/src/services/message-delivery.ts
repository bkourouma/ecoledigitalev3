/**
 * Livraison multi-canal des messages administratifs.
 *
 * Un message est **toujours** enregistré dans l'application (c'est la source
 * de vérité, consultée depuis l'espace du destinataire). Les canaux WhatsApp
 * et Email sont des relais optionnels, activés à l'envoi, et chaque tentative
 * — réussie, ignorée ou en échec — est tracée dans `app_whatsapp_delivery_log`
 * (table historique, désormais partagée par les deux canaux via la colonne
 * `channel`).
 *
 * Aucun échec de relais ne fait échouer l'envoi applicatif : les statuts sont
 * remontés à l'appelant pour être affichés, pas jetés.
 */

import type { FastifyBaseLogger } from "fastify";
import { emailService } from "./email.service";
import { emailLogoAttachments } from "./brand-assets";
import {
  logAndMaybeSendWhatsapp,
  type WhatsAppSourceType,
} from "./whatsapp-delivery-log";
import {
  loadTenantMessageTemplate,
  renderMessageEmail,
  type MessageEmailContext,
  type MessageEmailTemplate,
  type MessageTemplateKind,
} from "./message-email-templates";

export type EmailDeliveryStatus =
  | "skipped"
  | "skipped_not_configured"
  | "skipped_no_email"
  | "sent"
  | "failed";

export type WhatsAppDeliveryStatus =
  | "skipped"
  | "skipped_no_phone"
  | "skipped_not_configured"
  | "sent"
  | "failed";

/** Lien vers l'espace en ligne, injecté dans les modèles (`{{portalUrl}}`). */
export const PORTAL_URL =
  process.env.WEB_APP_URL ||
  process.env.FRONTEND_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://ecoledigitale.engage-360.net"
    : "http://localhost:3000");

/** Origine du front, utilisée pour l'aperçu HTML (logo servi en http). */
export const WEB_ORIGIN = PORTAL_URL.replace(/\/login\/?$/, "").replace(/\/+$/, "");

/**
 * Ajoute la colonne `channel` à la table de journal historique. Idempotent, et
 * silencieux si la table n'existe pas encore (elle sera créée par
 * `ensureWhatsAppDeliveryLogTable` au premier envoi).
 */
export async function ensureDeliveryLogChannelColumn(pool: any): Promise<void> {
  try {
    await pool.query(
      `ALTER TABLE app_whatsapp_delivery_log
         ADD COLUMN IF NOT EXISTS channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp'`
    );
    await pool.query(
      `ALTER TABLE app_whatsapp_delivery_log
         ADD COLUMN IF NOT EXISTS recipient_address VARCHAR(320)`
    );
  } catch {
    // Table absente ou droits insuffisants : l'envoi ne doit pas s'arrêter là.
  }
}

/** Nom affiché d'un utilisateur, utilisé comme expéditeur ou destinataire. */
export async function resolveDisplayName(
  pool: any,
  userId: string,
  fallback = "Utilisateur"
): Promise<string> {
  try {
    const result = await pool.query(
      `SELECT COALESCE(first_name || ' ' || last_name, name) AS display_name
         FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.display_name || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Administrateurs destinataires des messages adressés « à l'établissement ».
 * Plafonné comme les envois WhatsApp existants pour éviter qu'un tenant à
 * nombreux administrateurs ne déclenche des dizaines d'emails par message.
 */
export async function resolveAdminRecipients(
  pool: any,
  tenantId: string,
  limit = 30
): Promise<Array<{ userId: string; name: string }>> {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ur.user_id,
              COALESCE(u.first_name || ' ' || u.last_name, u.name) AS display_name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id AND u.tenant_id = $1
        WHERE ur.tenant_id = $1
          AND r.key IN ('admin','super_admin','Administrateur')
        LIMIT $2`,
      [tenantId, limit]
    );
    return result.rows.map((row: any) => ({
      userId: row.user_id,
      name: row.display_name || "Administration",
    }));
  } catch {
    return [];
  }
}

/** Email de connexion du destinataire (parent, enseignant, étudiant). */
export async function resolveUserEmail(
  pool: any,
  tenantId: string,
  userId: string
): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT NULLIF(TRIM(email), '') AS email
         FROM users
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [userId, tenantId]
    );
    const email = result.rows[0]?.email as string | undefined;
    return email && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

async function logEmailAttempt(params: {
  pool: any;
  tenantId: string;
  sourceType: WhatsAppSourceType;
  sourceId?: string | null;
  recipientUserId: string;
  address: string | null;
  preview: string;
  status: string;
  errorMessage?: string | null;
}): Promise<void> {
  const { pool, tenantId, sourceType, sourceId, recipientUserId, address, preview, status } = params;
  try {
    await pool.query(
      `INSERT INTO app_whatsapp_delivery_log
         (tenant_id, source_type, source_id, recipient_user_id, phone_e164,
          message_preview, status, error_message, channel, recipient_address)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, 'email', $8)`,
      [
        tenantId,
        sourceType,
        sourceId || null,
        recipientUserId,
        preview,
        status,
        params.errorMessage || null,
        address,
      ]
    );
  } catch {
    // Le journal est un confort, jamais un bloquant.
  }
}

export interface EmailRelayParams {
  pool: any;
  tenantId: string;
  sourceType: WhatsAppSourceType;
  sourceId?: string | null;
  recipientUserId: string;
  /** Type de modèle à utiliser pour la mise en forme. */
  templateKind: MessageTemplateKind;
  /** Contexte de rendu (nom du destinataire, sujet, contenu…). */
  context: MessageEmailContext;
  /** Modèle déjà chargé — évite une requête par destinataire sur un envoi groupé. */
  template?: MessageEmailTemplate;
  log?: FastifyBaseLogger;
}

/**
 * Envoie le relais email d'un message et journalise la tentative.
 * Ne lève jamais : le statut retourné décrit l'issue.
 */
export async function sendMessageEmail(
  params: EmailRelayParams
): Promise<{ emailStatus: EmailDeliveryStatus; sentTo?: string }> {
  const { pool, tenantId, sourceType, sourceId, recipientUserId, templateKind, context, log } =
    params;

  const preview =
    context.message.length > 500 ? `${context.message.slice(0, 500)}…` : context.message;

  await ensureDeliveryLogChannelColumn(pool);

  if (!emailService.isConfigured()) {
    await logEmailAttempt({
      pool,
      tenantId,
      sourceType,
      sourceId,
      recipientUserId,
      address: null,
      preview,
      status: "skipped_not_configured",
      errorMessage: "SMTP_HOST / SMTP_USER / SMTP_PASSWORD manquants",
    });
    return { emailStatus: "skipped_not_configured" };
  }

  const address = await resolveUserEmail(pool, tenantId, recipientUserId);
  if (!address) {
    await logEmailAttempt({
      pool,
      tenantId,
      sourceType,
      sourceId,
      recipientUserId,
      address: null,
      preview,
      status: "skipped_no_email",
      errorMessage: "Aucune adresse email exploitable pour ce destinataire",
    });
    return { emailStatus: "skipped_no_email" };
  }

  try {
    const template =
      params.template ?? (await loadTenantMessageTemplate(pool, tenantId, templateKind));
    const { subject, html, text } = renderMessageEmail(templateKind, template, context);

    await emailService.sendEmail({
      to: address,
      subject,
      html,
      text,
      attachments: emailLogoAttachments(),
    });

    await logEmailAttempt({
      pool,
      tenantId,
      sourceType,
      sourceId,
      recipientUserId,
      address,
      preview,
      status: "sent",
    });
    log?.info({ msg: "message_email_sent", sourceType, recipientUserId, address });
    return { emailStatus: "sent", sentTo: address };
  } catch (error: any) {
    await logEmailAttempt({
      pool,
      tenantId,
      sourceType,
      sourceId,
      recipientUserId,
      address,
      preview,
      status: "failed",
      errorMessage: error?.message || "send_failed",
    });
    log?.warn({ msg: "message_email_failed", sourceType, recipientUserId, err: error?.message });
    return { emailStatus: "failed" };
  }
}

export interface DeliverMessageParams extends Omit<EmailRelayParams, "log"> {
  /** Texte brut relayé sur WhatsApp (sujet + contenu). */
  whatsappText: string;
  sendWhatsapp?: boolean;
  sendEmail?: boolean;
  log?: FastifyBaseLogger;
}

/**
 * Point d'entrée unique des routes d'envoi : trace l'envoi applicatif, puis
 * déclenche les relais demandés. Les deux relais sont indépendants — l'échec
 * de l'un n'empêche pas l'autre.
 */
export async function deliverMessage(
  params: DeliverMessageParams
): Promise<{ whatsappStatus: WhatsAppDeliveryStatus; emailStatus: EmailDeliveryStatus }> {
  const wa = await logAndMaybeSendWhatsapp({
    pool: params.pool,
    tenantId: params.tenantId,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    recipientUserId: params.recipientUserId,
    text: params.whatsappText,
    sendWhatsapp: params.sendWhatsapp,
    log: params.log,
  });

  if (!params.sendEmail) {
    return { whatsappStatus: wa.whatsappStatus, emailStatus: "skipped" };
  }

  const mail = await sendMessageEmail({
    pool: params.pool,
    tenantId: params.tenantId,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    recipientUserId: params.recipientUserId,
    templateKind: params.templateKind,
    context: params.context,
    template: params.template,
    log: params.log,
  });

  return { whatsappStatus: wa.whatsappStatus, emailStatus: mail.emailStatus };
}

/** Agrège les statuts individuels d'un envoi groupé pour l'affichage. */
export function summarizeStatuses(statuses: string[]): Record<string, number> {
  return statuses.reduce<Record<string, number>>((acc, status) => {
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}
