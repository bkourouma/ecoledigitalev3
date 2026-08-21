/**
 * Export PDF de l'historique des bulletins de paie — feature 031.
 *
 * Le document reprend la liste telle qu'elle est filtrée à l'écran (enseignant,
 * année scolaire, période) et met en avant ce que le gestionnaire y cherche :
 * ce qui reste dû. Le total des impayés figure donc en tête, et les bulletins
 * concernés sont récapitulés en fin de document.
 */
import {
  dateEdition,
  effectif,
  nombreFr,
  stampFichier,
  type ReportBlock,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

/* ------------------------------- Libellés ------------------------------- */

/**
 * Deux mots suffisent au gestionnaire : PAYÉ et IMPAYÉ — mêmes libellés que
 * les pastilles de l'écran. Les autres valeurs couvrent les bulletins anciens.
 */
const STATUT_LABELS: Record<string, string> = {
  paid: "Payé",
  approved: "Impayé",
  unpaid: "Impayé",
  calculated: "Calculé",
  disputed: "Contesté",
  cancelled: "Annulé",
};

const TYPE_LABELS: Record<string, string> = {
  salary: "Salaire fixe",
  hourly: "Taux horaire",
  mixed: "Mixte",
};

/** Un bulletin arrêté mais pas encore versé — au sens comptable du mot. */
export const estImpaye = (statut: string): boolean =>
  statut === "approved" || statut === "unpaid";

/* ------------------------------- Formatage ------------------------------ */

/** `nombreFr` et non `toLocaleString` : voir `texteImprimable`. */
const fmtMontant = (v: number | null | undefined, devise = "XOF"): string =>
  `${nombreFr(Math.round(Number(v ?? 0)))} ${devise}`;

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  const parsed = new Date(String(d).length <= 10 ? `${d}T00:00:00` : String(d));
  return isNaN(parsed.getTime()) ? String(d) : parsed.toLocaleDateString("fr-FR");
};

/** 596 → « 596 h » ; 2,5 → « 2h30 ». */
export function fmtHeures(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h} h`;
}

/* -------------------------------- Données ------------------------------- */

export interface HistoriquePaieContexte {
  /** Filtres actifs sur l'écran, rappelés en sous-titre. */
  filtreLibelle?: string;
  /** Libellés séparés, pour le bloc de tête. */
  enseignant?: string;
  annee?: string;
  periode?: string;
}

export function buildHistoriquePaieSpec(
  bulletins: any[],
  ctx: HistoriquePaieContexte = {}
): ReportSpec {
  // Du plus récent au plus ancien : un historique se lit à rebours.
  const tries = [...bulletins].sort((a, b) =>
    String(b.periode_debut ?? "").localeCompare(String(a.periode_debut ?? ""))
  );

  const devise = tries[0]?.devise ?? "XOF";
  const total = tries.reduce((s, b) => s + Number(b.montant ?? 0), 0);
  const impayes = tries.filter((b) => estImpaye(String(b.statut)));
  const restantDu = impayes.reduce((s, b) => s + Number(b.montant ?? 0), 0);
  const verses = tries.filter((b) => String(b.statut) === "paid");

  const perimetre: Array<[string, string]> = [
    ["Enseignant", ctx.enseignant || "Tous les enseignants"],
    ["Année scolaire", ctx.annee || "Toutes les années"],
    ["Période", ctx.periode || "Toutes les périodes"],
    ["Bulletins archivés", effectif(tries.length, "bulletin")],
    ["Montant total", fmtMontant(total, devise)],
    ["Versés", `${verses.length} — ${fmtMontant(verses.reduce((s, b) => s + Number(b.montant ?? 0), 0), devise)}`],
    ["Reste à verser", `${impayes.length} — ${fmtMontant(restantDu, devise)}`],
  ];

  const blocks: ReportBlock[] = [
    { kind: "keyValues", items: perimetre, columns: 2 },
    {
      kind: "table",
      table: {
        columns: [
          { header: "N°", width: 10, align: "center" },
          { header: "Enseignant" },
          { header: "Période", width: 52 },
          { header: "Mode de paie", width: 26 },
          { header: "Heures", width: 20, align: "center" },
          { header: "H. sup.", width: 20, align: "center" },
          { header: "Archivé le", width: 24, align: "center" },
          { header: "Versé le", width: 24, align: "center" },
          { header: "Statut", width: 22, align: "center" },
          { header: "Montant", width: 32, align: "right" },
        ],
        rows: tries.map((b, i) => [
          String(i + 1),
          b.enseignant_nom || "—",
          b.periode_nom || "—",
          TYPE_LABELS[String(b.type_paiement)] ?? String(b.type_paiement ?? "—"),
          fmtHeures(b.heures_normales),
          fmtHeures(b.heures_sup),
          fmtDate(b.archive_le),
          fmtDate(b.verse_le),
          STATUT_LABELS[String(b.statut)] ?? String(b.statut ?? "—"),
          fmtMontant(b.montant, b.devise),
        ]),
        footer: [
          "",
          `TOTAL — ${effectif(tries.length, "bulletin")}`,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          fmtMontant(total, devise),
        ],
      },
    },
  ];

  // Ce qui reste dû : le chiffre que le gestionnaire vient chercher.
  if (impayes.length > 0) {
    blocks.push(
      { kind: "heading", level: 2, text: "Reste à verser", note: fmtMontant(restantDu, devise) },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 10, align: "center" },
            { header: "Enseignant" },
            { header: "Période", width: 60 },
            { header: "Archivé le", width: 28, align: "center" },
            { header: "Montant dû", width: 36, align: "right" },
          ],
          rows: impayes.map((b, i) => [
            String(i + 1),
            b.enseignant_nom || "—",
            b.periode_nom || "—",
            fmtDate(b.archive_le),
            fmtMontant(b.montant, b.devise),
          ]),
          footer: ["", `TOTAL — ${effectif(impayes.length, "impayé")}`, "", "", fmtMontant(restantDu, devise)],
        },
      }
    );
  }

  return {
    title: "Historique des bulletins de paie",
    subtitle: ctx.filtreLibelle,
    filename: `historique-paie-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(tries.length, "bulletin"),
    blocks,
  };
}

export const openHistoriquePaiePdf = (
  bulletins: any[],
  ctx: HistoriquePaieContexte,
  win?: Window | null
) => openReportPdf(buildHistoriquePaieSpec(bulletins, ctx), win);
