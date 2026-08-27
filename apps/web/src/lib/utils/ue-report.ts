/**
 * Export PDF du catalogue des UE — Module Professionnel.
 *
 * Le document reprend le catalogue tel qu'il est filtré à l'écran, avec pour
 * chaque UE sa classe, ses crédits et son montant. Cet écran n'a pas d'export
 * Word : le catalogue est un document de consultation, pas un document à
 * retoucher.
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

export interface UeExportOptions {
  /** Nom lisible d'une classe, tel qu'affiché à l'écran. */
  classeNom: (id: string) => string;
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

/** Tableau : une ligne par UE. */
function tableau(items: any[], o: UeExportOptions): ReportBlock {
  const colonnes: ReportColumn[] = [
    { header: "N°", width: 12, align: "center" },
    { header: "Code", width: 36 },
    { header: "Intitulé de l'UE" },
    { header: "Classe", width: 70 },
    { header: "Crédits", width: 22, align: "center" },
    { header: "Montant", width: 36, align: "right" },
  ];

  const rows = items.map((u, i) => [
    String(i + 1),
    u.code ?? "—",
    u.libelle ?? "—",
    o.classeNom(u.filiere_id),
    String(u.nb_uv ?? 0),
    fmtMontant(u.prix, u.devise),
  ]);

  return { kind: "table", table: { columns: colonnes, rows, footer: totalLigne(items) } };
}

/** Ligne de total : effectif, crédits cumulés et montant cumulé. */
function totalLigne(items: any[]): string[] {
  return [
    "",
    "",
    `TOTAL — ${effectif(items.length, "UE", "UE")}`,
    "",
    String(items.reduce((s, u) => s + Number(u.nb_uv ?? 0), 0)),
    fmtMontant(
      items.reduce((s, u) => s + Number(u.prix ?? 0), 0),
      items[0]?.devise
    ),
  ];
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
