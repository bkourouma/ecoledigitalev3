/**
 * Formateur Attendance Service
 * 
 * Handles attendance tracking for professional training sessions
 * T027-T029: Attendance service methods
 */

import { Pool } from "pg";
import { verifySessionAccess } from "../utils/sessionAccess";
import { getTableName } from '../utils/table-names';

export class FormateurAttendanceService {
  constructor(private pool: Pool) {}

  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Mark attendance for a learner
   * T027: Mark attendance service method
   */
  async markAttendance(
    sessionId: string,
    inscriptionId: string,
    present: boolean,
    formateurId: string,
    tenantId: string
  ): Promise<{
    inscription_id: string;
    present: boolean;
    marked_at: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify session access
      await verifySessionAccess(this.pool, sessionId, formateurId, tenantId);

      // Verify session status is 'en_cours' or 'terminee'
      const sessionQuery = `
        SELECT statut
        FROM ${getTableName(tenantId, 'sessions_professionnelles')}
        WHERE id = $1 AND tenant_id = $2
      `;
      const sessionResult = await client.query(sessionQuery, [sessionId, tenantId]);
      
      if (sessionResult.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND: Session not found");
      }

      const sessionStatus = sessionResult.rows[0].statut;
      if (sessionStatus !== 'en_cours' && sessionStatus !== 'terminee') {
        throw new Error("INVALID_SESSION_STATUS: Attendance can only be marked for sessions in progress or completed");
      }

      // Verify inscription belongs to session
      const inscriptionQuery = `
        SELECT id
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
        WHERE id = $1 AND session_id = $2 AND tenant_id = $3
      `;
      const inscriptionResult = await client.query(inscriptionQuery, [inscriptionId, sessionId, tenantId]);
      
      if (inscriptionResult.rows.length === 0) {
        throw new Error("INSCRIPTION_NOT_FOUND: Enrollment not found for this session");
      }

      // Upsert attendance record
      const attendanceTable = getTableName(tenantId, "session_attendance");
      const upsertQuery = `
        INSERT INTO ${attendanceTable} (
          tenant_id,
          session_id,
          inscription_id,
          present,
          marked_by
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id, session_id, inscription_id)
        DO UPDATE SET
          present = EXCLUDED.present,
          marked_by = EXCLUDED.marked_by,
          marked_at = NOW(),
          updated_at = NOW()
        RETURNING marked_at
      `;

      const result = await client.query(upsertQuery, [
        tenantId,
        sessionId,
        inscriptionId,
        present,
        formateurId,
      ]);

      return {
        inscription_id: inscriptionId,
        present,
        marked_at: result.rows[0].marked_at.toISOString(),
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get attendance statistics for a session
   * T028: Attendance statistics calculation
   */
  async getAttendanceStats(
    sessionId: string,
    tenantId: string
  ): Promise<{
    total_inscrits: number;
    presents: number;
    absents: number;
    non_marques: number;
    taux_presence: number; // Percentage
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);
      const attendanceTable = getTableName(tenantId, "session_attendance");

      const statsQuery = `
        SELECT 
          COUNT(DISTINCT i.id)::integer as total_inscrits,
          COUNT(DISTINCT CASE WHEN sa.present = TRUE THEN i.id END)::integer as presents,
          COUNT(DISTINCT CASE WHEN sa.present = FALSE THEN i.id END)::integer as absents,
          COUNT(DISTINCT CASE WHEN sa.id IS NULL THEN i.id END)::integer as non_marques
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        LEFT JOIN ${attendanceTable} sa ON sa.inscription_id = i.id AND sa.session_id = $1 AND sa.tenant_id = $2
        WHERE i.session_id = $1 AND i.tenant_id = $2 AND i.statut = 'confirmee'
      `;

      const result = await client.query(statsQuery, [sessionId, tenantId]);
      const stats = result.rows[0];

      const total = stats.total_inscrits || 0;
      const presents = stats.presents || 0;
      const absents = stats.absents || 0;
      const non_marques = stats.non_marques || 0;

      // Calculate attendance percentage
      const taux_presence = total > 0 ? Math.round((presents / total) * 100) : 0;

      return {
        total_inscrits: total,
        presents,
        absents,
        non_marques,
        taux_presence,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Export attendance list as CSV
   * T029: Attendance export service
   */
  async exportAttendanceList(
    sessionId: string,
    format: "csv" | "pdf",
    tenantId: string
  ): Promise<{
    content: string | Buffer;
    filename: string;
    contentType: string;
  }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get session info
      const formationsTable = getTableName(tenantId, "formations_professionnelles");
      const inscriptionsTable = getTableName(tenantId, "inscriptions_professionnelles");
      const entreprisesTable = getTableName(tenantId, "entreprises_clientes");
      const attendanceTable = getTableName(tenantId, "session_attendance");

      const sessionQuery = `
        SELECT s.code_session, s.date_debut, s.date_fin, f.titre as formation_titre
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        INNER JOIN ${formationsTable} f ON f.id = s.formation_pro_id AND f.tenant_id = s.tenant_id
        WHERE s.id = $1 AND s.tenant_id = $2
      `;
      const sessionResult = await client.query(sessionQuery, [sessionId, tenantId]);
      
      if (sessionResult.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND: Session not found");
      }

      const session = sessionResult.rows[0];

      // Get attendance data
      const attendanceQuery = `
        SELECT 
          COALESCE(NULLIF(u.last_name, ''), NULLIF(split_part(COALESCE(u.name, ''), ' ', 2), ''), COALESCE(u.name, '')) as nom,
          COALESCE(NULLIF(u.first_name, ''), NULLIF(split_part(COALESCE(u.name, ''), ' ', 1), ''), '') as prenom,
          u.email,
          NULL::text as telephone,
          COALESCE(e.raison_sociale, '') as entreprise_nom,
          i.statut as statut_inscription,
          sa.present,
          sa.marked_at
        FROM ${inscriptionsTable} i
        INNER JOIN users u ON i.apprenant_id = u.id AND u.tenant_id = $2
        LEFT JOIN ${entreprisesTable} e ON i.entreprise_id = e.id AND i.tenant_id = e.tenant_id
        LEFT JOIN ${attendanceTable} sa ON sa.inscription_id = i.id AND sa.session_id = $1 AND sa.tenant_id = $2
        WHERE i.session_id = $1 AND i.tenant_id = $2 AND i.statut = 'confirmee'
        ORDER BY COALESCE(NULLIF(u.last_name, ''), COALESCE(u.name, '')), COALESCE(NULLIF(u.first_name, ''), '')
      `;

      const attendanceResult = await client.query(attendanceQuery, [sessionId, tenantId]);
      const rows = attendanceResult.rows;

      if (format === "csv") {
        // Generate CSV
        const headers = [
          "Nom",
          "Prénom",
          "Email",
          "Téléphone",
          "Entreprise",
          "Statut inscription",
          "Présence",
          "Date marquage",
        ];

        const csvRows = [
          headers.join(","),
          ...rows.map((row: any) => {
            const presence = row.present === null ? "Non marqué" : row.present ? "Présent" : "Absent";
            const markedAt = row.marked_at
              ? new Date(row.marked_at).toLocaleString("fr-FR")
              : "";
            return [
              `"${(row.nom || "").replace(/"/g, '""')}"`,
              `"${(row.prenom || "").replace(/"/g, '""')}"`,
              `"${(row.email || "").replace(/"/g, '""')}"`,
              `"${(row.telephone || "").replace(/"/g, '""')}"`,
              `"${(row.entreprise_nom || "").replace(/"/g, '""')}"`,
              `"${row.statut_inscription || ""}"`,
              `"${presence}"`,
              `"${markedAt}"`,
            ].join(",");
          }),
        ];

        const csvContent = csvRows.join("\n");
        const filename = `emargement-${session.code_session}.csv`;

        return {
          content: csvContent,
          filename,
          contentType: "text/csv; charset=utf-8",
        };
      } else {
        // PDF export would require a PDF library (e.g., pdfkit, puppeteer)
        // For now, throw an error indicating PDF is not yet implemented
        throw new Error("PDF export is not yet implemented. Please use CSV format.");
      }
    } finally {
      client.release();
    }
  }
}
