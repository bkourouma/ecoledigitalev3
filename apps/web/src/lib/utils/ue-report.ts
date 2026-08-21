/**
 * Export PDF du catalogue des UE — Module Professionnel.
 *
 * L'utilisateur choisit avant d'exporter les données qu'il veut voir : le
 * tableau produit porte exactement les colonnes cochées. Cet écran n'a pas
 * d'export Word : le catalogue est un document de consultation, pas un
 * document à retoucher.
 */
import {
  dateEdition,
  effectif,
  nombreFr,
  stampFichier,
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

/* -------------------------------- Options ------------------------------- */

/** Clés des données optionnelles, dans l'ordre d'affichage de la boîte de dialogue. */
export const UE_EXPORT_CHOICES = [
  { key: "filiere", label: "Filière", hint: "Filière de rattachement de l'UE" },
  { key: "credits", label: "Crédits (UV)", hint: "Nombre d'unités de valeur" },
  { key: "montant", label: "Montant", hint: "Prix de l'UE, avec le total en fin de tableau" },
] as const;

export type UeExportKey = (typeof UE_EXPORT_CHOICES)[number]["key"];

/** Sélection par défaut à l'ouverture de la boîte de dialogue. */
export const UE_EXPORT_DEFAUT: UeExportKey[] = ["filiere", "credits", "montant"];

export interface UeExportOptions {
  choix: Set<string>;
  /** Nom lisible d'une filière, tel qu'affiché à l'écran. */
  filiereNom: (id: string) => string;
  /** Filtre actif sur l'écran, rappelé en sous-titre. */
  filtreLibelle?: string;
}

/* ------------------------------- Formatage ------------------------------ */

/**
 * Prix en FCFA, comme sur l'écran. 0 → « Gratuit ».
 *
 * `nombreFr` et non `toLocaleString("fr-FR")` : ce dernier sépare les milliers
 * par une espace insécable étroite, que jsPDF n'encode pas et qui empêche le
 * retour à la ligne — le montant sortait de sa colonne (voir `texteImprimable`).
 */
export function fmtMontant(prix: any, devise?: string): string {
  const n = Number(prix ?? 0);
  if (!Number.isFinite(n) || n === 0) return "Gratuit";
  const unite = !devise || devise === "XOF" ? "FCFA" : devise;
  return `${nombreFr(n)} ${unite}`;
}

/* ------------------------------ Construction ---------------------------- */

/** Tableau : une ligne par UE, colonnes = données cochées. */
function tableau(items: any[], o: UeExportOptions): ReportBlock {
  const colonnes: ReportColumn[] = [
    { header: "N°", width: 12, align: "center" },
    { header: "Code", width: 36 },
    { header: "Intitulé de l'UE" },
  ];
  if (o.choix.has("filiere")) colonnes.push({ header: "Filière", width: 70 });
  if (o.choix.has("credits")) colonnes.push({ header: "Crédits", width: 22, align: "center" });
  if (o.choix.has("montant")) colonnes.push({ header: "Montant", width: 36, align: "right" });

  const rows = items.map((u, i) => {
    const cells = [String(i + 1), u.code ?? "—", u.libelle ?? "—"];
    if (o.choix.has("filiere")) cells.push(o.filiereNom(u.filiere_id));
    if (o.choix.has("credits")) cells.push(String(u.nb_uv ?? 0));
    if (o.choix.has("montant")) cells.push(fmtMontant(u.prix, u.devise));
    return cells;
  });

  return { kind: "table", table: { columns: colonnes, rows, footer: totalLigne(items, o, colonnes) } };
}

/** Ligne de total : crédits cumulés et montant cumulé, si ces données sont là. */
function totalLigne(items: any[], o: UeExportOptions, colonnes: ReportColumn[]): string[] | undefined {
  if (!o.choix.has("credits") && !o.choix.has("montant")) return undefined;
  const ligne = colonnes.map(() => "");
  ligne[2] = `TOTAL — ${effectif(items.length, "UE", "UE")}`;
  const iCredits = colonnes.findIndex((c) => c.header === "Crédits");
  const iMontant = colonnes.findIndex((c) => c.header === "Montant");
  if (iCredits >= 0) {
    ligne[iCredits] = String(items.reduce((s, u) => s + Number(u.nb_uv ?? 0), 0));
  }
  if (iMontant >= 0) {
    const total = items.reduce((s, u) => s + Number(u.prix ?? 0), 0);
    ligne[iMontant] = fmtMontant(total, items[0]?.devise);
  }
  return ligne;
}

export function buildUeReportSpec(items: any[], o: UeExportOptions): ReportSpec {
  return {
    title: "Catalogue des unités d'enseignement",
    subtitle: o.filtreLibelle,
    filename: `catalogue-ue-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(items.length, "UE", "UE"),
    blocks: [tableau(items, o)],
  };
}

/* -------------------------------- Sorties ------------------------------- */

export const openUeReportPdf = (items: any[], o: UeExportOptions, win?: Window | null) =>
  openReportPdf(buildUeReportSpec(items, o), win);
