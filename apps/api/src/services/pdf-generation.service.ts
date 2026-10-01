import puppeteer from "puppeteer";

/**
 * Rendu HTML → PDF serveur (Puppeteer), utilisé par l'espace owner. Le gabarit « programme de
 * formation » d'Imhotep a été retiré avec le catalogue de formations professionnelles.
 */
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

