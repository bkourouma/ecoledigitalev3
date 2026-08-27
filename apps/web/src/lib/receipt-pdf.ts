/**
 * Reçu de paiement PDF — Module Professionnel.
 * Document A4 vectoriel aux couleurs IPAM, au design propre de reçu (distinct
 * du relevé de notes) : en-tête institut, titre + n° de reçu, panneau étudiant,
 * montant mis en avant (+ montant en lettres), détail des UE, situation
 * financière, signatures. jsPDF + jspdf-autotable.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { INSTITUT, LOGO_INSTITUT } from "./bulletin-format";

/** Emblème utilisé sur le reçu (PNG détouré, agrandi par rapport au bulletin). */
const LOGO_RECU_EMBLEME = "/embleme.png";

const M = 14;
const PAGE_W = 210;
const PAGE_H = 297;
const RIGHT = PAGE_W - M;
const W = PAGE_W - 2 * M;

const GREEN: [number, number, number] = [20, 83, 45];
const GREEN_DARK: [number, number, number] = [12, 59, 32];
const LIGHT: [number, number, number] = [237, 244, 239];
const OK: [number, number, number] = [21, 128, 61];
const AMBER: [number, number, number] = [180, 83, 9];
const GRAY: [number, number, number] = [95, 105, 100];
const INK: [number, number, number] = [25, 30, 28];

const MODE_LABEL: Record<string, string> = {
  especes: "Espèces",
  mobile_money: "Mobile Money",
  virement: "Virement bancaire",
  autre: "Autre",
};

interface Img {
  dataUrl: string;
  ratio: number;
  /** Format jsPDF déduit du type MIME (« PNG » conserve la transparence). */
  format: "PNG" | "JPEG";
}
async function loadImg(url: string): Promise<Img | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const format: "PNG" | "JPEG" = blob.type.includes("png") ? "PNG" : "JPEG";
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
    return { dataUrl, ratio, format };
  } catch {
    return null;
  }
}

/**
 * Montant « 1 250 000 FCFA » avec espaces SIMPLES : `toLocaleString("fr-FR")`
 * insère des espaces insécables étroites (U+202F) que les polices de jsPDF ne
 * savent pas encoder (glyphes « &…& » illisibles).
 */
function fmtFCFA(v?: number | null): string {
  const n = Math.round(Number(v ?? 0));
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} FCFA`;
}

function fmtDateLong(value?: string | null): string {
  const d = value ? new Date(value) : new Date();
  const base = (isNaN(d.getTime()) ? new Date() : d).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return base.replace(/ ([a-zà-ú])/i, (m) => m.toUpperCase());
}

/* --------------------- Montant en toutes lettres (FR) --------------------- */

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept",
  "dix-huit", "dix-neuf",
];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "", "", ""];

function below100(n: number): string {
  if (n < 20) return UNITS[n];
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return TENS[t];
    if (u === 1 && t !== 8) return `${TENS[t]} et un`;
    return `${TENS[t]}-${UNITS[u]}`;
  }
  if (n < 80) {
    const u = n - 60;
    if (u === 11) return "soixante et onze";
    return `soixante-${below100(u)}`;
  }
  const u = n - 80;
  if (u === 0) return "quatre-vingts";
  return `quatre-vingt-${below100(u)}`;
}

function below1000(n: number): string {
  if (n < 100) return below100(n);
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (r === 0) return c === 1 ? "cent" : `${UNITS[c]} cents`;
  return `${c === 1 ? "cent" : `${UNITS[c]} cent`} ${below100(r)}`;
}

/** 1234567 → « un million deux cent trente-quatre mille cinq cent soixante-sept ». */
function montantEnLettres(n: number): string {
  const val = Math.round(Math.abs(n));
  if (val === 0) return "zéro";
  const parts: string[] = [];
  const millions = Math.floor(val / 1_000_000);
  const milliers = Math.floor((val % 1_000_000) / 1000);
  const reste = val % 1000;
  if (millions > 0) parts.push(millions === 1 ? "un million" : `${below1000(millions)} millions`);
  if (milliers > 0) {
    // « vingt » et « cent » sont invariables devant « mille ».
    const mil = below1000(milliers).replace(/ts$/, "t");
    parts.push(milliers === 1 ? "mille" : `${mil} mille`);
  }
  if (reste > 0) parts.push(below1000(reste));
  return parts.join(" ");
}

/* ------------------------------ Types d'entrée ---------------------------- */

export interface ReceiptData {
  receipt_number?: string | null;
  reference_transaction?: string | null;
  montant: number;
  mode?: string | null;
  paid_at?: string | null;
  student: { first_name?: string; last_name?: string; matricule?: string | null };
  filiere?: { nom?: string | null; code?: string | null } | null;
  /** Total dû (toutes UE du lot). */
  total_du: number;
  /** Total payé cumulé à l'émission de ce reçu (inclus). */
  total_paye: number;
  ues?: { libelle?: string | null; code?: string | null; montant?: number | null }[];
}

/* ------------------------------- Dessin PDF ------------------------------- */

function setColor(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}

async function drawReceipt(
  doc: jsPDF,
  data: ReceiptData,
  imgs: { logoInstitut: Img | null; embleme: Img | null }
): Promise<void> {
  const { logoInstitut, embleme } = imgs;
  const studentName = `${data.student?.last_name ?? ""} ${data.student?.first_name ?? ""}`
    .trim()
    .toUpperCase();
  const dateStr = fmtDateLong(data.paid_at);
  const reste = Math.max(0, Number(data.total_du) - Number(data.total_paye));
  const solde = reste <= 0.5;

  doc.setFont("helvetica", "normal");

  // ---------- En-tête institut ----------
  if (logoInstitut) {
    const h = 21;
    doc.addImage(logoInstitut.dataUrl, logoInstitut.format, M, 11, h * logoInstitut.ratio, h);
  }
  if (embleme) {
    const h = 18; // Emblème agrandi (auparavant 13).
    doc.addImage(
      embleme.dataUrl,
      embleme.format,
      RIGHT - h * embleme.ratio,
      9,
      h * embleme.ratio,
      h
    );
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.5);
  setColor(doc, GREEN);
  const nameLines: string[] = doc.splitTextToSize(INSTITUT, 128);
  nameLines.forEach((ln, i) => doc.text(ln, PAGE_W / 2 + 4, 17 + i * 5.6, { align: "center" }));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.3);
  setColor(doc, GRAY);
  doc.text("Abidjan – Cocody, II Plateaux · 06 BP 2708 Abidjan 06", PAGE_W / 2 + 4, 26, {
    align: "center",
  });
  doc.text("Tél. : (225) 27 22-25-49-31 · www.ipam.ci · info@ipam.ci", PAGE_W / 2 + 4, 30, {
    align: "center",
  });

  // Double filet vert.
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.9);
  doc.line(M, 36, RIGHT, 36);
  doc.setLineWidth(0.25);
  doc.line(M, 37.4, RIGHT, 37.4);

  // ---------- Titre + n° de reçu ----------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  setColor(doc, GREEN_DARK);
  doc.text("REÇU DE PAIEMENT", PAGE_W / 2, 48, { align: "center" });

  // Pastille n° de reçu, centrée.
  const rn = `N° ${data.receipt_number ?? "—"}`;
  doc.setFontSize(10.5);
  const rw = doc.getTextWidth(rn) + 12;
  doc.setFillColor(LIGHT[0], LIGHT[1], LIGHT[2]);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(PAGE_W / 2 - rw / 2, 51.5, rw, 8, 4, 4, "FD");
  setColor(doc, GREEN);
  doc.text(rn, PAGE_W / 2, 56.7, { align: "center" });

  // Méta : date (gauche) · mode (droite) · référence éventuelle.
  let y = 67;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setColor(doc, INK);
  doc.text(`Date : ${dateStr}`, M, y);
  const modeTxt = `Mode de règlement : ${MODE_LABEL[data.mode ?? ""] ?? data.mode ?? "—"}`;
  doc.text(modeTxt, RIGHT, y, { align: "right" });
  if (data.reference_transaction) {
    y += 5.5;
    setColor(doc, GRAY);
    doc.setFontSize(9);
    doc.text(`Référence de transaction : ${data.reference_transaction}`, M, y);
    setColor(doc, INK);
  }
  y += 6;

  // ---------- Panneau étudiant ----------
  const panelH = 27;
  doc.setFillColor(LIGHT[0], LIGHT[1], LIGHT[2]);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, W, panelH, 2, 2, "FD");
  // Liseré vertical gauche.
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(M, y + 1.5, 1.6, panelH - 3, "F");

  const px = M + 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  setColor(doc, GREEN);
  doc.text("REÇU DE", px, y + 6.5);
  doc.setFontSize(13);
  setColor(doc, INK);
  doc.text(studentName || "—", px, y + 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setColor(doc, GRAY);
  const matricule = data.student?.matricule ? `Matricule : ${data.student.matricule}` : "";
  const filiere = `Filière : ${data.filiere?.nom ?? "—"}${
    data.filiere?.code ? ` (${data.filiere.code})` : ""
  }`;
  doc.text([matricule, filiere].filter(Boolean).join("      "), px, y + 20, {
    maxWidth: W - 14,
  });
  y += panelH + 6;

  // ---------- Montant reçu ----------
  const amtH = 16;
  doc.setFillColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.roundedRect(M, y, W, amtH, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("MONTANT REÇU", M + 7, y + 10);
  doc.setFontSize(18);
  doc.text(fmtFCFA(data.montant), RIGHT - 7, y + 10.8, { align: "right" });
  y += amtH + 5;

  // Montant en lettres.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9.5);
  setColor(doc, GRAY);
  const lettres = `Soit : ${montantEnLettres(data.montant)} francs CFA.`;
  (doc.splitTextToSize(lettres, W) as string[]).forEach((ln) => {
    doc.text(ln, M, y);
    y += 4.4;
  });
  y += 2.5;

  // ---------- Détail des UE ----------
  const ues = data.ues ?? [];
  if (ues.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    setColor(doc, GREEN);
    doc.text("OBJET DU PAIEMENT — UNITÉS D'ENSEIGNEMENT", M, y);
    y += 2.5;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: { top: 1.4, bottom: 1.4, left: 3, right: 3 },
        textColor: INK,
        valign: "middle",
      },
      headStyles: {
        fillColor: GREEN,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: LIGHT },
      head: [["N°", "Unité d'enseignement (UE)", "Montant"]],
      body: [
        ...ues.map((u, i) => [
          { content: String(i + 1), styles: { halign: "center" as const } },
          { content: (u.libelle ?? u.code ?? "—").toString() },
          { content: fmtFCFA(u.montant), styles: { halign: "right" as const } },
        ]),
        [
          { content: "", styles: {} },
          {
            content: "Total dû",
            styles: { fontStyle: "bold" as const, halign: "right" as const },
          },
          {
            content: fmtFCFA(data.total_du),
            styles: { fontStyle: "bold" as const, halign: "right" as const },
          },
        ],
      ],
      columnStyles: {
        0: { cellWidth: 12, halign: "center" },
        1: { cellWidth: "auto" },
        2: { cellWidth: 42, halign: "right" },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ---------- Situation financière : 4 cases ----------
  const gap = 4;
  const boxW = (W - 3 * gap) / 4;
  const boxH = 17;
  const boxes: { label: string; value: string; color?: [number, number, number] }[] = [
    { label: "TOTAL DÛ", value: fmtFCFA(data.total_du) },
    { label: "RÉGLÉ À CE JOUR", value: fmtFCFA(data.total_paye), color: OK },
    { label: "RESTE À PAYER", value: fmtFCFA(reste), color: solde ? OK : AMBER },
    { label: "SITUATION", value: solde ? "SOLDÉ" : "PARTIEL", color: solde ? OK : AMBER },
  ];
  boxes.forEach((b, i) => {
    const bx = M + i * (boxW + gap);
    doc.setFillColor(252, 253, 252);
    doc.setDrawColor(200, 214, 205);
    doc.setLineWidth(0.3);
    doc.roundedRect(bx, y, boxW, boxH, 1.8, 1.8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    setColor(doc, GRAY);
    doc.text(b.label, bx + boxW / 2, y + 5.4, { align: "center" });
    doc.setFontSize(10.2);
    setColor(doc, b.color ?? INK);
    doc.text(b.value, bx + boxW / 2, y + 12.4, { align: "center" });
  });
  y += boxH + 8;

  // ---------- Mention légale ----------
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  setColor(doc, INK);
  (doc.splitTextToSize(
    "Le présent reçu est délivré pour servir et valoir ce que de droit. Il atteste du règlement mentionné ci-dessus.",
    W
  ) as string[]).forEach((ln) => {
    doc.text(ln, M, y);
    y += 4.6;
  });
  y += 6;

  doc.setFontSize(10);
  setColor(doc, INK);
  doc.text(`Fait à Abidjan, le ${dateStr}`, RIGHT, y, { align: "right" });

  // ---------- Pied de page ----------
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setLineWidth(0.4);
  doc.line(M, 283, RIGHT, 283);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  setColor(doc, GRAY);
  doc.text(
    "Institut Polyvalent des Affaires et du Management — Reçu généré par la plateforme de gestion IPAM.",
    PAGE_W / 2,
    288,
    { align: "center" }
  );
  doc.setTextColor(0, 0, 0);
}

function drawWatermark(doc: jsPDF, logoInstitut: Img | null): void {
  if (!logoInstitut) return;
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    try {
      doc.saveGraphicsState();
      (doc as any).setGState(new (doc as any).GState({ opacity: 0.045 }));
      const w = 110;
      const h = w / logoInstitut.ratio;
      doc.addImage(logoInstitut.dataUrl, logoInstitut.format, (PAGE_W - w) / 2, (PAGE_H - h) / 2, w, h);
      doc.restoreGraphicsState();
    } catch {
      /* GState indisponible : filigrane ignoré */
    }
  }
}

function receiptFilename(data: ReceiptData): string {
  const name = `${data.student?.last_name ?? ""}_${data.student?.first_name ?? ""}`
    .trim()
    .replace(/[^\w-]+/g, "_");
  const rn = String(data.receipt_number ?? "recu").replace(/[^\w-]+/g, "_");
  return `Recu_${rn}_${name || "etudiant"}.pdf`;
}

async function buildReceiptDoc(data: ReceiptData): Promise<{ doc: jsPDF; filename: string }> {
  const [logoInstitut, embleme] = await Promise.all([
    loadImg(LOGO_INSTITUT),
    loadImg(LOGO_RECU_EMBLEME),
  ]);
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  await drawReceipt(doc, data, { logoInstitut, embleme });
  drawWatermark(doc, logoInstitut);
  return { doc, filename: receiptFilename(data) };
}

/** Télécharge le reçu de paiement en PDF. */
export async function downloadReceiptPdf(data: ReceiptData): Promise<void> {
  const { doc, filename } = await buildReceiptDoc(data);
  doc.save(filename);
}

/**
 * Ouvre le reçu de paiement comme un document PDF dans le navigateur.
 * `win` : onglet ouvert de façon synchrone au clic (évite le blocage popup).
 */
/**
 * URL objet du reçu, à afficher dans une visionneuse applicative.
 * L'appelant est responsable de la révoquer.
 */
export async function receiptPdfObjectUrl(data: ReceiptData): Promise<string> {
  const { doc } = await buildReceiptDoc(data);
  return URL.createObjectURL(doc.output("blob"));
}

export async function openReceiptPdf(data: ReceiptData, win?: Window | null): Promise<void> {
  const { doc } = await buildReceiptDoc(data);
  const url = URL.createObjectURL(doc.output("blob"));
  if (win) win.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
