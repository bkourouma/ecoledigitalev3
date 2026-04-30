/**
 * Document Automation Job
 * 
 * Background jobs for automatic document generation and management:
 * - Automatic attestation generation after session completion (daily at 2 AM)
 * - Quote expiration reminders (daily at 9 AM)
 * - Document storage cleanup (daily at 3 AM)
 * 
 * Uses setInterval for scheduling (can be replaced with node-cron if needed)
 */

import { Pool } from "pg";
import { DocumentGenerationService } from "../services/document-generation.service";
import { EmailService } from "../services/email.service";
import { getFileStorageService } from "../services/fileStorage";

export interface DocumentAutomationConfig {
  dbPool: Pool;
  tenantIds?: string[]; // Optional: if not provided, will query all active tenants
}

export class DocumentAutomationJob {
  private dbPool: Pool;
  private tenantIds?: string[];
  private documentService: DocumentGenerationService;
  private emailService: EmailService;
  private attestationJobInterval: NodeJS.Timeout | null = null;
  private quoteReminderJobInterval: NodeJS.Timeout | null = null;
  private cleanupJobInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: DocumentAutomationConfig) {
    this.dbPool = config.dbPool;
    this.tenantIds = config.tenantIds;
    this.documentService = new DocumentGenerationService(config.dbPool);
    this.emailService = new EmailService();
  }

  /**
   * Get list of tenant IDs to process
   */
  private async getTenantIds(): Promise<string[]> {
    if (this.tenantIds && this.tenantIds.length > 0) {
      return this.tenantIds;
    }

    // Query all active tenants
    const client = await this.dbPool.connect();
    try {
      const result = await client.query("SELECT id FROM tenants WHERE actif = true");
      return result.rows.map((row: any) => row.id);
    } finally {
      client.release();
    }
  }

  /**
   * Start all automation jobs
   */
  start(): void {
    console.log("Starting document automation jobs...");

    // Schedule attestation generation job (runs daily at 2 AM)
    this.scheduleAttestationGeneration();

    // Schedule quote reminder job (runs daily at 9 AM)
    this.scheduleQuoteReminders();

    // Schedule cleanup job (runs daily at 3 AM)
    this.scheduleCleanup();
  }

  /**
   * Stop all automation jobs
   */
  stop(): void {
    if (this.attestationJobInterval) {
      clearInterval(this.attestationJobInterval);
      this.attestationJobInterval = null;
    }
    if (this.quoteReminderJobInterval) {
      clearInterval(this.quoteReminderJobInterval);
      this.quoteReminderJobInterval = null;
    }
    if (this.cleanupJobInterval) {
      clearInterval(this.cleanupJobInterval);
      this.cleanupJobInterval = null;
    }
    console.log("Document automation jobs stopped");
  }

  /**
   * T118: Schedule automatic attestation generation (daily at 2 AM)
   */
  private scheduleAttestationGeneration(): void {
    const runAt2AM = () => {
      const now = new Date();
      const targetTime = new Date();
      targetTime.setHours(2, 0, 0, 0);

      // If it's past 2 AM today, schedule for tomorrow
      if (now >= targetTime) {
        targetTime.setDate(targetTime.getDate() + 1);
      }

      const msUntil2AM = targetTime.getTime() - now.getTime();

      setTimeout(() => {
        this.generateAttestationsForCompletedSessions().catch((error) => {
          console.error("Error in attestation generation job:", error);
        });

        // Schedule next run (24 hours later)
        this.attestationJobInterval = setInterval(() => {
          this.generateAttestationsForCompletedSessions().catch((error) => {
            console.error("Error in attestation generation job:", error);
          });
        }, 24 * 60 * 60 * 1000);
      }, msUntil2AM);
    };

    runAt2AM();
  }

  /**
   * Generate attestations for sessions completed yesterday
   */
  private async generateAttestationsForCompletedSessions(): Promise<void> {
    if (this.isRunning) {
      console.log("Attestation generation already running, skipping...");
      return;
    }

    this.isRunning = true;

    try {
      const tenantIds = await this.getTenantIds();
      console.log("[Document Automation] Starting attestation generation for completed sessions...");

      // Find sessions completed yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const yesterdayEnd = new Date(yesterday);
      yesterdayEnd.setHours(23, 59, 59, 999);

      for (const tenantId of tenantIds) {
        const client = await this.dbPool.connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          const sessionsQuery = `
            SELECT id, code_session
            FROM sessions_professionnelles
            WHERE tenant_id = $1
              AND statut = 'terminee'
              AND date_fin >= $2
              AND date_fin <= $3
          `;
          const sessionsResult = await client.query(sessionsQuery, [
            tenantId,
            yesterday,
            yesterdayEnd,
          ]);

          console.log(
            `[Document Automation] Tenant ${tenantId}: Found ${sessionsResult.rows.length} sessions completed yesterday`
          );

          // Generate attestations for each session
          for (const session of sessionsResult.rows) {
            try {
              await this.documentService.generateBatchAttestations(
                tenantId,
                session.id,
                "attestation_presence",
                "system"
              );
              console.log(
                `[Document Automation] Generated attestations for session ${session.code_session} (tenant: ${tenantId})`
              );
            } catch (error) {
              console.error(
                `[Document Automation] Error generating attestations for session ${session.id}:`,
                error
              );
              // Continue with next session
            }
          }
        } finally {
          client.release();
        }
      }

      console.log("[Document Automation] Attestation generation completed");
    } catch (error) {
      console.error("[Document Automation] Error in attestation generation:", error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * T119: Schedule quote expiration reminders (daily at 9 AM)
   */
  private scheduleQuoteReminders(): void {
    const runAt9AM = () => {
      const now = new Date();
      const targetTime = new Date();
      targetTime.setHours(9, 0, 0, 0);

      // If it's past 9 AM today, schedule for tomorrow
      if (now >= targetTime) {
        targetTime.setDate(targetTime.getDate() + 1);
      }

      const msUntil9AM = targetTime.getTime() - now.getTime();

      setTimeout(() => {
        this.sendQuoteExpirationReminders().catch((error) => {
          console.error("Error in quote reminder job:", error);
        });

        // Schedule next run (24 hours later)
        this.quoteReminderJobInterval = setInterval(() => {
          this.sendQuoteExpirationReminders().catch((error) => {
            console.error("Error in quote reminder job:", error);
          });
        }, 24 * 60 * 60 * 1000);
      }, msUntil9AM);
    };

    runAt9AM();
  }

  /**
   * Send email reminders for quotes expiring within 3 days
   */
  private async sendQuoteExpirationReminders(): Promise<void> {
    try {
      const tenantIds = await this.getTenantIds();
      console.log("[Document Automation] Starting quote expiration reminders...");

      // Find quotes expiring within 3 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const threeDaysFromNow = new Date(today);
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      threeDaysFromNow.setHours(23, 59, 59, 999);

      for (const tenantId of tenantIds) {
        const client = await this.dbPool.connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          const quotesQuery = `
            SELECT id, numero, metadata
            FROM documents
            WHERE tenant_id = $1
              AND type = 'devis'
              AND metadata->>'validite_jusqu_au' IS NOT NULL
              AND (metadata->>'validite_jusqu_au')::timestamp >= $2
              AND (metadata->>'validite_jusqu_au')::timestamp <= $3
              AND (metadata->>'reminder_sent' IS NULL OR (metadata->>'reminder_sent')::boolean = false)
          `;
          const quotesResult = await client.query(quotesQuery, [
            tenantId,
            today.toISOString(),
            threeDaysFromNow.toISOString(),
          ]);

          console.log(
            `[Document Automation] Tenant ${tenantId}: Found ${quotesResult.rows.length} quotes expiring within 3 days`
          );

          // Send reminders
          for (const quote of quotesResult.rows) {
            try {
              const metadata = quote.metadata || {};
              const clientData = metadata.client || {};
              const validiteDate = new Date(metadata.validite_jusqu_au);

              if (clientData.email) {
                await this.emailService.sendEmail({
                  to: clientData.email,
                  subject: `Rappel: Votre devis ${quote.numero} expire bientôt`,
                  html: `
                    <p>Bonjour ${clientData.prenom || ""} ${clientData.nom || ""},</p>
                    <p>Nous vous rappelons que votre devis <strong>${quote.numero}</strong> expire le <strong>${validiteDate.toLocaleDateString("fr-FR")}</strong>.</p>
                    <p>N'hésitez pas à nous contacter si vous souhaitez confirmer votre inscription.</p>
                    <p>Cordialement,<br>L'équipe Imhotep Academy</p>
                  `,
                });

                // Mark reminder as sent
                await client.query(
                  `UPDATE documents 
                   SET metadata = jsonb_set(metadata, '{reminder_sent}', 'true'::jsonb)
                   WHERE id = $1 AND tenant_id = $2`,
                  [quote.id, tenantId]
                );

                console.log(`[Document Automation] Sent reminder for quote ${quote.numero} (tenant: ${tenantId})`);
              }
            } catch (error) {
              console.error(`[Document Automation] Error sending reminder for quote ${quote.id}:`, error);
              // Continue with next quote
            }
          }
        } finally {
          client.release();
        }
      }

      console.log("[Document Automation] Quote reminders completed");
    } catch (error) {
      console.error("[Document Automation] Error in quote reminders:", error);
    }
  }

  /**
   * T125: Schedule document storage cleanup (daily at 3 AM)
   */
  private scheduleCleanup(): void {
    const runAt3AM = () => {
      const now = new Date();
      const targetTime = new Date();
      targetTime.setHours(3, 0, 0, 0);

      // If it's past 3 AM today, schedule for tomorrow
      if (now >= targetTime) {
        targetTime.setDate(targetTime.getDate() + 1);
      }

      const msUntil3AM = targetTime.getTime() - now.getTime();

      setTimeout(() => {
        this.cleanupOldExportFiles().catch((error) => {
          console.error("Error in cleanup job:", error);
        });

        // Schedule next run (24 hours later)
        this.cleanupJobInterval = setInterval(() => {
          this.cleanupOldExportFiles().catch((error) => {
            console.error("Error in cleanup job:", error);
          });
        }, 24 * 60 * 60 * 1000);
      }, msUntil3AM);
    };

    runAt3AM();
  }

  /**
   * Cleanup temporary export files older than 7 days
   */
  private async cleanupOldExportFiles(): Promise<void> {
    try {
      const tenantIds = await this.getTenantIds();
      console.log("[Document Automation] Starting export files cleanup...");

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const fileStorageService = getFileStorageService();
      let totalDeletedCount = 0;

      for (const tenantId of tenantIds) {
        const client = await this.dbPool.connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

          // Find export jobs older than 7 days
          const oldJobsQuery = `
            SELECT id, fichier_url
            FROM export_jobs
            WHERE tenant_id = $1
              AND status = 'completed'
              AND completed_at < $2
              AND fichier_url IS NOT NULL
          `;
          const oldJobsResult = await client.query(oldJobsQuery, [tenantId, sevenDaysAgo]);

          console.log(
            `[Document Automation] Tenant ${tenantId}: Found ${oldJobsResult.rows.length} old export files to clean up`
          );

          let deletedCount = 0;

          for (const job of oldJobsResult.rows) {
            try {
              await fileStorageService.deleteFile(job.fichier_url);
              deletedCount++;
            } catch (error) {
              console.error(
                `[Document Automation] Error deleting file ${job.fichier_url}:`,
                error
              );
              // Continue with next file
            }
          }

          totalDeletedCount += deletedCount;
        } finally {
          client.release();
        }
      }

      console.log(
        `[Document Automation] Cleanup completed: ${totalDeletedCount} files deleted across all tenants`
      );
    } catch (error) {
      console.error("[Document Automation] Error in cleanup:", error);
    }
  }
}

/**
 * Initialize and start document automation jobs
 */
export function initializeDocumentAutomationJob(
  dbPool: Pool,
  tenantIds?: string[]
): DocumentAutomationJob {
  const job = new DocumentAutomationJob({ dbPool, tenantIds });
  job.start();
  return job;
}

