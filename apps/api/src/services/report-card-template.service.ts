import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { readFile } from "fs/promises";

import puppeteer from "puppeteer";

export type ReportCardStudentIdentity = {
  studentId: string;
  firstName: string | null;
  lastName: string | null;
  studentNumber: string | null;
  dateOfBirth: string | Date | null;
  placeOfBirth: string | null;
  nationality: string | null;
};

export type ReportCardSubjectLine = {
  courseName: string;
  courseCode: string | null;
  coef: number;
  average: number | null;
  weightedScore: number | null;
  rank: number | null;
  appreciation: string;
};

export type ReportCardSection = {
  bilanTypeName: string;
  lines: ReportCardSubjectLine[];
  totalCoef: number;
  weightedTotal: number;
  average: number | null;
  rank: number | null;
  appreciation: string;
};

export type ReportCardSummary = {
  totalCoef: number;
  weightedTotal: number;
  overallAverage: number | null;
  rank: number | null;
  totalStudents: number;
  mention: string;
  decision: string;
  firstSemesterAverage?: number | null;
  secondSemesterAverage?: number | null;
  annualAverage?: number | null;
  annualRank?: number | null;
  distinctionSanctions?: string;
  attendanceSummary?: string;
  councilAppreciation?: string;
  endYearDecision?: string;
  affected?: boolean;
  repeating?: boolean;
};

export type ReportCardDocumentInput = {
  student: ReportCardStudentIdentity;
  schoolYearName: string;
  className: string;
  filiereName?: string;
  periodName: string;
  sections: ReportCardSection[];
  summary: ReportCardSummary;
};

type ReportCardLog = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

function resolveProjectRootFromCwd(): string {
  const cwd = path.resolve(process.cwd());
  const basename = path.basename(cwd).toLowerCase();
  const parentBasename = path.basename(path.dirname(cwd)).toLowerCase();

  if (basename === "api" && (parentBasename === "apps" || parentBasename === "packages")) {
    return path.resolve(cwd, "..", "..");
  }

  return cwd;
}

function resolveSchoolLogoPath(): string | null {
  const projectRoot = resolveProjectRootFromCwd();
  const logoPath = path.join(projectRoot, "assets", "modeles_documents", "logp.png");
  return fs.existsSync(logoPath) ? logoPath : null;
}

function findPuppeteerChromeBinary(): string | null {
  const envExecutable = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envExecutable && fs.existsSync(envExecutable)) {
    return envExecutable;
  }

  try {
    const bundledPath = puppeteer.executablePath();
    if (bundledPath && fs.existsSync(bundledPath)) {
      return bundledPath;
    }
  } catch {
    // Ignore: executable not installed for this runtime
  }

  const userHome = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const cacheRoot =
    process.env.PUPPETEER_CACHE_DIR || (userHome ? path.join(userHome, ".cache", "puppeteer") : null);
  if (!cacheRoot || !fs.existsSync(cacheRoot)) {
    return null;
  }

  const chromeDir = path.join(cacheRoot, "chrome");
  if (!fs.existsSync(chromeDir)) {
    return null;
  }

  const platformPrefix =
    process.platform === "win32" ? "win64-" : process.platform === "darwin" ? "mac-" : "linux-";
  const versions = fs
    .readdirSync(chromeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(platformPrefix))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const versionDir of versions) {
    const candidates =
      process.platform === "win32"
        ? [path.join(chromeDir, versionDir, "chrome-win64", "chrome.exe")]
        : process.platform === "darwin"
          ? [path.join(chromeDir, versionDir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")]
          : [path.join(chromeDir, versionDir, "chrome-linux64", "chrome")];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  if (process.platform === "win32") {
    try {
      const fromPath = execSync("where chrome", { encoding: "utf8" })
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find(Boolean);
      if (fromPath && fs.existsSync(fromPath)) {
        return fromPath;
      }
    } catch {
      // Ignore: not found in PATH
    }
  }

  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateFr(value: string | Date | null): string {
  if (!value) return "________________";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "________________";
  return date.toLocaleDateString("fr-FR");
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatNumberOrBlank(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  return formatNumber(value, digits);
}

function formatRank(rank: number | null | undefined, totalStudents?: number): string {
  if (rank == null || Number.isNaN(rank)) {
    return "NC";
  }

  if (totalStudents && totalStudents > 0) {
    return `${rank}/${totalStudents}`;
  }

  if (rank === 1) {
    return "1er";
  }

  return `${rank}e`;
}

function buildStudentFullName(student: ReportCardStudentIdentity): string {
  return `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim() || "Eleve";
}

async function renderHtmlToPdf(html: string): Promise<Buffer> {
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
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "4mm", right: "5mm", bottom: "5mm", left: "5mm" },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function buildReportCardsHtmlDocument(documents: ReportCardDocumentInput[]): Promise<string> {
  const logoPath = resolveSchoolLogoPath();
  const logoDataUri = logoPath
    ? `data:image/png;base64,${(await readFile(logoPath)).toString("base64")}`
    : null;

  const cards = documents
    .map((document) => {
      const studentName = buildStudentFullName(document.student);
      const normalizedPeriod = (document.periodName || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
      const isSecondSemester =
        normalizedPeriod.includes("SEMESTRE 2") ||
        normalizedPeriod.includes("DEUXIEME SEMESTRE");
      const firstSemesterCoeff = 1;
      const secondSemesterCoeff = 2;
      const doneDate = new Date().toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      const rowsHtml = document.sections
        .map((section) => {
          const sectionRows = section.lines
            .map(
              (line) => `
                <tr>
                  <td>
                    <div class="course-name">${escapeHtml(line.courseName)}</div>
                  </td>
                  <td class="num">${formatNumberOrBlank(line.average)}</td>
                  <td class="num">${formatNumberOrBlank(line.coef, 0)}</td>
                  <td class="num">${formatNumberOrBlank(line.weightedScore)}</td>
                  <td class="num">${escapeHtml(formatRank(line.rank))}</td>
                  <td>${escapeHtml(line.appreciation)}</td>
                </tr>
              `
            )
            .join("");

          return `
            ${sectionRows}
            <tr class="section-total group-total">
              <td>BILAN ${escapeHtml(section.bilanTypeName).toUpperCase()}</td>
              <td class="num">${formatNumberOrBlank(section.average)}</td>
              <td class="num">${formatNumberOrBlank(section.totalCoef, 0)}</td>
              <td class="num">${formatNumberOrBlank(section.weightedTotal)}</td>
              <td class="num"></td>
              <td></td>
            </tr>
          `;
        })
        .join("");

      const bottomSummaryHtml = isSecondSemester
        ? `
            <section class="semester2-summary">
              <div class="semester2-top">
                <div class="semester2-panel">
                  <div class="semester2-title">BILAN DU DEUXIEME SEMESTRE</div>
                  <div class="semester2-row">
                    <span class="council-label">Moyenne générale</span>
                    <span class="council-value strong">${formatNumber(document.summary.overallAverage)} / 20</span>
                  </div>
                  <div class="semester2-row">
                    <span class="council-label">Classement</span>
                    <span class="council-value strong">${escapeHtml(formatRank(document.summary.rank))}</span>
                  </div>
                  <div class="semester2-row">
                    <span class="council-label">Appréciation du Conseil</span>
                    <span class="council-value italic">${escapeHtml(document.summary.councilAppreciation || "")}</span>
                  </div>
                  <div class="semester2-row">
                    <span class="council-label">Assiduité</span>
                    <span class="council-value italic">${escapeHtml(document.summary.attendanceSummary || "")}</span>
                  </div>
                  <div class="semester2-row">
                    <span class="council-label">Distinction/Sanctions</span>
                    <span class="council-value italic">${escapeHtml(document.summary.distinctionSanctions || "")}</span>
                  </div>
                </div>
                <div class="semester2-panel">
                  <div class="semester2-title">DECISION DE FIN D'ANNEE</div>
                  <div class="decision-box">${escapeHtml(document.summary.endYearDecision || "")}</div>
                  <div class="decision-date">Fait à ABIDJAN, le ${escapeHtml(doneDate)}</div>
                </div>
              </div>
              <div class="semester2-bottom">
                <div class="semester2-title">BILAN DE FIN D'ANNEE</div>
                <table class="yearly-recap">
                  <tbody>
                    <tr>
                      <td>Rappel 1er Sem.</td>
                      <td class="num">${formatNumberOrBlank(document.summary.firstSemesterAverage ?? null)}</td>
                      <td class="num">x ${firstSemesterCoeff}</td>
                      <td class="num"></td>
                    </tr>
                    <tr>
                      <td>Rappel 2e Sem.</td>
                      <td class="num">${formatNumberOrBlank(document.summary.secondSemesterAverage ?? document.summary.overallAverage)}</td>
                      <td class="num">x ${secondSemesterCoeff}</td>
                      <td class="num"></td>
                    </tr>
                    <tr>
                      <td>Moyenne générale</td>
                      <td class="num">${formatNumberOrBlank(document.summary.annualAverage ?? document.summary.overallAverage)}</td>
                      <td class="num"></td>
                      <td class="num"></td>
                    </tr>
                    <tr>
                      <td>Classement</td>
                      <td class="num">${escapeHtml(formatRank(document.summary.annualRank ?? document.summary.rank))}</td>
                      <td class="num">/ ${document.summary.totalStudents}</td>
                      <td class="num"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          `
        : `
            <section class="semester1-bottom">
              <section class="council-summary">
                <div class="council-row">
                  <span class="council-label">Moyenne générale</span>
                  <span class="council-value strong">${formatNumber(document.summary.overallAverage)} / 20</span>
                </div>
                <div class="council-row">
                  <span class="council-label">Classement</span>
                  <span class="council-value strong">${escapeHtml(formatRank(document.summary.rank))}</span>
                </div>
                <div class="council-row">
                  <span class="council-label">Appréciation du Conseil</span>
                  <span class="council-value italic">${escapeHtml(document.summary.councilAppreciation || "")}</span>
                </div>
                <div class="council-row">
                  <span class="council-label">Assiduite</span>
                  <span class="council-value italic">${escapeHtml(document.summary.attendanceSummary || "")}</span>
                </div>
                <div class="council-row">
                  <span class="council-label">Distinction/Sanctions</span>
                  <span class="council-value italic">${escapeHtml(document.summary.distinctionSanctions || "")}</span>
                </div>
              </section>
              <div class="semester1-date-top">Fait à ABIDJAN, le ${escapeHtml(doneDate)}</div>
            </section>
          `;

      return `
        <section class="report-card">
          <header class="document-header">
            <div class="header-top">
              <div class="header-block header-block-left">
                <div class="gov-title">MINISTERE DE L'ENSEIGNEMENT SUPERIEUR ET DE LA<br />RECHERCHE SCIENTIFIQUE</div>
                <div class="gov-subtitle">DIRECTION DEPARTEMENTALE D'ABIDJAN 1</div>
                ${logoDataUri ? `<img class="school-logo" src="${logoDataUri}" alt="Logo Imhotep Academy" />` : ""}
              </div>
              <div class="header-block header-block-right">
                <div class="gov-title">REPUBLIQUE DE COTE D'IVOIRE</div>
                <div class="republic-motto">Union - Discipline - Travail</div>
                <div class="school-name">IMHOTEP ACADEMY (EXASP CI)</div>
                <div class="school-contact">03 BP 587 ABIDJAN 03 - Tel : 075 981 864 / 0707 755 94</div>
                <div class="school-year">${escapeHtml(document.schoolYearName)}</div>
              </div>
            </div>
            <div class="header-line"></div>
          </header>

          <main class="report-card-body">
            <div class="page-title">BULLETIN DE NOTES - ${escapeHtml(document.periodName.toUpperCase())}</div>
            <div class="page-subtitle">${escapeHtml(document.schoolYearName)}</div>

            <section class="student-summary">
              <div class="student-summary-layout">
                <div class="summary-full-name">${escapeHtml(studentName)}</div>
                <div class="summary-row summary-row-3">
                  <div class="summary-inline"><span class="summary-label">Ne(e) le</span><span class="summary-value">${escapeHtml(formatDateFr(document.student.dateOfBirth))}</span></div>
                  <div class="summary-inline"><span class="summary-label">Lieu</span><span class="summary-value">${escapeHtml(document.student.placeOfBirth || "--")}</span></div>
                  <div class="summary-inline"><span class="summary-label">Nationalite</span><span class="summary-value">${escapeHtml((document.student.nationality || "--").toUpperCase())}</span></div>
                </div>
                <div class="summary-row">
                  <div class="summary-inline"><span class="summary-label">Filiere</span><span class="summary-value">${escapeHtml(document.filiereName || document.className || "--")}</span></div>
                </div>
                <div class="summary-row summary-row-5">
                  <div class="summary-inline"><span class="summary-label">Classe</span><span class="summary-value">${escapeHtml(document.className)}</span></div>
                  <div class="summary-inline"><span class="summary-label">Effectif</span><span class="summary-value">${escapeHtml(String(document.summary.totalStudents ?? ""))}</span></div>
                  <div class="summary-inline"><span class="summary-label">Affecte(e)</span><span class="summary-value">${document.summary.affected ? "Oui" : "Non"}</span></div>
                  <div class="summary-inline"><span class="summary-label">Red.</span><span class="summary-value">${document.summary.repeating ? "Oui" : "Non"}</span></div>
                  <div class="summary-inline"><span class="summary-label">Matricule</span><span class="summary-value">${escapeHtml(document.student.studentNumber || "--")}</span></div>
                </div>
                <div class="student-photo-frame">
                  <div class="photo-placeholder">PHOTO</div>
                </div>
              </div>
            </section>

            <section class="section-block">
              <table class="grades-table">
                <thead>
                  <tr>
                    <th class="discipline-header">Discipline</th>
                    <th>Moy /20</th>
                    <th>Coef.</th>
                    <th>Moy coef</th>
                    <th>Rang</th>
                    <th>Appréciation</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                  <tr class="section-total totals-row">
                    <td>TOTAUX</td>
                    <td class="num"></td>
                    <td class="num">${formatNumberOrBlank(document.summary.totalCoef, 0)}</td>
                    <td class="num">${formatNumberOrBlank(document.summary.weightedTotal)}</td>
                    <td class="num"></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </section>

            ${bottomSummaryHtml}
          </main>
        </section>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: A4; margin: 3mm 4mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Georgia", "Times New Roman", serif;
        color: #243a5a;
        background: #ffffff;
      }
      .report-card {
        position: relative;
        background: #ffffff;
        padding: 6mm 6mm 5mm;
        page-break-after: always;
      }
      .report-card:last-child { page-break-after: auto; }
      .report-card::before {
        content: "";
        position: absolute;
        inset: 2mm;
        border: 1px solid #dbe4f4;
        pointer-events: none;
      }
      .document-header,
      .report-card-body {
        position: relative;
        z-index: 1;
      }
      .header-top {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        align-items: start;
      }
      .header-block { text-align: center; }
      .gov-title {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 6.6pt;
        line-height: 1.2;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .gov-subtitle {
        margin-top: 6px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 6.6pt;
        white-space: nowrap;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .republic-motto {
        margin-top: 2px;
        font-size: 6.6pt;
        white-space: nowrap;
        font-style: italic;
        color: #7f8795;
      }
      .school-logo {
        display: block;
        width: 118px;
        max-width: 100%;
        margin: 8px auto 0;
      }
      .school-name {
        margin-top: 8px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 8pt;
        white-space: nowrap;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .school-contact {
        margin-top: 4px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 6.4pt;
        line-height: 1.1;
        white-space: nowrap;
        color: #666d79;
      }
      .school-year {
        margin-top: 8px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 8pt;
        font-weight: 700;
        color: #314e7d;
      }
      .header-line {
        margin-top: 8px;
        height: 2px;
        background: linear-gradient(90deg, #4d86e4, #89aef2);
      }
      .report-card-body {
        padding: 8px 2px 0;
      }
      .page-title {
        margin: 4px 0 2px;
        text-align: center;
        font-size: 12.5pt;
        letter-spacing: 0.05em;
        font-weight: 700;
        color: #173e73;
      }
      .page-subtitle {
        margin-bottom: 12px;
        text-align: center;
        font-size: 8.8pt;
        font-weight: 700;
        color: #6e7e98;
      }
      .student-summary {
        margin-bottom: 6px;
        padding: 8px 8px;
        border: 1px solid #d9e3f2;
        background: linear-gradient(180deg, #f9fbff, #f1f6ff);
        border-radius: 8px;
      }
      .student-summary-layout {
        display: grid;
        grid-template-columns: 1fr 92px;
        gap: 8px 10px;
        align-items: stretch;
      }
      .summary-full-name {
        grid-column: 1;
        font-size: 12pt;
        font-weight: 700;
        color: #173e73;
        letter-spacing: 0.03em;
        padding: 2px 0 4px;
      }
      .summary-row {
        grid-column: 1;
        display: grid;
        gap: 14px;
        margin-top: 1px;
      }
      .summary-row-3 {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .summary-row-5 {
        grid-template-columns: 1.2fr 0.8fr 0.8fr 0.7fr 1fr;
      }
      .summary-inline {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px;
        font-size: 8pt;
        align-items: center;
        padding: 1px 0;
      }
      .summary-label {
        font-weight: 700;
        color: #31527f;
      }
      .summary-label::after {
        content: ":";
        margin-left: 2px;
      }
      .summary-value {
        color: #173e73;
        font-weight: 700;
      }
      .student-photo-frame {
        grid-column: 2;
        grid-row: 1 / span 4;
        border: 1px solid #cddaf0;
        background: #ffffff;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 102px;
      }
      .photo-placeholder {
        width: 62px;
        height: 78px;
        border: 1px dashed #8ca4cc;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7pt;
        font-weight: 700;
        letter-spacing: 0.05em;
        color: #5e79a5;
      }
      .section-block {
        margin-bottom: 6px;
      }
      .grades-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 7.8pt;
      }
      .grades-table th,
      .grades-table td {
        border: 1px solid #d7deeb;
        padding: 3px 4px;
        vertical-align: top;
      }
      .grades-table thead th {
        background: #eef3fb;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7pt;
        text-transform: uppercase;
        color: #32527f;
        text-align: center;
      }
      .grades-table thead th.discipline-header {
        text-align: left;
      }
      .grades-table tbody tr:nth-child(odd) td {
        background: #fbfcff;
      }
      .grades-table .num {
        text-align: right;
        white-space: nowrap;
      }
      .course-name {
        font-weight: 700;
        color: #253f65;
      }
      .section-total td {
        background: #f4f7fd !important;
        font-weight: 700;
        color: #1d467a;
      }
      .totals-row td {
        background: #e6f0ff !important;
        color: #1a3f70;
      }
      .group-total td {
        background: #eef3ff !important;
        color: #1d467a;
      }
      .general-total td {
        background: linear-gradient(180deg, #e7f0ff, #dce9ff) !important;
      }
      .council-summary {
        margin-top: 8px;
        border: 1px solid #d6e1f5;
        background: #f7faff;
        min-height: 34mm;
      }
      .council-row {
        display: grid;
        grid-template-columns: 180px 1fr;
        gap: 8px;
        padding: 6px 7px;
        font-size: 8pt;
        border-top: 1px solid #dfe7f5;
      }
      .council-row:first-child {
        border-top: none;
      }
      .council-label {
        font-weight: 700;
        color: #31527f;
      }
      .council-value {
        color: #173e73;
      }
      .council-value.strong {
        font-weight: 700;
      }
      .council-value.italic {
        font-style: italic;
      }
      .semester1-bottom {
        margin-top: 8px;
        display: grid;
        grid-template-columns: calc((100% - 8px) * 0.6) calc((100% - 8px) * 0.4);
        gap: 8px;
        align-items: start;
      }
      .semester1-date-top {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        text-align: center;
        font-size: 7.8pt;
        color: #48658f;
        padding-top: 6px;
      }
      .semester2-summary {
        margin-top: 8px;
      }
      .semester2-top {
        display: grid;
        grid-template-columns: 1.35fr 0.9fr;
        gap: 8px;
      }
      .semester2-panel,
      .semester2-bottom {
        border: 1px solid #d6e1f5;
        background: #f7faff;
      }
      .semester2-title {
        padding: 4px 6px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7.8pt;
        font-weight: 700;
        text-transform: uppercase;
        color: #1f487e;
        border-bottom: 1px solid #d6e1f5;
        background: #edf3ff;
      }
      .semester2-row {
        display: grid;
        grid-template-columns: 160px 1fr;
        gap: 8px;
        padding: 5px 6px;
        font-size: 8pt;
        border-top: 1px solid #dfe7f5;
      }
      .semester2-panel > .semester2-title + .semester2-row {
        border-top: none;
      }
      .decision-box {
        margin: 6px;
        min-height: 46px;
        padding: 10px 8px;
        border: 1px solid #b7c8e6;
        background: #ffffff;
        text-align: center;
        font-size: 11pt;
        font-style: italic;
        font-weight: 700;
        color: #1e3f6c;
      }
      .decision-date {
        padding: 6px 8px 8px;
        text-align: right;
        font-size: 7.8pt;
        color: #48658f;
      }
      .semester2-bottom {
        margin-top: 8px;
        width: calc((100% - 8px) * 0.6);
      }
      .yearly-recap {
        width: 100%;
        border-collapse: collapse;
        font-size: 8pt;
      }
      .yearly-recap td {
        border-top: 1px solid #dfe7f5;
        padding: 5px 6px;
      }
      .yearly-recap tr:first-child td {
        border-top: none;
      }
      .yearly-recap td:first-child {
        width: 46%;
        font-weight: 700;
        color: #31527f;
      }
    </style>
  </head>
  <body>${cards}</body>
</html>`;
}

export async function generateReportCardsPdfFromHtml(
  documents: ReportCardDocumentInput[],
  options?: { log?: ReportCardLog }
): Promise<Buffer> {
  if (documents.length === 0) {
    throw new Error("Aucun bulletin a generer");
  }

  options?.log?.info?.("Generation des bulletins via HTML/CSS + Puppeteer");

  try {
    const html = await buildReportCardsHtmlDocument(documents);
    return await renderHtmlToPdf(html);
  } catch (error: any) {
    const message = String(error?.message || error);
    if (message.includes("Could not find Chrome")) {
      throw new Error(
        "Generation PDF impossible: Chrome introuvable pour Puppeteer. Installez-le avec `npx puppeteer browsers install chrome` (dans apps/api), ou definissez PUPPETEER_EXECUTABLE_PATH / PUPPETEER_CACHE_DIR."
      );
    }

    throw error;
  }
}
