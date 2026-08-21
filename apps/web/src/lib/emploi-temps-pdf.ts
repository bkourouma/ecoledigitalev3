/**
 * Génération de l'emploi du temps au format PDF — même modèle que l'export Word
 * (`emploi-temps-docx.ts`) : en-tête institution puis grille hebdomadaire
 * (HORAIRES × jours), avec fusion verticale des cours sur plusieurs créneaux et
 * la même couleur de fond par UE.
 *
 * La logique de grille (heures affichées, fusions, palette) vient du modèle
 * partagé `emploi-temps-model.ts` : les deux documents ne peuvent pas diverger.
 *
 * Le PDF s'ouvre dans la visionneuse du navigateur, d'où l'utilisateur imprime
 * ou télécharge.
 */
import type { jsPDF } from "jspdf";
import { loadPdfImg } from "@/lib/pdf-image-loader";
import { LOGO_INSTITUT } from "@/lib/bulletin-format";
import {
  BLEU_SALLE,
  DAY_KEYS,
  GRID_BORDER,
  GRIS_NON_AFFECTE,
  INDIGO,
  INDIGO_DARK,
  INDIGO_LIGHT,
  INSTITUT,
  JOURS,
  MINISTERE,
  REPUBLIQUE,
  ROUGE_ENSEIGNANT,
  buildOccupancy,
  displayedHours,
  enTeteEmploiTemps,
  hexToRgb,
  plageHoraire,
  roomLabel,
  teacherName,
  ueColor,
} from "@/lib/emploi-temps-model";
import { decouperCellule, slugFichier, stampFichier } from "@/lib/utils/report-doc";

/* ------------------------------ Mise en page ---------------------------- */

const PAGE_W = 297;
const PAGE_H = 210;
const M = 12;
const RIGHT = PAGE_W - M;
/** Largeur de la colonne des horaires ; les six jours se partagent le reste. */
const COL_HORAIRES = 28;

const INDIGO_RGB = hexToRgb(INDIGO);
const INDIGO_LIGHT_RGB = hexToRgb(INDIGO_LIGHT);
const INDIGO_DARK_RGB = hexToRgb(INDIGO_DARK);
const BORDURE_RGB = hexToRgb(GRID_BORDER);
const ROUGE_RGB = hexToRgb(ROUGE_ENSEIGNANT);
const GRIS_RGB = hexToRgb(GRIS_NON_AFFECTE);
const BLEU_RGB = hexToRgb(BLEU_SALLE);

/* -------------------------------- En-tête ------------------------------- */

/** Reprend l'en-tête du modèle Word, dans le même ordre. Renvoie l'ordonnée atteinte. */
function enTete(
  doc: jsPDF,
  logo: { dataUrl: string; ratio: number; format: "PNG" | "JPEG" } | null,
  d: { titreFiliere: string; periode: string; annee: string; semestre: string }
): number {
  doc.setFont("times", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  MINISTERE.split("\n").forEach((ln, i) => doc.text(ln, M, 12 + i * 3.4));
  REPUBLIQUE.split("\n").forEach((ln, i) => doc.text(ln, RIGHT, 12 + i * 3.4, { align: "right" }));

  let y = 22;
  if (logo) {
    const h = 18;
    doc.addImage(logo.dataUrl, logo.format, PAGE_W / 2 - (h * logo.ratio) / 2, y, h * logo.ratio, h);
    y += h + 3;
  }

  doc.setFont("times", "bolditalic");
  doc.setFontSize(9);
  doc.text(INSTITUT, PAGE_W / 2, y + 3, { align: "center" });
  y += 8;

  doc.setFont("times", "italic");
  doc.setFontSize(8);
  doc.text(`ANNÉE ACADÉMIQUE ${d.annee}`, M, y);
  doc.text("MESRS : Diplômes homologués", RIGHT, y, { align: "right" });
  y += 7;

  doc.setFont("times", "bold");
  doc.setFontSize(14);
  doc.text("EMPLOI DU TEMPS : Modèle : HYBRIDE", PAGE_W / 2, y, { align: "center" });
  y += 6.5;

  // Semestre en rouge, période en noir — comme dans le document Word.
  doc.setFontSize(10);
  const libelleSemestre = `${d.semestre} : `;
  const wSem = doc.getTextWidth(libelleSemestre);
  const wPeriode = doc.getTextWidth(d.periode);
  const debut = PAGE_W / 2 - (wSem + wPeriode) / 2;
  doc.setTextColor(192, 0, 0);
  doc.text(libelleSemestre, debut, y);
  doc.setTextColor(0, 0, 0);
  doc.text(d.periode, debut + wSem, y);
  y += 7;

  doc.setFontSize(16);
  doc.text(d.titreFiliere, PAGE_W / 2, y, { align: "center" });
  return y + 5;
}

/* --------------------------------- Grille -------------------------------- */

/** Texte d'une case de cours : ECUE, enseignant, salle — plusieurs cours possibles. */
function dessinerCase(doc: jsPDF, cellule: any, slots: any[]): void {
  const { x, y, width, height } = cellule;
  const lignes: Array<{ texte: string; couleur: [number, number, number]; separateur?: boolean }> = [];

  slots.forEach((s, i) => {
    if (i > 0) lignes.push({ texte: "", couleur: [191, 191, 191], separateur: true });
    const enseignant = teacherName(s);
    const salle = roomLabel(s);
    lignes.push({ texte: s.ecue_libelle ?? "", couleur: [0, 0, 0] });
    lignes.push({
      texte: enseignant || "Non affecté",
      couleur: enseignant ? ROUGE_RGB : GRIS_RGB,
    });
    if (salle) lignes.push({ texte: salle, couleur: BLEU_RGB });
  });

  // Police réduite si la case porte plusieurs cours : tout doit tenir.
  const taille = lignes.length > 4 ? 5.5 : 6.5;
  const interligne = taille * 0.42;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(taille);

  // Chaque libellé peut occuper plusieurs lignes : on mesure avant de centrer.
  // `decouperCellule` coupe aussi les mots plus larges que la case (un nom
  // composé, une salle « B12-ANNEXE »), qui déborderaient sur le jour voisin.
  const dispo = width - 2.5;
  const rendu = lignes.flatMap((l) =>
    l.separateur
      ? [{ ...l, morceaux: [""] }]
      : [
          {
            ...l,
            morceaux:
              decouperCellule((t) => doc.getTextWidth(t), l.texte, dispo) ??
              (doc.splitTextToSize(l.texte, dispo) as string[]),
          },
        ]
  );
  const hauteurTotale = rendu.reduce((h, l) => h + l.morceaux.length * interligne, 0);
  let curseur = y + Math.max(1.5, (height - hauteurTotale) / 2);

  rendu.forEach((l) => {
    if (l.separateur) {
      doc.setDrawColor(191, 191, 191);
      doc.setLineWidth(0.15);
      doc.line(x + 2, curseur + interligne / 2, x + width - 2, curseur + interligne / 2);
      curseur += interligne;
      return;
    }
    doc.setTextColor(l.couleur[0], l.couleur[1], l.couleur[2]);
    l.morceaux.forEach((morceau) => {
      curseur += interligne;
      doc.text(morceau, x + width / 2, curseur, { align: "center" });
    });
  });
  doc.setTextColor(0, 0, 0);
}

/** Construit le corps du tableau : une ligne par heure, une colonne par jour. */
function corps(slots: any[], heures: number[]) {
  const occ = buildOccupancy(slots);
  return heures.map((h) => {
    const ligne: any[] = [
      {
        content: plageHoraire(h),
        styles: {
          fillColor: INDIGO_LIGHT_RGB,
          textColor: INDIGO_DARK_RGB,
          fontStyle: "bold",
          halign: "left",
          valign: "middle",
          fontSize: 7.5,
        },
      },
    ];
    for (const d of DAY_KEYS) {
      const case_ = occ[d][h];
      if (case_?.kind === "start") {
        const premier = case_.slots[0];
        const couleur = ueColor(premier.ue_code || premier.ue_libelle || premier.ecue_id || "");
        ligne.push({
          content: "",
          rowSpan: case_.span,
          // Le contenu est dessiné à la main (trois couleurs par cours).
          _slots: case_.slots,
          _bordure: hexToRgb(couleur.border),
          styles: { fillColor: hexToRgb(couleur.bg) },
        });
      } else if (case_?.kind === "cont") {
        // Rien : la cellule fusionnée de la ligne précédente couvre cette case.
        continue;
      } else {
        ligne.push({ content: "", styles: { fillColor: [255, 255, 255] } });
      }
    }
    return ligne;
  });
}

/* ------------------------------ Assemblage ------------------------------ */

async function buildEmploiTempsDoc(data: any): Promise<{ doc: jsPDF; filename: string }> {
  const [{ jsPDF: JsPDF }, { default: autoTable }, logo] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    loadPdfImg(LOGO_INSTITUT),
  ]);

  const entete = enTeteEmploiTemps(data);
  const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const yGrille = enTete(doc, logo, entete);

  const heures = displayedHours(entete.slots);
  const largeurJour = (PAGE_W - 2 * M - COL_HORAIRES) / DAY_KEYS.length;
  // Hauteur de ligne : la grille occupe toute la place restante, sans déborder.
  const hauteurLigne = Math.min(
    16,
    Math.max(9, (PAGE_H - M - yGrille - 8) / Math.max(heures.length, 1))
  );

  autoTable(doc, {
    startY: yGrille,
    head: [["HORAIRES", ...DAY_KEYS.map((d) => JOURS[d])]],
    body: corps(entete.slots, heures),
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 6.5,
      cellPadding: 1,
      lineColor: BORDURE_RGB,
      lineWidth: 0.2,
      minCellHeight: hauteurLigne,
      valign: "middle",
    },
    headStyles: {
      fillColor: INDIGO_RGB,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "left",
      fontSize: 8,
      minCellHeight: 7,
    },
    columnStyles: {
      0: { cellWidth: COL_HORAIRES },
      ...Object.fromEntries(DAY_KEYS.map((_, i) => [i + 1, { cellWidth: largeurJour }])),
    },
    margin: { top: 14, left: M, right: M, bottom: 10 },
    didDrawCell: (d: any) => {
      const brut = d.cell.raw;
      if (d.section !== "body" || !brut || !brut._slots) return;
      // Filet coloré à gauche, comme la bordure épaisse du document Word.
      const [r, g, b] = brut._bordure;
      doc.setFillColor(r, g, b);
      doc.rect(d.cell.x, d.cell.y, 1.2, d.cell.height, "F");
      dessinerCase(doc, d.cell, brut._slots);
    },
  });

  const nom = slugFichier(entete.titreFiliere || "emploi-du-temps");
  doc.setProperties({
    title: `Emploi du temps — ${entete.titreFiliere}`,
    subject: `${entete.semestre} · ${entete.periode}`,
    author: INSTITUT,
    creator: INSTITUT,
  });
  return { doc, filename: `emploi-du-temps-${nom}-${stampFichier()}.pdf` };
}

/**
 * Ouvre l'emploi du temps dans la visionneuse PDF du navigateur.
 * `win` : onglet ouvert de façon synchrone au clic (sinon popup bloquée).
 */
export async function openEmploiTempsPdf(data: any, win?: Window | null): Promise<void> {
  try {
    const { doc } = await buildEmploiTempsDoc(data);
    const url = URL.createObjectURL(doc.output("blob"));
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

/** Télécharge l'emploi du temps au format PDF. */
export async function downloadEmploiTempsPdf(data: any): Promise<void> {
  const { doc, filename } = await buildEmploiTempsDoc(data);
  doc.save(filename);
}
