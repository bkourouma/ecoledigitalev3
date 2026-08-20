/**
 * Export PDF du bulletin de paie enseignant — composé DANS LE NAVIGATEUR.
 *
 * POURQUOI CÔTÉ CLIENT
 * La voie serveur (`/api/teacher-payments/:id/pdf` → Puppeteer) renvoyait un
 * 504 Gateway Time-out en production : Puppeteer 21 dialogue avec Chrome 121,
 * or l'image Alpine fournit Chromium 136 — l'écart casse le protocole CDP et
 * la génération reste bloquée jusqu'à l'expiration de nginx.
 *
 * Les bulletins de notes n'ont jamais connu ce problème parce qu'ils sont
 * dessinés ici même, avec jsPDF (`bulletin-pdf.ts`). On applique le même
 * principe : aucun navigateur headless, aucun délai à franchir, et le PDF
 * s'ouvre instantanément.
 *
 * Les données viennent de `/api/v1/teacher-payments/:id/payslip-data`, qui
 * expose le `PayslipData` déjà assemblé côté serveur — celui-là même qui
 * alimentait le gabarit HTML. Seule la mise en page change de camp.
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { createApiHeaders } from "@/lib/api-utils";
import { loadHeaderImages, kv, type HeaderImages } from "@/lib/bulletin-pdf";
import {
  INSTITUT,
  IPAM_GREEN_RGB,
  IPAM_GREEN_LIGHT_RGB,
} from "@/lib/bulletin-format";

/* ------------------------------ Mise en page ---------------------------- */

const M = 12;
const PAGE_W = 210;
const PAGE_H = 297;
const RIGHT = PAGE_W - M;

const GREEN = IPAM_GREEN_RGB;
const ZEBRA = IPAM_GREEN_LIGHT_RGB;
const NOIR: [number, number, number] = [17, 17, 17];
const GRIS: [number, number, number] = [85, 85, 85];

/* ------------------------------- Données -------------------------------- */

/** Reflet de `PayslipData` (apps/api/src/services/teacher-payslip-template.service.ts). */
export interface PayslipData {
  paiementId: string;
  statut: string;
  devise: string;
  enseignantNom: string;
  enseignantEmail: string | null;
  enseignantMatricule: string | null;
  periodeNom: string;
  periodeDebut: string;
  periodeFin: string;
  typePaiement: string;
  montantBase: number;
  montantHeuresSup: number;
  primes: number;
  retenues: number;
  montantTotal: number;
  heuresNormales: number;
  heuresSup: number;
  tauxNormal: number | null;
  config: Record<string, any> | null;
  joursOuvres: number;
  joursPeriode: number;
  etablissementNom: string;
  etablissementContact: string | null;
  anneeScolaire: string | null;
  genereLe: string;
  tutelleMinistere: string;
  tutelleDirection: string;
  republique: string;
  devise_republique: string;
  villeSignature: string;
}

/* ------------------------------ Formatage ------------------------------- */

const nombre = (v: number, decimales = 0): string =>
  new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(v || 0);

const montant = (v: number, devise: string): string =>
  `${nombre(Math.round(v || 0))} ${devise}`;

const heures = (v: number): string => {
  const n = Number(v || 0);
  return Number.isInteger(n) ? `${nombre(n)} h` : `${nombre(n, 2)} h`;
};

const jour = (v: string | null): string => {
  if (!v) return "—";
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR");
};

/* --------------------- Montant en toutes lettres ------------------------ */
/* Repris de teacher-payslip-template.service.ts : un bulletin de paie porte
   le net en lettres, c'est ce qui fait foi en cas de contestation. */

const UNITES = [
  "", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
  "dix-sept", "dix-huit", "dix-neuf",
];
const DIZAINES = [
  "", "", "vingt", "trente", "quarante", "cinquante",
  "soixante", "soixante", "quatre-vingt", "quatre-vingt",
];

function centaineEnLettres(n: number): string {
  if (n === 0) return "";
  if (n < 20) return UNITES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    if (d === 7 || d === 9) {
      const base = DIZAINES[d];
      const reste = UNITES[10 + u];
      return u === 1 && d === 7 ? `${base} et onze` : `${base}-${reste}`;
    }
    if (u === 0) return DIZAINES[d] + (d === 8 ? "s" : "");
    if (u === 1 && d !== 8) return `${DIZAINES[d]} et un`;
    return `${DIZAINES[d]}-${UNITES[u]}`;
  }
  const c = Math.floor(n / 100);
  const reste = n % 100;
  const tete = c === 1 ? "cent" : `${UNITES[c]} cent`;
  if (reste === 0) return c === 1 ? "cent" : `${tete}s`;
  return `${tete} ${centaineEnLettres(reste)}`;
}

export function enLettres(v: number): string {
  const n = Math.abs(Math.round(v || 0));
  if (n === 0) return "zéro";
  const milliards = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1000);
  const unites = n % 1000;
  const bouts: string[] = [];
  if (milliards) bouts.push(`${centaineEnLettres(milliards)} milliard${milliards > 1 ? "s" : ""}`);
  if (millions) bouts.push(`${centaineEnLettres(millions)} million${millions > 1 ? "s" : ""}`);
  if (milliers) bouts.push(milliers === 1 ? "mille" : `${centaineEnLettres(milliers)} mille`);
  if (unites) bouts.push(centaineEnLettres(unites));
  return bouts.join(" ").trim();
}

/* --------------------------- Bases de calcul ---------------------------- */
/* Ce qui est affiché depend du mode de remuneration : un mensualise n'a pas
   de taux horaire a montrer, un vacataire n'a pas de salaire de reference. */

function basesDeCalcul(d: PayslipData): Array<{ libelle: string; valeur: string }> {
  const lignes: Array<{ libelle: string; valeur: string }> = [];
  const cfg = d.config ?? {};
  const mensuel = Number(cfg.monthlySalary ?? cfg.monthly_salary ?? 0);
  const seuil = Number(cfg.overtimeThreshold ?? cfg.overtime_threshold ?? 0);

  if (mensuel > 0) {
    lignes.push({ libelle: "Salaire mensuel de référence", valeur: montant(mensuel, d.devise) });
  }
  if (d.joursOuvres > 0) {
    lignes.push({
      libelle: "Jours ouvrés de la période",
      valeur: `${nombre(d.joursOuvres)} / ${nombre(d.joursPeriode)}`,
    });
  }
  if (d.heuresNormales > 0 || d.tauxNormal) {
    lignes.push({
      libelle: "Heures normales retenues",
      valeur: d.tauxNormal
        ? `${heures(d.heuresNormales)} × ${montant(d.tauxNormal, d.devise)}`
        : heures(d.heuresNormales),
    });
  }
  if (d.heuresSup > 0) {
    lignes.push({ libelle: "Heures supplémentaires", valeur: heures(d.heuresSup) });
  }
  if (seuil > 0) {
    lignes.push({ libelle: "Seuil d'heures supplémentaires", valeur: heures(seuil) });
  }
  return lignes;
}

/* ------------------------------- Dessin --------------------------------- */

function enTete(doc: jsPDF, d: PayslipData, imgs: HeaderImages): number {
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);

  `${d.tutelleMinistere}\n${d.tutelleDirection}`
    .split("\n")
    .filter(Boolean)
    .forEach((ln, i) => doc.text(ln, M, 14 + i * 3.4));

  `${d.republique}\n${d.devise_republique}`
    .split("\n")
    .filter(Boolean)
    .forEach((ln, i) => doc.text(ln, RIGHT, 14 + i * 3.4, { align: "right" }));

  if (imgs.logoInstitut) {
    const h = 22;
    doc.addImage(imgs.logoInstitut.dataUrl, "JPEG", M, 21, h * imgs.logoInstitut.ratio, h);
  }
  if (imgs.embleme) {
    const h = 19;
    doc.addImage(imgs.embleme.dataUrl, "JPEG", RIGHT - h * imgs.embleme.ratio, 21, h * imgs.embleme.ratio, h);
  }

  doc.setFont("times", "bold");
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.setFontSize(12.5);
  doc.text(d.etablissementNom || INSTITUT, PAGE_W / 2, 45, { align: "center" });

  // Titre encadré, comme le relevé de notes.
  const titre = "BULLETIN DE PAIE";
  doc.setFontSize(11);
  const w = doc.getTextWidth(titre) + 10;
  doc.setLineWidth(0.5);
  doc.setDrawColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.rect(PAGE_W / 2 - w / 2, 50, w, 7);
  doc.text(titre, PAGE_W / 2, 55, { align: "center" });

  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  if (d.anneeScolaire) {
    doc.text(`Année scolaire : ${d.anneeScolaire}`, PAGE_W / 2, 62, { align: "center" });
    return 70;
  }
  return 66;
}

function blocBeneficiaire(doc: jsPDF, d: PayslipData, y: number): number {
  const COL2 = 112;
  kv(doc, "Nom et prénoms", d.enseignantNom || "—", M, y, true);
  kv(doc, "Référence", d.paiementId.slice(0, 8).toUpperCase(), COL2, y);
  y += 5.8;
  kv(doc, "Matricule", d.enseignantMatricule || "—", M, y);
  kv(doc, "Période", d.periodeNom || "—", COL2, y);
  y += 5.8;
  kv(doc, "Courriel", d.enseignantEmail || "—", M, y);
  kv(doc, "Du", `${jour(d.periodeDebut)} au ${jour(d.periodeFin)}`, COL2, y);
  y += 5.8;
  kv(doc, "Mode de rémunération", d.typePaiement || "—", M, y);
  return y + 7;
}

function tableauBases(doc: jsPDF, d: PayslipData, y: number): number {
  const lignes = basesDeCalcul(d);
  if (lignes.length === 0) return y;

  autoTable(doc, {
    startY: y,
    head: [["Base de calcul", ""]],
    body: lignes.map((l) => [l.libelle, l.valeur]),
    theme: "grid",
    styles: { font: "times", fontSize: 9.5, cellPadding: 1.8, textColor: NOIR },
    headStyles: {
      fillColor: GREEN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    margin: { left: M, right: M },
  });
  return (doc as any).lastAutoTable.finalY + 6;
}

function tableauRemuneration(doc: jsPDF, d: PayslipData, y: number): number {
  const body: Array<[string, string]> = [
    ["Rémunération de base", montant(d.montantBase, d.devise)],
  ];
  if (d.montantHeuresSup) body.push(["Heures supplémentaires", montant(d.montantHeuresSup, d.devise)]);
  if (d.primes) body.push(["Primes", montant(d.primes, d.devise)]);
  if (d.retenues) body.push(["Retenues", `- ${montant(d.retenues, d.devise)}`]);

  autoTable(doc, {
    startY: y,
    head: [["Rémunération", ""]],
    body,
    foot: [["NET À PAYER", montant(d.montantTotal, d.devise)]],
    theme: "grid",
    styles: { font: "times", fontSize: 10, cellPadding: 2, textColor: NOIR },
    headStyles: {
      fillColor: GREEN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "left",
    },
    footStyles: {
      fillColor: GREEN,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 11,
    },
    alternateRowStyles: { fillColor: ZEBRA },
    columnStyles: { 1: { halign: "right", fontStyle: "bold" } },
    margin: { left: M, right: M },
  });
  return (doc as any).lastAutoTable.finalY + 6;
}

function montantEnLettres(doc: jsPDF, d: PayslipData, y: number): number {
  doc.setFont("times", "italic");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const phrase = `Arrêté le présent bulletin à la somme de ${enLettres(d.montantTotal)} ${d.devise}.`;
  doc.splitTextToSize(phrase, PAGE_W - 2 * M).forEach((ln: string) => {
    doc.text(ln, M, y);
    y += 5;
  });
  return y + 4;
}

function signature(doc: jsPDF, d: PayslipData, y: number): number {
  const dateSig = jour(d.genereLe) === "—" ? new Date().toLocaleDateString("fr-FR") : jour(d.genereLe);
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.text(`Fait à ${d.villeSignature || "ABIDJAN"}, le ${dateSig}`, RIGHT, y, { align: "right" });
  y += 12;

  doc.setFont("times", "bold");
  doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
  doc.text("Le bénéficiaire", M + 12, y);
  doc.text("La Direction", RIGHT - 30, y, { align: "center" });
  doc.setTextColor(0, 0, 0);
  return y + 22;
}

function pied(doc: jsPDF, d: PayslipData) {
  doc.setFont("times", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(GRIS[0], GRIS[1], GRIS[2]);
  const mention =
    "Ce bulletin est établi par l'établissement et remis à l'enseignant. Il doit être conservé sans limitation de durée.";
  let y = PAGE_H - 18;
  doc.splitTextToSize(mention, PAGE_W - 2 * M).forEach((ln: string) => {
    doc.text(ln, PAGE_W / 2, y, { align: "center" });
    y += 3.2;
  });
  if (d.etablissementContact) {
    doc.text(d.etablissementContact, PAGE_W / 2, y, { align: "center" });
  }
  doc.setTextColor(0, 0, 0);
}

/* ------------------------------ Assemblage ------------------------------ */

async function buildPayslipDoc(d: PayslipData): Promise<{ doc: jsPDF; filename: string }> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const imgs = await loadHeaderImages();

  let y = enTete(doc, d, imgs);
  y = blocBeneficiaire(doc, d, y);
  y = tableauBases(doc, d, y);
  y = tableauRemuneration(doc, d, y);
  y = montantEnLettres(doc, d, y);
  signature(doc, d, y);
  pied(doc, d);

  const nom = (d.enseignantNom || "enseignant").replace(/[^\w\-]+/g, "-").toLowerCase();
  return { doc, filename: `bulletin-paie-${nom}-${d.paiementId.slice(0, 8)}.pdf` };
}

/** Récupère les données du bulletin auprès de l'API. */
async function fetchPayslipData(paiementId: string): Promise<PayslipData> {
  const res = await fetch(`/api/v1/teacher-payments/${paiementId}/payslip-data`, {
    headers: createApiHeaders(),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.success === false)) {
    throw new Error(json?.message || json?.error || `Erreur HTTP ${res.status}`);
  }
  return (json?.data ?? json) as PayslipData;
}

/**
 * Ouvre le bulletin de paie dans la visionneuse PDF du navigateur.
 * `win` : onglet ouvert de façon synchrone au clic (évite le blocage popup).
 */
export async function openPayslipPdf(paiementId: string, win?: Window | null): Promise<void> {
  try {
    const data = await fetchPayslipData(paiementId);
    const { doc } = await buildPayslipDoc(data);
    const url = URL.createObjectURL(doc.output("blob"));
    if (win) win.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) {
    // L'onglet ouvert au clic resterait vide et sans explication.
    if (win) win.close();
    throw e;
  }
}

/** Télécharge le bulletin de paie. */
export async function downloadPayslipPdf(paiementId: string): Promise<void> {
  const data = await fetchPayslipData(paiementId);
  const { doc, filename } = await buildPayslipDoc(data);
  doc.save(filename);
}
