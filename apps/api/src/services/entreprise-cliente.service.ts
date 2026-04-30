/**
 * EntrepriseClienteService
 * 
 * Business logic for enterprise client management
 * Handles enterprise CRUD operations, statistics calculation, and grouped invoicing
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import ExcelJS from "exceljs";
import { getFileStorageService } from "./fileStorage";
import { DocumentGenerationService } from "./document-generation.service";
import { getTableName } from '../utils/table-names';
import type {
  CreateEntrepriseRequest,
  UpdateEntrepriseRequest,
  EntrepriseListQuery,
  EntrepriseListResponse,
  EntrepriseDetailResponse,
  EntrepriseWithStats,
  GenerateFacturationGroupeeRequest,
  GenerateFacturationGroupeeResponse,
} from "@ecoledigitale/contracts/src/entreprises";

export class EntrepriseClienteService {
  private documentGenerationService: DocumentGenerationService;

  constructor(private pool: Pool) {
    this.documentGenerationService = new DocumentGenerationService(pool);
  }

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * T052: Get enterprises list with filtering, sorting, pagination, and statistics
   */
  async getEntreprises(
    tenantId: string,
    query: EntrepriseListQuery
  ): Promise<EntrepriseListResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const { search, secteur, actif, sort, page, limit } = query;
      const offset = (page - 1) * limit;

      // Build WHERE conditions
      const whereConditions: string[] = ["e.tenant_id = $1"];
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      if (search) {
        whereConditions.push(
          `(e.raison_sociale ILIKE $${paramIndex} OR e.siret ILIKE $${paramIndex} OR e.contact_email ILIKE $${paramIndex})`
        );
        queryParams.push(`%${search}%`);
        paramIndex++;
      }

      if (secteur) {
        whereConditions.push(`e.secteur_activite = $${paramIndex++}`);
        queryParams.push(secteur);
      }

      if (actif !== undefined) {
        whereConditions.push(`e.actif = $${paramIndex++}`);
        queryParams.push(actif);
      }

      const whereClause = whereConditions.join(" AND ");

      // Build ORDER BY clause
      let orderBy = "e.created_at DESC";
      switch (sort) {
        case "nb_inscriptions":
          orderBy = "nb_inscriptions DESC, e.raison_sociale ASC";
          break;
        case "ca_total":
          orderBy = "ca_total DESC, e.raison_sociale ASC";
          break;
        case "raison_sociale":
          orderBy = "e.raison_sociale ASC";
          break;
      }

      // Count total
      const countQuery = `
        SELECT COUNT(*)::integer as total
        FROM ${getTableName(tenantId, 'entreprises_clientes')} e
        WHERE ${whereClause}
      `;
      const countResult = await client.query(countQuery, queryParams);
      const total = countResult.rows[0].total;
      const totalPages = Math.ceil(total / limit);

      // Get enterprises with statistics
      const enterprisesQuery = `
        SELECT
          e.id,
          e.raison_sociale,
          e.siret,
          e.forme_juridique,
          e.adresse,
          e.code_postal,
          e.ville,
          e.pays,
          e.contact_nom,
          e.contact_prenom,
          e.contact_email,
          e.contact_telephone,
          e.secteur_activite,
          e.nombre_employes,
          e.actif,
          e.notes,
          e.created_at,
          e.updated_at,
          COALESCE(COUNT(DISTINCT i.id), 0)::integer as nb_inscriptions,
          COALESCE(COUNT(DISTINCT i.apprenant_id), 0)::integer as nb_apprenants,
          COALESCE(SUM(i.montant_ttc), 0)::numeric as ca_total
        FROM ${getTableName(tenantId, 'entreprises_clientes')} e
        LEFT JOIN inscriptions_professionnelles i ON i.entreprise_id = e.id AND i.tenant_id = e.tenant_id
        WHERE ${whereClause}
        GROUP BY e.id
        ORDER BY ${orderBy}
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;
      queryParams.push(limit, offset);

      const result = await client.query(enterprisesQuery, queryParams);

      const entreprises: EntrepriseWithStats[] = result.rows.map((row: any) => ({
        id: row.id,
        raison_sociale: row.raison_sociale,
        siret: row.siret,
        forme_juridique: row.forme_juridique,
        adresse: row.adresse,
        code_postal: row.code_postal,
        ville: row.ville,
        pays: row.pays,
        contact_nom: row.contact_nom,
        contact_prenom: row.contact_prenom,
        contact_email: row.contact_email,
        contact_telephone: row.contact_telephone,
        secteur_activite: row.secteur_activite,
        nombre_employes: row.nombre_employes,
        actif: row.actif,
        notes: row.notes,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        nb_inscriptions: row.nb_inscriptions,
        nb_apprenants: row.nb_apprenants,
        ca_total: parseFloat(row.ca_total),
      }));

      return {
        entreprises,
        total,
        page,
        totalPages,
      };
    } finally {
      client.release();
    }
  }

  /**
   * T053: Get enterprise details with enrollments and statistics
   */
  async getEntrepriseDetails(tenantId: string, entrepriseId: string): Promise<EntrepriseDetailResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get enterprise
      const entrepriseQuery = `
        SELECT
          e.id,
          e.raison_sociale,
          e.siret,
          e.forme_juridique,
          e.adresse,
          e.code_postal,
          e.ville,
          e.pays,
          e.contact_nom,
          e.contact_prenom,
          e.contact_email,
          e.contact_telephone,
          e.secteur_activite,
          e.nombre_employes,
          e.actif,
          e.notes,
          e.created_at,
          e.updated_at
        FROM ${getTableName(tenantId, 'entreprises_clientes')} e
        WHERE e.id = $1 AND e.tenant_id = $2
      `;
      const entrepriseResult = await client.query(entrepriseQuery, [entrepriseId, tenantId]);
      if (entrepriseResult.rows.length === 0) {
        throw new Error("ENTERPRISE_NOT_FOUND");
      }
      const entreprise = entrepriseResult.rows[0];

      // Get enrollments
      const inscriptionsQuery = `
        SELECT
          i.id,
          i.numero_inscription,
          i.date_inscription,
          i.statut,
          i.montant_ttc,
          f.titre as formation,
          s.code_session,
          CONCAT(u.prenom, ' ', u.nom) as apprenant
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN ${getTableName(tenantId, 'sessions_professionnelles')} s ON i.session_id = s.id
        JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON s.formation_pro_id = f.id
        JOIN users u ON i.apprenant_id = u.id
        WHERE i.entreprise_id = $1 AND i.tenant_id = $2
        ORDER BY i.date_inscription DESC
      `;
      const inscriptionsResult = await client.query(inscriptionsQuery, [entrepriseId, tenantId]);

      // Calculate statistics
      const statsQuery = `
        SELECT
          COUNT(DISTINCT i.id)::integer as nb_inscriptions,
          COUNT(DISTINCT i.apprenant_id)::integer as nb_apprenants,
          COALESCE(SUM(i.montant_ttc), 0)::numeric as ca_total,
          ARRAY_AGG(DISTINCT f.titre) FILTER (WHERE f.titre IS NOT NULL) as formations_suivies
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN ${getTableName(tenantId, 'sessions_professionnelles')} s ON i.session_id = s.id
        JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON s.formation_pro_id = f.id
        WHERE i.entreprise_id = $1 AND i.tenant_id = $2
      `;
      const statsResult = await client.query(statsQuery, [entrepriseId, tenantId]);
      const stats = statsResult.rows[0];

      return {
        id: entreprise.id,
        raison_sociale: entreprise.raison_sociale,
        siret: entreprise.siret,
        forme_juridique: entreprise.forme_juridique,
        adresse: entreprise.adresse,
        code_postal: entreprise.code_postal,
        ville: entreprise.ville,
        pays: entreprise.pays,
        contact_nom: entreprise.contact_nom,
        contact_prenom: entreprise.contact_prenom,
        contact_email: entreprise.contact_email,
        contact_telephone: entreprise.contact_telephone,
        secteur_activite: entreprise.secteur_activite,
        nombre_employes: entreprise.nombre_employes,
        actif: entreprise.actif,
        notes: entreprise.notes,
        created_at: entreprise.created_at.toISOString(),
        updated_at: entreprise.updated_at.toISOString(),
        inscriptions: inscriptionsResult.rows.map((row: any) => ({
          id: row.id,
          numero_inscription: row.numero_inscription,
          date_inscription: row.date_inscription.toISOString(),
          statut: row.statut,
          montant_ttc: parseFloat(row.montant_ttc),
          formation: row.formation,
          session_code: row.code_session,
          apprenant: row.apprenant,
        })),
        statistiques: {
          nb_inscriptions: stats.nb_inscriptions,
          nb_apprenants: stats.nb_apprenants,
          ca_total: parseFloat(stats.ca_total),
          formations_suivies: stats.formations_suivies || [],
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * T054: Create enterprise with SIRET validation
   */
  async createEntreprise(tenantId: string, data: CreateEntrepriseRequest): Promise<{ id: string }> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Validate SIRET format (14 digits)
      if (data.siret && !/^\d{14}$/.test(data.siret)) {
        throw new Error("INVALID_SIRET_FORMAT");
      }

      // Check SIRET uniqueness if provided
      if (data.siret) {
        const existingQuery = `
          SELECT id FROM entreprises_clientes
          WHERE tenant_id = $1 AND siret = $2
        `;
        const existingResult = await client.query(existingQuery, [tenantId, data.siret]);
        if (existingResult.rows.length > 0) {
          throw new Error("SIRET_ALREADY_EXISTS");
        }
      }

      // Insert enterprise
      const insertQuery = `
        INSERT INTO ${getTableName(tenantId, 'entreprises_clientes')} (
          tenant_id, raison_sociale, siret, forme_juridique, adresse, code_postal, ville, pays,
          contact_nom, contact_prenom, contact_email, contact_telephone,
          secteur_activite, nombre_employes, notes, actif
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true)
        RETURNING id
      `;
      const result = await client.query(insertQuery, [
        tenantId,
        data.raison_sociale,
        data.siret,
        data.forme_juridique,
        data.adresse,
        data.code_postal,
        data.ville,
        data.pays || "Côte d'Ivoire",
        data.contact_nom,
        data.contact_prenom,
        data.contact_email,
        data.contact_telephone || null,
        data.secteur_activite || null,
        data.nombre_employes || null,
        data.notes || null,
      ]);

      return { id: result.rows[0].id };
    } finally {
      client.release();
    }
  }

  /**
   * T055: Update enterprise with SIRET validation if changed
   */
  async updateEntreprise(
    tenantId: string,
    entrepriseId: string,
    data: UpdateEntrepriseRequest
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Check if enterprise exists
      const checkQuery = `SELECT id, siret FROM entreprises_clientes WHERE id = $1 AND tenant_id = $2`;
      const checkResult = await client.query(checkQuery, [entrepriseId, tenantId]);
      if (checkResult.rows.length === 0) {
        throw new Error("ENTERPRISE_NOT_FOUND");
      }
      const existing = checkResult.rows[0];

      // Validate SIRET format if changed
      if (data.siret && data.siret !== existing.siret) {
        if (!/^\d{14}$/.test(data.siret)) {
          throw new Error("INVALID_SIRET_FORMAT");
        }

        // Check SIRET uniqueness
        const existingQuery = `
          SELECT id FROM entreprises_clientes
          WHERE tenant_id = $1 AND siret = $2 AND id != $3
        `;
        const existingResult = await client.query(existingQuery, [tenantId, data.siret, entrepriseId]);
        if (existingResult.rows.length > 0) {
          throw new Error("SIRET_ALREADY_EXISTS");
        }
      }

      // Build UPDATE query dynamically
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.raison_sociale !== undefined) {
        updates.push(`raison_sociale = $${paramIndex++}`);
        values.push(data.raison_sociale);
      }
      if (data.siret !== undefined) {
        updates.push(`siret = $${paramIndex++}`);
        values.push(data.siret);
      }
      if (data.forme_juridique !== undefined) {
        updates.push(`forme_juridique = $${paramIndex++}`);
        values.push(data.forme_juridique);
      }
      if (data.adresse !== undefined) {
        updates.push(`adresse = $${paramIndex++}`);
        values.push(data.adresse);
      }
      if (data.code_postal !== undefined) {
        updates.push(`code_postal = $${paramIndex++}`);
        values.push(data.code_postal);
      }
      if (data.ville !== undefined) {
        updates.push(`ville = $${paramIndex++}`);
        values.push(data.ville);
      }
      if (data.pays !== undefined) {
        updates.push(`pays = $${paramIndex++}`);
        values.push(data.pays);
      }
      if (data.contact_nom !== undefined) {
        updates.push(`contact_nom = $${paramIndex++}`);
        values.push(data.contact_nom);
      }
      if (data.contact_prenom !== undefined) {
        updates.push(`contact_prenom = $${paramIndex++}`);
        values.push(data.contact_prenom);
      }
      if (data.contact_email !== undefined) {
        updates.push(`contact_email = $${paramIndex++}`);
        values.push(data.contact_email);
      }
      if (data.contact_telephone !== undefined) {
        updates.push(`contact_telephone = $${paramIndex++}`);
        values.push(data.contact_telephone);
      }
      if (data.secteur_activite !== undefined) {
        updates.push(`secteur_activite = $${paramIndex++}`);
        values.push(data.secteur_activite);
      }
      if (data.nombre_employes !== undefined) {
        updates.push(`nombre_employes = $${paramIndex++}`);
        values.push(data.nombre_employes);
      }
      if (data.notes !== undefined) {
        updates.push(`notes = $${paramIndex++}`);
        values.push(data.notes);
      }
      if (data.actif !== undefined) {
        updates.push(`actif = $${paramIndex++}`);
        values.push(data.actif);
      }

      if (updates.length === 0) {
        return; // No updates to perform
      }

      updates.push(`updated_at = NOW()`);
      values.push(entrepriseId, tenantId);

      const updateQuery = `
        UPDATE ${getTableName(tenantId, 'entreprises_clientes')}
        SET ${updates.join(", ")}
        WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex++}
      `;
      await client.query(updateQuery, values);
    } finally {
      client.release();
    }
  }

  /**
   * T056: Delete enterprise (soft delete) with validation
   */
  async deleteEntreprise(tenantId: string, entrepriseId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Check for active enrollments
      const enrollmentsQuery = `
        SELECT COUNT(*)::integer as count
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')}
        WHERE entreprise_id = $1 AND tenant_id = $2
      `;
      const enrollmentsResult = await client.query(enrollmentsQuery, [entrepriseId, tenantId]);
      if (enrollmentsResult.rows[0].count > 0) {
        throw new Error("ENTERPRISE_HAS_ENROLLMENTS");
      }

      // Soft delete by setting actif = false
      const deleteQuery = `
        UPDATE ${getTableName(tenantId, 'entreprises_clientes')}
        SET actif = false, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `;
      await client.query(deleteQuery, [entrepriseId, tenantId]);
    } finally {
      client.release();
    }
  }

  /**
   * T057: Generate grouped invoice for multiple enrollments
   */
  async generateFacturationGroupee(
    tenantId: string,
    entrepriseId: string,
    request: GenerateFacturationGroupeeRequest,
    userId?: string
  ): Promise<GenerateFacturationGroupeeResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Verify enterprise exists
      const entrepriseQuery = `
        SELECT id, raison_sociale, siret, adresse, code_postal, ville, contact_email
        FROM ${getTableName(tenantId, 'entreprises_clientes')}
        WHERE id = $1 AND tenant_id = $2 AND actif = true
      `;
      const entrepriseResult = await client.query(entrepriseQuery, [entrepriseId, tenantId]);
      if (entrepriseResult.rows.length === 0) {
        throw new Error("ENTERPRISE_NOT_FOUND");
      }
      const entreprise = entrepriseResult.rows[0];

      // Fetch enrollments and validate they belong to the enterprise
      const inscriptionsQuery = `
        SELECT
          i.id, i.numero_inscription, i.montant_ht, i.montant_ttc, i.date_inscription,
          s.code_session, s.date_debut, s.date_fin,
          f.titre as formation_titre,
          u.nom as apprenant_nom, u.prenom as apprenant_prenom
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN ${getTableName(tenantId, 'sessions_professionnelles')} s ON i.session_id = s.id
        JOIN ${getTableName(tenantId, 'formations_professionnelles')} f ON s.formation_pro_id = f.id
        JOIN users u ON i.apprenant_id = u.id
        WHERE i.id = ANY($1::uuid[]) AND i.entreprise_id = $2 AND i.tenant_id = $3
      `;
      const inscriptionsResult = await client.query(inscriptionsQuery, [
        request.inscription_ids,
        entrepriseId,
        tenantId,
      ]);

      if (inscriptionsResult.rows.length !== request.inscription_ids.length) {
        throw new Error("SOME_ENROLLMENTS_NOT_FOUND_OR_NOT_BELONG_TO_ENTERPRISE");
      }

      // Generate invoice number
      const numeroFacture = await this.generateNumeroFactureGroupee(client, tenantId);

      // Generate PDF
      const pdfBuffer = await this.documentGenerationService.createFactureGroupeePDF(
        entreprise,
        inscriptionsResult.rows,
        numeroFacture,
        request.date_echeance ? new Date(request.date_echeance) : undefined
      );

      // Save to FileStorageService
      const fileStorageService = getFileStorageService();
      const fileName = `facture-groupee-${numeroFacture}.pdf`;
      const uploadResult = await fileStorageService.uploadFile(pdfBuffer, {
        tenantId,
        courseId: "documents",
        fileName,
        contentType: "application/pdf",
        metadata: {
          type: "facture_groupee",
          numero: numeroFacture,
          entreprise_id: entrepriseId,
          inscription_ids: request.inscription_ids,
        },
      });

      // Store document record
      const insertQuery = `
        INSERT INTO documents (
          tenant_id, type, numero, entreprise_id,
          fichier_url, genere_par, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      await client.query(insertQuery, [
        tenantId,
        "facture_groupee",
        numeroFacture,
        entrepriseId,
        uploadResult.key,
        userId,
        {
          inscription_ids: request.inscription_ids,
          date_echeance: request.date_echeance,
        },
      ]);

      return {
        facture_url: `/api/v1/admin/documents/${uploadResult.key}`,
        numero_facture: numeroFacture,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Generate unique grouped invoice number
   */
  private async generateNumeroFactureGroupee(client: any, tenantId: string): Promise<string> {
    const prefix = "FGRP";
    const year = new Date().getFullYear();

    const query = `
      SELECT COUNT(*)::integer as count
      FROM documents
      WHERE tenant_id = $1 AND type = 'facture_groupee' AND numero LIKE $2 || '%'
    `;
    const result = await client.query(query, [tenantId, `${prefix}-${year}-`]);
    const count = result.rows[0].count + 1;

    return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
  }

  /**
   * T059: Export enterprises to Excel
   */
  async exportEntreprisesToExcel(tenantId: string): Promise<Buffer> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get all enterprises with statistics
      const query = `
        SELECT
          e.raison_sociale,
          e.siret,
          e.forme_juridique,
          e.adresse,
          e.code_postal,
          e.ville,
          e.pays,
          e.contact_nom,
          e.contact_prenom,
          e.contact_email,
          e.contact_telephone,
          e.secteur_activite,
          e.nombre_employes,
          e.actif,
          COALESCE(COUNT(DISTINCT i.id), 0)::integer as nb_inscriptions,
          COALESCE(SUM(i.montant_ttc), 0)::numeric as ca_total
        FROM ${getTableName(tenantId, 'entreprises_clientes')} e
        LEFT JOIN inscriptions_professionnelles i ON i.entreprise_id = e.id AND i.tenant_id = e.tenant_id
        WHERE e.tenant_id = $1
        GROUP BY e.id
        ORDER BY e.raison_sociale ASC
      `;
      const result = await client.query(query, [tenantId]);

      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Entreprises");

      // Define columns
      worksheet.columns = [
        { header: "Raison sociale", key: "raison_sociale", width: 30 },
        { header: "SIRET", key: "siret", width: 15 },
        { header: "Forme juridique", key: "forme_juridique", width: 20 },
        { header: "Adresse", key: "adresse", width: 40 },
        { header: "Code postal", key: "code_postal", width: 12 },
        { header: "Ville", key: "ville", width: 20 },
        { header: "Pays", key: "pays", width: 20 },
        { header: "Contact", key: "contact", width: 30 },
        { header: "Email", key: "email", width: 30 },
        { header: "Téléphone", key: "telephone", width: 15 },
        { header: "Secteur", key: "secteur", width: 25 },
        { header: "Employés", key: "employes", width: 12 },
        { header: "Actif", key: "actif", width: 10 },
        { header: "Nb inscriptions", key: "nb_inscriptions", width: 15 },
        { header: "CA Total (XOF)", key: "ca_total", width: 18 },
      ];

      // Style header
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };

      // Add data rows
      result.rows.forEach((row: any) => {
        worksheet.addRow({
          raison_sociale: row.raison_sociale,
          siret: row.siret || "",
          forme_juridique: row.forme_juridique || "",
          adresse: row.adresse || "",
          code_postal: row.code_postal || "",
          ville: row.ville || "",
          pays: row.pays || "",
          contact: `${row.contact_prenom || ""} ${row.contact_nom || ""}`.trim(),
          email: row.contact_email || "",
          telephone: row.contact_telephone || "",
          secteur: row.secteur_activite || "",
          employes: row.nombre_employes || "",
          actif: row.actif ? "Oui" : "Non",
          nb_inscriptions: row.nb_inscriptions,
          ca_total: parseFloat(row.ca_total),
        });
      });

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } finally {
      client.release();
    }
  }
}

