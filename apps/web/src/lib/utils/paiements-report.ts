/**
 * Export PDF des paiements — Module Professionnel (admin).
 *
 * Le document reprend exactement ce que l'écran affiche : une ligne par carte,
 * c'est-à-dire par binôme étudiant + classe, avec son cumul attendu / encaissé
 * / reste à payer, dans le périmètre courant (année scolaire, nom de classe,
 * état de règlement, recherche). Le détail UE par UE et l'historique des
 * versements restent sur la fiche de l'étudiant.
 */
import {
  dateEdition,
  effectif,
  nombreFr,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

/** Libellés des états de règlement, identiques à l'écran. */
const ETAT_LABEL: Record<string, string> = {
  non_regle: "Non réglé",
  partiel: "Partiel",
  solde: "Soldé",
};

/**
 * Montant en FCFA. `nombreFr` et non `toLocaleString("fr-FR")` : ce dernier
 * sépare les milliers par une espace insécable étroite que jsPDF n'encode pas
 * (voir `texteImprimable`).
 */
export function fmtFCFA(v?: number | null): string {
  return `${nombreFr(Math.round(Number(v ?? 0)))} FCFA`;
}

export interface PaiementsExportOptions {
  /** Année scolaire sélectionnée, ou « Toutes les années ». */
  annee: string;
  /** Nom de classe sélectionné, ou « Tous les noms de classe ». */
  nomClasse: string;
  /** État de règlement filtré, ou « Tous ». */
  reglement: string;
  /** Recherche en cours sur l'écran. */
  recherche?: string;
  /** Totaux affichés au-dessus des cartes. */
  stats: {
    due: number;
    paid: number;
    reste: number;
    count: number;
    confirmed: number;
  };
}

export function buildPaiementsReportSpec(
  groupes: any[],
  o: PaiementsExportOptions
): ReportSpec {
  // Les cartes sont déjà triées par nom : on conserve cet ordre.
  const totalDue = groupes.reduce((s, g) => s + Number(g.due ?? 0), 0);
  const totalPaid = groupes.reduce((s, g) => s + Number(g.paid ?? 0), 0);
  const totalReste = groupes.reduce((s, g) => s + Number(g.reste ?? 0), 0);
  const totalUe = groupes.reduce(
    (s, g) => s + (Array.isArray(g.enrollments) ? g.enrollments.length : 0),
    0
  );

  const perimetre: Array<[string, string]> = [
    ["Année scolaire", o.annee || "—"],
    ["Nom de classe", o.nomClasse || "—"],
    ["Règlement", o.reglement || "—"],
    ["Étudiants", String(o.stats.count)],
    ["Inscriptions confirmées", String(o.stats.confirmed)],
    ["Attendu", fmtFCFA(o.stats.due)],
    ["Encaissé", fmtFCFA(o.stats.paid)],
    ["Reste à payer", fmtFCFA(o.stats.reste)],
  ];
  if (o.recherche) perimetre.push(["Recherche", `« ${o.recherche} »`]);

  const parEtat = groupes.reduce<Record<string, number>>((acc, g) => {
    const k = ETAT_LABEL[String(g.state)] ?? String(g.state ?? "—");
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    title: "Paiements",
    subtitle: [o.annee, o.nomClasse, o.reglement].filter(Boolean).join("  ·  "),
    filename: `paiements-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(groupes.length, "étudiant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 12, align: "center" },
            // Assez large pour qu'un matricule tienne sur une seule ligne.
            { header: "Matricule", width: 42, align: "center" },
            { header: "Nom & Prénom(s)" },
            { header: "UE", width: 14, align: "center" },
            { header: "Attendu", width: 32, align: "right" },
            { header: "Encaissé", width: 32, align: "right" },
            { header: "Reste", width: 32, align: "right" },
            { header: "État", width: 24, align: "center" },
          ],
          rows: groupes.map((g, i) => [
            String(i + 1),
            g.matricule || "—",
            `${String(g.last_name || "—").toUpperCase()} ${g.first_name || ""}`.trim(),
            String(Array.isArray(g.enrollments) ? g.enrollments.length : 0),
            fmtFCFA(g.due),
            fmtFCFA(g.paid),
            fmtFCFA(g.reste),
            ETAT_LABEL[String(g.state)] ?? String(g.state ?? "—"),
          ]),
          footer: [
            "",
            "",
            `TOTAL — ${effectif(groupes.length, "étudiant")}`,
            String(totalUe),
            fmtFCFA(totalDue),
            fmtFCFA(totalPaid),
            fmtFCFA(totalReste),
            "",
          ],
        },
      },
      {
        kind: "note",
        text: `Répartition par état de règlement : ${
          Object.entries(parEtat)
            .sort((a, b) => a[0].localeCompare(b[0], "fr"))
            .map(([k, n]) => `${k} : ${n}`)
            .join("  ·  ") || "—"
        }`,
      },
    ],
  };
}

export const openPaiementsPdf = (
  groupes: any[],
  o: PaiementsExportOptions,
  win?: Window | null
) => openReportPdf(buildPaiementsReportSpec(groupes, o), win);
