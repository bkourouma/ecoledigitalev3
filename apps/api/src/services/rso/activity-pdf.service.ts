/**
 * RSO Activity PDF Generation Service
 * Generates PDF reports for RSO activities using Puppeteer
 */

import puppeteer from 'puppeteer';
import { RSOActivity } from './activity.service';

export class RSOActivityPDFService {
  private browser: any = null;

  /**
   * Initialize Puppeteer browser instance
   */
  async initialize(): Promise<void> {
    if (!this.browser) {
      try {
        this.browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
      } catch (error: any) {
        if (error.message && error.message.includes('Could not find Chrome')) {
          throw new Error(
            'Chrome browser not found. Please run: npx puppeteer browsers install chrome'
          );
        }
        throw error;
      }
    }
  }

  /**
   * Close browser instance
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Generate PDF for an activity
   */
  async generateActivityPDF(activity: RSOActivity): Promise<Buffer> {
    await this.initialize();

    const page = await this.browser.newPage();

    try {
      const html = this.generateHTMLTemplate(activity);

      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm',
        },
      });

      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  /**
   * Generate HTML template for PDF
   */
  private generateHTMLTemplate(activity: RSOActivity): string {
    const formatDate = (date: Date | string): string => {
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const formatDateShort = (date: Date | string): string => {
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    };

    const getStatusLabel = (status: string): string => {
      const labels: Record<string, string> = {
        planifie: 'Planifié',
        en_cours: 'En cours',
        termine: 'Terminé',
        annule: 'Annulé',
      };
      return labels[status] || status;
    };

    const getTypeLabel = (type: string): string => {
      return type.charAt(0).toUpperCase() + type.slice(1);
    };

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rapport d'Activité RSO - ${activity.titre}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #333;
      background: #fff;
    }
    
    .header {
      border-bottom: 3px solid #1e40af;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    .header h1 {
      color: #1e40af;
      font-size: 24pt;
      font-weight: bold;
      margin-bottom: 10px;
    }
    
    .header .subtitle {
      color: #666;
      font-size: 14pt;
    }
    
    .section {
      margin-bottom: 25px;
    }
    
    .section-title {
      color: #1e40af;
      font-size: 16pt;
      font-weight: bold;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 8px;
      margin-bottom: 15px;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
      margin-bottom: 20px;
    }
    
    .info-item {
      padding: 10px;
      background: #f9fafb;
      border-left: 3px solid #1e40af;
    }
    
    .info-label {
      font-weight: bold;
      color: #4b5563;
      font-size: 10pt;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .info-value {
      color: #111827;
      font-size: 12pt;
    }
    
    .description {
      padding: 15px;
      background: #f9fafb;
      border-left: 3px solid #1e40af;
      white-space: pre-wrap;
      line-height: 1.8;
    }
    
    .status-badge {
      display: inline-block;
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 10pt;
      font-weight: bold;
      text-transform: uppercase;
    }
    
    .status-planifie {
      background: #dbeafe;
      color: #1e40af;
    }
    
    .status-en_cours {
      background: #fef3c7;
      color: #92400e;
    }
    
    .status-termine {
      background: #d1fae5;
      color: #065f46;
    }
    
    .status-annule {
      background: #fee2e2;
      color: #991b1b;
    }
    
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 10pt;
      color: #6b7280;
      text-align: center;
    }
    
    .metadata {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 10pt;
      color: #6b7280;
    }
    
    .metadata-item {
      margin-bottom: 5px;
    }
    
    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>RAPPORT D'ACTIVITÉ RSO</h1>
    <div class="subtitle">Sûreté Portuaire - Code ISPS</div>
  </div>

  <div class="section">
    <div class="section-title">Informations Générales</div>
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Titre de l'activité</div>
        <div class="info-value">${activity.titre}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Type d'activité</div>
        <div class="info-value">${getTypeLabel(activity.type)}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Date de l'activité</div>
        <div class="info-value">${formatDate(activity.dateActivite)}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Statut</div>
        <div class="info-value">
          <span class="status-badge status-${activity.statut}">
            ${getStatusLabel(activity.statut)}
          </span>
        </div>
      </div>
    </div>
  </div>

  ${activity.description ? `
  <div class="section">
    <div class="section-title">Description</div>
    <div class="description">${activity.description}</div>
  </div>
  ` : ''}

  <div class="metadata">
    <div class="metadata-item"><strong>ID Activité:</strong> #${activity.id}</div>
    <div class="metadata-item"><strong>Installation ID:</strong> #${activity.installationId}</div>
    <div class="metadata-item"><strong>Créé le:</strong> ${formatDate(activity.createdAt)}</div>
    ${activity.updatedAt && activity.updatedAt !== activity.createdAt ? `
    <div class="metadata-item"><strong>Modifié le:</strong> ${formatDate(activity.updatedAt)}</div>
    ` : ''}
  </div>

  <div class="footer">
    <p>Document généré le ${formatDate(new Date())}</p>
    <p>Rapport d'Activité RSO - Code ISPS</p>
  </div>
</body>
</html>
    `.trim();
  }
}

