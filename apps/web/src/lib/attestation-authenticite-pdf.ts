/**
 * Export PDF — Attestation d'authenticité (Module Professionnel).
 *
 * Reprend le modèle officiel IPAM : en-tête ministère / logo / établissement,
 * cartouche « ATTESTATION D'AUTHENTICITÉ » sur fond vert pâle flanqué de
 * filets dorés, formule « Je soussigné(e), BAH CELESTE, Directeur Général
 * Adjoint … », liste des caractéristiques du document (titulaire, nature,
 * intitulé, filière, année d'obtention, référence) rythmée par des losanges
 * dorés et un double accent vertical, paragraphes de certification, date,
 * bloc signature et pied de page.
 *
 * Cadre : triple filet (vert clair / vert soutenu / hairline doré) avec
 * équerres d'angle pleines et losanges dorés — même famille visuelle que
 * `attestation-pdf.ts` et `diplome-pdf.ts`. Filigranes : logo IPAM centré et
 * guirlande de laurier en bas de page. jsPDF vectoriel.
 */
import { jsPDF } from "jspdf";
import { IPAM_GREEN_RGB, IPAM_GREEN_LIGHT_RGB, INSTITUT, FOOTER_ADDRESS } from "./bulletin-format";
import {
  AUTHENTICITE_TITRE,
  AUTHENTICITE_SIGNATAIRE_NOM,
  AUTHENTICITE_SIGNATAIRE_FONCTION,
  AUTHENTICITE_ETABLISSEMENT,
  ATTESTATION_LIEU,
  fmtDateAttestation,
  type Signataire,
} from "./diplome-format";
import { loadPdfHeaderImages, type PdfHeaderImages, type PdfImg } from "./pdf-image-loader";

const PAGE_W = 210;
const PAGE_H = 297;
const M = 22;
const RIGHT = PAGE_W - M;
const CONTENT_W = RIGHT - M;

const GREEN = IPAM_GREEN_RGB;
/** Vert clair du hairline extérieur du cadre. */
const GREEN_BAND: [number, number, number] = [46, 125, 91];
/** Doré des accents (hairline du cadre, losanges, filets du titre). */
const GOLD: [number, number, number] = [172, 128, 48];
/** Encre du corps de texte (bleu-ardoise). */
const INK: [number, number, number] = [26, 54, 70];
const MUTED: [number, number, number] = [90, 105, 115];

export interface AttestationAuthenticiteInput {
  reference: string;
  titulaire: string;
  nature_document: string;
  intitule: string;
  filiere: string;
  annee_obtention: string;
  /** Signataire configuré en administration ; défauts appliqués si absent. */
  signataire?: Signataire | null;
}

/* --------------------------- Primitives de tracé ------------------------ */

/** Polygone plein à partir de points absolus. */
function polyFill(doc: jsPDF, pts: Array<[number, number]>): void {
  const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
  doc.lines(deltas as any, pts[0][0], pts[0][1], [1, 1], "F", true);
}

/** Petit losange plein — accent décoratif du cadre, du titre et des puces. */
function drawDiamond(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  color: [number, number, number]
): void {
  doc.setFillColor(color[0], color[1], color[2]);
  polyFill(doc, [
    [cx, cy - r],
    [cx + r, cy],
    [cx, cy + r],
    [cx - r, cy],
  ]);
}

/** Une branche de laurier : tige en arc, paires de feuilles décroissantes. */
function drawLaurelBranch(doc: jsPDF, cx: number, yb: number, dir: 1 | -1): void {
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.7);
  const N = 9;
  let prev: [number, number] = [cx + dir * 6, yb];
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const x = cx + dir * (6 + 52 * t);
    const y = yb - 12 * t * t;
    doc.line(prev[0], prev[1], x, y);
    const ang = Math.atan2(y - prev[1], x - prev[0]);
    for (const side of [-1, 1]) {
      const la = ang + side * (Math.PI / 3.1);
      const len = 7 - 3.2 * t;
      const wid = 1.5 - 0.55 * t;
      const tip: [number, number] = [x + Math.cos(la) * len, y + Math.sin(la) * len];
      const mid: [number, number] = [x + Math.cos(la) * len * 0.5, y + Math.sin(la) * len * 0.5];
      const px = -Math.sin(la);
      const py = Math.cos(la);
      polyFill(doc, [
        [x, y],
        [mid[0] + px * wid, mid[1] + py * wid],
        tip,
        [mid[0] - px * wid, mid[1] - py * wid],
      ]);
    }
    prev = [x, y];
  }
}

/**
 * Cadre du document : triple filet fin (hairline vert clair à l'extérieur,
 * filet vert soutenu, hairline doré à l'intérieur), équerres d'angle pleines
 * posées sur le filet principal et losanges dorés au centre des bords haut et
 * bas — même cadre que l'attestation de réussite.
 */
function drawFrame(doc: jsPDF): void {
  doc.setDrawColor(GREEN_BAND[0], GREEN_BAND[1], GREEN_BAND[2]);
  doc.setLineWidth(0.35);
  doc.rect(10, 10, PAGE_W - 20, PAGE_H - 20, "S");

  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(1.3);
  doc.rect(13, 13, PAGE_W - 26, PAGE_H - 26, "S");

  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(0.3);
  doc.rect(15.6, 15.6, PAGE_W - 31.2, PAGE_H - 31.2, "S");

  // Équerres d'angle pleines (rectangles pour des jonctions nettes),
  // centrées sur le filet principal.
  const c = 13;
  const t = 2.4;
  const a = 20;
  const near = c - t / 2;
  const farX = PAGE_W - c - t / 2;
  const farY = PAGE_H - c - t / 2;
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(near, near, a, t, "F");
  doc.rect(near, near, t, a, "F");
  doc.rect(PAGE_W - c + t / 2 - a, near, a, t, "F");
  doc.rect(farX, near, t, a, "F");
  doc.rect(near, farY, a, t, "F");
  doc.rect(near, PAGE_H - c + t / 2 - a, t, a, "F");
  doc.rect(PAGE_W - c + t / 2 - a, farY, a, t, "F");
  doc.rect(farX, PAGE_H - c + t / 2 - a, t, a, "F");

  drawDiamond(doc, PAGE_W / 2, c, 1.7, GOLD);
  drawDiamond(doc, PAGE_W / 2, PAGE_H - c, 1.7, GOLD);
}

/** Segment de texte enrichi (normal/gras) pour le rendu avec retour à la ligne. */
interface Run {
  text: string;
  bold?: boolean;
}

/**
 * Rend une suite de segments (normal/gras) avec passage à la ligne au mot, à
 * partir de (x, y), dans une largeur `maxW`. Renvoie le y de la ligne suivante.
 */
function drawRuns(
  doc: jsPDF,
  runs: Run[],
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  fontSize: number
): number {
  doc.setFontSize(fontSize);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  let cx = x;
  let cy = y;
  for (const run of runs) {
    doc.setFont("times", run.bold ? "bold" : "normal");
    const tokens = run.text.split(/(\s+)/).filter((t) => t !== "");
    for (const tok of tokens) {
      const isSpace = /^\s+$/.test(tok);
      const w = doc.getTextWidth(tok);
      if (!isSpace && cx + w > x + maxW && cx > x) {
        cy += lineH;
        cx = x;
      }
      if (isSpace && cx === x) continue; // pas d'espace en début de ligne
      doc.text(tok, cx, cy);
      cx += w;
    }
  }
  return cy + lineH;
}

/** Ligne à puce : « • Libellé : valeur » (libellé gras). */
function drawBullet(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  fontSize: number
): number {
  const x = M + 6;
  drawDiamond(doc, M + 2, y - 1.3, 1, GOLD);
  return drawRuns(
    doc,
    [
      { text: `${label} : `, bold: true },
      { text: value },
    ],
    x,
    y,
    RIGHT - x,
    5.6,
    fontSize
  );
}

/**
 * En-tête centré : ligne ministère, logo IPAM centré, nom de l'établissement
 * centré sous le logo, filet vert ponctué de losanges dorés. Renvoie le y du
 * filet de clôture (le titre se positionne dessous).
 */
function drawHeader(doc: jsPDF, imgs: PdfHeaderImages): number {
  const { logoInstitut, embleme } = imgs;

  // Ligne ministère, centrée en haut (sous le filet doré du cadre).
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text(
    "Ministère de l'Enseignement Supérieur et de la Recherche Scientifique",
    PAGE_W / 2,
    21,
    { align: "center" }
  );

  // Logo IPAM centré.
  const logo = logoInstitut ?? embleme;
  let y = 24;
  if (logo) {
    const logoH = 17;
    doc.addImage(
      logo.dataUrl,
      logo.format,
      PAGE_W / 2 - (logoH * logo.ratio) / 2,
      y,
      logoH * logo.ratio,
      logoH
    );
    y += logoH + 6.5;
  } else {
    y += 5;
  }

  // Nom de l'établissement, centré sous le logo.
  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  const lines: string[] = doc.splitTextToSize(INSTITUT, CONTENT_W);
  lines.forEach((ln, i) => doc.text(ln, PAGE_W / 2, y + i * 6, { align: "center" }));
  y += (lines.length - 1) * 6 + 4.5;

  // Filet sous l'en-tête, ponctué de losanges dorés aux extrémités.
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.5);
  doc.line(M, y, RIGHT, y);
  drawDiamond(doc, M, y, 1.1, GOLD);
  drawDiamond(doc, RIGHT, y, 1.1, GOLD);
  return y;
}

function drawFooter(doc: jsPDF): void {
  // Remonté pour rester à l'intérieur du hairline doré du cadre.
  const lineY = PAGE_H - 27;
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.4);
  doc.line(M, lineY, RIGHT, lineY);
  drawDiamond(doc, PAGE_W / 2, lineY, 1.1, GOLD);
  doc.setFont("times", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  FOOTER_ADDRESS.split("\n").forEach((ln, i) =>
    doc.text(ln, PAGE_W / 2, lineY + 4.5 + i * 3.6, { align: "center" })
  );
}

/**
 * Filigranes : logo IPAM en transparence au centre et guirlande de laurier en
 * bas de page. « stroke-opacity » est indispensable pour que les tiges de la
 * guirlande soient elles aussi estompées (« opacity » ne couvre que les
 * remplissages).
 */
function drawWatermark(doc: jsPDF, logo: PdfImg | null): void {
  try {
    doc.saveGraphicsState();
    const setOpacity = (o: number) =>
      (doc as any).setGState(new (doc as any).GState({ opacity: o, "stroke-opacity": o }));

    setOpacity(0.05);
    if (logo) {
      const w = 120;
      const h = w / logo.ratio;
      doc.addImage(logo.dataUrl, logo.format, (PAGE_W - w) / 2, (PAGE_H - h) / 2, w, h);
    }
    drawLaurelBranch(doc, PAGE_W / 2, 258, 1);
    drawLaurelBranch(doc, PAGE_W / 2, 258, -1);

    doc.restoreGraphicsState();
  } catch {
    /* GState indisponible */
  }
}

function drawAttestation(
  doc: jsPDF,
  data: AttestationAuthenticiteInput,
  imgs: PdfHeaderImages
): void {
  drawWatermark(doc, imgs.logoInstitut);
  drawFrame(doc);
  const headerBottom = drawHeader(doc, imgs);

  /* ------------------------ Titre en cartouche --------------------- */
  doc.setFont("times", "bold");
  doc.setFontSize(17);
  const titreW = doc.getTextWidth(AUTHENTICITE_TITRE);
  const boxW = titreW + 26;
  const boxH = 14;
  const boxX = PAGE_W / 2 - boxW / 2;
  const boxY = headerBottom + 7;
  const cyTitre = boxY + boxH / 2;

  // Filets latéraux dorés, losange à leur extrémité extérieure.
  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(0.4);
  doc.line(M + 2, cyTitre, boxX - 4, cyTitre);
  doc.line(boxX + boxW + 4, cyTitre, RIGHT - 2, cyTitre);
  drawDiamond(doc, M + 2, cyTitre, 1.1, GOLD);
  drawDiamond(doc, RIGHT - 2, cyTitre, 1.1, GOLD);

  // Cartouche : fond vert pâle, filet vert, hairline doré en retrait.
  doc.setFillColor(IPAM_GREEN_LIGHT_RGB[0], IPAM_GREEN_LIGHT_RGB[1], IPAM_GREEN_LIGHT_RGB[2]);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.9);
  doc.rect(boxX, boxY, boxW, boxH, "FD");
  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(0.3);
  doc.rect(boxX + 1.5, boxY + 1.5, boxW - 3, boxH - 3, "S");

  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text(AUTHENTICITE_TITRE, PAGE_W / 2, boxY + 9.3, { align: "center" });

  /* ---------------------------- Corps ---------------------------- */
  let y = boxY + boxH + 14;
  const FS = 11.5;
  const LH = 5.8;

  // Signataire configuré en administration, avec repli sur les défauts.
  const sigNom = data.signataire?.nom?.trim() || AUTHENTICITE_SIGNATAIRE_NOM;
  const sigFonction = data.signataire?.fonction?.trim() || AUTHENTICITE_SIGNATAIRE_FONCTION;

  y = drawRuns(
    doc,
    [{ text: "Je soussigné(e), " }, { text: sigNom, bold: true }, { text: "," }],
    M,
    y,
    CONTENT_W,
    LH,
    FS
  );
  y = drawRuns(
    doc,
    [
      { text: sigFonction, bold: true },
      { text: `, de l'${AUTHENTICITE_ETABLISSEMENT}.` },
    ],
    M,
    y,
    CONTENT_W,
    LH,
    FS
  );

  y += 4;
  y = drawRuns(
    doc,
    [
      { text: "atteste par la présente que le document ci-après mentionné est " },
      { text: "authentique et conforme à l'original délivré par notre établissement", bold: true },
      { text: " :" },
    ],
    M,
    y,
    CONTENT_W,
    LH,
    FS
  );

  y += 3;
  const yFields = y;
  y = drawBullet(doc, "Nom et Prénoms du titulaire", data.titulaire, y, FS);
  y = drawBullet(doc, "Nature du document", data.nature_document, y, FS);
  y = drawBullet(doc, "Intitulé du diplôme ou document", data.intitule, y, FS);
  y = drawBullet(doc, "Filière", data.filiere, y, FS);
  y = drawBullet(doc, "Année d'obtention", data.annee_obtention, y, FS);
  y = drawBullet(doc, "Numéro de référence", data.reference, y, FS);

  // Double accent vertical (vert + doré) dans la marge, le long du bloc des
  // caractéristiques — entre le hairline doré du cadre et le texte.
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(1);
  doc.line(18.6, yFields - 4.6, 18.6, y - 4);
  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(0.3);
  doc.line(20, yFields - 4.6, 20, y - 4);

  y += 4;
  y = drawRuns(
    doc,
    [
      { text: "Après vérification dans nos registres administratifs, nous certifions que ce document a été " },
      { text: "régulièrement délivré et est conforme aux archives de l'établissement", bold: true },
      { text: "." },
    ],
    M,
    y,
    CONTENT_W,
    LH,
    FS
  );

  y += 2;
  y = drawRuns(
    doc,
    [
      { text: "La présente attestation est délivrée à l'intéressé(e) pour servir et valoir ce que de droit, notamment " },
      { text: "dans le cadre de la constitution d'un dossier de candidature à un concours", bold: true },
      { text: "." },
    ],
    M,
    y,
    CONTENT_W,
    LH,
    FS
  );

  /* --------------------------- Date + signature -------------------- */
  y += 10;
  doc.setFont("times", "normal");
  doc.setFontSize(FS);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(`Fait à ${ATTESTATION_LIEU}, le ${fmtDateAttestation(new Date(), { pad2: true })}`, M, y);

  y += 12;
  doc.setFont("times", "bold");
  doc.text("Le Responsable", M, y);
  doc.setFont("times", "normal");
  y += 6;
  doc.text(`Nom et Prénoms : ${sigNom}`, M, y);
  y += 6;
  doc.text(`Fonction : ${sigFonction}`, M, y);
  y += 10;
  doc.text("Signature", M, y);

  drawFooter(doc);
}

async function buildDoc(data: AttestationAuthenticiteInput): Promise<jsPDF> {
  const imgs = await loadPdfHeaderImages();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  drawAttestation(doc, data, imgs);
  return doc;
}

function filename(data: AttestationAuthenticiteInput): string {
  const safe = (data.titulaire || "etudiant").replace(/[^\w-]+/g, "_");
  return `Attestation_authenticite_${safe}.pdf`;
}

/** Télécharge l'attestation d'authenticité en PDF. */
export async function downloadAttestationAuthenticitePdf(
  data: AttestationAuthenticiteInput
): Promise<void> {
  const doc = await buildDoc(data);
  doc.save(filename(data));
}

/** Ouvre l'attestation d'authenticité dans un nouvel onglet (visionneuse PDF). */
export async function openAttestationAuthenticitePdf(
  data: AttestationAuthenticiteInput,
  win?: Window | null
): Promise<void> {
  const doc = await buildDoc(data);
  const url = URL.createObjectURL(doc.output("blob"));
  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
