import puppeteer from "puppeteer";
import { FormationDetail } from "@ecoledigitale/contracts";

export class PDFGenerationService {
  private browser: any = null;

  /**
   * Initialize Puppeteer browser instance
   */
  async initialize(): Promise<void> {
    if (!this.browser) {
      try {
        this.browser = await puppeteer.launch({
          headless: "new", // Use new headless mode
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
      } catch (error: any) {
        // Check if it's a Chrome not found error
        if (error.message && error.message.includes("Could not find Chrome")) {
          throw new Error(
            "Chrome browser not found. Please run: npx puppeteer browsers install chrome"
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
   * Generate PDF for a training program
   */
  async generateProgrammePDF(formation: FormationDetail): Promise<Buffer> {
    await this.initialize();

    const page = await this.browser.newPage();

    try {
      const html = this.generateHTMLTemplate(formation);

      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "20mm",
          right: "15mm",
          bottom: "20mm",
          left: "15mm",
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
  private generateHTMLTemplate(formation: FormationDetail): string {
    const formatPrice = (price: number) => {
      return new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "XOF",
        minimumFractionDigits: 0,
      }).format(price);
    };

    const formatDuration = () => {
      if (formation.duree_jours && formation.duree_heures) {
        return `${formation.duree_jours} jours / ${formation.duree_heures} heures`;
      } else if (formation.duree_jours) {
        return `${formation.duree_jours} jours`;
      } else if (formation.duree_heures) {
        return `${formation.duree_heures} heures`;
      }
      return "Non spécifié";
    };

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Programme de Formation - ${formation.titre}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Arial', sans-serif;
            line-height: 1.6;
            color: #333;
            background: #fff;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        
        .logo {
            font-size: 24px;
            font-weight: bold;
            color: #2563eb;
            margin-bottom: 10px;
        }
        
        .title {
            font-size: 28px;
            font-weight: bold;
            color: #1e40af;
            margin-top: 20px;
            margin-bottom: 10px;
        }
        
        .section {
            margin-bottom: 30px;
            page-break-inside: avoid;
        }
        
        .section-title {
            font-size: 20px;
            font-weight: bold;
            color: #2563eb;
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
            border-radius: 5px;
        }
        
        .info-label {
            font-weight: bold;
            color: #6b7280;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        
        .info-value {
            color: #111827;
            font-size: 14px;
        }
        
        .objectives-list, .programme-list {
            list-style: none;
            padding-left: 0;
        }
        
        .objectives-list li, .programme-list li {
            padding: 8px 0;
            padding-left: 25px;
            position: relative;
        }
        
        .objectives-list li:before {
            content: "✓";
            position: absolute;
            left: 0;
            color: #10b981;
            font-weight: bold;
        }
        
        .programme-list li:before {
            content: "→";
            position: absolute;
            left: 0;
            color: #2563eb;
            font-weight: bold;
        }
        
        .module-title {
            font-weight: bold;
            color: #1e40af;
            margin-top: 15px;
            margin-bottom: 8px;
        }
        
        .module-content {
            padding-left: 20px;
            margin-bottom: 15px;
        }
        
        .module-content-item {
            padding: 5px 0;
            padding-left: 20px;
            position: relative;
        }
        
        .module-content-item:before {
            content: "•";
            position: absolute;
            left: 0;
            color: #6b7280;
        }
        
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #e5e7eb;
            text-align: center;
            font-size: 12px;
            color: #6b7280;
        }
        
        .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
            margin-right: 8px;
        }
        
        .badge-niveau {
            background: #dbeafe;
            color: #1e40af;
        }
        
        .badge-certification {
            background: #dcfce7;
            color: #166534;
        }
        
        @media print {
            body {
                padding: 0;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">IMHOTEP DATA</div>
        <div class="title">${formation.titre}</div>
    </div>
    
    <div class="section">
        <div class="info-grid">
            <div class="info-item">
                <div class="info-label">Durée</div>
                <div class="info-value">${formatDuration()}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Prix TTC</div>
                <div class="info-value">${formatPrice(formation.prix_ttc)}</div>
            </div>
            <div class="info-item">
                <div class="info-label">Niveau</div>
                <div class="info-value">
                    ${formation.niveau ? `<span class="badge badge-niveau">${formation.niveau}</span>` : "Non spécifié"}
                </div>
            </div>
            <div class="info-item">
                <div class="info-label">Certification</div>
                <div class="info-value">
                    ${formation.type_certification ? `<span class="badge badge-certification">${formation.type_certification}</span>` : "Non certifiante"}
                </div>
            </div>
        </div>
    </div>
    
    ${formation.objectifs && formation.objectifs.length > 0 ? `
    <div class="section">
        <div class="section-title">Objectifs Pédagogiques</div>
        <ul class="objectives-list">
            ${formation.objectifs.map((obj) => `<li>${obj}</li>`).join("")}
        </ul>
    </div>
    ` : ""}
    
    ${formation.programme_detaille ? `
    <div class="section">
        <div class="section-title">Programme Détaillé</div>
        ${formation.programme_detaille.modules.map((module) => `
            <div class="module-title">${module.titre}${module.duree ? ` - ${module.duree}` : ""}</div>
            <div class="module-content">
                ${module.contenu.map((item) => `<div class="module-content-item">${item}</div>`).join("")}
            </div>
        `).join("")}
    </div>
    ` : ""}
    
    ${formation.prerequis ? `
    <div class="section">
        <div class="section-title">Prérequis</div>
        <p>${formation.prerequis.replace(/\n/g, "<br>")}</p>
    </div>
    ` : ""}
    
    ${formation.public_cible ? `
    <div class="section">
        <div class="section-title">Public Cible</div>
        <p>${formation.public_cible.replace(/\n/g, "<br>")}</p>
    </div>
    ` : ""}
    
    ${formation.nom_certification ? `
    <div class="section">
        <div class="section-title">Certification</div>
        <p><strong>${formation.nom_certification}</strong></p>
        <p>${formation.type_certification || "Certification professionnelle"}</p>
    </div>
    ` : ""}
    
    <div class="footer">
        <p>Pour plus d'informations, contactez-nous :</p>
        <p>Email: contact@imhotepdata.com | Téléphone: +225 XX XX XX XX</p>
        <p>Document généré le ${new Date().toLocaleDateString("fr-FR")}</p>
    </div>
</body>
</html>
    `;
  }

  /**
   * Generic HTML → PDF (e.g. Owner financial summary).
   */
  async generatePdfFromHtml(html: string): Promise<Buffer> {
    await this.initialize();
    const page = await this.browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "15mm", right: "12mm", bottom: "15mm", left: "12mm" },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}

