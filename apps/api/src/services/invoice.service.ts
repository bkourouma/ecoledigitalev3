/**
 * Invoice Service
 * 
 * Handles PDF invoice generation for confirmed enrollments.
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export interface InvoiceData {
  invoiceNumber: string;
  enrollmentNumber: string;
  issueDate: Date;
  
  // Participant information
  participant: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
  };
  
  // Company information (if applicable)
  company?: {
    name: string;
    siret?: string;
    address?: string;
  };
  
  // Training session information
  session: {
    title: string;
    startDate: Date;
    endDate: Date;
    code?: string;
    priceHT?: number;
    priceTTC?: number;
  };
  
  // Pricing
  pricing: {
    amountHT: number;
    taxRate?: number;
    taxAmount?: number;
    amountTTC: number;
    discount?: number;
    promoCode?: string;
  };
  
  // Payment information
  payment?: {
    method: string;
    transactionId?: string;
    amountPaid?: number;
    date: Date;
  };
  
  // Discount information (for compatibility with existing code)
  discount?: {
    amount: number;
    code?: string;
  };
}

export class InvoiceService {
  private outputDir: string;

  constructor() {
    // Use uploads directory or create invoices subdirectory
    const baseDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
    this.outputDir = path.join(baseDir, 'invoices');
    
    // Ensure directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate invoice number using database function
   */
  async generateInvoiceNumber(pool: any, tenantId: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await client.query('SELECT generate_invoice_number($1) as numero', [tenantId]);
      return result.rows[0].numero;
    } finally {
      client.release();
    }
  }

  /**
   * Generate PDF invoice
   */
  async generateInvoice(data: InvoiceData): Promise<string> {
    const filename = `facture-${data.invoiceNumber}.pdf`;
    const filepath = path.join(this.outputDir, filename);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const stream = fs.createWriteStream(filepath);

      doc.pipe(stream);

      // Header
      doc.fontSize(20).text('FACTURE', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`N° ${data.invoiceNumber}`, { align: 'right' });
      doc.text(`Date: ${data.issueDate.toLocaleDateString('fr-FR')}`, { align: 'right' });
      doc.moveDown(2);

      // Company/Issuer information
      doc.fontSize(14).text('Émetteur:', { underline: true });
      doc.fontSize(10).text('EcoleDigitale');
      doc.text('Imhotep Academy');
      doc.text('Email: contact@ecoledigitale.com');
      doc.moveDown();

      // Client information
      doc.fontSize(14).text('Client:', { underline: true });
      if (data.company) {
        doc.fontSize(10).text(data.company.name);
        if (data.company.siret) {
          doc.text(`SIRET: ${data.company.siret}`);
        }
        if (data.company.address) {
          doc.text(data.company.address);
        }
      }
      doc.fontSize(10).text(data.participant.name);
      doc.text(data.participant.email);
      if (data.participant.phone) {
        doc.text(`Tél: ${data.participant.phone}`);
      }
      doc.moveDown(2);

      // Training details
      doc.fontSize(14).text('Détails de la formation:', { underline: true });
      doc.fontSize(10).text(`Formation: ${data.session.title}`);
      if (data.session.code) {
        doc.text(`Code session: ${data.session.code}`);
      }
      doc.text(`Date de début: ${data.session.startDate.toLocaleDateString('fr-FR')}`);
      doc.text(`Date de fin: ${data.session.endDate.toLocaleDateString('fr-FR')}`);
      doc.text(`Numéro d'inscription: ${data.enrollmentNumber}`);
      doc.moveDown(2);

      // Pricing table
      doc.fontSize(14).text('Détails de facturation:', { underline: true });
      doc.moveDown(0.5);

      const tableTop = doc.y;
      const itemHeight = 20;

      // Calculate discount from pricing or discount field
      const discountAmount = data.pricing.discount || data.discount?.amount || 0;
      const promoCode = data.pricing.promoCode || data.discount?.code;
      const taxAmount = data.pricing.taxAmount || (data.pricing.amountTTC - data.pricing.amountHT);

      // Table header
      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Description', 50, tableTop);
      doc.text('Montant HT', 350, tableTop, { width: 100, align: 'right' });
      doc.text('TVA', 450, tableTop, { width: 100, align: 'right' });
      doc.text('Montant TTC', 550, tableTop, { width: 100, align: 'right' });

      // Table row
      doc.font('Helvetica');
      const rowY = tableTop + itemHeight;
      doc.text(data.session.title, 50, rowY);
      doc.text(`${data.pricing.amountHT.toFixed(2)} FCFA`, 350, rowY, { width: 100, align: 'right' });
      doc.text(
        taxAmount ? `${taxAmount.toFixed(2)} FCFA` : '0.00 FCFA',
        450,
        rowY,
        { width: 100, align: 'right' }
      );
      doc.text(`${data.pricing.amountTTC.toFixed(2)} FCFA`, 550, rowY, { width: 100, align: 'right' });

      // Discount row (if applicable)
      if (discountAmount > 0) {
        const discountY = rowY + itemHeight;
        doc.font('Helvetica-Oblique').fontSize(9);
        doc.text(`Réduction (${promoCode || 'Code promo'}):`, 50, discountY);
        doc.text(`-${discountAmount.toFixed(2)} FCFA`, 550, discountY, { width: 100, align: 'right' });
        doc.font('Helvetica').fontSize(10);
      }

      // Total row
      const totalY = (discountAmount > 0 ? rowY + itemHeight * 2 : rowY + itemHeight) + 10;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('TOTAL TTC:', 350, totalY);
      const finalAmount = data.pricing.amountTTC - discountAmount;
      doc.text(`${finalAmount.toFixed(2)} FCFA`, 550, totalY, { width: 100, align: 'right' });
      doc.font('Helvetica').fontSize(10);

      doc.moveDown(3);

      // Payment information
      if (data.payment) {
        doc.fontSize(14).text('Informations de paiement:', { underline: true });
        doc.fontSize(10).text(`Méthode: ${data.payment.method}`);
        if (data.payment.transactionId) {
          doc.text(`Transaction: ${data.payment.transactionId}`);
        }
        if (data.payment.amountPaid) {
          doc.text(`Montant payé: ${data.payment.amountPaid.toFixed(2)} FCFA`);
        }
        doc.text(`Date de paiement: ${data.payment.date.toLocaleDateString('fr-FR')}`);
        doc.moveDown(2);
      }

      // Footer
      doc.fontSize(8).text('Merci pour votre confiance!', { align: 'center' });
      doc.text('Cet document est généré automatiquement.', { align: 'center' });

      doc.end();

      stream.on('finish', () => {
        resolve(filepath);
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get invoice file path
   */
  getInvoicePath(invoiceNumber: string): string {
    const filename = `facture-${invoiceNumber}.pdf`;
    return path.join(this.outputDir, filename);
  }

  /**
   * Get invoice file URL (relative path for API)
   */
  getInvoiceUrl(invoiceNumber: string): string {
    return `/uploads/invoices/facture-${invoiceNumber}.pdf`;
  }

  /**
   * Check if invoice exists
   */
  invoiceExists(invoiceNumber: string): boolean {
    const filepath = this.getInvoicePath(invoiceNumber);
    return fs.existsSync(filepath);
  }

  /**
   * Read invoice file as buffer
   */
  async readInvoiceBuffer(invoiceNumber: string): Promise<Buffer> {
    const filepath = this.getInvoicePath(invoiceNumber);
    if (!fs.existsSync(filepath)) {
      throw new Error(`Invoice file not found: ${invoiceNumber}`);
    }
    return await fs.promises.readFile(filepath);
  }
}

// Export singleton instance
export const invoiceService = new InvoiceService();

