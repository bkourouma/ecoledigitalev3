/**
 * Export PDF — Diplôme officiel (Module Professionnel, feature 030).
 *
 * A4 paysage, disposition du modèle officiel IPAM : en-tête à trois colonnes
 * (logo MESRS + ministère à gauche, logo IPAM au centre, armoiries +
 * république + tricolore à droite), titre en double cadre vert avec filet
 * interne, visas de la Commission précédés d'un tiret, paragraphe d'identité
 * centré à graisse mixte (nom, matricule, naissance, intitulé du diplôme et
 * mention en gras), trois blocs de signatures (Comité Scientifique à gauche,
 * Direction Générale en bleu au centre, Directeur Général Adjoint à droite).
 *
 * Filigranes : logo IPAM centré en transparence, mortiers de diplômés
 * vectoriels aux quatre angles et guirlande de laurier en bas de page —
 * dessinés à ~5 % d'opacité. Cadre : filets verts + hairline doré, équerres
 * d'angle étagées (rappel du cadre de l'attestation). jsPDF vectoriel.
 */
import { jsPDF } from "jspdf";
import { IPAM_GREEN_RGB } from "./bulletin-format";
import {
  COMMISSION_VISA_1,
  COMMISSION_VISA_2,
  COMMISSION_VISA_3,
  PRESIDENT_JURY_TITRE,
  DIPLOME_SIGNATAIRE_GAUCHE_NOM,
  DIPLOME_SIGNATAIRE_DROITE_NOM,
  DIPLOME_SIGNATAIRE_DROITE_TITRE,
  DIPLOME_MINISTERE_LIGNES,
  DIPLOME_REPUBLIQUE_TITRE,
  DIPLOME_REPUBLIQUE_DEVISE,
  DUPLICATA_MENTION,
  cycleLabel,
  intituleObtention,
  type Signataire,
} from "./diplome-format";
import {
  loadDiplomeHeaderImages,
  type DiplomeHeaderImages,
  type PdfImg,
} from "./pdf-image-loader";

const M = 14;
const PAGE_W = 297;
const PAGE_H = 210;
const RIGHT = PAGE_W - M;

const GREEN = IPAM_GREEN_RGB;
/** Vert clair des filets secondaires. */
const GREEN_BAND: [number, number, number] = [46, 125, 91];
/** Doré des accents (hairline du cadre, losanges du titre). */
const GOLD: [number, number, number] = [172, 128, 48];

export interface DiplomePdfInput {
  reference: string;
  diplome: { code: string; libelle: string; filiere_libelle: string };
  etudiant: {
    nom_complet: string;
    matricule?: string | null;
    date_naissance?: string | null;
    lieu_naissance?: string | null;
  };
  date_obtention: string;
  date_deliberation?: string | null;
  annee_academique?: string | null;
  mention?: string | null;
  /** Signataires configurés en administration ; défauts appliqués si absents. */
  signataire_gauche?: Signataire | null;
  signataire_droite?: Signataire | null;
}

/* ----------------------------- Dates (fr) ------------------------------ */

/** « mercredi 03 juillet 2024 » — session de la Commission (avec jour). */
function fmtDateJourFr(value?: string | null): string {
  if (!value) return "____________________";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/** « 11 août 2025 » — établissement du procès-verbal. */
function fmtDatePvFr(value?: string | null): string {
  if (!value) return "____________________";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}

/** « 09/12/1997 » — date de naissance (format numérique du modèle). */
function fmtDateNaissanceFr(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("fr-FR");
}

/* --------------------------- Primitives de tracé ------------------------ */

/** Rotation d'un point autour d'un centre (degrés, sens horaire écran). */
function rot(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number
): [number, number] {
  const a = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

/** Polygone plein à partir de points absolus. */
function polyFill(doc: jsPDF, pts: Array<[number, number]>): void {
  const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
  doc.lines(deltas as any, pts[0][0], pts[0][1], [1, 1], "F", true);
}

/** Petit losange plein (accents dorés du titre). */
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

/**
 * Mortier de diplômé (vue de trois quarts) : plateau en losange, calotte
 * trapézoïdale, bouton central et gland pendant. Motif de filigrane.
 */
function drawCap(doc: jsPDF, cx: number, cy: number, s: number, deg: number): void {
  const R = (p: [number, number]): [number, number] => rot(cx + p[0], cy + p[1], cx, cy, deg);
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  // Plateau.
  polyFill(doc, ([
    [0, -0.55 * s],
    [s, 0],
    [0, 0.55 * s],
    [-s, 0],
  ] as Array<[number, number]>).map(R));
  // Calotte.
  polyFill(doc, ([
    [-0.42 * s, 0.1 * s],
    [0.42 * s, 0.1 * s],
    [0.3 * s, 0.6 * s],
    [-0.3 * s, 0.6 * s],
  ] as Array<[number, number]>).map(R));
  // Bouton et gland.
  const btn = R([0, -0.08 * s]);
  const end = R([0.9 * s, 0.45 * s]);
  doc.circle(btn[0], btn[1], 0.09 * s, "F");
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.5);
  doc.line(btn[0], btn[1], end[0], end[1]);
  doc.circle(end[0], end[1], 0.13 * s, "F");
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
    const x = cx + dir * (6 + 58 * t);
    const y = yb - 14 * t * t;
    doc.line(prev[0], prev[1], x, y);
    const ang = Math.atan2(y - prev[1], x - prev[0]);
    for (const side of [-1, 1]) {
      const la = ang + side * (Math.PI / 3.1);
      const len = 7.5 - 3.5 * t;
      const wid = 1.6 - 0.6 * t;
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
 * Filigranes du diplôme : logo IPAM centré (comme sur l'attestation), quatre
 * mortiers de diplômés inclinés près des angles et guirlande de laurier en
 * bas de page — le tout en transparence, sous le contenu.
 */
function drawWatermarks(doc: jsPDF, logo: PdfImg | null): void {
  try {
    doc.saveGraphicsState();
    // « opacity » ne couvre que les remplissages ; « stroke-opacity » est
    // indispensable pour les traits (tiges du laurier, cordons des mortiers).
    const setOpacity = (o: number) =>
      (doc as any).setGState(new (doc as any).GState({ opacity: o, "stroke-opacity": o }));

    setOpacity(0.06);
    if (logo) {
      const w = 105;
      const h = w / logo.ratio;
      doc.addImage(logo.dataUrl, "JPEG", (PAGE_W - w) / 2, (PAGE_H - h) / 2 - 4, w, h);
    }

    setOpacity(0.05);
    drawCap(doc, 36, 60, 11, -18);
    drawCap(doc, PAGE_W - 36, 60, 11, 18);
    drawCap(doc, 36, 150, 11, 12);
    drawCap(doc, PAGE_W - 36, 150, 11, -12);
    drawLaurelBranch(doc, PAGE_W / 2, 191, 1);
    drawLaurelBranch(doc, PAGE_W / 2, 191, -1);

    doc.restoreGraphicsState();
  } catch {
    /* GState indisponible : on ignore les filigranes */
  }
}

/** Équerres d'angle pleines centrées sur un filet (rectangles pleins). */
function drawCornerBrackets(
  doc: jsPDF,
  c: number,
  t: number,
  a: number,
  color: [number, number, number]
): void {
  const near = c - t / 2;
  const farX = PAGE_W - c - t / 2;
  const farY = PAGE_H - c - t / 2;
  doc.setFillColor(color[0], color[1], color[2]);
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
}

/**
 * Cadre du diplôme : filet vert principal + filet secondaire + hairline doré,
 * avec équerres d'angle étagées (large sur le filet principal, fine sur le
 * secondaire) — l'équivalent paysage du cadre de l'attestation.
 */
function drawBorder(doc: jsPDF): void {
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.9);
  doc.rect(7, 7, PAGE_W - 14, PAGE_H - 14, "S");

  doc.setDrawColor(GREEN_BAND[0], GREEN_BAND[1], GREEN_BAND[2]);
  doc.setLineWidth(0.3);
  doc.rect(10.5, 10.5, PAGE_W - 21, PAGE_H - 21, "S");

  doc.setDrawColor(GOLD[0], GOLD[1], GOLD[2]);
  doc.setLineWidth(0.25);
  doc.rect(12.3, 12.3, PAGE_W - 24.6, PAGE_H - 24.6, "S");

  drawCornerBrackets(doc, 7, 3.2, 30, GREEN);
  drawCornerBrackets(doc, 10.5, 1.2, 17, GREEN_BAND);
}

/* ------------------- Paragraphe centré à graisse mixte ------------------ */

interface RichSeg {
  t: string;
  bold?: boolean;
}

/**
 * Écrit un paragraphe centré dont certains segments sont en gras : les mots
 * sont mesurés avec leur graisse, répartis en lignes tenant dans `maxW`,
 * chaque ligne étant ensuite centrée sur `cx`. Renvoie le y suivant.
 */
function drawRichCentered(
  doc: jsPDF,
  segs: RichSeg[],
  cx: number,
  y: number,
  maxW: number,
  size: number,
  lh: number
): number {
  const words: Array<{ t: string; bold: boolean }> = [];
  for (const s of segs) {
    for (const w of s.t.split(/\s+/)) if (w) words.push({ t: w, bold: !!s.bold });
  }
  doc.setFontSize(size);
  doc.setFont("times", "normal");
  const spaceW = doc.getTextWidth(" ");
  const widthOf = (w: { t: string; bold: boolean }) => {
    doc.setFont("times", w.bold ? "bold" : "normal");
    return doc.getTextWidth(w.t);
  };

  const lines: Array<{ words: typeof words; width: number }> = [];
  let cur: typeof words = [];
  let curW = 0;
  for (const w of words) {
    const ww = widthOf(w);
    if (cur.length && curW + spaceW + ww > maxW) {
      lines.push({ words: cur, width: curW });
      cur = [w];
      curW = ww;
    } else {
      cur.push(w);
      curW += cur.length === 1 ? ww : spaceW + ww;
    }
  }
  if (cur.length) lines.push({ words: cur, width: curW });

  for (const line of lines) {
    let x = cx - line.width / 2;
    for (const w of line.words) {
      doc.setFont("times", w.bold ? "bold" : "normal");
      doc.text(w.t, x, y);
      x += doc.getTextWidth(w.t) + spaceW;
    }
    y += lh;
  }
  return y;
}

/* ------------------------------- Rendu ---------------------------------- */

function drawDiplome(doc: jsPDF, data: DiplomePdfInput, imgs: DiplomeHeaderImages): void {
  const { logoInstitut, embleme, ministere } = imgs;

  drawWatermarks(doc, logoInstitut);
  drawBorder(doc);

  /* ---------------------------- En-tête ---------------------------- */
  // Les trois logos démarrent tous à la même hauteur (LOGO_TOP), clairement
  // sous le filet doré (qui s'arrête à 12,425 mm) : selon leur marge interne,
  // un logo positionné plus haut peut chevaucher ce filet et le faire
  // apparaître troué ou décoloré à cet endroit (mélange alpha avec le trait
  // du cadre) — d'où un rendu incohérent d'un côté à l'autre si les hauteurs
  // de départ diffèrent. Aligner les trois évite tout chevauchement.
  const LOGO_TOP = 13;

  // Colonne gauche : logo MESRS (il embarque déjà le libellé du ministère) ;
  // à défaut d'image, les lignes de texte le remplacent.
  if (ministere) {
    const h = 16;
    doc.addImage(ministere.dataUrl, "PNG", M + 8, LOGO_TOP, h * ministere.ratio, h);
  } else {
    doc.setFont("times", "bold");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    DIPLOME_MINISTERE_LIGNES.forEach((ln, i) => doc.text(ln, M + 10, 18 + i * 3.6));
  }

  // Colonne centrale : logo IPAM.
  if (logoInstitut) {
    const h = 22;
    doc.addImage(
      logoInstitut.dataUrl,
      "JPEG",
      PAGE_W / 2 - (h * logoInstitut.ratio) / 2,
      LOGO_TOP,
      h * logoInstitut.ratio,
      h
    );
  }

  // Colonne droite : armoiries, république, devise, bandeau tricolore.
  const colRightX = RIGHT - 8 - 26;
  if (embleme) {
    const h = 14;
    doc.addImage(
      embleme.dataUrl,
      "PNG",
      colRightX - (h * embleme.ratio) / 2,
      LOGO_TOP,
      h * embleme.ratio,
      h
    );
  }
  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.text(DIPLOME_REPUBLIQUE_TITRE, colRightX, 29.5, { align: "center" });
  doc.setFont("times", "normal");
  doc.setFontSize(7.5);
  doc.text(DIPLOME_REPUBLIQUE_DEVISE, colRightX, 33.2, { align: "center" });

  /* --------------------------- Titre encadré ------------------------ */
  let y = 45;
  const grade = cycleLabel(data.diplome.filiere_libelle);
  const titre =
    grade !== "—" ? `DIPLÔME\n${grade} PROFESSIONNELLE` : `DIPLÔME\n${data.diplome.libelle.toUpperCase()}`;
  const lignes = titre.split("\n");
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  const boxW = Math.max(...lignes.map((l) => doc.getTextWidth(l))) + 26;
  const boxH = 24.5;
  const boxX = PAGE_W / 2 - boxW / 2;
  // Double cadre vert.
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(1.1);
  doc.rect(boxX, y, boxW, boxH, "S");
  doc.setLineWidth(0.35);
  doc.rect(boxX + 1.7, y + 1.7, boxW - 3.4, boxH - 3.4, "S");
  // Titre sur deux lignes.
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  lignes.forEach((ln, i) => doc.text(ln, PAGE_W / 2, y + 8.5 + i * 9, { align: "center" }));
  // Filet interne sous le titre, ponctué de losanges dorés.
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.7);
  doc.line(boxX + 12, y + 20.8, boxX + boxW - 12, y + 20.8);
  drawDiamond(doc, boxX + 12, y + 20.8, 0.9, GOLD);
  drawDiamond(doc, boxX + boxW - 12, y + 20.8, 0.9, GOLD);

  y += boxH + 8;

  /* ----------------------------- Visas ------------------------------ */
  doc.setTextColor(0, 0, 0);
  doc.setFont("times", "normal");
  doc.setFontSize(9.5);
  const bodyX = M + 34;
  const bodyW = PAGE_W - 2 * bodyX;
  const deliberationDate = fmtDateJourFr(data.date_deliberation ?? data.date_obtention);
  const examenDate = fmtDatePvFr(data.date_obtention);
  const visas = [
    `- ${COMMISSION_VISA_1}`,
    `- ${COMMISSION_VISA_2} ${deliberationDate} ;`,
    `- ${COMMISSION_VISA_3} ${examenDate}, Par le Président du Jury, Examinateur,`,
  ];
  for (const visa of visas) {
    doc.splitTextToSize(visa, bodyW).forEach((ln: string) => {
      doc.text(ln, bodyX, y);
      y += 4.7;
    });
    y += 2.4;
  }

  doc.setFontSize(10.5);
  doc.text("Déclare que", PAGE_W / 2, y, { align: "center" });
  y += 7;

  /* ----------------------- Identité + résultat ---------------------- */
  const segs: RichSeg[] = [{ t: "Mme, Mlle, M." }, { t: `${data.etudiant.nom_complet.toUpperCase()},`, bold: true }];
  if (data.etudiant.matricule) {
    segs.push({ t: "matricule :" }, { t: `${data.etudiant.matricule},`, bold: true });
  }
  if (data.etudiant.date_naissance) {
    segs.push({ t: "né(e) le" }, { t: fmtDateNaissanceFr(data.etudiant.date_naissance), bold: true });
    if (data.etudiant.lieu_naissance) {
      segs.push({ t: "à" }, { t: `${data.etudiant.lieu_naissance},`, bold: true });
    } else {
      segs[segs.length - 1].t += ",";
    }
  }
  segs.push(
    { t: "a obtenu le Diplôme de" },
    { t: intituleObtention(data.diplome.filiere_libelle).toUpperCase(), bold: true }
  );
  if (data.annee_academique) segs.push({ t: `au titre de l'année ${data.annee_academique}` });
  if (data.mention) {
    segs.push({ t: "avec la Mention" }, { t: `${data.mention}.`, bold: true });
  } else {
    segs[segs.length - 1].t += ".";
  }

  y = drawRichCentered(doc, segs, PAGE_W / 2, y, 220, 11.5, 6.4);

  y += 2;
  doc.setFont("times", "italic");
  doc.setFontSize(10);
  doc.text("Pour en jouir des droits et prérogatives qui y sont attachés.", PAGE_W / 2, y, {
    align: "center",
  });

  /* --------------------------- Signatures --------------------------- */
  const sigY = 168;
  const cxL = M + 48;
  const cxR = RIGHT - 48;

  // Signataires configurés en administration, avec repli sur les défauts.
  const nomG = data.signataire_gauche?.nom?.trim() || DIPLOME_SIGNATAIRE_GAUCHE_NOM;
  const titreG = data.signataire_gauche?.fonction?.trim() || PRESIDENT_JURY_TITRE;
  const nomD = data.signataire_droite?.nom?.trim() || DIPLOME_SIGNATAIRE_DROITE_NOM;
  const titreD = data.signataire_droite?.fonction?.trim() || DIPLOME_SIGNATAIRE_DROITE_TITRE;

  doc.setTextColor(0, 0, 0);
  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.text(nomG, cxL, sigY, { align: "center", maxWidth: 86 });
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  titreG.split("\n").forEach((ln, i) =>
    doc.text(ln, cxL, sigY + 5 + i * 4.2, { align: "center" })
  );

  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.text(nomD, cxR, sigY, { align: "center", maxWidth: 86 });
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  titreD.split("\n").forEach((ln, i) =>
    doc.text(ln, cxR, sigY + 5 + i * 4.2, { align: "center" })
  );

  // Espace central volontairement vide : emplacement du cachet physique de
  // l'établissement (aucun texte, pour ne pas le recouvrir).

  /* --------------------------- Pied de page ------------------------- */
  doc.setFont("times", "italic");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(DUPLICATA_MENTION, PAGE_W / 2, PAGE_H - 15, { align: "center" });
}

async function buildDiplomeDoc(data: DiplomePdfInput): Promise<jsPDF> {
  const imgs = await loadDiplomeHeaderImages();
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  drawDiplome(doc, data, imgs);
  return doc;
}

function diplomeFilename(data: DiplomePdfInput): string {
  const safe = (data.etudiant.nom_complet || "etudiant").replace(/[^\w-]+/g, "_");
  return `Diplome_${safe}.pdf`;
}

/** Télécharge le diplôme officiel en PDF. */
export async function downloadDiplomePdf(data: DiplomePdfInput): Promise<void> {
  const doc = await buildDiplomeDoc(data);
  doc.save(diplomeFilename(data));
}

/** Ouvre le diplôme officiel dans un nouvel onglet (visionneuse PDF). */
export async function openDiplomePdf(data: DiplomePdfInput, win?: Window | null): Promise<void> {
  const doc = await buildDiplomeDoc(data);
  const url = URL.createObjectURL(doc.output("blob"));
  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
