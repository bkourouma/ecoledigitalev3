/**
 * Rendu PDF d'un `ReportSpec` — composé DANS LE NAVIGATEUR avec jsPDF.
 *
 * Aucun navigateur headless côté serveur : le document s'ouvre instantanément
 * dans la visionneuse du navigateur, d'où l'utilisateur imprime ou télécharge.
 *
 * L'en-tête institutionnel n'est dessiné que sur la première page ; les pages
 * suivantes sont la continuité du contenu, avec la ligne de titres des tableaux
 * répétée et le pied de page sur chacune.
 */
import type { jsPDF } from "jspdf";
import { loadPdfHeaderImages, type PdfHeaderImages } from "@/lib/pdf-image-loader";
import {
  INSTITUT,
  MINISTERE,
  REPUBLIQUE,
  FOOTER_ADDRESS,
  IPAM_GREEN_RGB,
  IPAM_GREEN_LIGHT_RGB,
} from "@/lib/bulletin-format";
import {
  CONTINUATION_TOP_MM,
  FOOTER_H_MM,
  HEADER_H_MM,
  PAGE_MARGIN_MM,
  pageSize,
  decouperCellule,
  resolveWidths,
  texteImprimable,
  type ReportBlock,
  type ReportSpec,
} from "@/lib/utils/report-doc";

const M = PAGE_MARGIN_MM;
const GREEN = IPAM_GREEN_RGB;
const ZEBRA = IPAM_GREEN_LIGHT_RGB;
const NOIR: [number, number, number] = [17, 17, 17];
const GRIS: [number, number, number] = [85, 85, 85];
const FILET: [number, number, number] = [210, 210, 210];

/** Contexte de dessin : le document, ses dimensions et le curseur vertical. */
interface Ctx {
  doc: jsPDF;
  autoTable: any;
  W: number;
  H: number;
  right: number;
  y: number;
}

/* -------------------------------- En-tête ------------------------------- */

function enTete(c: Ctx, spec: ReportSpec, imgs: PdfHeaderImages): void {
  const { doc, W, right } = c;
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);

  MINISTERE.split("\n").forEach((ln, i) => doc.text(ln, M, 13 + i * 3.4));
  REPUBLIQUE.split("\n").forEach((ln, i) => doc.text(ln, right, 13 + i * 3.4, { align: "right" }));

  if (imgs.logoInstitut) {
    const h = 18;
    doc.addImage(imgs.logoInstitut.dataUrl, imgs.logoInstitut.format, M, 20, h * imgs.logoInstitut.ratio, h);
  }
  if (imgs.embleme) {
    const h = 16;
    doc.addImage(imgs.embleme.dataUrl, imgs.embleme.format, right - h * imgs.embleme.ratio, 20, h * imgs.embleme.ratio, h);
  }

  doc.setFont("times", "bold");
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setFontSize(13);
  doc.text(INSTITUT, W / 2, 27, { align: "center" });

  // Titre encadré, comme le relevé de notes et le bulletin de paie.
  doc.setFontSize(11);
  const titre = tronquer(doc, spec.title.toUpperCase(), W - 2 * M - 14);
  const w = Math.min(doc.getTextWidth(titre) + 12, W - 2 * M);
  doc.setLineWidth(0.5);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(W / 2 - w / 2, 32, w, 7.5);
  doc.text(titre, W / 2, 37.2, { align: "center" });

  if (spec.subtitle) {
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(tronquer(doc, spec.subtitle, W - 2 * M), W / 2, 44.5, { align: "center" });
  }

  doc.setFont("times", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
  const yMentions = spec.subtitle ? 50 : 47;
  // Les deux mentions se partagent la ligne : chacune la moitié, au plus.
  const demi = (W - 2 * M) / 2 - 4;
  if (spec.metaLeft) doc.text(tronquer(doc, spec.metaLeft, demi), M, yMentions);
  if (spec.metaRight) {
    doc.text(tronquer(doc, spec.metaRight, demi), right, yMentions, { align: "right" });
  }

  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.4);
  doc.line(M, yMentions + 2.5, right, yMentions + 2.5);
  doc.setTextColor(0, 0, 0);
  c.y = yMentions + 8;
}

/* ------------------------------- Pied de page --------------------------- */

/** Posé après coup : le nombre total de pages n'est connu qu'à la fin. */
function pieds(c: Ctx): void {
  const { doc, W, H, right } = c;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
    doc.setLineWidth(0.3);
    doc.line(M, H - FOOTER_H_MM + 2, right, H - FOOTER_H_MM + 2);

    doc.setFont("times", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
    let y = H - FOOTER_H_MM + 6.5;
    FOOTER_ADDRESS.split("\n").forEach((ln) => {
      doc.text(ln, W / 2, y, { align: "center" });
      y += 3.2;
    });
    doc.text(`Page ${p} / ${pages}`, right, H - 5, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }
}

/* --------------------------------- Blocs -------------------------------- */

/** Réserve `h` millimètres ; ouvre une page si le pied de page est atteint. */
function place(c: Ctx, h: number): void {
  if (c.y + h > c.H - FOOTER_H_MM) {
    c.doc.addPage();
    c.y = CONTINUATION_TOP_MM;
  }
}

/**
 * Tronque au besoin, police et corps courants : un titre de section est écrit
 * sur une seule ligne, et rien ne doit sortir de son bandeau.
 */
function tronquer(doc: jsPDF, texte: string, largeurMax: number): string {
  const t = texteImprimable(texte);
  if (largeurMax <= 0 || doc.getTextWidth(t) <= largeurMax) return t;
  let court = t;
  while (court.length > 1 && doc.getTextWidth(`${court}…`) > largeurMax) {
    court = court.slice(0, -1);
  }
  return `${court.trimEnd()}…`;
}

function heading(c: Ctx, texte: string, niveau: 1 | 2, note?: string): void {
  const { doc, right } = c;
  const taille = niveau === 1 ? 12 : 10.5;
  place(c, niveau === 1 ? 14 : 11);
  const dispo = c.W - 2 * M - 6;

  if (niveau === 1) {
    // Bandeau plein vert : ouvre une grande section (une filière, une session…).
    doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
    doc.rect(M, c.y, c.W - 2 * M, 7, "F");
    doc.setFont("times", "bold");
    doc.setFontSize(taille);
    doc.setTextColor(255, 255, 255);
    // La mention de droite est prioritaire : le titre prend ce qui reste.
    const largeurNote = note ? doc.getTextWidth(texteImprimable(note)) + 6 : 0;
    doc.text(tronquer(doc, texte, dispo - largeurNote), M + 3, c.y + 4.9);
    if (note) doc.text(texteImprimable(note), right - 3, c.y + 4.9, { align: "right" });
    c.y += 10;
  } else {
    doc.setFont("times", "normal");
    doc.setFontSize(9.5);
    const largeurNote = note ? doc.getTextWidth(texteImprimable(note)) + 6 : 0;
    doc.setFont("times", "bold");
    doc.setFontSize(taille);
    doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
    doc.text(tronquer(doc, texte, dispo - largeurNote), M, c.y + 3.6);
    if (note) {
      doc.setFont("times", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
      doc.text(texteImprimable(note), right, c.y + 3.6, { align: "right" });
    }
    c.y += 6.5;
  }
  doc.setTextColor(0, 0, 0);
}

function note(c: Ctx, texte: string): void {
  const { doc } = c;
  doc.setFont("times", "italic");
  doc.setFontSize(9.5);
  doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
  doc.splitTextToSize(texteImprimable(texte), c.W - 2 * M).forEach((ln: string) => {
    place(c, 5);
    doc.text(ln, M, c.y + 3.4);
    c.y += 4.6;
  });
  c.y += 2;
  doc.setTextColor(0, 0, 0);
}

/** Bloc « Libellé : valeur » — rendu comme un tableau discret, sans en-tête. */
function keyValues(c: Ctx, items: Array<[string, string]>, colonnes: 1 | 2 | 3): void {
  if (items.length === 0) return;
  const largeurPaire = (c.W - 2 * M) / colonnes;
  const lignes: string[][] = [];
  for (let i = 0; i < items.length; i += colonnes) {
    const tranche = items.slice(i, i + colonnes);
    const cells: string[] = [];
    for (let j = 0; j < colonnes; j += 1) {
      cells.push(
        contenuCellule(c.doc, tranche[j]?.[0] ?? "", largeurPaire * 0.4, 9.5, true),
        contenuCellule(c.doc, tranche[j]?.[1] ?? "", largeurPaire * 0.6, 9.5, false)
      );
    }
    lignes.push(cells);
  }

  const styles: Record<number, any> = {};
  for (let j = 0; j < colonnes; j += 1) {
    styles[j * 2] = { cellWidth: largeurPaire * 0.4, fontStyle: "bold", textColor: GREEN };
    styles[j * 2 + 1] = { cellWidth: largeurPaire * 0.6 };
  }

  c.autoTable(c.doc, {
    startY: c.y,
    body: lignes,
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 9.5,
      cellPadding: 1.6,
      textColor: NOIR,
      lineColor: FILET,
      lineWidth: 0.1,
      overflow: "linebreak",
    },
    columnStyles: styles,
    margin: { top: CONTINUATION_TOP_MM, left: M, right: M, bottom: FOOTER_H_MM },
  });
  c.y = (c.doc as any).lastAutoTable.finalY + 5;
}

/** Marge intérieure des cellules de tableau (`cellPadding`), de chaque côté. */
const PADDING_CELLULE = 2;

/**
 * Contenu d'une cellule prêt à être posé : la chaîne telle quelle si elle sait
 * se replier seule, sinon les lignes découpées à la main. Un mot plus large que
 * sa colonne (nom composé, adresse électronique) déborderait sinon sur la
 * colonne voisine.
 */
function contenuCellule(
  doc: jsPDF,
  texte: string,
  largeurColonne: number,
  corps: number,
  gras: boolean
): string {
  doc.setFont("times", gras ? "bold" : "normal");
  doc.setFontSize(corps);
  const lignes = decouperCellule(
    (t) => doc.getTextWidth(t),
    texte,
    largeurColonne - 2 * PADDING_CELLULE
  );
  // Les sauts de ligne explicites sont la façon dont autoTable accepte un
  // contenu multi-lignes ; un tableau de chaînes serait converti en « a,b ».
  return lignes ? lignes.join("\n") : texteImprimable(texte);
}

function table(c: Ctx, t: { columns: any[]; rows: string[][]; footer?: string[] }): void {
  const largeurs = resolveWidths(t.columns, c.W - 2 * M);
  const styles: Record<number, any> = {};
  t.columns.forEach((col, i) => {
    styles[i] = { cellWidth: largeurs[i], halign: col.align ?? "left" };
  });
  const cellule = (v: string, i: number, corps: number, gras: boolean) =>
    contenuCellule(c.doc, v, largeurs[i], corps, gras);

  c.autoTable(c.doc, {
    startY: c.y,
    // Aucune cellule ne part au dessin sans passer par `texteImprimable` (une
    // espace insécable bloquerait le retour à la ligne) ni sans vérifier
    // qu'elle tient dans sa colonne.
    head: [t.columns.map((col, i) => cellule(col.header, i, 10, true))],
    body: t.rows.map((row) => row.map((v, i) => cellule(v, i, 9.5, false))),
    foot: t.footer ? [t.footer.map((v, i) => cellule(v, i, 9.5, true))] : undefined,
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 9.5,
      cellPadding: 2,
      textColor: NOIR,
      lineColor: FILET,
      lineWidth: 0.1,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: GREEN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      fontSize: 10,
    },
    footStyles: {
      fillColor: GREEN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: styles,
    margin: { top: CONTINUATION_TOP_MM, left: M, right: M, bottom: FOOTER_H_MM },
  });
  c.y = (c.doc as any).lastAutoTable.finalY + 6;
}

function bloc(c: Ctx, b: ReportBlock): void {
  switch (b.kind) {
    case "heading":
      return heading(c, b.text, b.level ?? 1, b.note);
    case "keyValues":
      return keyValues(c, b.items, b.columns ?? 2);
    case "table":
      return table(c, b.table);
    case "note":
      return note(c, b.text);
    case "pageBreak":
      c.doc.addPage();
      c.y = CONTINUATION_TOP_MM;
      return;
  }
}

/* ------------------------------ Assemblage ------------------------------ */

/**
 * jsPDF et jsPDF-autoTable sont chargés à la demande : plusieurs centaines de
 * Ko qui n'ont rien à faire dans le bundle initial des écrans.
 */
export async function buildReportPdf(spec: ReportSpec): Promise<{ doc: jsPDF; filename: string }> {
  const orientation = spec.orientation ?? "landscape";
  const [{ jsPDF: JsPDF }, { default: autoTable }, imgs] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    loadPdfHeaderImages(),
  ]);

  const { w: W, h: H } = pageSize(orientation);
  const doc = new JsPDF({ unit: "mm", format: "a4", orientation });
  const c: Ctx = { doc, autoTable, W, H, right: W - M, y: HEADER_H_MM };

  enTete(c, spec, imgs);
  spec.blocks.forEach((b) => bloc(c, b));
  pieds(c);

  const filename = `${spec.filename}.pdf`;
  // Titre du document : affiché par la visionneuse dans l'onglet, et proposé
  // comme nom de fichier par pdf.js (Firefox).
  doc.setProperties({
    title: spec.filename,
    subject: spec.title,
    author: INSTITUT,
    creator: INSTITUT,
  });
  return { doc, filename };
}

/**
 * Ouvre le rapport dans la visionneuse PDF du navigateur.
 *
 * `win` : onglet ouvert de façon synchrone au clic. La composition étant
 * asynchrone (jsPDF, logos, parfois des appels API), un `window.open` différé
 * serait bloqué comme popup — l'onglet doit exister avant.
 */
export async function openReportPdf(spec: ReportSpec, win?: Window | null): Promise<void> {
  try {
    const { doc } = await buildReportPdf(spec);
    const url = URL.createObjectURL(doc.output("blob"));
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    // Sans cela, l'onglet ouvert au clic resterait vide et sans explication.
    if (win) win.close();
    throw e;
  }
}

/** Télécharge le rapport au format PDF (sans passer par la visionneuse). */
export async function downloadReportPdf(spec: ReportSpec): Promise<void> {
  const { doc, filename } = await buildReportPdf(spec);
  doc.save(filename);
}

/**
 * Ouvre un onglet dans le geste de clic, prêt à recevoir le PDF.
 * Renvoie `null` si le navigateur a bloqué la popup — l'appelant doit alors
 * prévenir l'utilisateur plutôt que composer un document pour rien.
 */
export function ouvrirOngletPdf(): Window | null {
  return typeof window === "undefined" ? null : window.open("", "_blank");
}

/** Message affiché quand l'ouverture de l'onglet est bloquée. */
export const POPUP_BLOQUEE =
  "Le navigateur a bloqué l'ouverture d'un nouvel onglet. Autorisez les pop-ups pour ce site, puis réessayez.";
