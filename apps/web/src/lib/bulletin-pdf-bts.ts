/**
 * Export PDF du bulletin de notes de style BTS — Licence 1 et 2 uniquement
 * (feature ad hoc, hors spec 030). Même moteur (jsPDF + jspdf-autotable) et
 * même identité visuelle IPAM que le relevé LMD (bulletin-pdf.ts), mais
 * restitué en tableau UE/ECUE à plat avec un rang de classe par ligne.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  MINISTERE,
  REPUBLIQUE,
  INSTITUT,
  FOOTER_NOTE,
  FOOTER_ADDRESS,
  VISA_DIRECTEUR,
  fmtNote,
  fmtDateLongFr,
  genreLabel,
  appreciation,
  semestreLabelShort,
  specialiteBts,
  niveauBts,
  rangLabel,
  appreciationGenerale,
  IPAM_GREEN_RGB,
  IPAM_GREEN_LIGHT_RGB,
} from "./bulletin-format";
import { loadHeaderImages, kv, type HeaderImages } from "./bulletin-pdf";

const M = 12;
const PAGE_W = 210;
const PAGE_H = 297;
const RIGHT = PAGE_W - M;

const GREEN = IPAM_GREEN_RGB;
const ZEBRA: [number, number, number] = [247, 250, 248];

/** Dessine un bulletin BTS complet sur la page courante de `doc`. */
async function drawBulletinBts(doc: jsPDF, data: any, imgs: HeaderImages): Promise<void> {
  const { logoInstitut, embleme } = imgs;
  const studentName = `${data.student?.last_name ?? ""} ${data.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();

  // ---------- En-tête (même agencement que le relevé « Consulter ») ----------
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  MINISTERE.split("\n").forEach((ln, i) => doc.text(ln, M, 14 + i * 3.4));
  REPUBLIQUE.split("\n").forEach((ln, i) => doc.text(ln, RIGHT, 14 + i * 3.4, { align: "right" }));

  // Titres encadrés : BULLETIN DE NOTES / n Semestre.
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  const titre = "BULLETIN DE NOTES";
  let w = doc.getTextWidth(titre) + 10;
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.5);
  doc.rect(PAGE_W / 2 - w / 2, 16, w, 7);
  doc.text(titre, PAGE_W / 2, 20.9, { align: "center" });

  const sousTitre = semestreLabelShort(data.semestre?.libelle);
  doc.setFontSize(10.5);
  w = doc.getTextWidth(sousTitre) + 8;
  doc.rect(PAGE_W / 2 - w / 2, 25, w, 6);
  doc.text(sousTitre, PAGE_W / 2, 29.2, { align: "center" });

  // Logos de part et d'autre, année scolaire entre les deux.
  if (logoInstitut) {
    const h = 20;
    doc.addImage(logoInstitut.dataUrl, "JPEG", M, 21, h * logoInstitut.ratio, h);
  }
  if (embleme) {
    const h = 18;
    doc.addImage(embleme.dataUrl, "JPEG", RIGHT - h * embleme.ratio, 21, h * embleme.ratio, h);
  }
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(`Année scolaire : ${data.annee_academique ?? "—"}`, PAGE_W / 2, 36, { align: "center" });

  // Nom de l'institut, sous les logos.
  doc.setFont("times", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text(INSTITUT, PAGE_W / 2, 48, { align: "center" });
  doc.setTextColor(0, 0, 0);

  // ---------- Bloc identité ----------
  let y = 56;
  const COL2 = 118;
  kv(doc, "Nom et prénoms", studentName || "—", M, y, true);
  y += 6;
  kv(doc, "Spécialité", specialiteBts(data.filiere?.name), M, y);
  kv(doc, "Niveau", niveauBts(data.filiere?.name), COL2, y);
  y += 6;
  const neLe = `${fmtDateLongFr(data.student?.date_of_birth)}${
    data.student?.place_of_birth ? ` à ${data.student.place_of_birth}` : ""
  }`;
  kv(doc, "Né(e) le", neLe, M, y);
  kv(doc, "Matricule", String(data.student?.matricule ?? "—"), COL2, y);
  y += 6;
  kv(doc, "Genre", genreLabel(data.student?.gender), M, y);
  kv(doc, "Redoublant(e)", data.student?.is_repeating ? "OUI" : "NON", COL2, y);
  y += 8;

  // ---------- Tableau des disciplines (UE en gras + ECUE en sous-ligne) ----------
  const body: any[] = [];
  (data.disciplines ?? []).forEach((ue: any, i: number) => {
    const zbg = i % 2 === 1 ? { fillColor: ZEBRA } : {};
    body.push([
      { content: (ue.libelle ?? "—").toUpperCase(), styles: { fontStyle: "bold", ...zbg } },
      { content: fmtNote(ue.moyenne), styles: { fontStyle: "bold", halign: "center", ...zbg } },
      { content: ue.coeff != null ? String(ue.coeff) : "—", styles: { halign: "center", ...zbg } },
      { content: fmtNote(ue.moyenne_ponderee), styles: { halign: "center", fontStyle: "bold", ...zbg } },
      { content: rangLabel(ue.rang), styles: { halign: "center", fontStyle: "bold", ...zbg } },
      { content: appreciation(ue.moyenne), styles: { halign: "center", ...zbg } },
    ]);
    (ue.ecues ?? []).forEach((e: any) => {
      const es = { fontSize: 9.5, ...zbg };
      body.push([
        { content: `   ${e.libelle ?? "—"}`, styles: es },
        { content: fmtNote(e.moyenne), styles: { ...es, halign: "center" } },
        { content: e.coeff != null ? String(e.coeff) : "—", styles: { ...es, halign: "center" } },
        { content: fmtNote(e.moyenne_ponderee), styles: { ...es, halign: "center" } },
        { content: rangLabel(e.rang), styles: { ...es, halign: "center" } },
        { content: appreciation(e.moyenne), styles: { ...es, halign: "center" } },
      ]);
    });
  });

  // ---------- Savoir être (Assiduité + Conduite) — même tableau ----------
  const savoirEtre: any[] = data.savoir_etre ?? [];
  if (savoirEtre.length > 0) {
    body.push([
      {
        content: "SAVOIR ÊTRE",
        colSpan: 6,
        styles: { fontStyle: "bold", fillColor: IPAM_GREEN_LIGHT_RGB, textColor: GREEN },
      },
    ]);
    savoirEtre.forEach((row: any) => {
      body.push([
        { content: (row.libelle ?? "—").toUpperCase(), styles: { fontStyle: "bold" } },
        { content: fmtNote(row.moyenne), styles: { fontStyle: "bold", halign: "center" } },
        { content: row.coeff != null ? String(row.coeff) : "—", styles: { halign: "center" } },
        { content: fmtNote(row.moyenne_ponderee), styles: { halign: "center", fontStyle: "bold" } },
        { content: rangLabel(row.rang), styles: { halign: "center", fontStyle: "bold" } },
        { content: appreciation(row.moyenne), styles: { halign: "center" } },
      ]);
    });
    const seCoeff = savoirEtre.reduce((s, r) => s + (r.coeff ?? 0), 0);
    const seTotal = savoirEtre.reduce((s, r) => s + (r.moyenne_ponderee ?? 0), 0);
    const seMoyenne = seCoeff > 0 ? seTotal / seCoeff : null;
    body.push([
      { content: "Total Savoir être", styles: { fontStyle: "bold", fillColor: ZEBRA } },
      { content: fmtNote(seMoyenne), styles: { fontStyle: "bold", halign: "center", fillColor: ZEBRA } },
      { content: String(seCoeff), styles: { halign: "center", fillColor: ZEBRA } },
      { content: fmtNote(seTotal), styles: { fontStyle: "bold", halign: "center", fillColor: ZEBRA } },
      { content: "", styles: { fillColor: ZEBRA } },
      { content: appreciation(seMoyenne), styles: { halign: "center", fillColor: ZEBRA } },
    ]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 10,
      cellPadding: 1,
      lineColor: [80, 80, 80],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      valign: "middle",
    },
    headStyles: {
      fillColor: GREEN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
      fontSize: 8.5,
      cellPadding: 1.6,
    },
    head: [["DISCIPLINES", "MOYENNE", "COEFF.", "MOY. PONDÉRÉE", "RANG", "APPRÉCIATIONS"]],
    body,
    columnStyles: {
      // Col. 0 volontairement large + police compacte : évite qu'un intitulé
      // d'UE/catégorie long (ex. « MATHÉMATIQUES FONDAMENTALES ») ne
      // retourne à la ligne dans la cellule. Les autres colonnes sont
      // dimensionnées pour que leur en-tête tienne sur une seule ligne.
      0: { cellWidth: 76, fontSize: 9 },
      1: { cellWidth: 22, halign: "center" },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 26, halign: "center" },
      4: { cellWidth: 16, halign: "center" },
      5: { cellWidth: 30, halign: "center" },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 4;
  if (y > 215) {
    doc.addPage();
    y = 20;
  }

  // ---------- Absences ----------
  const COL2B = 118;
  kv(doc, "Absences justifiées", String(data.absences?.justifiees ?? 0), M, y);
  kv(doc, "Absences non justifiées", String(data.absences?.non_justifiees ?? 0), COL2B, y);
  y += 5.5;

  // ---------- Synthèse semestrielle ----------
  const hstyle = { fontStyle: "bold", fillColor: GREEN, textColor: [255, 255, 255] as [number, number, number] };
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: "grid",
    styles: {
      font: "times",
      fontSize: 10,
      cellPadding: 1,
      halign: "center",
      valign: "middle",
      lineColor: [80, 80, 80],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
    },
    body: [
      [
        { content: "Total des points", styles: hstyle },
        { content: "Moyenne semestrielle", styles: hstyle },
        { content: "Rang", styles: hstyle },
      ],
      [
        { content: fmtNote(data.total_points) },
        { content: fmtNote(data.moyenne_session), styles: { fontStyle: "bold" } },
        { content: rangLabel(data.rang), styles: { fontStyle: "bold" } },
      ],
    ],
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  // ---------- Distinctions (gauche) + Bilan annuel (droite), même ligne ----------
  if (y > 245) {
    doc.addPage();
    y = 20;
  }
  const gutter = 4;
  const halfW = (RIGHT - M - gutter) / 2;
  const leftMarginRight = PAGE_W - (M + halfW);
  const rightMarginLeft = M + halfW + gutter;

  const dist = data.distinction ?? {};
  const distRows: [string, boolean][] = [
    ["Tableau d'honneur", !!dist.tableau_honneur],
    ["Tableau d'honneur + Encouragement", !!dist.tableau_honneur_encouragement],
    ["Avertissement", !!dist.avertissement],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: leftMarginRight },
    theme: "grid",
    styles: { font: "times", fontSize: 9, cellPadding: 1.1, lineColor: [80, 80, 80], lineWidth: 0.2, textColor: [0, 0, 0] },
    head: [[{ content: "Distinctions", styles: hstyle, colSpan: 2 }]],
    body: distRows.map(([label, marked]) => [
      { content: label },
      { content: marked ? "X" : "", styles: { halign: "center", fontStyle: "bold" } },
    ]),
    columnStyles: { 1: { cellWidth: 16, halign: "center" } },
  });
  const yLeft = (doc as any).lastAutoTable.finalY;

  // Bilan annuel (dernier semestre de la filière uniquement) : semestres +
  // ligne « Moyenne annuelle » en gras, sans colonne Crédits.
  let yRight = y;
  if (data.annuel) {
    const semRows = (data.annuel.semestres ?? []).map((s: any) => [
      { content: s.libelle ?? "—" },
      { content: fmtNote(s.moyenne_session) },
      { content: rangLabel(s.rang) },
    ]);
    autoTable(doc, {
      startY: y,
      margin: { left: rightMarginLeft, right: M },
      theme: "grid",
      styles: {
        font: "times",
        fontSize: 9,
        cellPadding: 1.1,
        halign: "center",
        lineColor: [80, 80, 80],
        lineWidth: 0.2,
        textColor: [0, 0, 0],
      },
      head: [[
        { content: "Bilan annuel", styles: hstyle, colSpan: 3 },
      ], [
        { content: "Semestre", styles: hstyle },
        { content: "Moyenne", styles: hstyle },
        { content: "Rang", styles: hstyle },
      ]],
      body: [
        ...semRows,
        [
          { content: "Moyenne annuelle", styles: { fontStyle: "bold", fillColor: ZEBRA } },
          { content: fmtNote(data.annuel.moyenne), styles: { fontStyle: "bold", fillColor: ZEBRA } },
          { content: rangLabel(data.annuel.rang), styles: { fontStyle: "bold", fillColor: ZEBRA } },
        ],
      ],
    });
    yRight = (doc as any).lastAutoTable.finalY;
  }
  y = Math.max(yLeft, yRight) + 5;

  // ---------- Appréciation du conseil (pleine largeur) ----------
  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text("Appréciation du conseil", M, y);
  doc.setFont("times", "italic");
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.text(appreciationGenerale(data.moyenne_session), M + 48, y);
  y += 8;

  // ---------- Fait à ... / Visa le Directeur des Études ----------
  if (y > 266) {
    doc.addPage();
    y = 20;
  }
  const officialDate = data.generated_at ? new Date(data.generated_at) : new Date();
  const dateLabel = officialDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(0, 0, 0);
  doc.text(`Fait à Abidjan, le ${dateLabel}`, RIGHT, y, { align: "right" });
  y += 7;
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.text(VISA_DIRECTEUR, RIGHT, y, { align: "right" });
  doc.line(RIGHT - doc.getTextWidth(VISA_DIRECTEUR), y + 0.8, RIGHT, y + 0.8);

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

/** Filigrane (logo en transparence). */
function drawWatermark(doc: jsPDF, logoInstitut: HeaderImages["logoInstitut"]): void {
  if (!logoInstitut) return;
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

function bulletinBtsFilename(data: any): string {
  const studentName = `${data.student?.last_name ?? ""} ${data.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();
  const safe = (studentName || "etudiant").replace(/[^\w-]+/g, "_");
  const semSafe = String(data.semestre?.libelle ?? "semestre").replace(/[^\w-]+/g, "_");
  return `Bulletin_BTS_${safe}_${semSafe}.pdf`;
}

async function buildBulletinBtsDoc(data: any): Promise<{ doc: jsPDF; filename: string }> {
  const imgs = await loadHeaderImages();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  await drawBulletinBts(doc, data, imgs);
  drawWatermark(doc, imgs.logoInstitut);
  return { doc, filename: bulletinBtsFilename(data) };
}

/**
 * Ouvre le bulletin BTS comme document PDF dans le navigateur.
 * `win` : onglet ouvert de façon synchrone au clic (évite le blocage popup) ;
 * si absent, un nouvel onglet est ouvert.
 */
export async function openBulletinBtsPdf(data: any, win?: Window | null): Promise<void> {
  const { doc } = await buildBulletinBtsDoc(data);
  const url = URL.createObjectURL(doc.output("blob"));
  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Télécharge le bulletin BTS en PDF. */
export async function downloadBulletinBtsPdf(data: any): Promise<void> {
  const { doc, filename } = await buildBulletinBtsDoc(data);
  doc.save(filename);
}
