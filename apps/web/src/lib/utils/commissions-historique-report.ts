/**
 * Export PDF des paiements de commissions.
 *
 * UN seul tableau, celui des commissions — le même que l'écran. Un second
 * tableau récapitulant le solde par commercial ne dirait, agrégé, que ce que
 * celui-ci dit déjà ligne à ligne.
 *
 * Le MONTANT versé par l'étudiant n'y figure pas : c'est l'affaire de la
 * caisse, pas celle de la rémunération du commercial. Seul son nom apparaît,
 * pour savoir au titre de qui la commission est due.
 */
import {
  dateEdition,
  effectif,
  nombreFr,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";
import type { LigneCommissionDto } from "@ecoledigitale/contracts";

export interface CommissionsHistoriqueExportOptions {
  /** Commercial sélectionné, ou « Tous les commerciaux ». */
  commercial: string;
  /** État filtré : commissions à payer, ou commissions payées. */
  statut: string;
}

const fcfa = (n: number) => `${nombreFr(Math.round(n))} FCFA`;

const fmtDate = (d: string | null): string => {
  if (!d) return "—";
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  return isNaN(parsed.getTime()) ? d : parsed.toLocaleDateString("fr-FR");
};

export function buildCommissionsHistoriqueReportSpec(
  lignes: LigneCommissionDto[],
  o: CommissionsHistoriqueExportOptions
): ReportSpec {
  const impayees = lignes.filter((l) => l.statut === "impaye");
  const acquis = lignes.reduce((s, l) => s + l.commission, 0);
  const paye = lignes.filter((l) => l.statut === "regle").reduce((s, l) => s + l.commission, 0);
  const reste = impayees.reduce((s, l) => s + l.commission, 0);

  return {
    title: "Paiements des commissions",
    subtitle: [o.commercial, o.statut].filter(Boolean).join("  ·  "),
    filename: `commissions-paiements-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(lignes.length, "commission"),
    blocks: [
      {
        kind: "keyValues",
        columns: 2,
        items: [
          ["Commercial", o.commercial || "—"],
          ["État", o.statut || "—"],
          ["Commission acquise", fcfa(acquis)],
          ["Déjà payé", fcfa(paye)],
          ["Reste à payer", fcfa(reste)],
          ["Lignes impayées", `${impayees.length} / ${lignes.length}`],
        ],
      },
      lignes.length === 0
        ? { kind: "note", text: "Aucune commission sur ce périmètre." }
        : {
            kind: "table",
            table: {
              columns: [
                { header: "N°", width: 12, align: "center" },
                { header: "Date", width: 28, align: "center" },
                { header: "Commercial" },
                { header: "Au titre de" },
                { header: "Commission", width: 36, align: "right" },
                { header: "État", width: 24, align: "center" },
                { header: "Payé le", width: 28, align: "center" },
              ],
              rows: lignes.map((l, i) => [
                String(i + 1),
                fmtDate(l.paiement_le),
                String(l.commercial_nom || "—"),
                String(l.student_nom || "—"),
                fcfa(l.commission),
                l.statut === "impaye" ? "Impayé" : "Payé",
                l.statut === "impaye" ? "—" : fmtDate(l.regle_le),
              ]),
              footer: [
                "",
                "",
                `TOTAL — ${effectif(lignes.length, "commission")}`,
                "",
                fcfa(acquis),
                `${impayees.length} impayée(s)`,
                "",
              ],
            },
          },
      {
        kind: "note",
        text:
          "Une ligne par commission due : un règlement de scolarité d'un étudiant amené par " +
          "un commercial en déclenche une. Le montant est le taux figé sur la fiche de " +
          "l'étudiant appliqué à ce règlement, arrondi au franc. Rien n'est dû tant que " +
          "l'étudiant n'a pas payé.",
      },
    ],
  };
}

export const openCommissionsHistoriquePdf = (
  lignes: LigneCommissionDto[],
  o: CommissionsHistoriqueExportOptions,
  win?: Window | null
) => openReportPdf(buildCommissionsHistoriqueReportSpec(lignes, o), win);
