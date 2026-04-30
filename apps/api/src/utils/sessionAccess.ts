/**
 * Session Access Verification Utility
 * 
 * Verifies that a trainer is assigned to a session before allowing access.
 * Used across all session-related endpoints to ensure trainers can only
 * access sessions they are assigned to.
 */

import { Pool } from "pg";
import { getTableName } from './table-names';

export interface SessionAccessError extends Error {
  code: "SESSION_NOT_FOUND" | "ACCESS_DENIED";
}

/**
 * Verify that a trainer is assigned to a session
 * 
 * @param pool - PostgreSQL connection pool
 * @param sessionId - Session ID to verify access for
 * @param formateurId - Trainer ID to verify
 * @param tenantId - Tenant ID for multi-tenant isolation
 * @returns Promise that resolves if access is granted, rejects if denied
 * @throws SessionAccessError if session not found or access denied
 */
export async function verifySessionAccess(
  pool: Pool,
  sessionId: string,
  formateurId: string,
  tenantId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    // Set tenant context for RLS
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

    // Check if session exists and trainer is assigned
    const query = `
      SELECT 
        s.id as session_id,
        sf.id as assignment_id
      FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
      INNER JOIN ${getTableName(tenantId, 'session_formateurs')} sf 
        ON sf.session_id = s.id 
        AND sf.formateur_id = $1
        AND sf.tenant_id = $2
      WHERE s.id = $3
        AND s.tenant_id = $2
    `;

    const result = await client.query(query, [formateurId, tenantId, sessionId]);

    if (result.rows.length === 0) {
      // Check if session exists at all
      const sessionCheck = await client.query(
        `SELECT id FROM ${getTableName(tenantId, 'sessions_professionnelles')} WHERE id = $1 AND tenant_id = $2`,
        [sessionId, tenantId]
      );

      if (sessionCheck.rows.length === 0) {
        const error: SessionAccessError = new Error("Session not found") as SessionAccessError;
        error.code = "SESSION_NOT_FOUND";
        throw error;
      }

      // Session exists but trainer is not assigned
      const error: SessionAccessError = new Error("Trainer is not assigned to this session") as SessionAccessError;
      error.code = "ACCESS_DENIED";
      throw error;
    }

    // Access granted - trainer is assigned to session
  } finally {
    client.release();
  }
}

