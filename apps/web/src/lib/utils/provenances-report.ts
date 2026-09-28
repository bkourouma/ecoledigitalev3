/**
 * Export PDF des étudiants amenés par un commercial — Module Professionnel.
 *
 * Le document reprend exactement ce que l'écran affiche : une ligne par
 * étudiant, dans le périmètre courant (commercial sélectionné, recherche). Les
 * montants sont ceux calculés par l'API — scolarité encaissée sur la ligne
 * « Scolarité » du barème, et commission au taux figé sur la fiche — de sorte
 * que le PDF ne peut pas diverger du tableau qui est sous les yeux.
 */
import {
  dateEdition,
  effectif,
  nombreFr,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";
import type { ProvenanceRowDto } from "@ecoledigitale/contracts";

export interface ProvenancesExportOptions {
  /** Commercial sélectionné, ou « Tous les commerciaux ». */
  commercial: string;
  /** Recherche en cours sur l'écran. */
  recherche?: string;
}

/** Montant en FCFA, séparateurs français et sans décimale. */
const fcfa = (n: number) => `${nombreFr(Math.round(n))} FCFA`;

export function buildProvenancesReportSpec(
  lignes: ProvenanceRowDto[],
  o: ProvenancesExportOptions
): ReportSpec {
  const scolarite = lignes.reduce((s, r) => s + r.total_paye, 0);
  const commission = lignes.reduce((s, r) => s + r.commission, 0);

  const perimetre: Array<[string, string]> = [
    ["Commercial", o.commercial || "—"],
    ["Étudiants amenés", effectif(lignes.length, "étudiant")],
    ["Scolarité encaissée", fcfa(scolarite)],
    ["Commission acquise", fcfa(commission)],
  ];
  if (o.recherche) perimetre.push(["Recherche", `« ${o.recherche} »`]);

  // Ce que chaque commercial pèse dans la sélection — utile dès que le PDF
  // porte sur « Tous les commerciaux ».
  const parCommercial = lignes.reduce<Record<string, { n: number; commission: number }>>(
    (acc, r) => {
      const k = r.commercial_nom || "—";
      acc[k] = acc[k] ?? { n: 0, commission: 0 };
      acc[k].n += 1;
      acc[k].commission += r.commission;
      return acc;
    },
    {}
  );

  return {
    title: "Étudiants amenés par un commercial",
    subtitle: o.commercial,
    filename: `commerciaux-etudiants-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(lignes.length, "étudiant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 12, align: "center" },
            // Assez large pour qu'un matricule IPAM tienne sur une seule ligne.
            { header: "Matricule", width: 42, align: "center" },
            { header: "Nom & Prénom(s)" },
            { header: "Commercial", width: 50 },
            { header: "Taux", width: 16, align: "center" },
            { header: "Scolarité encaissée", width: 38, align: "right" },
            { header: "Commission", width: 34, align: "right" },
          ],
          rows: lignes.map((r, i) => [
            String(i + 1),
            r.matricule || "—",
            String(r.student_nom || "—"),
            r.commercial_nom || "—",
            r.taux_commission == null ? "—" : `${r.taux_commission} %`,
            fcfa(r.total_paye),
            r.commission > 0 ? fcfa(r.commission) : "—",
          ]),
          footer: [
            "",
            "",
            `TOTAL — ${effectif(lignes.length, "étudiant")}`,
            "",
            "",
            fcfa(scolarite),
            fcfa(commission),
          ],
        },
      },
      {
        kind: "note",
        text: `Répartition par commercial : ${
          Object.entries(parCommercial)
            .sort((a, b) => b[1].commission - a[1].commission)
            .map(([nom, v]) => `${nom} : ${v.n} — ${fcfa(v.commission)}`)
            .join("  ·  ") || "—"
        }`,
      },
      {
        kind: "note",
        text:
          "La commission est le taux figé sur la fiche de l'étudiant appliqué à la ligne " +
          "« Scolarité » du barème effectivement encaissée. Elle n'inclut ni les frais " +
          "d'inscription, ni les frais annexes, ni la conduite, et rien n'est dû sur un impayé.",
      },
    ],
  };
}

export const openProvenancesPdf = (
  lignes: ProvenanceRowDto[],
  o: ProvenancesExportOptions,
  win?: Window | null
) => openReportPdf(buildProvenancesReportSpec(lignes, o), win);
