/**
 * DocumentGenerationService
 * 
 * Business logic for administrative document generation
 * Handles PDF generation for conventions, attestations, quotes, and invoices
 * 
 * Multi-tenant isolation: All queries must include tenant_id filtering via RLS
 */

import { Pool } from "pg";
import PDFDocument from "pdfkit";
import { getFileStorageService } from "./fileStorage";
import { EmailService } from "./email.service";
import { getTableName } from '../utils/table-names';
import type {
  DocumentType,
  DocumentResponse,
  BatchGenerateResponse,
  DocumentListResponse,
} from "@ecoledigitale/contracts/src/documents";

type DocumentPrefix = "CONV" | "ATTP" | "ATTR" | "DEV" | "FACT" | "FGRP";

export class DocumentGenerationService {
  private emailService: EmailService;

  constructor(private pool: Pool) {
    this.emailService = new EmailService();
  }

  /**
   * Set tenant context for RLS policies
   * Must be called before any database query
   */
  private async setTenantContext(client: any, tenantId: string): Promise<void> {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  /**
   * T022: Generate unique document number
   * Format: PREFIX-YYYY-NNNN (e.g., CONV-2024-0001)
   */
  private async generateNumeroDocument(
    client: any,
    tenantId: string,
    type: DocumentType
  ): Promise<string> {
    const prefixMap: Record<DocumentType, DocumentPrefix> = {
      convention: "CONV",
      attestation_presence: "ATTP",
      attestation_reussite: "ATTR",
      devis: "DEV",
      facture: "FACT",
      facture_groupee: "FGRP",
    };

    const prefix = prefixMap[type];
    const year = new Date().getFullYear();
    const yearPrefix = `${prefix}-${year}-`;

    // Get the highest number for this type and year
    const query = `
      SELECT numero
      FROM documents
      WHERE tenant_id = $1 AND type = $2 AND numero LIKE $3
      ORDER BY numero DESC
      LIMIT 1
    `;
    const result = await client.query(query, [tenantId, type, `${yearPrefix}%`]);

    let nextNumber = 1;
    if (result.rows.length > 0) {
      const lastNumero = result.rows[0].numero;
      const lastNumber = parseInt(lastNumero.split("-")[2] || "0", 10);
      nextNumber = lastNumber + 1;
    }

    const numero = `${yearPrefix}${nextNumber.toString().padStart(4, "0")}`;
    return numero;
  }

  /**
   * T023: Generate convention document
   */
  async genererConvention(
    tenantId: string,
    inscriptionId: string,
    generePar?: string
  ): Promise<DocumentResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Check if document already exists
      const existingQuery = `
        SELECT id, numero, fichier_url
        FROM documents
        WHERE tenant_id = $1 AND type = 'convention' AND inscription_id = $2
        LIMIT 1
      `;
      const existingResult = await client.query(existingQuery, [tenantId, inscriptionId]);
      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        return {
          document_id: existing.id,
          document_url: existing.fichier_url,
          numero: existing.numero,
          deja_genere: true,
        };
      }

      // Fetch enrollment with all related data
      const enrollmentQuery = `
        SELECT 
          i.id, i.numero_inscription, i.montant_ht, i.montant_ttc, i.date_inscription,
          i.reduction_appliquee, i.code_promo_utilise,
          s.id as session_id, s.code_session, s.date_debut, s.date_fin, s.prix_ht, s.prix_ttc,
          s.mode_formation, s.lieu, s.horaires,
          f.id as formation_id, f.titre as formation_titre, f.description_courte,
          u.id as apprenant_id, u.nom as apprenant_nom, u.prenom as apprenant_prenom,
          u.email as apprenant_email, u.telephone as apprenant_telephone,
          e.id as entreprise_id, e.raison_sociale, e.siret, e.adresse as entreprise_adresse,
          e.code_postal, e.ville, e.contact_nom, e.contact_prenom, e.contact_email, e.contact_telephone
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN sessions_professionnelles s ON i.session_id = s.id
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        JOIN users u ON i.apprenant_id = u.id
        LEFT JOIN entreprises_clientes e ON i.entreprise_id = e.id
        WHERE i.id = $1 AND i.tenant_id = $2
      `;
      const enrollmentResult = await client.query(enrollmentQuery, [inscriptionId, tenantId]);
      if (enrollmentResult.rows.length === 0) {
        throw new Error("INSCRIPTION_NOT_FOUND");
      }

      const enrollment = enrollmentResult.rows[0];

      // Get payments
      const paymentsQuery = `
        SELECT methode_paiement, montant, date_paiement, statut
        FROM paiements_professionnels
        WHERE inscription_id = $1 AND tenant_id = $2
        ORDER BY date_paiement DESC
      `;
      const paymentsResult = await client.query(paymentsQuery, [inscriptionId, tenantId]);
      const paiements = paymentsResult.rows;

      // Generate document number
      const numero = await this.generateNumeroDocument(client, tenantId, "convention");

      // Generate PDF
      const pdfBuffer = await this.createConventionPDF(enrollment, paiements);

      // Save to FileStorageService
      const fileStorageService = getFileStorageService();
      const fileName = `convention-${numero}.pdf`;
      const uploadResult = await fileStorageService.uploadFile(pdfBuffer, {
        tenantId,
        courseId: "documents",
        fileName,
        contentType: "application/pdf",
        metadata: {
          type: "convention",
          numero,
          inscription_id: inscriptionId,
        },
      });

      // Store metadata in database
      const insertQuery = `
        INSERT INTO documents (
          tenant_id, type, numero, inscription_id, session_id, entreprise_id,
          fichier_url, genere_par, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `;
      const insertResult = await client.query(insertQuery, [
        tenantId,
        "convention",
        numero,
        inscriptionId,
        enrollment.session_id,
        enrollment.entreprise_id || null,
        uploadResult.key,
        generePar || null,
        JSON.stringify({
          montant_ht: enrollment.montant_ht,
          montant_ttc: enrollment.montant_ttc,
        }),
      ]);

      return {
        document_id: insertResult.rows[0].id,
        document_url: `/api/v1/files/${uploadResult.key}`,
        numero,
        deja_genere: false,
      };
    } finally {
      client.release();
    }
  }

  /**
   * T024: Create convention PDF
   */
  private async createConventionPDF(enrollment: any, paiements: any[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Header
      doc.fontSize(20).text("CONVENTION DE FORMATION", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`N° ${enrollment.numero_inscription}`, { align: "right" });
      doc.text(`Date: ${new Date(enrollment.date_inscription).toLocaleDateString("fr-FR")}`, {
        align: "right",
      });
      doc.moveDown(2);

      // Parties
      doc.fontSize(14).text("PARTIES", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text("Formateur:", { continued: false });
      doc.text("Imhotep Academy / EcoleDigitale");
      doc.text("Email: contact@ecoledigitale.com");
      doc.moveDown();

      if (enrollment.entreprise_id) {
        doc.text("Bénéficiaire (Entreprise):", { continued: false });
        doc.text(enrollment.raison_sociale);
        if (enrollment.siret) doc.text(`SIRET: ${enrollment.siret}`);
        if (enrollment.entreprise_adresse) doc.text(enrollment.entreprise_adresse);
        doc.text(`${enrollment.code_postal} ${enrollment.ville}`);
        doc.text(`Contact: ${enrollment.contact_prenom} ${enrollment.contact_nom}`);
        doc.text(`Email: ${enrollment.contact_email}`);
        if (enrollment.contact_telephone) doc.text(`Tél: ${enrollment.contact_telephone}`);
      }
      doc.text("Participant:", { continued: false });
      doc.text(`${enrollment.apprenant_prenom} ${enrollment.apprenant_nom}`);
      doc.text(`Email: ${enrollment.apprenant_email}`);
      if (enrollment.apprenant_telephone) doc.text(`Tél: ${enrollment.apprenant_telephone}`);
      doc.moveDown(2);

      // Objet
      doc.fontSize(14).text("OBJET", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(
        `La présente convention a pour objet la formation professionnelle intitulée "${enrollment.formation_titre}".`
      );
      doc.moveDown(2);

      // Caractéristiques
      doc.fontSize(14).text("CARACTÉRISTIQUES DE LA FORMATION", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Formation: ${enrollment.formation_titre}`);
      doc.text(`Code session: ${enrollment.code_session}`);
      doc.text(
        `Dates: Du ${new Date(enrollment.date_debut).toLocaleDateString("fr-FR")} au ${new Date(enrollment.date_fin).toLocaleDateString("fr-FR")}`
      );
      if (enrollment.horaires) doc.text(`Horaires: ${enrollment.horaires}`);
      doc.text(`Mode: ${this.formatMode(enrollment.mode_formation)}`);
      if (enrollment.lieu) doc.text(`Lieu: ${enrollment.lieu}`);
      doc.moveDown(2);

      // Coût
      doc.fontSize(14).text("COÛT DE LA FORMATION", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Montant HT: ${parseFloat(enrollment.montant_ht).toFixed(2)} FCFA`);
      doc.text(`Montant TTC: ${parseFloat(enrollment.montant_ttc).toFixed(2)} FCFA`);
      if (enrollment.reduction_appliquee > 0) {
        doc.text(
          `Réduction: -${parseFloat(enrollment.reduction_appliquee).toFixed(2)} FCFA ${enrollment.code_promo_utilise ? `(Code: ${enrollment.code_promo_utilise})` : ""}`
        );
      }
      doc.moveDown(2);

      // Modalités de paiement
      doc.fontSize(14).text("MODALITÉS DE PAIEMENT", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10);
      if (paiements.length > 0) {
        paiements.forEach((paiement) => {
          doc.text(
            `- ${this.formatMethodePaiement(paiement.methode_paiement)}: ${parseFloat(paiement.montant).toFixed(2)} FCFA (${paiement.statut === "valide" ? "Payé" : "En attente"})`
          );
        });
      } else {
        doc.text("Paiement à effectuer selon les modalités convenues.");
      }
      doc.moveDown(2);

      // Obligations
      doc.fontSize(14).text("OBLIGATIONS", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text("Le formateur s'engage à dispenser la formation selon les modalités convenues.");
      doc.text("Le bénéficiaire s'engage à assister à la formation et à respecter les règles établies.");
      doc.moveDown(2);

      // Signatures
      doc.fontSize(14).text("SIGNATURES", { underline: true });
      doc.moveDown(2);
      doc.text("Le Formateur", 100, doc.y);
      doc.text("Le Bénéficiaire", 400, doc.y);
      doc.moveDown(3);
      doc.text("_________________________", 100, doc.y);
      doc.text("_________________________", 400, doc.y);

      // Footer
      doc.fontSize(8).text("Document généré automatiquement", { align: "center" });

      doc.end();
    });
  }

  /**
   * Helper: Format delivery mode
   */
  private formatMode(mode: string): string {
    const modeMap: Record<string, string> = {
      presentiel: "Présentiel",
      distanciel: "Distanciel",
      hybride: "Hybride",
    };
    return modeMap[mode] || mode;
  }

  /**
   * Helper: Format payment method
   */
  private formatMethodePaiement(methode: string): string {
    const methodMap: Record<string, string> = {
      orange_money: "Orange Money",
      mtn_money: "MTN Money",
      wave: "Wave",
      carte_bancaire: "Carte Bancaire",
      tresorpay: "TresorPay",
      virement: "Virement Bancaire",
      cheque: "Chèque",
    };
    return methodMap[methode] || methode;
  }

  // Additional methods will be implemented in next part...
  // T025-T034: Other document generation methods

  /**
   * T025: Generate attendance certificate
   */
  async genererAttestationPresence(
    tenantId: string,
    inscriptionId: string,
    generePar?: string
  ): Promise<DocumentResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Fetch enrollment and session data
      const enrollmentQuery = `
        SELECT 
          i.id, i.numero_inscription,
          s.id as session_id, s.code_session, s.date_debut, s.date_fin, s.mode_formation, s.lieu,
          f.titre as formation_titre,
          u.nom as apprenant_nom, u.prenom as apprenant_prenom,
          sa.present, sa.marked_at
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN sessions_professionnelles s ON i.session_id = s.id
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        JOIN users u ON i.apprenant_id = u.id
        LEFT JOIN session_attendance sa ON sa.inscription_id = i.id AND sa.session_id = s.id
        WHERE i.id = $1 AND i.tenant_id = $2
      `;
      const enrollmentResult = await client.query(enrollmentQuery, [inscriptionId, tenantId]);
      if (enrollmentResult.rows.length === 0) {
        throw new Error("INSCRIPTION_NOT_FOUND");
      }

      const enrollment = enrollmentResult.rows[0];

      // Validate session is completed
      const sessionEndDate = new Date(enrollment.date_fin);
      if (sessionEndDate > new Date()) {
        throw new Error("SESSION_NOT_COMPLETED");
      }

      // Check participant presence
      if (!enrollment.present) {
        throw new Error("PARTICIPANT_NOT_PRESENT");
      }

      // Check if document already exists
      const existingQuery = `
        SELECT id, numero, fichier_url
        FROM documents
        WHERE tenant_id = $1 AND type = 'attestation_presence' AND inscription_id = $2
        LIMIT 1
      `;
      const existingResult = await client.query(existingQuery, [tenantId, inscriptionId]);
      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        return {
          document_id: existing.id,
          document_url: existing.fichier_url,
          numero: existing.numero,
          deja_genere: true,
        };
      }

      // Get trainers
      const trainersQuery = `
        SELECT f.nom, f.prenom
        FROM formateurs f
        JOIN session_formateurs sf ON f.id = sf.formateur_id
        WHERE sf.session_id = $1 AND f.tenant_id = $2
      `;
      const trainersResult = await client.query(trainersQuery, [enrollment.session_id, tenantId]);
      const formateurs = trainersResult.rows.map((r: any) => `${r.prenom} ${r.nom}`).join(", ");

      // Generate document number
      const numero = await this.generateNumeroDocument(client, tenantId, "attestation_presence");

      // Generate PDF
      const pdfBuffer = await this.createAttestationPresencePDF(enrollment, formateurs);

      // Save to FileStorageService
      const fileStorageService = getFileStorageService();
      const fileName = `attestation-presence-${numero}.pdf`;
      const uploadResult = await fileStorageService.uploadFile(pdfBuffer, {
        tenantId,
        courseId: "documents",
        fileName,
        contentType: "application/pdf",
        metadata: {
          type: "attestation_presence",
          numero,
          inscription_id: inscriptionId,
        },
      });

      // Store metadata
      const insertQuery = `
        INSERT INTO documents (
          tenant_id, type, numero, inscription_id, session_id,
          fichier_url, genere_par
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      const insertResult = await client.query(insertQuery, [
        tenantId,
        "attestation_presence",
        numero,
        inscriptionId,
        enrollment.session_id,
        uploadResult.key,
        generePar || null,
      ]);

      return {
        document_id: insertResult.rows[0].id,
        document_url: `/api/v1/files/${uploadResult.key}`,
        numero,
        deja_genere: false,
      };
    } finally {
      client.release();
    }
  }

  /**
   * T026: Create attendance certificate PDF
   */
  private async createAttestationPresencePDF(enrollment: any, formateurs: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Header
      doc.fontSize(24).text("ATTESTATION DE PRÉSENCE", { align: "center" });
      doc.moveDown(2);

      // Body
      doc.fontSize(12);
      doc.text("Je soussigné(e), représentant(e) d'Imhotep Academy / EcoleDigitale,", {
        align: "justify",
      });
      doc.moveDown();
      doc.text(
        `atteste que ${enrollment.apprenant_prenom} ${enrollment.apprenant_nom} a suivi avec assiduité la formation professionnelle intitulée "${enrollment.formation_titre}".`,
        { align: "justify" }
      );
      doc.moveDown(2);

      // Details
      doc.fontSize(11).text("Détails de la formation:", { continued: false });
      doc.moveDown(0.5);
      doc.text(`- Formation: ${enrollment.formation_titre}`);
      doc.text(`- Code session: ${enrollment.code_session}`);
      doc.text(
        `- Dates: Du ${new Date(enrollment.date_debut).toLocaleDateString("fr-FR")} au ${new Date(enrollment.date_fin).toLocaleDateString("fr-FR")}`
      );
      if (formateurs) doc.text(`- Formateurs: ${formateurs}`);
      if (enrollment.lieu) doc.text(`- Lieu: ${enrollment.lieu}`);
      doc.moveDown(2);

      // Duration calculation
      const startDate = new Date(enrollment.date_debut);
      const endDate = new Date(enrollment.date_fin);
      const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      doc.text(`Durée totale: ${durationDays} jour(s)`, { continued: false });
      doc.moveDown(3);

      // Signature
      doc.text("Fait à Abidjan, le " + new Date().toLocaleDateString("fr-FR"), {
        align: "right",
      });
      doc.moveDown(2);
      doc.text("Le Directeur", { align: "right" });
      doc.moveDown(1);
      doc.text("_________________________", { align: "right" });

      // Footer
      doc.fontSize(8).text("Document généré automatiquement", { align: "center" });

      doc.end();
    });
  }

  /**
   * T027: Generate success certificate
   */
  async genererAttestationReussite(
    tenantId: string,
    inscriptionId: string,
    note?: number,
    generePar?: string
  ): Promise<DocumentResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Fetch enrollment and session data
      const enrollmentQuery = `
        SELECT 
          i.id, i.numero_inscription,
          s.id as session_id, s.code_session, s.date_debut, s.date_fin, s.mode_formation, s.lieu,
          f.titre as formation_titre,
          u.nom as apprenant_nom, u.prenom as apprenant_prenom,
          sa.present, sa.marked_at
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN sessions_professionnelles s ON i.session_id = s.id
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        JOIN users u ON i.apprenant_id = u.id
        LEFT JOIN session_attendance sa ON sa.inscription_id = i.id AND sa.session_id = s.id
        WHERE i.id = $1 AND i.tenant_id = $2
      `;
      const enrollmentResult = await client.query(enrollmentQuery, [inscriptionId, tenantId]);
      if (enrollmentResult.rows.length === 0) {
        throw new Error("INSCRIPTION_NOT_FOUND");
      }

      const enrollment = enrollmentResult.rows[0];

      // Validate session is completed
      const sessionEndDate = new Date(enrollment.date_fin);
      if (sessionEndDate > new Date()) {
        throw new Error("SESSION_NOT_COMPLETED");
      }

      // Check participant presence
      if (!enrollment.present) {
        throw new Error("PARTICIPANT_NOT_PRESENT");
      }

      // Check if document already exists
      const existingQuery = `
        SELECT id, numero, fichier_url
        FROM documents
        WHERE tenant_id = $1 AND type = 'attestation_reussite' AND inscription_id = $2
        LIMIT 1
      `;
      const existingResult = await client.query(existingQuery, [tenantId, inscriptionId]);
      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        return {
          document_id: existing.id,
          document_url: existing.fichier_url,
          numero: existing.numero,
          deja_genere: true,
        };
      }

      // Get trainers
      const trainersQuery = `
        SELECT f.nom, f.prenom
        FROM formateurs f
        JOIN session_formateurs sf ON f.id = sf.formateur_id
        WHERE sf.session_id = $1 AND f.tenant_id = $2
      `;
      const trainersResult = await client.query(trainersQuery, [enrollment.session_id, tenantId]);
      const formateurs = trainersResult.rows.map((r: any) => `${r.prenom} ${r.nom}`).join(", ");

      // Generate document number
      const numero = await this.generateNumeroDocument(client, tenantId, "attestation_reussite");

      // Generate PDF
      const pdfBuffer = await this.createAttestationReussitePDF(enrollment, formateurs, note);

      // Save to FileStorageService
      const fileStorageService = getFileStorageService();
      const fileName = `attestation-reussite-${numero}.pdf`;
      const uploadResult = await fileStorageService.uploadFile(pdfBuffer, {
        tenantId,
        courseId: "documents",
        fileName,
        contentType: "application/pdf",
        metadata: {
          type: "attestation_reussite",
          numero,
          inscription_id: inscriptionId,
        },
      });

      // Store metadata
      const insertQuery = `
        INSERT INTO documents (
          tenant_id, type, numero, inscription_id, session_id,
          fichier_url, genere_par, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `;
      const insertResult = await client.query(insertQuery, [
        tenantId,
        "attestation_reussite",
        numero,
        inscriptionId,
        enrollment.session_id,
        uploadResult.key,
        generePar || null,
        JSON.stringify({ note: note || null }),
      ]);

      return {
        document_id: insertResult.rows[0].id,
        document_url: `/api/v1/files/${uploadResult.key}`,
        numero,
        deja_genere: false,
      };
    } finally {
      client.release();
    }
  }

  /**
   * T028: Create success certificate PDF
   */
  private async createAttestationReussitePDF(
    enrollment: any,
    formateurs: string,
    note?: number
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Header
      doc.fontSize(24).text("ATTESTATION DE RÉUSSITE", { align: "center" });
      doc.moveDown(2);

      // Body
      doc.fontSize(12);
      doc.text("Je soussigné(e), représentant(e) d'Imhotep Academy / EcoleDigitale,", {
        align: "justify",
      });
      doc.moveDown();
      doc.text(
        `atteste que ${enrollment.apprenant_prenom} ${enrollment.apprenant_nom} a suivi avec succès la formation professionnelle intitulée "${enrollment.formation_titre}".`,
        { align: "justify" }
      );
      doc.moveDown(2);

      // Details
      doc.fontSize(11).text("Détails de la formation:", { continued: false });
      doc.moveDown(0.5);
      doc.text(`- Formation: ${enrollment.formation_titre}`);
      doc.text(`- Code session: ${enrollment.code_session}`);
      doc.text(
        `- Dates: Du ${new Date(enrollment.date_debut).toLocaleDateString("fr-FR")} au ${new Date(enrollment.date_fin).toLocaleDateString("fr-FR")}`
      );
      if (formateurs) doc.text(`- Formateurs: ${formateurs}`);
      if (enrollment.lieu) doc.text(`- Lieu: ${enrollment.lieu}`);
      if (note !== undefined) {
        doc.text(`- Note obtenue: ${note}/20`);
      }
      doc.moveDown(2);

      // Duration calculation
      const startDate = new Date(enrollment.date_debut);
      const endDate = new Date(enrollment.date_fin);
      const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      doc.text(`Durée totale: ${durationDays} jour(s)`, { continued: false });
      doc.moveDown(3);

      // Signature
      doc.text("Fait à Abidjan, le " + new Date().toLocaleDateString("fr-FR"), {
        align: "right",
      });
      doc.moveDown(2);
      doc.text("Le Directeur", { align: "right" });
      doc.moveDown(1);
      doc.text("_________________________", { align: "right" });

      // Footer
      doc.fontSize(8).text("Document généré automatiquement", { align: "center" });

      doc.end();
    });
  }

  /**
   * T029: Generate quote
   */
  async genererDevis(
    tenantId: string,
    sessionId: string,
    client: {
      nom: string;
      prenom: string;
      email: string;
      telephone?: string;
      entreprise?: string;
    },
    validiteJours: number = 30,
    generePar?: string
  ): Promise<DocumentResponse> {
    const client_db = await this.pool.connect();
    try {
      await this.setTenantContext(client_db, tenantId);

      // Fetch session with formation
      const sessionQuery = `
        SELECT 
          s.id, s.code_session, s.date_debut, s.date_fin, s.prix_ht, s.prix_ttc,
          s.mode_formation, s.lieu, s.horaires,
          f.titre as formation_titre, f.description_courte
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        WHERE s.id = $1 AND s.tenant_id = $2
      `;
      const sessionResult = await client_db.query(sessionQuery, [sessionId, tenantId]);
      if (sessionResult.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const session = sessionResult.rows[0];

      // Generate document number
      const numero = await this.generateNumeroDocument(client_db, tenantId, "devis");

      // Calculate validity date
      const validiteJusquAu = new Date();
      validiteJusquAu.setDate(validiteJusquAu.getDate() + validiteJours);

      // Generate PDF
      const pdfBuffer = await this.createDevisPDF(session, client, validiteJusquAu);

      // Save to FileStorageService
      const fileStorageService = getFileStorageService();
      const fileName = `devis-${numero}.pdf`;
      const uploadResult = await fileStorageService.uploadFile(pdfBuffer, {
        tenantId,
        courseId: "documents",
        fileName,
        contentType: "application/pdf",
        metadata: {
          type: "devis",
          numero,
          session_id: sessionId,
        },
      });

      // Store metadata
      const insertQuery = `
        INSERT INTO documents (
          tenant_id, type, numero, session_id,
          fichier_url, genere_par, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;
      const insertResult = await client_db.query(insertQuery, [
        tenantId,
        "devis",
        numero,
        sessionId,
        uploadResult.key,
        generePar || null,
        JSON.stringify({
          client,
          validite_jusqu_au: validiteJusquAu.toISOString(),
        }),
      ]);

      return {
        document_id: insertResult.rows[0].id,
        document_url: `/api/v1/files/${uploadResult.key}`,
        numero,
        deja_genere: false,
      };
    } finally {
      client_db.release();
    }
  }

  /**
   * T030: Create quote PDF
   */
  private async createDevisPDF(
    session: any,
    client: any,
    validiteJusquAu: Date
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Header
      doc.fontSize(20).text("DEVIS", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`N° ${session.code_session}`, { align: "right" });
      doc.text(`Date: ${new Date().toLocaleDateString("fr-FR")}`, { align: "right" });
      doc.text(`Valable jusqu'au: ${validiteJusquAu.toLocaleDateString("fr-FR")}`, {
        align: "right",
      });
      doc.moveDown(2);

      // Client information
      doc.fontSize(14).text("Client:", { underline: true });
      doc.fontSize(10);
      if (client.entreprise) {
        doc.text(client.entreprise);
      }
      doc.text(`${client.prenom} ${client.nom}`);
      doc.text(`Email: ${client.email}`);
      if (client.telephone) doc.text(`Tél: ${client.telephone}`);
      doc.moveDown(2);

      // Training details
      doc.fontSize(14).text("Détails de la formation:", { underline: true });
      doc.fontSize(10);
      doc.text(`Formation: ${session.formation_titre}`);
      doc.text(`Code session: ${session.code_session}`);
      doc.text(
        `Dates: Du ${new Date(session.date_debut).toLocaleDateString("fr-FR")} au ${new Date(session.date_fin).toLocaleDateString("fr-FR")}`
      );
      if (session.horaires) doc.text(`Horaires: ${session.horaires}`);
      doc.text(`Mode: ${this.formatMode(session.mode_formation)}`);
      if (session.lieu) doc.text(`Lieu: ${session.lieu}`);
      doc.moveDown(2);

      // Pricing
      doc.fontSize(14).text("Tarification:", { underline: true });
      doc.moveDown(0.5);
      const tableTop = doc.y;
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Description", 50, tableTop);
      doc.text("Montant HT", 350, tableTop, { width: 100, align: "right" });
      doc.text("TVA", 450, tableTop, { width: 100, align: "right" });
      doc.text("Montant TTC", 550, tableTop, { width: 100, align: "right" });

      doc.font("Helvetica");
      const rowY = tableTop + 20;
      doc.text(session.formation_titre, 50, rowY);
      const prixHT = parseFloat(session.prix_ht || "0");
      const prixTTC = parseFloat(session.prix_ttc || "0");
      const tva = prixTTC - prixHT;
      doc.text(`${prixHT.toFixed(2)} FCFA`, 350, rowY, { width: 100, align: "right" });
      doc.text(`${tva.toFixed(2)} FCFA`, 450, rowY, { width: 100, align: "right" });
      doc.text(`${prixTTC.toFixed(2)} FCFA`, 550, rowY, { width: 100, align: "right" });

      const totalY = rowY + 30;
      doc.font("Helvetica-Bold").fontSize(12);
      doc.text("TOTAL TTC:", 350, totalY);
      doc.text(`${prixTTC.toFixed(2)} FCFA`, 550, totalY, { width: 100, align: "right" });
      doc.font("Helvetica").fontSize(10);

      doc.y = totalY + 40;
      doc.moveDown(2);

      // Payment conditions
      doc.fontSize(14).text("Modalités de paiement:", { underline: true });
      doc.fontSize(10);
      doc.text("Paiement par Orange Money, MTN Money, Wave, ou virement bancaire.");
      doc.text("Inscription confirmée après réception du paiement.");
      doc.moveDown(2);

      // Footer
      doc.fontSize(8).text("Document généré automatiquement", { align: "center" });

      doc.end();
    });
  }

  /**
   * T058: Create grouped invoice PDF
   */
  async createFactureGroupeePDF(
    entreprise: any,
    inscriptions: any[],
    numeroFacture: string,
    dateEcheance?: Date
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Header
      doc.fontSize(20).text("FACTURE GROUPÉE", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`N° ${numeroFacture}`, { align: "right" });
      doc.text(`Date: ${this.formatDate(new Date())}`, { align: "right" });
      if (dateEcheance) {
        doc.text(`Échéance: ${this.formatDate(dateEcheance)}`, { align: "right" });
      }
      doc.moveDown(2);

      // Issuer information
      doc.fontSize(14).text("ÉMETTEUR:", { underline: true });
      doc.fontSize(10).text("EcoleDigitale - Imhotep Academy");
      doc.text("Abidjan, Côte d'Ivoire");
      doc.moveDown();

      // Client information
      doc.fontSize(14).text("CLIENT:", { underline: true });
      doc.fontSize(10).text(entreprise.raison_sociale);
      if (entreprise.siret) {
        doc.text(`SIRET: ${entreprise.siret}`);
      }
      doc.text(`${entreprise.adresse || ""}, ${entreprise.code_postal || ""} ${entreprise.ville || ""}`);
      if (entreprise.contact_email) {
        doc.text(`Email: ${entreprise.contact_email}`);
      }
      doc.moveDown(2);

      // Invoice lines table
      doc.fontSize(14).text("DÉTAILS DES FORMATIONS:", { underline: true });
      doc.moveDown(0.5);

      const tableTop = doc.y;
      const itemHeight = 25;
      let currentY = tableTop;

      // Table header
      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("Formation", 50, currentY, { width: 200 });
      doc.text("Session", 250, currentY, { width: 100 });
      doc.text("Apprenant", 350, currentY, { width: 120 });
      doc.text("Montant HT", 470, currentY, { width: 80, align: "right" });
      doc.text("Montant TTC", 550, currentY, { width: 80, align: "right" });
      doc.font("Helvetica");

      currentY += itemHeight;
      doc.moveTo(50, currentY - 5).lineTo(630, currentY - 5).stroke();

      // Invoice lines
      let totalHT = 0;
      let totalTTC = 0;

      inscriptions.forEach((inscription) => {
        if (currentY > 700) {
          // New page if needed
          doc.addPage();
          currentY = 50;
        }

        const montantHT = parseFloat(inscription.montant_ht || "0");
        const montantTTC = parseFloat(inscription.montant_ttc || "0");
        totalHT += montantHT;
        totalTTC += montantTTC;

        doc.fontSize(9);
        doc.text(inscription.formation_titre || "", 50, currentY, { width: 200 });
        doc.text(inscription.code_session || "", 250, currentY, { width: 100 });
        doc.text(
          `${inscription.apprenant_prenom || ""} ${inscription.apprenant_nom || ""}`.trim(),
          350,
          currentY,
          { width: 120 }
        );
        doc.text(this.formatAmount(montantHT), 470, currentY, { width: 80, align: "right" });
        doc.text(this.formatAmount(montantTTC), 550, currentY, { width: 80, align: "right" });

        currentY += itemHeight;
      });

      // Totals
      currentY += 10;
      doc.moveTo(50, currentY).lineTo(630, currentY).stroke();
      currentY += 10;

      doc.fontSize(10).font("Helvetica-Bold");
      doc.text("SOUS-TOTAL HT:", 470, currentY, { width: 80, align: "right" });
      doc.text(this.formatAmount(totalHT), 550, currentY, { width: 80, align: "right" });
      currentY += 20;

      const tva = totalTTC - totalHT;
      doc.text("TVA:", 470, currentY, { width: 80, align: "right" });
      doc.text(this.formatAmount(tva), 550, currentY, { width: 80, align: "right" });
      currentY += 20;

      doc.fontSize(12);
      doc.text("TOTAL TTC:", 470, currentY, { width: 80, align: "right" });
      doc.text(this.formatAmount(totalTTC), 550, currentY, { width: 80, align: "right" });
      doc.font("Helvetica").fontSize(10);

      doc.y = currentY + 30;
      doc.moveDown(2);

      // Payment terms
      doc.fontSize(14).text("MODALITÉS DE PAIEMENT:", { underline: true });
      doc.fontSize(10);
      doc.text("Paiement par virement bancaire ou chèque.");
      if (dateEcheance) {
        doc.text(`Date d'échéance: ${this.formatDate(dateEcheance)}`);
      }
      doc.moveDown(2);

      // Footer
      doc.fontSize(8).text("Merci de votre confiance !", { align: "center" });
      doc.text("Document généré automatiquement.", { align: "center" });

      doc.end();
    });
  }

  /**
   * T031: Generate batch attestations
   */
  async generateBatchAttestations(
    tenantId: string,
    sessionId: string,
    type: "attestation_presence" | "attestation_reussite",
    notes?: Record<string, number>,
    generePar?: string
  ): Promise<BatchGenerateResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Fetch completed session with present participants
      const sessionQuery = `
        SELECT 
          s.id, s.code_session, s.date_debut, s.date_fin, s.statut,
          f.titre as formation_titre
        FROM ${getTableName(tenantId, 'sessions_professionnelles')} s
        JOIN formations_professionnelles f ON s.formation_pro_id = f.id
        WHERE s.id = $1 AND s.tenant_id = $2
      `;
      const sessionResult = await client.query(sessionQuery, [sessionId, tenantId]);
      if (sessionResult.rows.length === 0) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const session = sessionResult.rows[0];

      // Validate session is completed
      const sessionEndDate = new Date(session.date_fin);
      if (sessionEndDate > new Date() && session.statut !== "terminee") {
        throw new Error("SESSION_NOT_COMPLETED");
      }

      // Get present participants
      const participantsQuery = `
        SELECT 
          i.id as inscription_id,
          u.nom as apprenant_nom, u.prenom as apprenant_prenom,
          sa.present
        FROM ${getTableName(tenantId, 'inscriptions_professionnelles')} i
        JOIN users u ON i.apprenant_id = u.id
        JOIN session_attendance sa ON sa.inscription_id = i.id AND sa.session_id = $1
        WHERE i.session_id = $1 AND i.tenant_id = $2 AND sa.present = TRUE
      `;
      const participantsResult = await client.query(participantsQuery, [sessionId, tenantId]);
      const participants = participantsResult.rows;

      if (participants.length === 0) {
        throw new Error("NO_PRESENT_PARTICIPANTS");
      }

      // Generate documents for each participant
      const documents: BatchGenerateResponse["documents"] = [];
      let successCount = 0;
      let failureCount = 0;

      for (const participant of participants) {
        try {
          let result: DocumentResponse;
          if (type === "attestation_presence") {
            result = await this.genererAttestationPresence(
              tenantId,
              participant.inscription_id,
              generePar
            );
          } else {
            const note = notes?.[participant.inscription_id];
            result = await this.genererAttestationReussite(
              tenantId,
              participant.inscription_id,
              note,
              generePar
            );
          }

          documents.push({
            inscription_id: participant.inscription_id,
            apprenant: `${participant.apprenant_prenom} ${participant.apprenant_nom}`,
            document_url: result.document_url,
            document_id: result.document_id,
            numero: result.numero,
          });
          successCount++;
        } catch (error: any) {
          failureCount++;
          // Log error but continue with other participants
          console.error(
            `Error generating ${type} for inscription ${participant.inscription_id}:`,
            error.message
          );
        }
      }

      return {
        nb_generes: successCount,
        documents,
      };
    } finally {
      client.release();
    }
  }

  /**
   * T032: Get documents list with filtering and pagination
   */
  async getDocumentsList(
    tenantId: string,
    filters: {
      type?: DocumentType;
      session_id?: string;
      inscription_id?: string;
      date_debut?: string;
      date_fin?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<DocumentListResponse> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const offset = (page - 1) * limit;

      // Build WHERE clause
      const whereConditions: string[] = ["d.tenant_id = $1"];
      const queryParams: any[] = [tenantId];
      let paramIndex = 2;

      if (filters.type) {
        whereConditions.push(`d.type = $${paramIndex}`);
        queryParams.push(filters.type);
        paramIndex++;
      }

      if (filters.session_id) {
        whereConditions.push(`d.session_id = $${paramIndex}`);
        queryParams.push(filters.session_id);
        paramIndex++;
      }

      if (filters.inscription_id) {
        whereConditions.push(`d.inscription_id = $${paramIndex}`);
        queryParams.push(filters.inscription_id);
        paramIndex++;
      }

      if (filters.date_debut) {
        whereConditions.push(`d.date_generation >= $${paramIndex}`);
        queryParams.push(filters.date_debut);
        paramIndex++;
      }

      if (filters.date_fin) {
        whereConditions.push(`d.date_generation <= $${paramIndex}`);
        queryParams.push(filters.date_fin);
        paramIndex++;
      }

      if (filters.search) {
        whereConditions.push(
          `(d.numero ILIKE $${paramIndex} OR u.nom ILIKE $${paramIndex} OR u.prenom ILIKE $${paramIndex} OR s.code_session ILIKE $${paramIndex})`
        );
        queryParams.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.join(" AND ");

      // Get total count
      const countQuery = `
        SELECT COUNT(*)::integer as total
        FROM documents d
        LEFT JOIN inscriptions_professionnelles i ON d.inscription_id = i.id
        LEFT JOIN users u ON i.apprenant_id = u.id
        LEFT JOIN sessions_professionnelles s ON d.session_id = s.id
        WHERE ${whereClause}
      `;
      const countResult = await client.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total) || 0;

      // Get documents
      const documentsQuery = `
        SELECT 
          d.id,
          d.type,
          d.numero,
          d.date_generation,
          d.inscription_id,
          d.session_id,
          d.entreprise_id,
          d.fichier_url,
          u.nom || ' ' || u.prenom as apprenant_nom,
          s.code_session as session_code
        FROM documents d
        LEFT JOIN inscriptions_professionnelles i ON d.inscription_id = i.id
        LEFT JOIN users u ON i.apprenant_id = u.id
        LEFT JOIN sessions_professionnelles s ON d.session_id = s.id
        WHERE ${whereClause}
        ORDER BY d.date_generation DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      const documentsResult = await client.query(documentsQuery, [
        ...queryParams,
        limit,
        offset,
      ]);

      const documents = documentsResult.rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        numero: row.numero,
        date_generation: row.date_generation.toISOString(),
        inscription_id: row.inscription_id,
        session_id: row.session_id,
        entreprise_id: row.entreprise_id,
        apprenant_nom: row.apprenant_nom,
        session_code: row.session_code,
        fichier_url: `/api/v1/files/${row.fichier_url}`,
      }));

      const totalPages = Math.ceil(total / limit);

      return {
        documents,
        total,
        page,
        totalPages,
      };
    } finally {
      client.release();
    }
  }

  /**
   * T033: Resend document by email
   */
  async resendDocument(
    tenantId: string,
    documentId: string,
    email: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get document
      const documentQuery = `
        SELECT d.id, d.type, d.numero, d.fichier_url, d.inscription_id,
               u.email as apprenant_email, u.nom as apprenant_nom, u.prenom as apprenant_prenom
        FROM documents d
        LEFT JOIN inscriptions_professionnelles i ON d.inscription_id = i.id
        LEFT JOIN users u ON i.apprenant_id = u.id
        WHERE d.id = $1 AND d.tenant_id = $2
      `;
      const documentResult = await client.query(documentQuery, [documentId, tenantId]);
      if (documentResult.rows.length === 0) {
        throw new Error("DOCUMENT_NOT_FOUND");
      }

      const document = documentResult.rows[0];

      // Get file from FileStorageService
      const fileStorageService = getFileStorageService();
      const fileBuffer = await fileStorageService.getFileBuffer(document.fichier_url);

      // Send email
      const documentTypeNames: Record<DocumentType, string> = {
        convention: "Convention de formation",
        attestation_presence: "Attestation de présence",
        attestation_reussite: "Attestation de réussite",
        devis: "Devis",
        facture: "Facture",
        facture_groupee: "Facture groupée",
      };

      await this.emailService.sendEmail({
        to: email,
        subject: `Votre ${documentTypeNames[document.type as DocumentType]}`,
        html: `
          <p>Bonjour,</p>
          <p>Vous trouverez ci-joint votre ${documentTypeNames[document.type as DocumentType]} n° ${document.numero}.</p>
          <p>Cordialement,<br>L'équipe Imhotep Academy</p>
        `,
        attachments: [
          {
            filename: `${document.type}-${document.numero}.pdf`,
            content: fileBuffer,
            contentType: "application/pdf",
          },
        ],
      });
    } finally {
      client.release();
    }
  }

  /**
   * T034: Delete document
   */
  async deleteDocument(tenantId: string, documentId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.setTenantContext(client, tenantId);

      // Get document
      const documentQuery = `
        SELECT id, fichier_url
        FROM documents
        WHERE id = $1 AND tenant_id = $2
      `;
      const documentResult = await client.query(documentQuery, [documentId, tenantId]);
      if (documentResult.rows.length === 0) {
        throw new Error("DOCUMENT_NOT_FOUND");
      }

      const document = documentResult.rows[0];

      // Delete file from FileStorageService
      try {
        const fileStorageService = getFileStorageService();
        await fileStorageService.deleteFile(document.fichier_url);
      } catch (error) {
        // Log but don't fail if file doesn't exist
        console.warn(`File not found for deletion: ${document.fichier_url}`);
      }

      // Delete database record
      await client.query(`DELETE FROM documents WHERE id = $1 AND tenant_id = $2`, [
        documentId,
        tenantId,
      ]);
    } finally {
      client.release();
    }
  }
}
