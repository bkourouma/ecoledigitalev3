/**
 * FormateurMessagingService
 * 
 * Business logic for trainer group messaging
 * Handles sending group messages to enrolled learners via email and SMS
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import { EmailService } from "./email.service";
import { SMSService } from "./sms.service";
import { verifySessionAccess } from "../utils/sessionAccess";
import { getTableName } from '../utils/table-names';

export interface GroupMessageData {
  sujet: string;
  message: string;
  type: "email" | "sms" | "both";
  destinataires?: "tous" | "presents" | "absents";
}

export interface GroupMessageResult {
  nb_destinataires: number;
  email_envoyes?: number;
  sms_envoyes?: number;
}

export class FormateurMessagingService {
  private emailService: EmailService;
  private smsService: SMSService;

  constructor(private pool: Pool) {
    this.emailService = new EmailService();
    this.smsService = new SMSService();
  }

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Send group message to enrolled learners
   * T047: Group messaging service method
   */
  async sendGroupMessage(
    sessionId: string,
    messageData: GroupMessageData,
    formateurId: string,
    tenantId: string
  ): Promise<GroupMessageResult> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify session access
      await verifySessionAccess(this.pool, sessionId, formateurId, tenantId);

      // Get session info for context
      const sessionQuery = await client.query(
        `SELECT code_session, date_debut, date_fin FROM ${getTableName(tenantId, 'sessions_professionnelles')} WHERE id = $1 AND tenant_id = $2`,
        [sessionId, tenantId]
      );
      if (sessionQuery.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND: Session not found");
      }
      const session = sessionQuery.rows[0];
      const inscriptionsTable = getTableName(tenantId, "inscriptions_professionnelles");
      const attendanceTable = getTableName(tenantId, "session_attendance");

      // Build query to get enrolled learners with attendance status
      let recipientsQuery = `
        SELECT DISTINCT
          u.id AS apprenant_id,
          u.email,
          NULL::text AS telephone,
          ip.statut AS statut_inscription,
          sa.present AS presence
        FROM ${inscriptionsTable} ip
        INNER JOIN users u ON ip.apprenant_id = u.id AND u.tenant_id = $2
        LEFT JOIN ${attendanceTable} sa ON ip.id = sa.inscription_id 
          AND ip.session_id = sa.session_id 
          AND ip.tenant_id = sa.tenant_id
        WHERE ip.session_id = $1 
          AND ip.tenant_id = $2
          AND ip.statut = 'confirmee'
      `;

      // Filter by attendance status if specified
      if (messageData.destinataires === "presents") {
        recipientsQuery += ` AND sa.present = TRUE`;
      } else if (messageData.destinataires === "absents") {
        recipientsQuery += ` AND (sa.present = FALSE OR sa.present IS NULL)`;
      }
      // "tous" doesn't need additional filter

      const recipientsResult = await client.query(recipientsQuery, [sessionId, tenantId]);
      const recipients = recipientsResult.rows;

      if (recipients.length === 0) {
        return {
          nb_destinataires: 0,
          email_envoyes: messageData.type === "email" || messageData.type === "both" ? 0 : undefined,
          sms_envoyes: messageData.type === "sms" || messageData.type === "both" ? 0 : undefined,
        };
      }

      let emailCount = 0;
      let smsCount = 0;
      const errors: string[] = [];

      // Send messages based on type
      for (const recipient of recipients) {
        // Send email if requested
        if (messageData.type === "email" || messageData.type === "both") {
          if (recipient.email) {
            try {
              const emailHtml = `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta charset="utf-8">
                  <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
                    .content { padding: 20px; background-color: #f9fafb; }
                    .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header">
                      <h1>Message de votre formateur</h1>
                    </div>
                    <div class="content">
                      <h2>${messageData.sujet}</h2>
                      <p>${messageData.message.replace(/\n/g, '<br>')}</p>
                      <hr>
                      <p><strong>Session:</strong> ${session.code_session}</p>
                    </div>
                    <div class="footer">
                      <p>EcoleDigitale - Formation Professionnelle</p>
                    </div>
                  </div>
                </body>
                </html>
              `;

              await this.emailService.sendEmail({
                to: recipient.email,
                subject: messageData.sujet,
                html: emailHtml,
                text: messageData.message,
              });
              emailCount++;
            } catch (error) {
              errors.push(`Email failed for ${recipient.email}: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
          } else {
            errors.push(`No email for apprenant ${recipient.apprenant_id}`);
          }
        }

        // Send SMS if requested
        if (messageData.type === "sms" || messageData.type === "both") {
          if (recipient.telephone) {
            try {
              const smsMessage = `${messageData.sujet}\n\n${messageData.message}\n\nSession: ${session.code_session} - EcoleDigitale`;
              await this.smsService.sendSMS({
                to: recipient.telephone,
                message: smsMessage,
              });
              smsCount++;
            } catch (error) {
              errors.push(`SMS failed for ${recipient.telephone}: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
          } else {
            errors.push(`No phone for apprenant ${recipient.apprenant_id}`);
          }
        }
      }

      // Log message in database (optional - create table if needed)
      // For now, we'll skip logging to avoid creating new tables in this phase
      // This can be added later if message history is needed

      const result: GroupMessageResult = {
        nb_destinataires: recipients.length,
      };

      if (messageData.type === "email" || messageData.type === "both") {
        result.email_envoyes = emailCount;
      }
      if (messageData.type === "sms" || messageData.type === "both") {
        result.sms_envoyes = smsCount;
      }

      // Log errors but don't fail the request
      if (errors.length > 0) {
        console.warn(`[FormateurMessaging] Some messages failed:`, errors);
      }

      return result;
    } finally {
      client.release();
    }
  }
}
