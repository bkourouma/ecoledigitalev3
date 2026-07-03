/**
 * Export PDF du relevé de notes — Module Professionnel (feature 030).
 * PDF vectoriel A4 : identité IPAM (vert), filigrane, tableau UE→ECUE groupé
 * par catégorie, zébrage, statuts colorés, synthèse (rang), décision colorée,
 * QR de vérification, cachet. jsPDF + jspdf-autotable + qrcode.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import QRCode from "qrcode";
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
  ueDecision,
  niveauOf,
  fmtDateLongFr,
  genreLabel,
  decisionLabel,
  semestreOrdinalFr,
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

interface Img {
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

function kv(doc: jsPDF, label: string, value: string, x: number, y: number, valueBold = false) {
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

export async function downloadBulletinPdf(bulletin: any): Promise<void> {
  const [logoInstitut, embleme] = await Promise.all([loadImg(LOGO_INSTITUT), loadImg(LOGO_EMBLEME)]);
  let qrData = "";
  try {
    qrData = await QRCode.toDataURL(String(bulletin.reference ?? ""), { margin: 0, width: 200 });
  } catch {
    qrData = "";
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const studentName = `${bulletin.student?.last_name ?? ""} ${bulletin.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();
  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const totalObtenus = bulletin.credits_valides ?? 0;
  const totalUe = bulletin.credits_total ?? 0;

  // ---------- En-tête ----------
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  MINISTERE.split("\n").forEach((ln, i) => doc.text(ln, M, 14 + i * 3.4));
  REPUBLIQUE.split("\n").forEach((ln, i) => doc.text(ln, RIGHT, 14 + i * 3.4, { align: "right" }));

  doc.setFont("times", "bold");
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setFontSize(15);
  doc.text("BULLETIN DE NOTES", PAGE_W / 2, 16, { align: "center" });
  const ordinal = semestreOrdinalFr(bulletin.semestre?.libelle);
  doc.setFontSize(11);
  const ow = doc.getTextWidth(ordinal) + 10;
  doc.setLineWidth(0.5);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(PAGE_W / 2 - ow / 2, 18.5, ow, 6);
  doc.text(ordinal, PAGE_W / 2, 22.6, { align: "center" });
  doc.setTextColor(0, 0, 0);

  if (logoInstitut) {
    const h = 22;
    doc.addImage(logoInstitut.dataUrl, "JPEG", M, 21, h * logoInstitut.ratio, h);
  }
  if (embleme) {
    const h = 19;
    doc.addImage(embleme.dataUrl, "JPEG", RIGHT - h * embleme.ratio, 21, h * embleme.ratio, h);
  }

  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.text(
    `Année scolaire : ${bulletin.annee_academique ?? "—"}        Effectif : ${bulletin.effectif ?? "—"}`,
    PAGE_W / 2,
    30,
    { align: "center" }
  );

  // Institut (gras, vert).
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text(INSTITUT, PAGE_W / 2, 46, { align: "center" });
  doc.setTextColor(0, 0, 0);

  // ---------- Bloc scolarité ----------
  let y = 54;
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
  kv(doc, "Filière", String(bulletin.filiere?.name ?? "—"), M, y);
  kv(doc, "Redoublant(e)", bulletin.student?.is_repeating ? "OUI" : "NON", COL2, y);
  y += 5.8;
  kv(doc, "Niveau", niveauOf(bulletin.filiere?.name), M, y);
  y += 6;

  // ---------- Tableau (catégories + UE + ECUE) ----------
  const catList =
    bulletin.categories?.length > 0
      ? bulletin.categories
      : [{ key: "_all", ues: bulletin.ues ?? [], credits_obtenus: totalObtenus, credits_ue: totalUe }];
  const body: any[] = [];
  for (const cat of catList) {
    cat.ues.forEach((ue: any, i: number) => {
      const zbg = i % 2 === 1 ? { fillColor: ZEBRA } : {};
      const obtenus = ue.validee ? ue.credits : 0;
      body.push([
        { content: (ue.libelle ?? ue.code ?? "—").toUpperCase(), colSpan: 4, styles: { fontStyle: "bold", ...zbg } },
        { content: fmtNote(ue.moyenne_ue), styles: { fontStyle: "bold", halign: "center", ...zbg } },
        {
          content: ueDecision(ue.validee),
          styles: { halign: "center", fontStyle: "bold", textColor: ue.validee ? OK : BAD, ...zbg },
        },
        { content: String(obtenus), styles: { halign: "center", ...zbg } },
        { content: String(ue.credits), styles: { halign: "center", ...zbg } },
      ]);
      for (const e of ue.ecues) {
        const es = { fontSize: 9.5, ...zbg };
        body.push([
          { content: `   ${e.libelle ?? e.code ?? "—"}`, styles: es },
          { content: fmtNote(e.moyenne_devoirs), styles: { ...es, halign: "center" } },
          { content: fmtNote(e.note_examen), styles: { ...es, halign: "center" } },
          { content: fmtNote(e.note_ecue), styles: { ...es, halign: "center" } },
          { content: "", styles: zbg },
          { content: appreciation(e.note_ecue), styles: { ...es, halign: "center" } },
          { content: "", styles: zbg },
          { content: "", styles: zbg },
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
    head: [
      [
        "UNITÉ D'ENSEIGNEMENTS",
        "Contrôle continu",
        "Examen",
        "Moyenne ECUE",
        "Moyenne UE",
        "Appréciation",
        "Crédits obtenus",
        "Crédit UE",
      ],
    ],
    body,
    columnStyles: {
      0: { cellWidth: 56 },
      1: { cellWidth: 18, halign: "center" },
      2: { cellWidth: 15, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 26, halign: "center" },
      6: { cellWidth: 20, halign: "center" },
      7: { cellWidth: 17, halign: "center" },
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
        { content: "Rang", styles: hstyle },
        { content: "Moyenne", styles: hstyle },
        { content: "Appréciation", styles: hstyle },
      ],
      [
        { content: "Session 1" },
        { content: `${totalObtenus}/${totalUe}` },
        { content: `${bulletin.nb_ue_validees ?? 0}/${bulletin.nb_ue_total ?? 0}` },
        { content: bulletin.rang ? `${bulletin.rang}/${bulletin.effectif ?? "—"}` : "—" },
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

  // ---------- Bas : QR/réf · décision · visa ----------
  y += 3;
  const topY = y;
  if (qrData) doc.addImage(qrData, "PNG", M, y, 22, 22);
  doc.setFont("times", "normal");
  doc.setFontSize(8);
  doc.text(`N° ${bulletin.reference ?? "—"}`, M, y + 25);

  // Décision (centre, colorée).
  doc.setFont("times", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(DECISION_TITRE, PAGE_W / 2, topY + 3, { align: "center" });
  const dw = doc.getTextWidth(DECISION_TITRE);
  doc.setDrawColor(0, 0, 0);
  doc.line(PAGE_W / 2 - dw / 2, topY + 3.8, PAGE_W / 2 + dw / 2, topY + 3.8);
  const dc = decRgb(bulletin.decision);
  doc.setFontSize(15);
  doc.setTextColor(dc[0], dc[1], dc[2]);
  doc.text(decisionLabel(bulletin.decision), PAGE_W / 2, topY + 13, { align: "center" });
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

  // ---------- Filigrane (overlay léger) ----------
  if (logoInstitut) {
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

  const safe = (studentName || "etudiant").replace(/[^\w-]+/g, "_");
  const semSafe = String(bulletin.semestre?.libelle ?? "semestre").replace(/[^\w-]+/g, "_");
  doc.save(`Releve_de_notes_${safe}_${semSafe}.pdf`);
}
