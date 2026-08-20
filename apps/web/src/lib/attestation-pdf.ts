/**
 * Export PDF — Attestation de réussite (Module Professionnel, feature 030).
 *
 * Inspiré du modèle officiel IPAM mais avec un encadrement raffiné : triple
 * filet fin (hairline vert clair, filet vert soutenu, hairline doré) rehaussé
 * d'équerres d'angle pleines et de losanges dorés — plus léger que la bande
 * épaisse du modèle papier. En-tête ministère / logo / république, cartouche
 * de titre sur fond vert pâle flanqué de filets dorés, année académique,
 * formule « je soussigné … atteste que », champs à libellés gras alignés en
 * colonne, formule finale, date à droite et bloc signature à gauche.
 * Filigrane du logo appliqué comme sur le relevé de notes (`bulletin-pdf.ts`).
 * jsPDF vectoriel.
 */
import { jsPDF } from "jspdf";
import { IPAM_GREEN_RGB, IPAM_GREEN_LIGHT_RGB } from "./bulletin-format";
import {
  ATTESTATION_TITRE,
  ATTESTATION_FOOTER,
  ATTESTATION_LIEU,
  ATTESTATION_MINISTERE_LIGNES,
  ATTESTATION_REPUBLIQUE_LIGNES,
  attestationIntro,
  attestationSignatureBloc,
  intituleObtention,
  anneeAcademiqueEspacee,
  fmtDateAttestation,
  type Signataire,
} from "./diplome-format";
import { loadPdfHeaderImages, type PdfHeaderImages, type PdfImg } from "./pdf-image-loader";

const PAGE_W = 210;
const PAGE_H = 297;
/** Marge du contenu (à l'intérieur du cadre). */
const M = 24;
const RIGHT = PAGE_W - M;
/** Colonne des valeurs des champs (libellés gras à gauche). */
const COL_VALEUR = 74;

const GREEN = IPAM_GREEN_RGB;
/** Vert clair du hairline extérieur du cadre. */
const GREEN_BAND: [number, number, number] = [46, 125, 91];
/** Encre du corps de texte (bleu-ardoise du modèle). */
const INK: [number, number, number] = [26, 54, 70];
/** Doré des filets d'accent (cadre, cartouche du titre, losanges). */
const GOLD: [number, number, number] = [172, 128, 48];
/** Doré foncé, lisible en texte (« ANNÉE ACADÉMIQUE … »). */
const GOLD_TEXT: [number, number, number] = [148, 96, 24];

export interface AttestationPdfInput {
  reference: string;
  diplome: { code: string; libelle: string; filiere_libelle: string };
  etudiant: {
    nom_complet: string;
    matricule?: string | null;
    date_naissance?: string | null;
    lieu_naissance?: string | null;
  };
  date_obtention: string;
  annee_academique?: string | null;
  mention?: string | null;
  uv_total_validees: number;
  /** Signataire configuré en administration ; défauts appliqués si absent. */
  signataire?: Signataire | null;
}

/* --------------------------- Primitives de tracé ------------------------ */

/** Petit losange plein — accent décoratif du cadre et du titre. */
function drawDiamond(
  doc: jsPDF,
  cx: number,
  cy: number,
  r: number,
  color: [number, number, number]
): void {
  doc.setFillColor(color[0], color[1], color[2]);
  doc.lines(
    [
      [r, r],
      [-r, r],
      [-r, -r],
    ],
    cx,
    cy - r,
    [1, 1],
    "F",
    true
  );
}

/**
 * Cadre du document : triple filet fin (hairline vert clair à l'extérieur,
 * filet vert soutenu, hairline doré à l'intérieur), équerres d'angle pleines
 * posées sur le filet principal et losanges dorés au centre des bords haut et
 * bas. Bien plus léger que la bande épaisse du modèle papier, tout en gardant
 * un caractère officiel.
 */
function drawFrame(doc: jsPDF): void {
  // Hairline extérieur, vert clair.
  doc.setDrawColor(GREEN_BAND[0], GREEN_BAND[1], GREEN_BAND[2]);
  doc.setLineWidth(0.35);
  doc.rect(10, 10, PAGE_W - 20, PAGE_H - 20, "S");

  // Filet principal, vert foncé.
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(1.3);
  doc.rect(13, 13, PAGE_W - 26, PAGE_H - 26, "S");

  // Hairline doré intérieur.
  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(0.3);
  doc.rect(15.6, 15.6, PAGE_W - 31.2, PAGE_H - 31.2, "S");

  // Équerres d'angle pleines (rectangles pour des jonctions nettes),
  // centrées sur le filet principal.
  const c = 13; // position du filet principal
  const t = 2.4; // épaisseur des équerres
  const a = 20; // longueur des bras
  const near = c - t / 2;
  const farX = PAGE_W - c - t / 2;
  const farY = PAGE_H - c - t / 2;
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  // Haut-gauche / haut-droit.
  doc.rect(near, near, a, t, "F");
  doc.rect(near, near, t, a, "F");
  doc.rect(PAGE_W - c + t / 2 - a, near, a, t, "F");
  doc.rect(farX, near, t, a, "F");
  // Bas-gauche / bas-droit.
  doc.rect(near, farY, a, t, "F");
  doc.rect(near, PAGE_H - c + t / 2 - a, t, a, "F");
  doc.rect(PAGE_W - c + t / 2 - a, farY, a, t, "F");
  doc.rect(farX, PAGE_H - c + t / 2 - a, t, a, "F");

  // Losanges dorés au centre des bords haut et bas.
  drawDiamond(doc, PAGE_W / 2, c, 1.7, GOLD);
  drawDiamond(doc, PAGE_W / 2, PAGE_H - c, 1.7, GOLD);
}

/** Filigrane : logo en transparence, centré sur la page. */
function drawWatermark(doc: jsPDF, logo: PdfImg | null): void {
  if (!logo) return;
  try {
    doc.saveGraphicsState();
    (doc as any).setGState(new (doc as any).GState({ opacity: 0.06 }));
    const w = 120;
    const h = w / logo.ratio;
    doc.addImage(logo.dataUrl, logo.format, (PAGE_W - w) / 2, (PAGE_H - h) / 2, w, h);
    doc.restoreGraphicsState();
  } catch {
    /* GState indisponible : on ignore le filigrane */
  }
}

/** Ligne « Libellé : valeur » — libellé gras à gauche, valeur en colonne. */
function champ(
  doc: jsPDF,
  label: string,
  value: string,
  y: number,
  opts: { valueBold?: boolean } = {}
): void {
  doc.setFont("times", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(label, M + 4, y);
  doc.setFont("times", opts.valueBold ? "bold" : "normal");
  doc.text(value, COL_VALEUR, y, { maxWidth: RIGHT - COL_VALEUR });
}

/* ------------------------------- Rendu ---------------------------------- */

function drawAttestation(doc: jsPDF, data: AttestationPdfInput, imgs: PdfHeaderImages): void {
  const { logoInstitut, embleme } = imgs;

  drawWatermark(doc, logoInstitut);
  drawFrame(doc);

  /* ---------------------------- En-tête ---------------------------- */
  // Découpage figé (cf. modèle officiel) : chaque bloc est centré sur sa
  // colonne, ligne par ligne.
  const LH = 4.2;
  doc.setFont("times", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);

  const cxMinistere = M + 30;
  ATTESTATION_MINISTERE_LIGNES.forEach((ln, i) =>
    doc.text(ln, cxMinistere, 25 + i * LH, { align: "center" })
  );

  const cxRepublique = RIGHT - 30;
  ATTESTATION_REPUBLIQUE_LIGNES.forEach((ln, i) =>
    doc.text(ln, cxRepublique, 25 + i * LH, { align: "center" })
  );

  if (logoInstitut) {
    const h = 21;
    doc.addImage(
      logoInstitut.dataUrl,
      logoInstitut.format,
      PAGE_W / 2 - (h * logoInstitut.ratio) / 2,
      19,
      h * logoInstitut.ratio,
      h
    );
  } else if (embleme) {
    const h = 18;
    doc.addImage(embleme.dataUrl, embleme.format, PAGE_W / 2 - (h * embleme.ratio) / 2, 20, h * embleme.ratio, h);
  }

  /* -------------------------- Titre en cartouche -------------------- */
  let y = 62;
  doc.setFont("times", "bold");
  doc.setFontSize(19);
  const titreW = doc.getTextWidth(ATTESTATION_TITRE);
  const boxW = titreW + 28;
  const boxH = 14.5;
  const boxX = PAGE_W / 2 - boxW / 2;
  const cyTitre = y + boxH / 2;

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
  doc.rect(boxX, y, boxW, boxH, "FD");
  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(0.3);
  doc.rect(boxX + 1.5, y + 1.5, boxW - 3, boxH - 3, "S");

  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text(ATTESTATION_TITRE, PAGE_W / 2, y + 10, { align: "center" });

  /* ------------------------- Année académique ----------------------- */
  y += boxH + 10;
  const annee = anneeAcademiqueEspacee(data.annee_academique);
  if (annee) {
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.setTextColor(GOLD_TEXT[0], GOLD_TEXT[1], GOLD_TEXT[2]);
    doc.text(`ANNÉE ACADÉMIQUE ${annee}`, PAGE_W / 2, y, { align: "center" });
    y += 14;
  } else {
    y += 6;
  }

  /* ---------------------------- Formule ----------------------------- */
  doc.setFont("times", "normal");
  doc.setFontSize(11.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const introLines: string[] = doc.splitTextToSize(
    attestationIntro(data.signataire),
    RIGHT - M
  );
  introLines.forEach((ln, i) => {
    doc.text(ln, M, y + i * 6.2);
  });
  y += introLines.length * 6.2 + 12;

  /* ----------------------------- Champs ----------------------------- */
  const ROW = 14.5;
  champ(doc, "Mme, Mlle, M. :", data.etudiant.nom_complet.toUpperCase(), y, { valueBold: true });
  y += ROW;

  const naissance = data.etudiant.date_naissance
    ? `${fmtDateAttestation(data.etudiant.date_naissance)}${
        data.etudiant.lieu_naissance ? ` à ${data.etudiant.lieu_naissance}` : ""
      }`
    : "—";
  champ(doc, "Né(e) le :", naissance, y);
  y += ROW;

  champ(doc, "N° matricule :", data.etudiant.matricule ?? "—", y);
  y += ROW;

  champ(doc, "A obtenu :", intituleObtention(data.diplome.filiere_libelle), y);
  y += ROW;

  const mentionTxt = data.mention ? `${annee || "—"} avec la mention ${data.mention}` : annee || "—";
  champ(doc, "Au cours de l'année :", mentionTxt, y);
  y += ROW + 6;

  /* -------------------------- Formule finale ------------------------ */
  doc.setFont("times", "normal");
  doc.setFontSize(11.5);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  const finalLines: string[] = doc.splitTextToSize(ATTESTATION_FOOTER, RIGHT - M);
  finalLines.forEach((ln, i) => doc.text(ln, M, y + i * 6.2));
  y += finalLines.length * 6.2 + 18;

  /* ---------------------------- Date à droite ----------------------- */
  // Date de délivrance = date de génération du document (aujourd'hui), pas la
  // date de validation académique (`date_obtention`, utilisée uniquement pour
  // l'année académique ci-dessus).
  doc.setFont("times", "bolditalic");
  doc.setFontSize(11.5);
  doc.text(
    `Fait à ${ATTESTATION_LIEU}, le ${fmtDateAttestation(new Date(), { pad2: true })}`,
    RIGHT,
    y,
    { align: "right" }
  );
  y += 20;

  /* ------------------------ Bloc signature (gauche) ------------------ */
  // Les deux lignes sont centrées l'une sous l'autre (cf. modèle).
  doc.setFont("times", "bold");
  doc.setFontSize(11.5);
  const sigLines = attestationSignatureBloc(data.signataire).split("\n");
  const cxSignature = M + 4 + doc.getTextWidth(sigLines[0]) / 2;
  sigLines.forEach((ln, i) => doc.text(ln, cxSignature, y + i * 6.4, { align: "center" }));
}

async function buildAttestationDoc(data: AttestationPdfInput): Promise<jsPDF> {
  const imgs = await loadPdfHeaderImages();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  drawAttestation(doc, data, imgs);
  return doc;
}

function attestationFilename(data: AttestationPdfInput): string {
  const safe = (data.etudiant.nom_complet || "etudiant").replace(/[^\w-]+/g, "_");
  return `Attestation_de_reussite_${safe}.pdf`;
}

/** Télécharge l'attestation de réussite en PDF. */
export async function downloadAttestationPdf(data: AttestationPdfInput): Promise<void> {
  const doc = await buildAttestationDoc(data);
  doc.save(attestationFilename(data));
}

/**
 * Génère l'attestation et renvoie une URL blob pour l'aperçu embarqué
 * (iframe/object). L'appelant doit révoquer l'URL (URL.revokeObjectURL).
 */
export async function attestationPdfObjectUrl(data: AttestationPdfInput): Promise<string> {
  const doc = await buildAttestationDoc(data);
  return URL.createObjectURL(doc.output("blob"));
}

/** Ouvre l'attestation de réussite dans un nouvel onglet (visionneuse PDF). */
export async function openAttestationPdf(
  data: AttestationPdfInput,
  win?: Window | null
): Promise<void> {
  const doc = await buildAttestationDoc(data);
  const url = URL.createObjectURL(doc.output("blob"));
  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
