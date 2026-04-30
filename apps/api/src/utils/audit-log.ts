/**
 * Audit Log Utility
 * 
 * Logs trainer actions for audit purposes
 * T063: Audit logging utility
 */

import { Pool } from "pg";

export interface AuditLogEntry {
  tenantId: string;
  formateurId: string;
  actionType: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, any>;
}

export class AuditLogService {
  constructor(private pool: Pool) {}

  /**
   * Log a trainer action
   */
  async logAction(entry: AuditLogEntry): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Set tenant context
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [entry.tenantId]);

      // Insert audit log entry
      // Note: This assumes an audit_log table exists. If not, we'll log to console for now.
      // In production, you would create a proper audit_log table.
      const logMessage = {
        timestamp: new Date().toISOString(),
        tenantId: entry.tenantId,
        formateurId: entry.formateurId,
        actionType: entry.actionType,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata,
      };

      // Log to console for now (can be extended to write to database or file)
      console.log("[AUDIT]", JSON.stringify(logMessage));

      // TODO: If audit_log table exists, insert there:
      // await client.query(
      //   `INSERT INTO audit_log (tenant_id, user_id, action_type, resource_type, resource_id, metadata, created_at)
      //    VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      //   [entry.tenantId, entry.formateurId, entry.actionType, entry.resourceType, entry.resourceId, JSON.stringify(entry.metadata)]
      // );
    } catch (error) {
      // Don't throw - audit logging should not break the main flow
      console.error("[AUDIT] Failed to log action:", error);
    } finally {
      client.release();
    }
  }
}

