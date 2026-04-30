import { existsSync, readdirSync, promises as fs } from "fs";
import { join, dirname, resolve, basename } from "path";
import * as os from "os";
import { execSync } from "child_process";
import puppeteer from "puppeteer";

interface ReceiptData {
  receiptNumber: string;
  transactionId: string;
  studentName: string;
  studentNumber: string;
  feeType: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  paymentDate: Date;
  academicYear: string;
  className?: string;
  remainingAmount?: number;
  tenantInfo: {
    name: string;
    address: string;
    phone: string;
    email: string;
    logo?: string;
  };
}

interface ReceiptTemplate {
  generateHTML(data: ReceiptData): string;
}

type FeeTemplateMeta = {
  label: string;
  documentTitle: string;
  intro: string;
  purpose: string;
  detailsTitle: string;
  footerNote: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveProjectRootFromCwd(): string {
  const cwd = resolve(process.cwd());
  const base = basename(cwd).toLowerCase();
  const parent = basename(dirname(cwd)).toLowerCase();

  if (base === "api" && (parent === "apps" || parent === "packages")) {
    return resolve(cwd, "..", "..");
  }

  return cwd;
}

function normalizeFeeType(raw: string): "inscription" | "scolarite" | "annexes" | "autres" {
  const normalized = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (normalized === "inscription") return "inscription";
  if (normalized === "scolarite") return "scolarite";
  if (normalized === "annexes") return "annexes";
  return "autres";
}

function getFeeTemplateMeta(feeType: string): FeeTemplateMeta {
  const key = normalizeFeeType(feeType);

  if (key === "inscription") {
    return {
      label: "Inscription",
      documentTitle: "REÇU D'INSCRIPTION",
      intro: "Ce document confirme l'encaissement des frais liés à l'inscription de l'étudiant.",
      purpose:
        "Le paiement couvre les formalités administratives d'enregistrement et l'ouverture du dossier pédagogique.",
      detailsTitle: "Détails de l'inscription",
      footerNote: "Ce reçu est valable comme justificatif administratif d'inscription.",
    };
  }

  if (key === "scolarite") {
    return {
      label: "Scolarité",
      documentTitle: "REÇU DE SCOLARITÉ",
      intro: "Ce document atteste le règlement des frais de scolarité.",
      purpose:
        "Le paiement participe à la couverture des prestations pédagogiques et du suivi académique.",
      detailsTitle: "Détails de la scolarité",
      footerNote: "Conserver ce reçu pour tout contrôle comptable ou pédagogique.",
    };
  }

  if (key === "annexes") {
    return {
      label: "Annexes",
      documentTitle: "REÇU DE FRAIS ANNEXES",
      intro: "Ce document atteste le paiement de frais annexes liés à la vie scolaire.",
      purpose:
        "Le paiement concerne les services complémentaires et charges associées à la scolarité.",
      detailsTitle: "Détails des frais annexes",
      footerNote: "Ce reçu constitue la preuve de règlement des frais annexes.",
    };
  }

  return {
    label: "Autres",
    documentTitle: "REÇU AUTRES FRAIS",
    intro: "Ce document atteste le paiement d'autres frais identifiés par l'administration.",
    purpose:
      "Le paiement couvre des charges spécifiées dans le cadre du parcours administratif ou scolaire.",
    detailsTitle: "Détails des autres frais",
    footerNote: "Ce reçu fait foi de règlement pour la catégorie Autres.",
  };
}

function findPuppeteerChromeBinary(): string | null {
  const envExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envExecutable) {
    return envExecutable;
  }

  try {
    const bundledPath = puppeteer.executablePath();
    if (bundledPath) {
      return bundledPath;
    }
  } catch {
    // Ignore
  }

  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const cacheRoot =
    process.env.PUPPETEER_CACHE_DIR || (userHome ? join(userHome, ".cache", "puppeteer") : null);

  if (cacheRoot) {
    const chromeDir = join(cacheRoot, "chrome");

    try {
      const versions = readdirSync(chromeDir, { withFileTypes: true })
        .filter((entry: any) => entry.isDirectory())
        .map((entry: any) => entry.name)
        .sort()
        .reverse();

      for (const version of versions) {
        const candidates =
          process.platform === "win32"
            ? [join(chromeDir, version, "chrome-win64", "chrome.exe")]
            : process.platform === "darwin"
              ? [join(chromeDir, version, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")]
              : [join(chromeDir, version, "chrome-linux64", "chrome")];

        for (const candidate of candidates) {
          if (existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  if (process.platform === "win32") {
    try {
      const fromPath = execSync("where chrome", { encoding: "utf8" })
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find(Boolean);
      if (fromPath) {
        return fromPath;
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

class FrenchReceiptTemplate implements ReceiptTemplate {
  generateHTML(data: ReceiptData): string {
    const feeMeta = getFeeTemplateMeta(data.feeType);

    const formatCurrency = (amount: number) =>
      new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: data.currency,
        minimumFractionDigits: 0,
      }).format(amount);

    const formatDate = (date: Date) =>
      new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);

    const getPaymentMethodLabel = (method: string) => {
      switch (method) {
        case "orange_money":
          return "Orange Money";
        case "mtn_money":
          return "MTN Mobile Money";
        case "moov_money":
          return "Moov Money";
        case "card":
          return "Carte Bancaire";
        case "bank_transfer":
          return "Virement Bancaire";
        case "especes":
          return "Espèces";
        default:
          return method;
      }
    };

    return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(feeMeta.documentTitle)} - ${escapeHtml(data.receiptNumber)}</title>
    <style>
      @page { size: A4; margin: 7mm 8mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        color: #243a5a;
        background: #ffffff;
      }
      .document {
        position: relative;
        min-height: calc(297mm - 14mm);
        border: 1px solid #dbe4f4;
        padding: 10mm 9mm;
      }
      .header-top {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        align-items: start;
      }
      .header-block {
        text-align: center;
      }
      .gov-title {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7pt;
        line-height: 1.2;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .gov-subtitle {
        margin-top: 7px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7pt;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .republic-motto {
        margin-top: 2px;
        font-size: 7pt;
        font-style: italic;
        color: #7f8795;
      }
      .school-logo {
        display: block;
        width: 132px;
        max-height: 64px;
        object-fit: contain;
        margin: 10px auto 0;
      }
      .school-name {
        margin-top: 9px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 8.5pt;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .school-contact {
        margin-top: 4px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 6.8pt;
        line-height: 1.25;
        color: #666d79;
      }
      .school-year {
        margin-top: 9px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 8.5pt;
        font-weight: 700;
        color: #314e7d;
      }
      .header-line {
        margin-top: 10px;
        height: 2px;
        background: linear-gradient(90deg, #4d86e4, #89aef2);
      }
      .title {
        margin-top: 16px;
        text-align: center;
        font-size: 18pt;
        letter-spacing: 0.06em;
        font-weight: 700;
        color: #173e73;
      }
      .subtitle {
        margin-top: 6px;
        text-align: center;
        font-size: 10.5pt;
        color: #6e7e98;
      }
      .lead {
        margin-top: 18px;
        font-size: 11.2pt;
        line-height: 1.55;
        text-align: justify;
      }
      .box {
        margin-top: 14px;
        border: 1px solid #d9e3f2;
        border-radius: 10px;
        background: linear-gradient(180deg, #f9fbff, #f1f6ff);
        overflow: hidden;
      }
      .box-title {
        padding: 8px 12px;
        background: #eef3ff;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9pt;
        font-weight: 700;
        text-transform: uppercase;
        color: #1f487e;
      }
      .rows {
        padding: 8px 12px;
      }
      .row {
        display: grid;
        grid-template-columns: 180px 1fr;
        gap: 10px;
        padding: 6px 0;
        border-bottom: 1px dashed #d3deef;
        font-size: 10pt;
      }
      .row:last-child {
        border-bottom: none;
      }
      .label {
        font-weight: 700;
        color: #31527f;
      }
      .value {
        color: #1f3554;
      }
      .amount {
        font-size: 16pt;
        font-weight: 700;
        color: #0f7a55;
      }
      .footer {
        margin-top: 24px;
        padding-top: 14px;
        border-top: 1px solid #dce5f3;
      }
      .footer-note {
        font-size: 10pt;
        font-style: italic;
        color: #4c6488;
      }
      .status {
        display: inline-block;
        margin-top: 7px;
        background: #10b981;
        color: #fff;
        border-radius: 999px;
        padding: 4px 10px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 8pt;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
    </style>
  </head>
  <body>
    <div class="document">
      <header>
        <div class="header-top">
          <div class="header-block">
            <div class="gov-title">MINISTERE DE L'ENSEIGNEMENT SUPERIEUR ET DE LA<br/>RECHERCHE SCIENTIFIQUE</div>
            <div class="gov-subtitle">DIRECTION DEPARTEMENTALE D'ABIDJAN 1</div>
            ${data.tenantInfo.logo ? `<img class="school-logo" src="${data.tenantInfo.logo}" alt="Logo"/>` : ""}
          </div>
          <div class="header-block">
            <div class="gov-title">REPUBLIQUE DE COTE D'IVOIRE</div>
            <div class="republic-motto">Union - Discipline - Travail</div>
            <div class="school-name">IMHOTEP ACADEMY (EXASP CI)</div>
            <div class="school-contact">03 BP 587 ABIDJAN 03 - Tel : 075 981 864 / 0707 755 94</div>
            <div class="school-year">${escapeHtml(data.academicYear || "")}</div>
          </div>
        </div>
        <div class="header-line"></div>
      </header>

      <main>
        <div class="title">${escapeHtml(feeMeta.documentTitle)}</div>
        <div class="subtitle">Numéro ${escapeHtml(data.receiptNumber)}</div>

        <p class="lead">${escapeHtml(feeMeta.intro)} ${escapeHtml(feeMeta.purpose)}</p>

        <section class="box">
          <div class="box-title">Identité de l'étudiant</div>
          <div class="rows">
            <div class="row"><div class="label">Nom complet</div><div class="value">${escapeHtml(data.studentName || "Non renseigné")}</div></div>
            <div class="row"><div class="label">Matricule</div><div class="value">${escapeHtml(data.studentNumber || "Non renseigné")}</div></div>
            <div class="row"><div class="label">Classe</div><div class="value">${escapeHtml(data.className || "Non renseignée")}</div></div>
          </div>
        </section>

        <section class="box">
          <div class="box-title">${escapeHtml(feeMeta.detailsTitle)}</div>
          <div class="rows">
            <div class="row"><div class="label">Catégorie de frais</div><div class="value">${escapeHtml(feeMeta.label)}</div></div>
            <div class="row"><div class="label">Méthode de paiement</div><div class="value">${escapeHtml(getPaymentMethodLabel(data.paymentMethod))}</div></div>
            <div class="row"><div class="label">Date de paiement</div><div class="value">${escapeHtml(formatDate(data.paymentDate))}</div></div>
            <div class="row"><div class="label">Référence transaction</div><div class="value">${escapeHtml(data.transactionId)}</div></div>
            <div class="row"><div class="label">Montant réglé</div><div class="value amount">${escapeHtml(formatCurrency(data.amount))}</div></div>
            ${normalizeFeeType(data.feeType) === "scolarite"
              ? `<div class="row"><div class="label">Montant restant à payer</div><div class="value">${escapeHtml(formatCurrency(Math.max(0, Number(data.remainingAmount || 0))))}</div></div>`
              : ""}
          </div>
        </section>

        <div class="footer">
          <div class="footer-note">${escapeHtml(feeMeta.footerNote)}</div>
          <div class="status">PAYÉ</div>
        </div>
      </main>
    </div>
  </body>
</html>`;
  }
}

class EnglishReceiptTemplate implements ReceiptTemplate {
  generateHTML(data: ReceiptData): string {
    return new FrenchReceiptTemplate()
      .generateHTML(data)
      .replace(/REÇU/g, "RECEIPT")
      .replace(/PAYÉ/g, "PAID");
  }
}

export class ReceiptGeneratorService {
  private templates: Map<string, ReceiptTemplate> = new Map([
    ["fr", new FrenchReceiptTemplate()],
    ["en", new EnglishReceiptTemplate()],
  ]);

  private async getDefaultSchoolLogoDataUri(): Promise<string | null> {
    const projectRoot = resolveProjectRootFromCwd();
    const logoPath = join(projectRoot, "assets", "modeles_documents", "logp.png");

    try {
      const bytes = await fs.readFile(logoPath);
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }

  async generateReceipt(
    receiptData: ReceiptData,
    language: string = "fr",
    outputPath?: string
  ): Promise<{ filePath: string; receiptNumber: string }> {
    try {
      const template = this.templates.get(language) || this.templates.get("fr")!;

      if (!receiptData.tenantInfo.logo) {
        const fallbackLogo = await this.getDefaultSchoolLogoDataUri();
        if (fallbackLogo) {
          receiptData.tenantInfo.logo = fallbackLogo;
        }
      }

      const htmlContent = template.generateHTML(receiptData);
      const fileName = `receipt_${receiptData.receiptNumber}_${Date.now()}.html`;
      const filePath = outputPath || join(process.cwd(), "uploads", "receipts", fileName);

      await fs.mkdir(dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, htmlContent, "utf8");

      return {
        filePath,
        receiptNumber: receiptData.receiptNumber,
      };
    } catch (error) {
      console.error("Error generating receipt:", error);
      throw new Error(`Failed to generate receipt: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async generatePaymentReceipt(
    transactionData: {
      transactionId: string;
      studentName: string;
      studentNumber: string;
      feeType: string;
      amount: number;
      currency: string;
      paymentMethod: string;
      paymentDate: Date;
      academicYear: string;
      className?: string;
      remainingAmount?: number;
    },
    tenantInfo: {
      name: string;
      address: string;
      phone: string;
      email: string;
      logo?: string;
    },
    receiptNumber: string,
    language: string = "fr"
  ): Promise<{ filePath: string; receiptNumber: string }> {
    const receiptData: ReceiptData = {
      receiptNumber,
      ...transactionData,
      tenantInfo,
    };

    return this.generateReceipt(receiptData, language);
  }

  async convertToPDF(htmlFilePath: string): Promise<string> {
    try {
      const htmlContent = await fs.readFile(htmlFilePath, "utf8");

      const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      };

      const chromePath = findPuppeteerChromeBinary();
      if (chromePath) {
        launchOptions.executablePath = chromePath;
      }

      const browser = await puppeteer.launch(launchOptions);

      try {
        const page = await browser.newPage();
        await page.setContent(htmlContent, {
          waitUntil: "networkidle0",
          timeout: 30000,
        });

        const pdfPath = htmlFilePath.replace(/\.html$/i, ".pdf");

        await page.pdf({
          path: pdfPath,
          format: "A4",
          printBackground: true,
          margin: {
            top: "7mm",
            right: "8mm",
            bottom: "7mm",
            left: "8mm",
          },
        });

        await page.close();
        return pdfPath;
      } finally {
        await browser.close();
      }
    } catch (error) {
      console.error("Error converting HTML to PDF:", error);
      console.warn("Falling back to HTML file");
      return htmlFilePath;
    }
  }

  async verifyReceipt(_receiptNumber: string): Promise<boolean> {
    return true;
  }
}

export function createReceiptGeneratorService(): ReceiptGeneratorService {
  return new ReceiptGeneratorService();
}
