/**
 * Genere des attestations de frequentation en PDF (un par eleve), puis fusion.
 * Template Word attendu:
 * assets/modeles_documents/attestation-frequentation-TEMPLATE.docx
 */

import fs from "fs";
import path from "path";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import { access, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import mammoth from "mammoth";
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";

const execFileAsync = promisify(execFile);

export type AttendanceStudentInput = {
  firstName: string | null;
  lastName: string | null;
  studentNumber: string | null;
  dateOfBirth: string | null;
  placeOfBirth: string | null;
  fatherName: string | null;
  motherName: string | null;
  scholarshipLevel: string | null;
};

export type AttendanceMetaInput = {
  schoolYearName: string;
  className: string;
  periodName?: string | null;
};

type AttendanceLog = {
  info?: (m: string) => void;
  warn?: (m: string) => void;
  error?: (m: string) => void;
};

function formatDateFr(date: Date | string | null): string {
  if (!date) return "________________";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "________________";
  return d.toLocaleDateString("fr-FR");
}

/** Nom du template DOCX attendu. */
const ATTENDANCE_TEMPLATE_FILE_NAME = "attestation-frequentation-TEMPLATE.docx";

function resolveProjectRootFromCwd(): string {
  const cwd = path.resolve(process.cwd());
  const basename = path.basename(cwd).toLowerCase();
  const parentBasename = path.basename(path.dirname(cwd)).toLowerCase();

  if (basename === "api" && (parentBasename === "apps" || parentBasename === "packages")) {
    return path.resolve(cwd, "..", "..");
  }
  return cwd;
}

/**
 * Construit le chemin template selon convention:
 * assets/modeles_documents/attestation-frequentation-TEMPLATE.docx
 * Retourne null si le fichier est absent.
 */
export async function resolveAttendanceCertificateTemplatePath(): Promise<string | null> {
  const projectRoot = resolveProjectRootFromCwd();
  const templatePath = path.join(
    projectRoot,
    "assets",
    "modeles_documents",
    ATTENDANCE_TEMPLATE_FILE_NAME
  );

  try {
    await access(templatePath, fs.constants.F_OK);
    return templatePath;
  } catch {
    return null;
  }
}

function resolveAttendanceLogoPath(): string | null {
  const projectRoot = resolveProjectRootFromCwd();
  const logoPath = path.join(projectRoot, "assets", "modeles_documents", "logp.png");
  return fs.existsSync(logoPath) ? logoPath : null;
}

function findLibreOfficeBinary(): string | null {
  const envPath = process.env.LIBREOFFICE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }
  const win = "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
  if (fs.existsSync(win)) {
    return win;
  }
  const win86 = "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe";
  if (fs.existsSync(win86)) {
    return win86;
  }
  if (process.platform === "win32") {
    try {
      const out = execSync("where soffice", { encoding: "utf8" })
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (out.length > 0 && fs.existsSync(out[0])) {
        return out[0];
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const out = execSync("which soffice", { encoding: "utf8" }).trim();
    if (out) {
      return out;
    }
  } catch {
    /* ignore */
  }
  return null;
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

  const platformPrefix = process.platform === "win32" ? "win64-" : process.platform === "darwin" ? "mac-" : "linux-";
  const versions = fs
    .readdirSync(chromeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(platformPrefix))
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const versionDir of versions) {
    const candidates =
      process.platform === "win32"
        ? [path.join(chromeDir, versionDir, "chrome-win64", "chrome.exe")]
        : process.platform === "darwin"
          ? [path.join(chromeDir, versionDir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")]
          : [path.join(chromeDir, versionDir, "chrome-linux64", "chrome")];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
  }

  return null;
}

/** Corps du certificat (WordprocessingML) avec champs docxtemplater {{...}}. */
function buildAttestationBodyOoxml(): string {
  const p = (inner: string) =>
    `<w:p w14:paraId="A1B2C3D4" w14:textId="77777777" w:rsidR="00EB3670" w:rsidRDefault="00EB3670">${inner}</w:p>`;
  const r = (text: string, rPr?: string) =>
    `<w:r>${rPr ?? ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const rPr = (opts: { bold?: boolean; italic?: boolean; sz?: number }) => {
    const parts: string[] = [];
    if (opts.bold) {
      parts.push("<w:b/><w:bCs/>");
    }
    if (opts.italic) {
      parts.push("<w:i/><w:iCs/>");
    }
    if (opts.sz) {
      parts.push(`<w:sz w:val="${opts.sz}"/><w:szCs w:val="${opts.sz}"/>`);
    }
    return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
  };

  return [
    p(`<w:pPr><w:jc w:val="center"/></w:pPr>${r("Attestation de fréquentation", rPr({ bold: true, sz: 36 }))}`),
    p(`${r("{{etablissement_intro}}")}`),
    p(`${r("L'élève : {{eleve_nom}}", rPr({ bold: true }))}`),
    p(`${r("Né(e) le : {{date_naissance}} à {{lieu_naissance}}", rPr({ bold: true }))}`),
    p(`${r("Fils de : {{nom_pere}}", rPr({ bold: true }))}`),
    p(`${r("Et de : {{nom_mere}}", rPr({ bold: true }))}`),
    p(`${r("est inscrit sur le registre de l'établissement pour l'année scolaire {{annee_scolaire}}", rPr({}))}`),
    p(`${r("et fréquente régulièrement la classe de {{classe}}", rPr({}))}`),
    p(`${r("Période : {{periode_label}}", rPr({}))}`),
    p(`${r("Matricule : {{matricule}}          Bourse : {{bourse}}", rPr({ bold: true }))}`),
    p(
      `<w:pPr><w:spacing w:before="240"/></w:pPr>${r(
        "En foi de quoi le présent certificat est établi pour servir et valoir ce que de droit.",
        rPr({ italic: true })
      )}`
    ),
    p(
      `<w:pPr><w:jc w:val="right"/></w:pPr>${r("Fait à {{lieu_attestation}}, le {{date_attestation}}", rPr({ italic: true }))}`
    ),
  ].join("");
}

function buildStyledAttestationBodyOoxml(): string {
  const p = (inner: string) =>
    `<w:p w14:paraId="B2C3D4E5" w14:textId="88888888" w:rsidR="00EB3670" w:rsidRDefault="00EB3670">${inner}</w:p>`;
  const r = (text: string, rPr?: string) =>
    `<w:r>${rPr ?? ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const rPr = (opts: { bold?: boolean; italic?: boolean; sz?: number; caps?: boolean }) => {
    const parts: string[] = [];
    if (opts.bold) {
      parts.push("<w:b/><w:bCs/>");
    }
    if (opts.italic) {
      parts.push("<w:i/><w:iCs/>");
    }
    if (opts.caps) {
      parts.push("<w:caps/>");
    }
    if (opts.sz) {
      parts.push(`<w:sz w:val="${opts.sz}"/><w:szCs w:val="${opts.sz}"/>`);
    }
    return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
  };

  return [
    p(
      `<w:pPr><w:spacing w:before="220" w:after="80"/><w:jc w:val="center"/></w:pPr>${r(
        "ATTESTATION DE FREQUENTATION",
        rPr({ bold: true, caps: true, sz: 34 })
      )}`
    ),
    p(
      `<w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr>${r(
        "Annee scolaire {{annee_scolaire}}",
        rPr({ bold: true, italic: true, sz: 24 })
      )}`
    ),
    p(
      `<w:pPr><w:spacing w:after="180"/><w:jc w:val="both"/></w:pPr>${r(
        "{{autorite_intro}}"
      )}`
    ),
    p(
      `<w:pPr><w:spacing w:after="70"/><w:ind w:left="360"/></w:pPr>${r(
        "Nom et prenoms : ",
        rPr({ bold: true })
      )}${r("{{eleve_nom}}", rPr({ bold: true }))}`
    ),
    p(
      `<w:pPr><w:spacing w:after="70"/><w:ind w:left="360"/></w:pPr>${r(
        "Ne(e) le : ",
        rPr({ bold: true })
      )}${r("{{date_naissance}} a {{lieu_naissance}}")}`
    ),
    p(
      `<w:pPr><w:spacing w:after="70"/><w:ind w:left="360"/></w:pPr>${r(
        "Fils/Fille de : ",
        rPr({ bold: true })
      )}${r("{{nom_pere}}")}`
    ),
    p(
      `<w:pPr><w:spacing w:after="70"/><w:ind w:left="360"/></w:pPr>${r(
        "Et de : ",
        rPr({ bold: true })
      )}${r("{{nom_mere}}")}`
    ),
    p(
      `<w:pPr><w:spacing w:after="70"/><w:ind w:left="360"/></w:pPr>${r(
        "Matricule : ",
        rPr({ bold: true })
      )}${r("{{matricule}}")}${r("    Niveau de bourse : ", rPr({ bold: true }))}${r("{{bourse}}")}`
    ),
    p(
      `<w:pPr><w:spacing w:before="140" w:after="120"/><w:jc w:val="both"/></w:pPr>${r(
        "{{corps_attestation_ligne_1}}"
      )}`
    ),
    p(
      `<w:pPr><w:spacing w:after="180"/><w:jc w:val="both"/></w:pPr>${r(
        "{{corps_attestation_ligne_2}}"
      )}`
    ),
    p(
      `<w:pPr><w:spacing w:before="160" w:after="220"/><w:jc w:val="both"/></w:pPr>${r(
        "{{formule_finale}}",
        rPr({ italic: true })
      )}`
    ),
    p(
      `<w:pPr><w:spacing w:after="420"/><w:jc w:val="right"/></w:pPr>${r(
        "Fait a {{lieu_attestation}}, le {{date_attestation}}",
        rPr({ italic: true })
      )}`
    ),
    p(
      `<w:pPr><w:jc w:val="right"/></w:pPr>${r("{{signataire_titre}}", rPr({ bold: true }))}`
    ),
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildStyledAttestationHtml(data: ReturnType<typeof buildStyledTemplateData>): string {
  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.55; color: #23324a; margin: 0; }
      .title { text-align: center; font-weight: 700; font-size: 17pt; letter-spacing: 0.08em; margin: 22px 0 8px; text-transform: uppercase; }
      .subtitle { text-align: center; font-style: italic; font-weight: 700; font-size: 12.5pt; margin: 0 0 28px; }
      .intro, .body, .final { text-align: justify; margin: 0 0 14px; }
      .identity { margin: 0 0 16px 24px; }
      .identity-row { margin: 0 0 8px; }
      .label { font-weight: 700; }
      .date-line { text-align: right; font-style: italic; margin: 26px 0 52px; }
      .signatory { text-align: right; font-weight: 700; }
    </style>
  </head>
  <body>
    <div class="title">ATTESTATION DE FREQUENTATION</div>
    <div class="subtitle">Annee scolaire ${escapeHtml(data.annee_scolaire)}</div>
    <p class="intro">${escapeHtml(data.autorite_intro)}</p>
    <div class="identity">
      <p class="identity-row"><span class="label">Nom et prenoms :</span> <strong>${escapeHtml(data.eleve_nom)}</strong></p>
      <p class="identity-row"><span class="label">Ne(e) le :</span> ${escapeHtml(data.date_naissance)} a ${escapeHtml(data.lieu_naissance)}</p>
      <p class="identity-row"><span class="label">Fils/Fille de :</span> ${escapeHtml(data.nom_pere)}</p>
      <p class="identity-row"><span class="label">Et de :</span> ${escapeHtml(data.nom_mere)}</p>
      <p class="identity-row"><span class="label">Matricule :</span> ${escapeHtml(data.matricule)} <span class="label">Niveau de bourse :</span> ${escapeHtml(data.bourse)}</p>
    </div>
    <p class="body">${escapeHtml(data.corps_attestation_ligne_1)}</p>
    <p class="body">${escapeHtml(data.corps_attestation_ligne_2)}</p>
    <p class="final"><em>${escapeHtml(data.formule_finale)}</em></p>
    <p class="date-line">Fait a ${escapeHtml(data.lieu_attestation)}, le ${escapeHtml(data.date_attestation)}</p>
    <p class="signatory">${escapeHtml(data.signataire_titre)}</p>
  </body>
</html>`;
}

function injectAttestationBodyIntoDocumentXml(documentXml: string): string {
  const bodyXml = buildStyledAttestationBodyOoxml();
  if (!documentXml.includes("<w:sectPr")) {
    throw new Error("document.xml du modèle Word invalide (sectPr manquant).");
  }
  return documentXml.replace(/<w:body>[\s\S]*?<w:sectPr/, `<w:body>${bodyXml}<w:sectPr`);
}

function injectAttestationHtmlIntoZip(zip: PizZip, html: string, log?: AttendanceLog): void {
  const docPath = "word/document.xml";
  const relsPath = "word/_rels/document.xml.rels";
  const contentTypesPath = "[Content_Types].xml";
  const docXml = zip.file(docPath)?.asText();
  const relsXml = zip.file(relsPath)?.asText();
  const contentTypesXml = zip.file(contentTypesPath)?.asText();

  if (!docXml || !relsXml || !contentTypesXml) {
    throw new Error("Template DOCX incomplet pour injection HTML");
  }
  if (!docXml.includes("<w:sectPr")) {
    throw new Error("document.xml du modele Word invalide (sectPr manquant)");
  }

  const altChunkId = "htmlChunk";
  const updatedDocXml = docXml.replace(
    /<w:body>[\s\S]*?<w:sectPr/,
    `<w:body><w:altChunk r:id="${altChunkId}"/><w:sectPr`
  );
  const updatedRelsXml = relsXml.includes(`Id="${altChunkId}"`)
    ? relsXml
    : relsXml.replace(
        "</Relationships>",
        `<Relationship Id="${altChunkId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk.html"/></Relationships>`
      );
  const updatedContentTypesXml = contentTypesXml.includes('PartName="/word/afchunk.html"')
    ? contentTypesXml
    : contentTypesXml.replace(
        "</Types>",
        `<Override PartName="/word/afchunk.html" ContentType="text/html"/></Types>`
      );

  zip.file(docPath, updatedDocXml);
  zip.file(relsPath, updatedRelsXml);
  zip.file(contentTypesPath, updatedContentTypesXml);
  zip.file("word/afchunk.html", html);
  log?.info?.("Injection HTML du corps de l'attestation dans le template DOCX");
}

function patchHeaderYearInXml(xml: string, schoolYearName: string): string {
  let out = xml.replace(/Année scolaire\s+[\d]{4}\s*[-–/]\s*[\d]{4}/, `Année scolaire ${schoolYearName}`);
  out = out.replace(/Année scolaire\s+[\d\-–/]+/i, `Année scolaire ${schoolYearName}`);
  return out;
}

function patchAllHeaders(zip: PizZip, schoolYearName: string): void {
  const names = Object.keys(zip.files).filter(
    (n) => /^word\/header\d+\.xml$/.test(n) && !zip.files[n].dir
  );
  for (const name of names) {
    const text = zip.files[name].asText();
    zip.file(name, patchHeaderYearInXml(text, schoolYearName));
  }
}

function buildTemplateData(student: AttendanceStudentInput, meta: AttendanceMetaInput) {
  const fullName = `${student.lastName ?? ""} ${student.firstName ?? ""}`.trim() || "________________";
  const bourseRaw = (student.scholarshipLevel ?? "").trim();
  const bourse = bourseRaw ? bourseRaw : "Non";
  const periode = (meta.periodName ?? "").trim() || "—";

  return {
    etablissement_intro:
      process.env.ATTENDANCE_CERTIFICATE_ETABLISSEMENT_INTRO?.trim() ||
      "du IMHOTEP ACADEMY (EX ASP CI) soussigné, atteste que",
    eleve_nom: fullName,
    date_naissance: formatDateFr(student.dateOfBirth),
    lieu_naissance: student.placeOfBirth || "________________",
    nom_pere: student.fatherName || "________________",
    nom_mere: student.motherName || "________________",
    annee_scolaire: meta.schoolYearName,
    classe: meta.className,
    periode_label: periode,
    matricule: student.studentNumber || "________________",
    bourse,
    lieu_attestation: process.env.ATTENDANCE_CERTIFICATE_LIEU?.trim() || "ABIDJAN",
    date_attestation: new Date().toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}

function buildStyledTemplateData(student: AttendanceStudentInput, meta: AttendanceMetaInput) {
  const base = buildTemplateData(student, meta);
  const etablissementNom =
    process.env.ATTENDANCE_CERTIFICATE_ESTABLISHMENT_NAME?.trim() || "IMHOTEP ACADEMY (EX ASP CI)";
  const autoriteTitre =
    process.env.ATTENDANCE_CERTIFICATE_AUTHORITY_TITLE?.trim() || "Le Directeur des Etudes";
  const periode = (meta.periodName ?? "").trim() || "non precisee";

  return {
    ...base,
    autorite_intro:
      process.env.ATTENDANCE_CERTIFICATE_ETABLISSEMENT_INTRO?.trim() ||
      `Je soussigne, ${autoriteTitre} de ${etablissementNom}, certifie par la presente que l'eleve ci-dessous :`,
    corps_attestation_ligne_1: `est regulierement inscrit(e) dans notre etablissement au titre de l'annee scolaire ${meta.schoolYearName} et suit effectivement les enseignements en classe de ${meta.className}.`,
    corps_attestation_ligne_2: `La presente attestation couvre la periode ${periode} et est delivree a l'interesse(e) pour servir et valoir ce que de droit.`,
    formule_finale:
      "La presente attestation est etablie pour faire foi en toutes circonstances administratives et scolaires.",
    signataire_titre: autoriteTitre,
  };
}

async function buildAttendanceHtmlDocument(
  students: AttendanceStudentInput[],
  meta: AttendanceMetaInput
): Promise<string> {
  const logoPath = resolveAttendanceLogoPath();
  const logoDataUri = logoPath
    ? `data:image/png;base64,${(await readFile(logoPath)).toString("base64")}`
    : null;

  const cards = students
    .map((student) => {
      const data = buildStyledTemplateData(student, meta);
      return `
        <section class="certificate">
          <header class="certificate-header">
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
                <div class="school-contact">03 BP 587 ABIDJAN 03 - Tél : 075 981 864 / 0707 755 94</div>
                <div class="school-year">${escapeHtml(data.annee_scolaire)}</div>
              </div>
            </div>
            <div class="header-line"></div>
          </header>

          <main class="certificate-body">
            <h1>ATTESTATION DE FREQUENTATION</h1>

            <p class="lead">${escapeHtml(data.autorite_intro)}</p>

            <div class="identity-box">
              <div class="identity-row"><span class="label">Nom et prenoms</span><span class="value strong">${escapeHtml(data.eleve_nom)}</span></div>
              <div class="identity-row"><span class="label">Ne(e) le</span><span class="value">${escapeHtml(data.date_naissance)} a ${escapeHtml(data.lieu_naissance)}</span></div>
              <div class="identity-row"><span class="label">Fils/Fille de</span><span class="value">${escapeHtml(data.nom_pere)}</span></div>
              <div class="identity-row"><span class="label">Et de</span><span class="value">${escapeHtml(data.nom_mere)}</span></div>
              <div class="identity-row"><span class="label">Matricule</span><span class="value">${escapeHtml(data.matricule)}</span></div>
              <div class="identity-row"><span class="label">Niveau de bourse</span><span class="value">${escapeHtml(data.bourse)}</span></div>
            </div>

            <p>${escapeHtml(data.corps_attestation_ligne_1)}</p>
            <p class="final-line">${escapeHtml(data.formule_finale)}</p>

            <div class="signature-block">
              <div class="signature-date">Fait a ${escapeHtml(data.lieu_attestation)}, le ${escapeHtml(data.date_attestation)}</div>
            </div>
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
      @page { size: A4; margin: 10mm 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "Georgia", "Times New Roman", serif; color: #243a5a; background: #f4f6fb; }
      .certificate {
        width: 100%;
        height: calc(297mm - 20mm);
        background: white;
        padding: 14mm 12mm 12mm;
        page-break-after: always;
        page-break-inside: avoid;
        position: relative;
        overflow: hidden;
      }
      .certificate:last-child { page-break-after: auto; }
      .certificate::before {
        content: "";
        position: absolute;
        inset: 8mm;
        border: 1px solid #dbe4f4;
        pointer-events: none;
      }
      .certificate-header { position: relative; z-index: 1; }
      .header-top { display: grid; grid-template-columns: 1fr 1fr; gap: 44px; align-items: start; }
      .header-block { text-align: center; }
      .gov-title {
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7pt;
        line-height: 1.2;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .gov-subtitle {
        margin-top: 12px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7pt;
        white-space: nowrap;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .republic-motto {
        margin-top: 2px;
        font-size: 7pt;
        white-space: nowrap;
        font-style: italic;
        color: #7f8795;
      }
      .school-logo {
        display: block;
        width: 145px;
        max-width: 100%;
        margin: 18px auto 0;
      }
      .school-name {
        margin-top: 14px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9pt;
        white-space: nowrap;
        font-weight: 700;
        text-transform: uppercase;
        color: #2c5588;
      }
      .school-contact {
        margin-top: 4px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 7pt;
        line-height: 1.1;
        white-space: nowrap;
        color: #666d79;
      }
      .school-year {
        margin-top: 14px;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9pt;
        font-weight: 700;
        color: #314e7d;
      }
      .header-line {
        margin-top: 14px;
        height: 2px;
        background: linear-gradient(90deg, #4d86e4, #89aef2);
      }
      .certificate-body {
        position: relative;
        z-index: 1;
        padding: 24px 8px 0;
      }
      h1 {
        margin: 14px 0 4px;
        text-align: center;
        font-size: 17pt;
        letter-spacing: 0.06em;
        color: #173e73;
        white-space: nowrap;
      }
      .subtitle {
        text-align: center;
        font-style: italic;
        color: #70809a;
        margin-bottom: 18px;
        font-size: 10pt;
      }
      .lead, p {
        font-size: 11.2pt;
        line-height: 1.55;
        text-align: justify;
        margin: 0 0 10px;
        color: #243a5a;
      }
      .lead {
        margin-top: 18px;
        margin-bottom: 16px;
      }
      .identity-box {
        margin: 14px 0 18px;
        padding: 14px 18px;
        border: 1px solid #d9e3f2;
        background: linear-gradient(180deg, #f9fbff, #f1f6ff);
        border-radius: 12px;
      }
      .identity-row {
        display: grid;
        grid-template-columns: 165px 1fr;
        gap: 12px;
        padding: 6px 0;
        border-bottom: 1px dashed #d3deef;
      }
      .identity-row:last-child { border-bottom: none; }
      .label {
        font-weight: 700;
        color: #31527f;
      }
      .value.strong {
        font-weight: 700;
      }
      .final-line {
        font-style: italic;
        margin-top: 6px;
      }
      .signature-block {
        margin-top: 28px;
        width: 42%;
        margin-left: auto;
        text-align: center;
      }
      .signature-date {
        font-style: italic;
        margin-bottom: 0;
      }
    </style>
  </head>
  <body>${cards}</body>
</html>`;
}

async function convertDocxToPdfLibreOffice(docxBuffer: Buffer, sofficePath: string): Promise<Buffer> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ecoledigitale-att-"));
  const input = path.join(tmp, "cert.docx");
  const outDir = tmp;
  await writeFile(input, docxBuffer);
  await execFileAsync(sofficePath, [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    input,
  ]);
  const pdfPath = path.join(tmp, "cert.pdf");
  const pdf = await readFile(pdfPath);
  await rm(tmp, { recursive: true, force: true });
  return pdf;
}

async function convertDocxToPdfMammothPuppeteer(docxBuffer: Buffer): Promise<Buffer> {
  const { value: html } = await mammoth.convertToHtml({ buffer: docxBuffer });
  const wrapped = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; margin: 2cm; line-height: 1.35; color: #111; }
    p { margin: 0.35em 0; }
  </style></head><body>${html}</body></html>`;

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
    await page.setContent(wrapped, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", right: "18mm", bottom: "18mm", left: "18mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
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
      margin: { top: "12mm", right: "14mm", bottom: "14mm", left: "14mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function convertDocxBufferToPdf(
  docxBuffer: Buffer,
  log?: AttendanceLog,
  options?: { requireWordFidelity?: boolean }
): Promise<Buffer> {
  const requireWordFidelity = Boolean(options?.requireWordFidelity);
  const lo = findLibreOfficeBinary();
  if (lo) {
    try {
      return await convertDocxToPdfLibreOffice(docxBuffer, lo);
    } catch (e) {
      if (requireWordFidelity) {
        throw new Error(
          `Conversion PDF fidèle au modèle impossible: échec LibreOffice (${String(
            e
          )}). Installez/configurez LibreOffice (LIBREOFFICE_PATH).`
        );
      }
      log?.warn?.(`LibreOffice PDF conversion failed, fallback Mammoth+Puppeteer: ${String(e)}`);
    }
  } else {
    if (requireWordFidelity) {
      throw new Error(
        "Conversion PDF fidèle au modèle impossible: LibreOffice non détecté. Installez LibreOffice (ou configurez LIBREOFFICE_PATH) pour conserver l'entête et la mise en page du template Word."
      );
    }
    log?.warn?.("LibreOffice non détecté — conversion via Mammoth+Puppeteer (en-tête Word peut être simplifié).");
  }
  try {
    return await convertDocxToPdfMammothPuppeteer(docxBuffer);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("Could not find Chrome")) {
      throw new Error(
        "Conversion PDF impossible: Chrome introuvable pour Puppeteer. Installez-le avec `npx puppeteer browsers install chrome` (dans apps/api), ou définissez PUPPETEER_EXECUTABLE_PATH / PUPPETEER_CACHE_DIR, ou configurez LIBREOFFICE_PATH."
      );
    }
    throw e;
  }
}

function renderOneCertificateDocxFromTemplate(
  templateBuffer: Buffer,
  student: AttendanceStudentInput,
  meta: AttendanceMetaInput,
  log?: AttendanceLog
): Buffer {
  const zip = new PizZip(templateBuffer);
  const data = buildStyledTemplateData(student, meta);
  patchAllHeaders(zip, meta.schoolYearName);

  try {
    injectAttestationHtmlIntoZip(zip, buildStyledAttestationHtml(data), log);
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
  } catch (error) {
    log?.warn?.(`Injection HTML non utilisee, retour au rendu Word natif: ${String(error)}`);
  }

  const docPath = "word/document.xml";
  const docXml = zip.file(docPath)?.asText();
  if (!docXml) {
    throw new Error("word/document.xml manquant dans le template DOCX");
  }
  zip.file(docPath, injectAttestationBodyIntoDocumentXml(docXml));

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
  });

  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

function buildStyledInternalCertificateParagraphs(
  data: ReturnType<typeof buildStyledTemplateData>
): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 220, after: 80 },
      children: [
        new TextRun({
          text: "ATTESTATION DE FREQUENTATION",
          bold: true,
          allCaps: true,
          size: 34,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `Annee scolaire ${data.annee_scolaire}`,
          bold: true,
          italics: true,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 180 },
      children: [new TextRun({ text: data.autorite_intro })],
    }),
    new Paragraph({
      indent: { left: 360 },
      spacing: { after: 70 },
      children: [
        new TextRun({ text: "Nom et prenoms : ", bold: true }),
        new TextRun({ text: data.eleve_nom, bold: true }),
      ],
    }),
    new Paragraph({
      indent: { left: 360 },
      spacing: { after: 70 },
      children: [
        new TextRun({ text: "Ne(e) le : ", bold: true }),
        new TextRun({ text: `${data.date_naissance} a ${data.lieu_naissance}` }),
      ],
    }),
    new Paragraph({
      indent: { left: 360 },
      spacing: { after: 70 },
      children: [
        new TextRun({ text: "Fils/Fille de : ", bold: true }),
        new TextRun({ text: data.nom_pere }),
      ],
    }),
    new Paragraph({
      indent: { left: 360 },
      spacing: { after: 70 },
      children: [
        new TextRun({ text: "Et de : ", bold: true }),
        new TextRun({ text: data.nom_mere }),
      ],
    }),
    new Paragraph({
      indent: { left: 360 },
      spacing: { after: 70 },
      children: [
        new TextRun({ text: "Matricule : ", bold: true }),
        new TextRun({ text: data.matricule }),
        new TextRun({ text: "    Niveau de bourse : ", bold: true }),
        new TextRun({ text: data.bourse }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 140, after: 120 },
      children: [new TextRun({ text: data.corps_attestation_ligne_1 })],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 180 },
      children: [new TextRun({ text: data.corps_attestation_ligne_2 })],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 160, after: 220 },
      children: [new TextRun({ text: data.formule_finale, italics: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 420 },
      children: [new TextRun({ text: `Fait a ${data.lieu_attestation}, le ${data.date_attestation}`, italics: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: data.signataire_titre, bold: true })],
    }),
  ];
}

async function renderOneCertificateDocxInternal(
  student: AttendanceStudentInput,
  meta: AttendanceMetaInput
): Promise<Buffer> {
  const data = buildStyledTemplateData(student, meta);

  const doc = new Document({
    sections: [
      {
        children: buildStyledInternalCertificateParagraphs(data),
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}

type AttendanceDocxBuildContext = {
  templatePath: string | null;
  templateBuffer: Buffer | null;
  templateUsable: boolean;
  fallbackLogged: boolean;
  log?: AttendanceLog;
};

async function buildAttendanceCertificateDocx(
  student: AttendanceStudentInput,
  meta: AttendanceMetaInput,
  context: AttendanceDocxBuildContext
): Promise<Buffer> {
  if (context.templateUsable && context.templatePath && context.templateBuffer) {
    try {
      return renderOneCertificateDocxFromTemplate(context.templateBuffer, student, meta, context.log);
    } catch (error) {
      context.log?.warn?.(`Erreur rendu template DOCX (${context.templatePath}): ${String(error)}`);
      context.templateUsable = false;
    }
  }

  if (!context.fallbackLogged) {
    context.log?.warn?.("Fallback active: generateur interne DOCX");
    context.fallbackLogged = true;
  }
  return renderOneCertificateDocxInternal(student, meta);
}

async function mergePdfBuffers(pages: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buf of pages) {
    const src = await PDFDocument.load(buf);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

/**
 * Produit un PDF multi-pages (1 page par eleve).
 * Template prioritaire:
 * assets/modeles_documents/attestation-frequentation-TEMPLATE.docx
 * Fallback: generateur interne DOCX.
 */
export async function generateAttendanceCertificatesPdfFromWordTemplate(
  students: AttendanceStudentInput[],
  meta: AttendanceMetaInput,
  options?: { log?: AttendanceLog }
): Promise<Buffer> {
  if (students.length === 0) {
    throw new Error("Aucun eleve");
  }

  const log = options?.log;
  const templatePath = await resolveAttendanceCertificateTemplatePath();
  let templateBuffer: Buffer | null = null;
  let templateUsable = false;
  let fallbackLogged = false;

  if (templatePath) {
    log?.info?.(`Template DOCX trouve: ${templatePath}`);
    try {
      templateBuffer = await readFile(templatePath);
      templateUsable = true;
    } catch (error) {
      log?.warn?.(`Lecture template impossible (${templatePath}): ${String(error)}`);
      log?.warn?.("Fallback active: generateur interne DOCX");
      fallbackLogged = true;
    }
  } else {
    const expectedPath = path.join(resolveProjectRootFromCwd(), "assets", "modeles_documents", ATTENDANCE_TEMPLATE_FILE_NAME);
    log?.warn?.(`Template DOCX introuvable: ${expectedPath}`);
    log?.warn?.("Fallback active: generateur interne DOCX");
    fallbackLogged = true;
  }

  const context: AttendanceDocxBuildContext = {
    templatePath,
    templateBuffer,
    templateUsable,
    fallbackLogged,
    log,
  };

  const pdfs: Buffer[] = [];
  for (const student of students) {
    const docx = await buildAttendanceCertificateDocx(student, meta, context);
    const pdf = await convertDocxBufferToPdf(docx, log, {
      requireWordFidelity: Boolean(templatePath),
    });
    pdfs.push(pdf);
  }

  return mergePdfBuffers(pdfs);
}

export async function generateAttendanceCertificatesPdfFromHtml(
  students: AttendanceStudentInput[],
  meta: AttendanceMetaInput,
  options?: { log?: AttendanceLog }
): Promise<Buffer> {
  if (students.length === 0) {
    throw new Error("Aucun eleve");
  }

  options?.log?.info?.("Generation des attestations via HTML/CSS + Puppeteer");
  const html = await buildAttendanceHtmlDocument(students, meta);
  return renderHtmlToPdf(html);
}

