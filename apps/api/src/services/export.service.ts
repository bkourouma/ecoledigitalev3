/**
 * ExportService
 * 
 * Business logic for data exports
 * Handles Excel/CSV generation for enrollments, payments, attendance, and custom exports
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import ExcelJS from "exceljs";
import { getFileStorageService } from "./fileStorage";
import { getTableName } from '../utils/table-names';
import type {
  ExportInscriptionsRequest,
  ExportPaiementsRequest,
  ExportPresencesRequest,
  ExportCAFormationRequest,
  ExportPersonnaliseRequest,
  ExportJobResponse,
  ExportJobStatus,
} from "@ecoledigitale/contracts/src/exports";

export class ExportService {
  constructor(private pool: Pool) {}

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * Build WHERE clause from filters
   */
  private buildWhereClause(
    filters: Record<string, any>,
    prefix: string = "",
    paramIndex: number = 1
  ): { clause: string; params: any[]; nextIndex: number } {
    const conditions: string[] = [];
    const params: any[] = [];
    let currentIndex = paramIndex;

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== "") {
        const column = prefix ? `${prefix}.${key}` : key;
        conditions.push(`${column} = $${currentIndex++}`);
        params.push(value);
      }
    }

    return {
      clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
      params,
      nextIndex: currentIndex,
    };
  }

  /**
   * T077: Export enrollments with filters and column selection
   */
  async exportInscriptions(
    tenantId: string,
    request: ExportInscriptionsRequest
  ): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { filters, format, colonnes } = request;

      // Build query with filters
      let whereClause = "i.tenant_id = $1";
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      if (filters.date_debut) {
        whereClause += ` AND i.date_inscription >= $${paramIndex++}`;
        queryParams.push(filters.date_debut);
      }
      if (filters.date_fin) {
        whereClause += ` AND i.date_inscription <= $${paramIndex++}`;
        queryParams.push(filters.date_fin);
      }
      if (filters.statut) {
        whereClause += ` AND i.statut = $${paramIndex++}`;
        queryParams.push(filters.statut);
      }
      if (filters.formation_id) {
        whereClause += ` AND f.id = $${paramIndex++}`;
        queryParams.push(filters.formation_id);
      }
      if (filters.session_id) {
        whereClause += ` AND s.id = $${paramIndex++}`;
        queryParams.push(filters.session_id);
      }

      // Build column selection
      const columnMap: Record<string, string> = {
        numero_inscription: "i.numero_inscription",
        date_inscription: "i.date_inscription",
        statut: "i.statut",
        montant_ht: "i.montant_ht",
        montant_ttc: "i.montant_ttc",
        apprenant_nom: "u.nom",
        apprenant_prenom: "u.prenom",
        apprenant_email: "u.email",
        apprenant_telephone: "u.telephone",
        formation: "f.titre",
        session_code: "s.code_session",
        session_date_debut: "s.date_debut",
        session_date_fin: "s.date_fin",
        entreprise: "e.raison_sociale",
      };

      const selectedColumns = colonnes
        .map((col) => columnMap[col] || null)
        .filter((col) => col !== null)
        .join(", ");

      const query = `
        SELECT ${selectedColumns}
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN sessions_professionnelles s ON i.session_id = s.id
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        JOIN users u ON i.apprenant_id = u.id
        LEFT JOIN entreprises_clientes e ON i.entreprise_id = e.id
        ${whereClause}
        ORDER BY i.date_inscription DESC
      `;

      const result = await client.query(query, queryParams);

      if (format === "csv") {
        return this.generateCSV(result.rows, colonnes);
      } else {
        return await this.generateExcel(result.rows, colonnes, "Inscriptions");
      }
    } finally {
      client.release();
    }
  }

  /**
   * T078: Export payments with optional grouping
   */
  async exportPaiements(
    tenantId: string,
    request: ExportPaiementsRequest
  ): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { filters, format, grouper_par } = request;

      // Build query with filters
      let whereClause = "p.tenant_id = $1";
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      if (filters.date_debut) {
        whereClause += ` AND p.date_paiement >= $${paramIndex++}`;
        queryParams.push(filters.date_debut);
      }
      if (filters.date_fin) {
        whereClause += ` AND p.date_paiement <= $${paramIndex++}`;
        queryParams.push(filters.date_fin);
      }
      if (filters.methode) {
        whereClause += ` AND p.methode_paiement = $${paramIndex++}`;
        queryParams.push(filters.methode);
      }
      if (filters.statut) {
        whereClause += ` AND p.statut = $${paramIndex++}`;
        queryParams.push(filters.statut);
      }

      const query = `
        SELECT
          p.id, p.numero_transaction, p.montant, p.methode_paiement, p.statut,
          p.date_paiement, p.date_creation,
          i.numero_inscription,
          u.nom as apprenant_nom, u.prenom as apprenant_prenom,
          f.titre as formation, s.code_session
        FROM ${getTableName(tenantId, 'paiements_professionnels')} p
        JOIN inscriptions_professionnelles i ON p.inscription_id = i.id
        JOIN sessions_professionnelles s ON i.session_id = s.id
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        JOIN users u ON i.apprenant_id = u.id
        ${whereClause}
        ORDER BY p.date_paiement DESC
      `;

      const result = await client.query(query, queryParams);

      if (format === "csv") {
        return this.generateCSV(result.rows, Object.keys(result.rows[0] || {}));
      } else {
        return await this.generateExcelWithGrouping(
          result.rows,
          grouper_par,
          "Paiements"
        );
      }
    } finally {
      client.release();
    }
  }

  /**
   * T079: Export attendance for a session
   */
  async exportPresences(
    tenantId: string,
    request: ExportPresencesRequest
  ): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { session_id } = request;

      // Get session info
      const sessionQuery = `
        SELECT s.code_session, s.date_debut, s.date_fin,
               f.titre as formation_titre
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        WHERE s.id = $1 AND s.tenant_id = $2
      `;
      const sessionResult = await client.query(sessionQuery, [session_id, tenantId]);
      if (sessionResult.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND");
      }
      const session = sessionResult.rows[0];

      // Get attendance records
      const attendanceQuery = `
        SELECT
          u.nom, u.prenom, u.email,
          i.numero_inscription,
          sa.present, sa.date_presence
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN users u ON i.apprenant_id = u.id
        LEFT JOIN session_attendance sa ON sa.inscription_id = i.id AND sa.session_id = $1
        WHERE i.session_id = $1 AND i.tenant_id = $2
        ORDER BY u.nom, u.prenom
      `;
      const attendanceResult = await client.query(attendanceQuery, [session_id, tenantId]);

      // Calculate statistics
      const total = attendanceResult.rows.length;
      const present = attendanceResult.rows.filter((r: any) => r.present === true).length;
      const absent = total - present;
      const rate = total > 0 ? (present / total) * 100 : 0;

      // Generate Excel with statistics
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Présences");

      // Add session info
      worksheet.addRow(["Session", session.code_session]);
      worksheet.addRow(["Formation", session.formation_titre]);
      worksheet.addRow(["Date début", session.date_debut]);
      worksheet.addRow(["Date fin", session.date_fin]);
      worksheet.addRow([]);

      // Add statistics
      worksheet.addRow(["Statistiques"]);
      worksheet.addRow(["Total participants", total]);
      worksheet.addRow(["Présents", present]);
      worksheet.addRow(["Absents", absent]);
      worksheet.addRow(["Taux de présence", `${rate.toFixed(2)}%`]);
      worksheet.addRow([]);

      // Add attendance table
      worksheet.addRow(["Nom", "Prénom", "Email", "Numéro inscription", "Présent", "Date présence"]);
      worksheet.getRow(worksheet.rowCount).font = { bold: true };
      worksheet.getRow(worksheet.rowCount).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };

      attendanceResult.rows.forEach((row: any) => {
        worksheet.addRow([
          row.nom,
          row.prenom,
          row.email,
          row.numero_inscription,
          row.present ? "Oui" : "Non",
          row.date_presence ? new Date(row.date_presence).toLocaleDateString("fr-FR") : "",
        ]);
      });

      // Set column widths
      worksheet.columns.forEach((column) => {
        column.width = 20;
      });

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } finally {
      client.release();
    }
  }

  /**
   * T080: Export revenue by training for a year
   */
  async exportCAFormation(
    tenantId: string,
    request: ExportCAFormationRequest
  ): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { annee, format } = request;

      // Calculate revenue by formation
      const query = `
        SELECT
          f.id, f.titre as formation,
          COUNT(DISTINCT i.id) as nb_inscriptions,
          COUNT(DISTINCT i.apprenant_id) as nb_apprenants,
          SUM(i.montant_ttc) as ca_total,
          SUM(i.montant_ht) as ca_ht
        FROM ${getTableName(tenantId, 'formations_professionnelles')} f
        JOIN sessions_professionnelles s ON s.formation_pro_id = f.id
        JOIN inscriptions_professionnelles i ON i.session_id = s.id
        WHERE EXTRACT(YEAR FROM i.date_inscription) = $1
          AND i.tenant_id = $2
        GROUP BY f.id, f.titre
        ORDER BY ca_total DESC
      `;
      const result = await client.query(query, [annee, tenantId]);

      if (format === "csv") {
        return this.generateCSV(result.rows, ["formation", "nb_inscriptions", "nb_apprenants", "ca_ht", "ca_total"]);
      } else {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("CA par Formation");

        // Headers
        worksheet.addRow(["Formation", "Nb Inscriptions", "Nb Apprenants", "CA HT", "CA TTC"]);
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" },
        };

        // Data
        result.rows.forEach((row: any) => {
          worksheet.addRow([
            row.formation,
            row.nb_inscriptions,
            row.nb_apprenants,
            parseFloat(row.ca_ht || "0"),
            parseFloat(row.ca_total || "0"),
          ]);
        });

        // Set column widths
        worksheet.columns = [
          { width: 40 },
          { width: 15 },
          { width: 15 },
          { width: 15 },
          { width: 15 },
        ];

        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
      }
    } finally {
      client.release();
    }
  }

  /**
   * T081: Custom export with query builder
   */
  async exportPersonnalise(
    tenantId: string,
    request: ExportPersonnaliseRequest
  ): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { tables, colonnes, filtres, groupements, format } = request;

      // Build dynamic SQL query with tenant isolation
      // This is a simplified version - in production, you'd want more validation
      let query = `SELECT ${colonnes.join(", ")} FROM ${tables[0]}`;
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      // Add tenant filter
      if (tables[0] === "inscriptions_professionnelles") {
        query += ` WHERE tenant_id = $1`;
      } else if (tables[0] === "sessions_professionnelles") {
        query += ` WHERE tenant_id = $1`;
      } else if (tables[0] === "paiements_professionnels") {
        query += ` WHERE tenant_id = $1`;
      } else {
        // For other tables, join with a tenant-scoped table
        throw new Error("CUSTOM_EXPORT_NOT_SUPPORTED_FOR_THIS_TABLE");
      }

      // Add filters
      if (filtres && filtres.length > 0) {
        const filterConditions = filtres.map((filtre) => {
          query += ` AND ${filtre.colonne} ${filtre.operateur} $${paramIndex++}`;
          queryParams.push(filtre.valeur);
        });
      }

      // Add groupings
      if (groupements && groupements.length > 0) {
        query += ` GROUP BY ${groupements.join(", ")}`;
      }

      const result = await client.query(query, queryParams);

      if (format === "csv") {
        return this.generateCSV(result.rows, colonnes);
      } else {
        return await this.generateExcel(result.rows, colonnes, "Export Personnalisé");
      }
    } finally {
      client.release();
    }
  }

  /**
   * Generate CSV from data
   */
  private generateCSV(rows: any[], columns: string[]): Buffer {
    const headers = columns.join(",");
    const dataRows = rows.map((row) =>
      columns.map((col) => {
        const value = row[col];
        if (value === null || value === undefined) return "";
        // Escape commas and quotes
        const str = String(value);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(",")
    );
    const csv = [headers, ...dataRows].join("\n");
    return Buffer.from(csv, "utf-8");
  }

  /**
   * Generate Excel from data
   */
  private async generateExcel(rows: any[], columns: string[], sheetName: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    // Set headers
    worksheet.columns = columns.map((col) => ({
      header: col,
      key: col,
      width: 20,
    }));

    // Style header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    // Add data
    rows.forEach((row) => {
      worksheet.addRow(row);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Generate Excel with grouping
   */
  private async generateExcelWithGrouping(
    rows: any[],
    grouper_par: "methode" | "jour" | "formation" | undefined,
    sheetName: string
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const detailedSheet = workbook.addWorksheet("Détails");

    // Detailed sheet
    detailedSheet.columns = [
      { header: "Transaction", key: "numero_transaction", width: 20 },
      { header: "Montant", key: "montant", width: 15 },
      { header: "Méthode", key: "methode_paiement", width: 15 },
      { header: "Statut", key: "statut", width: 12 },
      { header: "Date", key: "date_paiement", width: 15 },
      { header: "Apprenant", key: "apprenant", width: 25 },
      { header: "Formation", key: "formation", width: 30 },
    ];

    detailedSheet.getRow(1).font = { bold: true };
    detailedSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE0E0E0" },
    };

    rows.forEach((row: any) => {
      detailedSheet.addRow({
        numero_transaction: row.numero_transaction,
        montant: parseFloat(row.montant || "0"),
        methode_paiement: row.methode_paiement,
        statut: row.statut,
        date_paiement: row.date_paiement ? new Date(row.date_paiement).toLocaleDateString("fr-FR") : "",
        apprenant: `${row.apprenant_prenom} ${row.apprenant_nom}`,
        formation: row.formation,
      });
    });

    // Grouped sheet if grouping requested
    if (grouper_par) {
      const groupedSheet = workbook.addWorksheet("Groupé");
      const grouped = this.groupData(rows, grouper_par);

      if (grouper_par === "methode") {
        groupedSheet.columns = [
          { header: "Méthode de paiement", key: "group", width: 20 },
          { header: "Nombre", key: "count", width: 12 },
          { header: "Total", key: "total", width: 15 },
        ];
      } else if (grouper_par === "jour") {
        groupedSheet.columns = [
          { header: "Jour", key: "group", width: 15 },
          { header: "Nombre", key: "count", width: 12 },
          { header: "Total", key: "total", width: 15 },
        ];
      } else if (grouper_par === "formation") {
        groupedSheet.columns = [
          { header: "Formation", key: "group", width: 40 },
          { header: "Nombre", key: "count", width: 12 },
          { header: "Total", key: "total", width: 15 },
        ];
      }

      groupedSheet.getRow(1).font = { bold: true };
      groupedSheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };

      grouped.forEach((group) => {
        groupedSheet.addRow(group);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Group data by specified field
   */
  private groupData(rows: any[], groupBy: "methode" | "jour" | "formation"): Array<{ group: string; count: number; total: number }> {
    const groups = new Map<string, { count: number; total: number }>();

    rows.forEach((row: any) => {
      let key: string;
      if (groupBy === "methode") {
        key = row.methode_paiement || "Non spécifié";
      } else if (groupBy === "jour") {
        key = row.date_paiement ? new Date(row.date_paiement).toLocaleDateString("fr-FR") : "Non spécifié";
      } else {
        key = row.formation || "Non spécifié";
      }

      if (!groups.has(key)) {
        groups.set(key, { count: 0, total: 0 });
      }

      const group = groups.get(key)!;
      group.count++;
      group.total += parseFloat(row.montant || "0");
    });

    return Array.from(groups.entries()).map(([group, data]) => ({
      group,
      ...data,
    }));
  }

  /**
   * T082: Create export job
   */
  async createExportJob(
    tenantId: string,
    type: string,
    config: any,
    userId: string
  ): Promise<string> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const insertQuery = `
        INSERT INTO export_jobs (
          tenant_id, type, status, config, created_by
        ) VALUES ($1, $2, 'pending', $3, $4)
        RETURNING id
      `;
      const result = await client.query(insertQuery, [tenantId, type, JSON.stringify(config), userId]);
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  /**
   * T083: Process export job
   */
  async processExportJob(tenantId: string, jobId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get job
      const jobQuery = `SELECT * FROM export_jobs WHERE id = $1 AND tenant_id = $2`;
      const jobResult = await client.query(jobQuery, [jobId, tenantId]);
      if (jobResult.rows.length === 0) {
        throw new Error("JOB_NOT_FOUND");
      }
      const job = jobResult.rows[0];

      // Update status to processing
      await client.query(
        `UPDATE export_jobs SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [jobId]
      );

      try {
        // Generate export based on type
        let buffer: Buffer;
        const config = typeof job.config === "string" ? JSON.parse(job.config) : job.config;

        switch (job.type) {
          case "inscriptions":
            buffer = await this.exportInscriptions(tenantId, config);
            break;
          case "paiements":
            buffer = await this.exportPaiements(tenantId, config);
            break;
          case "presences":
            buffer = await this.exportPresences(tenantId, config);
            break;
          case "ca_formation":
            buffer = await this.exportCAFormation(tenantId, config);
            break;
          case "personnalise":
            buffer = await this.exportPersonnalise(tenantId, config);
            break;
          default:
            throw new Error("UNKNOWN_EXPORT_TYPE");
        }

        // Save file
        const fileStorageService = getFileStorageService();
        const extension = config.format === "csv" ? "csv" : "xlsx";
        const fileName = `export-${job.type}-${jobId}.${extension}`;
        const uploadResult = await fileStorageService.uploadFile(buffer, {
          tenantId,
          courseId: "exports",
          fileName,
          contentType: config.format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          metadata: {
            type: job.type,
            job_id: jobId,
          },
        });

        // Update job as completed
        await client.query(
          `UPDATE export_jobs 
           SET status = 'completed', fichier_url = $1, progress = 100, completed_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [uploadResult.key, jobId]
        );
      } catch (error) {
        // Update job as failed
        await client.query(
          `UPDATE export_jobs 
           SET status = 'failed', error_message = $1, updated_at = NOW()
           WHERE id = $2`,
          [error instanceof Error ? error.message : "Unknown error", jobId]
        );
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * T084: Get export job status
   */
  async getExportJobStatus(tenantId: string, jobId: string): Promise<ExportJobResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const query = `
        SELECT id, status, progress, fichier_url, error_message, created_at, completed_at
        FROM export_jobs
        WHERE id = $1 AND tenant_id = $2
      `;
      const result = await client.query(query, [jobId, tenantId]);
      if (result.rows.length === 0) {
        throw new Error("JOB_NOT_FOUND");
      }

      const job = result.rows[0];
      return {
        job_id: job.id,
        status: job.status as ExportJobStatus,
        progress: job.progress,
        fichier_url: job.fichier_url ? `/api/v1/admin/exports/jobs/${jobId}/download` : null,
        error_message: job.error_message,
        created_at: job.created_at.toISOString(),
        completed_at: job.completed_at ? job.completed_at.toISOString() : null,
      };
    } finally {
      client.release();
    }
  }
}

