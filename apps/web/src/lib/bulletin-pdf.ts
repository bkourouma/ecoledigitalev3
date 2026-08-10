/**
 * Export PDF du relevé de notes — Module Professionnel (feature 030).
 * PDF vectoriel A4 : identité IPAM (vert), filigrane, tableau UE→ECUE groupé
 * par catégorie, zébrage, statuts colorés, synthèse (rang), décision colorée,
 * QR de vérification, cachet. jsPDF + jspdf-autotable + qrcode.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  MINISTERE,
  REPUBLIQUE,
  INSTITUT,
  DECISION_TITRE,
  VISA_DIRECTEUR,
  FOOTER_NOTE,
  FOOTER_ADDRESS,
  LOGO_INSTITUT,
  LOGO_EMBLEME,
  fmtNote,
  appreciation,
  ueEtatLabel,
  niveauOf,
  fmtDateLongFr,
  genreLabel,
  decisionLabel,
  releveSemestreTitre,
  sessionLabel,
  juryIntro,
  JURY_RESULTATS,
  JURY_NB,
} from "./bulletin-format";

const M = 12;
const PAGE_W = 210;
const PAGE_H = 297;
const RIGHT = PAGE_W - M;

const GREEN: [number, number, number] = [20, 83, 45];
const ZEBRA: [number, number, number] = [247, 250, 248];
const OK: [number, number, number] = [21, 128, 61];
const BAD: [number, number, number] = [185, 28, 28];
const AMBER: [number, number, number] = [180, 83, 9];

function decRgb(d: string): [number, number, number] {
  return d === "admis" ? OK : d === "rattrapage" ? AMBER : BAD;
}

export interface Img {
  dataUrl: string;
  ratio: number;
}
async function loadImg(url: string): Promise<Img | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl: string = await new Promise((r) => {
      const f = new FileReader();
      f.onloadend = () => r(f.result as string);
      f.readAsDataURL(blob);
    });
    const ratio: number = await new Promise((r) => {
      const i = new Image();
      i.onload = () => r(i.width / i.height || 1);
      i.onerror = () => r(1);
      i.src = dataUrl;
    });
    return { dataUrl, ratio };
  } catch {
    return null;
  }
}

export function kv(doc: jsPDF, label: string, value: string, x: number, y: number, valueBold = false) {
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text(label, x, y);
  const w = doc.getTextWidth(label);
  doc.setLineWidth(0.2);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.line(x, y + 0.6, x + w, y + 0.6);
  doc.setTextColor(0, 0, 0);
  doc.setFont("times", valueBold ? "bold" : "normal");
  doc.text(value, x + w + 2, y);
}

export interface HeaderImages {
  logoInstitut: Img | null;
  embleme: Img | null;
}

export async function loadHeaderImages(): Promise<HeaderImages> {
  const [logoInstitut, embleme] = await Promise.all([loadImg(LOGO_INSTITUT), loadImg(LOGO_EMBLEME)]);
  return { logoInstitut, embleme };
}

/** Dessine un relevé de notes complet sur la page courante de `doc`. */
async function drawBulletin(doc: jsPDF, bulletin: any, imgs: HeaderImages): Promise<void> {
  const { logoInstitut, embleme } = imgs;
  const studentName = `${bulletin.student?.last_name ?? ""} ${bulletin.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();
  // Date officielle : date de génération permanente si le bulletin est généré.
  const officialDate = bulletin.generated_at ? new Date(bulletin.generated_at) : new Date();
  const today = officialDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const totalObtenus = bulletin.credits_valides ?? 0;
  const totalUe = bulletin.credits_total ?? 0;

  // ---------- En-tête ----------
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  MINISTERE.split("\n").forEach((ln, i) => doc.text(ln, M, 14 + i * 3.4));
  REPUBLIQUE.split("\n").forEach((ln, i) => doc.text(ln, RIGHT, 14 + i * 3.4, { align: "right" }));

  // Encadré central : RELEVE DE NOTES SEMESTRE n (gras, vert).
  doc.setFont("times", "bold");
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  const titre = releveSemestreTitre(bulletin.semestre?.libelle);
  doc.setFontSize(10);
  const ow = doc.getTextWidth(titre) + 8;
  doc.setLineWidth(0.5);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(PAGE_W / 2 - ow / 2, 16, ow, 6);
  doc.text(titre, PAGE_W / 2, 20.1, { align: "center" });

  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text(`Année scolaire : ${bulletin.annee_academique ?? "—"}`, PAGE_W / 2, 27, {
    align: "center",
  });

  if (logoInstitut) {
    const h = 22;
    doc.addImage(logoInstitut.dataUrl, "JPEG", M, 21, h * logoInstitut.ratio, h);
  }
  if (embleme) {
    const h = 19;
    doc.addImage(embleme.dataUrl, "JPEG", RIGHT - h * embleme.ratio, 21, h * embleme.ratio, h);
  }

  // Nom de l'institut : pleine largeur, centré, sous les logos (remonté).
  doc.setFont("times", "bold");
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setFontSize(12.5);
  doc.text(INSTITUT, PAGE_W / 2, 45, { align: "center" });
  doc.setTextColor(0, 0, 0);

  // ---------- Jury : introduction (espace accru sous le titre) ----------
  let y = 56;
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.splitTextToSize(juryIntro(officialDate), PAGE_W - 2 * M).forEach((ln: string) => {
    doc.text(ln, M, y);
    y += 5;
  });
  y += 1.5;

  // ---------- Bloc scolarité ----------
  const COL2 = 118;
  const ne = `${fmtDateLongFr(bulletin.student?.date_of_birth)}${
    bulletin.student?.place_of_birth ? ` à ${bulletin.student.place_of_birth}` : ""
  }`;
  kv(doc, "Nom et prénoms", studentName || "—", M, y, true);
  kv(doc, "Matricule", String(bulletin.student?.matricule ?? "—"), COL2, y);
  y += 5.8;
  kv(doc, "Né(e) le", ne, M, y);
  kv(doc, "Genre", genreLabel(bulletin.student?.gender), COL2, y);
  y += 5.8;
  kv(doc, "Spécialité", String(bulletin.filiere?.name ?? "—"), M, y);
  kv(doc, "Redoublant(e)", bulletin.student?.is_repeating ? "OUI" : "NON", COL2, y);
  y += 5.8;
  kv(doc, "Niveau", niveauOf(bulletin.filiere?.name), M, y);
  kv(doc, "Domaine", String(bulletin.filiere?.domaine ?? "—"), COL2, y);
  y += 7;

  // ---------- Textes jury avant le tableau ----------
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.splitTextToSize(JURY_RESULTATS, PAGE_W - 2 * M).forEach((ln: string) => {
    doc.text(ln, M, y);
    y += 5;
  });
  doc.setFont("times", "bold");
  doc.splitTextToSize(JURY_NB, PAGE_W - 2 * M).forEach((ln: string) => {
    doc.text(ln, M, y);
    y += 5;
  });
  doc.setFont("times", "normal");
  y += 1.5;

  // ---------- Tableau (catégories + UE + ECUE) ----------
  const catList =
    bulletin.categories?.length > 0
      ? bulletin.categories
      : [{ key: "_all", ues: bulletin.ues ?? [], credits_obtenus: totalObtenus, credits_ue: totalUe }];
  const body: any[] = [];
  for (const cat of catList) {
    cat.ues.forEach((ue: any, i: number) => {
      const zbg = i % 2 === 1 ? { fillColor: ZEBRA } : {};
      // Le titre de l'UE porte « (MOY) » : la valeur en colonne Note de cette
      // ligne est la moyenne de l'UE (colonne Moy supprimée).
      body.push([
        {
          content: `${(ue.libelle ?? ue.code ?? "—").toUpperCase()} (MOY)`,
          styles: { fontStyle: "bold", ...zbg },
        },
        { content: fmtNote(ue.moyenne_ue), styles: { fontStyle: "bold", halign: "center", ...zbg } },
        {
          content: ueEtatLabel(ue.etat),
          styles: {
            halign: "center",
            fontStyle: "bold",
            textColor: ue.etat === "validee" ? OK : ue.etat === "rattrapage" ? AMBER : BAD,
            ...zbg,
          },
        },
        { content: String(ue.credits), styles: { halign: "center", ...zbg } },
        { content: sessionLabel(ue.session_validation), styles: { halign: "center", fontStyle: "bold", ...zbg } },
      ]);
      for (const e of ue.ecues) {
        const es = { fontSize: 9.5, ...zbg };
        body.push([
          { content: `   ${e.libelle ?? e.code ?? "—"}`, styles: es },
          { content: fmtNote(e.note_ecue), styles: { ...es, halign: "center" } },
          { content: appreciation(e.note_ecue), styles: { ...es, halign: "center" } },
          { content: e.credits != null ? String(e.credits) : "—", styles: { ...es, halign: "center" } },
          { content: sessionLabel(e.session_obtention), styles: { ...es, halign: "center" } },
        ]);
      }
    });
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 10.5,
      cellPadding: 1.2,
      lineColor: [80, 80, 80],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      valign: "middle",
    },
    headStyles: { fillColor: GREEN, textColor: [255, 255, 255], fontStyle: "bold", halign: "center", fontSize: 9.5 },
    head: [["UNITÉ D'ENSEIGNEMENTS", "Note", "Appréciation", "Crédits", "Session"]],
    body,
    columnStyles: {
      0: { cellWidth: 96 },
      1: { cellWidth: 20, halign: "center" },
      2: { cellWidth: 30, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 22, halign: "center" },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 7;
  if (y > 235) {
    doc.addPage();
    y = 20;
  }

  // ---------- Synthèse (avec rang) ----------
  const hstyle = { fontStyle: "bold", fillColor: GREEN, textColor: [255, 255, 255] as [number, number, number] };
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 10.5,
      cellPadding: 1.4,
      halign: "center",
      valign: "middle",
      lineColor: [80, 80, 80],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
    },
    body: [
      [
        { content: "Session", styles: hstyle },
        { content: "Crédits", styles: hstyle },
        { content: "Nombre d'UE validés", styles: hstyle },
        { content: "Moyenne", styles: hstyle },
        { content: "Appréciation", styles: hstyle },
      ],
      [
        { content: sessionLabel(bulletin.session_globale ?? 1) },
        { content: `${totalObtenus}/${totalUe}` },
        { content: `${bulletin.nb_ue_validees ?? 0}/${bulletin.nb_ue_total ?? 0}` },
        { content: fmtNote(bulletin.moyenne_session), styles: { fontStyle: "bold" } },
        { content: appreciation(bulletin.moyenne_session), styles: { fontStyle: "bold" } },
      ],
    ],
  });

  y = (doc as any).lastAutoTable.finalY + 7;
  doc.setFont("times", "normal");
  doc.setFontSize(11);
  doc
    .splitTextToSize(
      "En foi de quoi, il lui est délivré le présent relevé de notes pour servir et valoir ce que de droit.",
      PAGE_W - 2 * M
    )
    .forEach((ln: string) => {
      doc.text(ln, M, y);
      y += 5;
    });

  // ---------- Bas : décision · visa ----------
  y += 3;
  const topY = y;

  // Décision (aligné à gauche, colorée).
  doc.setFont("times", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(DECISION_TITRE, M, topY + 3);
  const dw = doc.getTextWidth(DECISION_TITRE);
  doc.setDrawColor(0, 0, 0);
  doc.line(M, topY + 3.8, M + dw, topY + 3.8);
  const dc = decRgb(bulletin.decision);
  doc.setFontSize(15);
  doc.setTextColor(dc[0], dc[1], dc[2]);
  doc.text(decisionLabel(bulletin.decision), M, topY + 13);
  doc.setTextColor(0, 0, 0);

  // Visa (droite) + date.
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.text(`Fait à Abidjan, le ${today}`, RIGHT, topY + 2, { align: "right" });
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.text(VISA_DIRECTEUR, RIGHT, topY + 8, { align: "right" });
  doc.line(RIGHT - doc.getTextWidth(VISA_DIRECTEUR), topY + 8.8, RIGHT, topY + 8.8);

  // ---------- Pied de page ----------
  doc.setFont("times", "normal");
  doc.setFontSize(7);
  doc.setTextColor(60, 60, 60);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.line(M, 280, RIGHT, 280);
  doc.text(doc.splitTextToSize(FOOTER_NOTE, PAGE_W - 2 * M), PAGE_W / 2, 284, { align: "center" });
  FOOTER_ADDRESS.split("\n").forEach((ln, i) =>
    doc.text(ln, PAGE_W / 2, 289 + i * 3.4, { align: "center" })
  );
  doc.setTextColor(0, 0, 0);

}

/** Filigrane (logo en transparence) appliqué sur toutes les pages du document. */
function drawWatermarkAllPages(doc: jsPDF, logoInstitut: Img | null): void {
  if (!logoInstitut) return;
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    try {
      doc.saveGraphicsState();
      (doc as any).setGState(new (doc as any).GState({ opacity: 0.06 }));
      const w = 120;
      const h = w / logoInstitut.ratio;
      doc.addImage(logoInstitut.dataUrl, "JPEG", (PAGE_W - w) / 2, (PAGE_H - h) / 2, w, h);
      doc.restoreGraphicsState();
    } catch {
      /* GState indisponible : on ignore le filigrane */
    }
  }
}

function bulletinFilename(bulletin: any): string {
  const studentName = `${bulletin.student?.last_name ?? ""} ${bulletin.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();
  const safe = (studentName || "etudiant").replace(/[^\w-]+/g, "_");
  const semSafe = String(bulletin.semestre?.libelle ?? "semestre").replace(/[^\w-]+/g, "_");
  return `Releve_de_notes_${safe}_${semSafe}.pdf`;
}

async function buildBulletinDoc(bulletin: any): Promise<{ doc: jsPDF; filename: string }> {
  const imgs = await loadHeaderImages();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  await drawBulletin(doc, bulletin, imgs);
  drawWatermarkAllPages(doc, imgs.logoInstitut);
  return { doc, filename: bulletinFilename(bulletin) };
}

/** PDF combiné : un relevé par étudiant, chacun sur sa (ses) propre(s) page(s). */
async function buildAllBulletinsDoc(bulletins: any[]): Promise<jsPDF> {
  const imgs = await loadHeaderImages();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (let i = 0; i < bulletins.length; i++) {
    if (i > 0) doc.addPage();
    await drawBulletin(doc, bulletins[i], imgs);
  }
  drawWatermarkAllPages(doc, imgs.logoInstitut);
  return doc;
}

/** Télécharge le relevé de notes en PDF. */
export async function downloadBulletinPdf(bulletin: any): Promise<void> {
  const { doc, filename } = await buildBulletinDoc(bulletin);
  doc.save(filename);
}

/**
 * Génère le PDF officiel et renvoie une URL blob pour l'aperçu embarqué
 * (iframe / object). L'appelant doit révoquer l'URL (URL.revokeObjectURL).
 */
export async function bulletinPdfObjectUrl(bulletin: any): Promise<string> {
  const { doc } = await buildBulletinDoc(bulletin);
  return URL.createObjectURL(doc.output("blob"));
}

/**
 * Ouvre le PDF combiné de TOUS les bulletins dans le navigateur.
 * `win` : onglet ouvert de façon synchrone au clic (évite le blocage popup) ;
 * si absent, un nouvel onglet est ouvert.
 */
export async function openAllBulletinsPdf(bulletins: any[], win?: Window | null): Promise<void> {
  const doc = await buildAllBulletinsDoc(bulletins);
  const url = URL.createObjectURL(doc.output("blob"));
  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Ouvre le relevé de notes comme un document PDF dans le navigateur
 * (visionneuse native), sans passer par l'interface applicative.
 * `win` : onglet ouvert de façon synchrone au clic (évite le blocage popup) ;
 * si absent, un nouvel onglet est ouvert.
 */
export async function openBulletinPdf(bulletin: any, win?: Window | null): Promise<void> {
  const { doc } = await buildBulletinDoc(bulletin);
  const url = URL.createObjectURL(doc.output("blob"));
  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
