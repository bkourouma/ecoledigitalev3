/**
 * Export PDF des bulletins de paie — vue d'ensemble des enseignants
 * (feature 031).
 *
 * Le document reprend exactement ce que l'écran affiche : une ligne par carte,
 * dans le périmètre courant (enseignant choisi, filtre « à problème »). Il
 * porte l'information qui fait tout l'intérêt de l'écran — l'état de
 * configuration : un enseignant sans configuration valide est ignoré EN
 * SILENCE par le calcul, et c'est le seul endroit où ça se voit.
 */
import {
  dateEdition,
  effectif,
  nombreFr,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";
import type {
  EnseignantPaie,
  EtatConfiguration,
} from "@/lib/hooks/use-professional-remuneration";

/** Libellés des états de configuration, identiques aux pastilles de l'écran. */
const ETAT_LABELS: Record<EtatConfiguration, string> = {
  active: "Configuré",
  absente: "Non configuré",
  expiree: "Configuration expirée",
  future: "Configuration à venir",
};

/** 4.5 → « 4h30 » ; 2 → « 2h » — identique à l'affichage de l'écran. */
function fmtHeures(h: number | null | undefined): string {
  const v = Number(h ?? 0);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

/**
 * Montant. `nombreFr` et non `toLocaleString` : ce dernier sépare les milliers
 * par une espace insécable étroite que jsPDF n'encode pas (voir
 * `texteImprimable`).
 */
function fmtMontant(v: number | null | undefined, devise?: string | null): string {
  if (v == null) return "—";
  const unite = !devise || devise === "XOF" ? "FCFA" : devise;
  return `${nombreFr(Math.round(Number(v)))} ${unite}`;
}

export interface PaieBulletinsExportOptions {
  /** Enseignant sélectionné, ou « Tous les enseignants ». */
  enseignant: string;
  /** Filtre « seulement à problème », rappelé en tête. */
  filtre: string;
  /** Période qui pilote les cartes, ou null si le cycle est terminé. */
  periode?: string | null;
  /** Totaux affichés au-dessus des cartes. */
  stats: {
    total: number;
    configures: number;
    aTraiter: number;
    heuresValidees: number;
    seancesValidees: number;
  };
}

export function buildPaieBulletinsReportSpec(
  enseignants: EnseignantPaie[],
  o: PaieBulletinsExportOptions
): ReportSpec {
  // Les cartes sont déjà alphabétiques (ordre de l'API) : on le conserve.
  const totalHeures = enseignants.reduce((s, e) => s + Number(e.heures?.totales ?? 0), 0);
  const totalSeances = enseignants.reduce((s, e) => s + Number(e.heures?.nb_seances ?? 0), 0);
  const totalAValider = enseignants.reduce((s, e) => s + Number(e.seances_a_valider ?? 0), 0);
  const totalMontant = enseignants.reduce((s, e) => s + Number(e.bulletin?.montant ?? 0), 0);
  const devise = enseignants.find((e) => e.bulletin?.devise)?.bulletin?.devise ?? null;

  const perimetre: Array<[string, string]> = [
    ["Enseignant", o.enseignant || "—"],
    ["Filtre", o.filtre || "—"],
    ["Période", o.periode || "Aucune période ouverte"],
    ["Enseignants", String(o.stats.total)],
    ["Configurés", String(o.stats.configures)],
    ["À configurer", String(o.stats.aTraiter)],
    ["Heures validées", fmtHeures(o.stats.heuresValidees)],
    ["Séances validées", String(o.stats.seancesValidees)],
  ];

  const parEtat = enseignants.reduce<Record<string, number>>((acc, e) => {
    const k = ETAT_LABELS[e.etat_configuration] ?? String(e.etat_configuration);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    title: "Bulletins de paie — enseignants",
    subtitle: [o.enseignant, o.periode].filter(Boolean).join("  ·  "),
    filename: `bulletins-paie-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(enseignants.length, "enseignant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 12, align: "center" },
            { header: "Enseignant" },
            { header: "Matricule", width: 34, align: "center" },
            { header: "Configuration", width: 42 },
            { header: "Séances", width: 20, align: "center" },
            { header: "Heures payables", width: 28, align: "center" },
            { header: "À valider", width: 22, align: "center" },
            { header: "Bulletin", width: 26, align: "center" },
            { header: "Montant", width: 34, align: "right" },
          ],
          rows: enseignants.map((e, i) => [
            String(i + 1),
            e.nom || "Enseignant",
            e.matricule || "—",
            ETAT_LABELS[e.etat_configuration] ?? String(e.etat_configuration),
            String(e.heures?.nb_seances ?? 0),
            fmtHeures(e.heures?.totales),
            String(e.seances_a_valider ?? 0),
            e.bulletin ? (e.bulletin.statut ?? "—") : "Aucun",
            e.bulletin ? fmtMontant(e.bulletin.montant, e.bulletin.devise) : "—",
          ]),
          footer: [
            "",
            `TOTAL — ${effectif(enseignants.length, "enseignant")}`,
            "",
            "",
            String(totalSeances),
            fmtHeures(totalHeures),
            String(totalAValider),
            "",
            fmtMontant(totalMontant, devise),
          ],
        },
      },
      {
        kind: "note",
        text: `Répartition par configuration : ${
          Object.entries(parEtat)
            .sort((a, b) => a[0].localeCompare(b[0], "fr"))
            .map(([k, n]) => `${k} : ${n}`)
            .join("  ·  ") || "—"
        }`,
      },
      {
        kind: "note",
        text:
          "Un enseignant dont la configuration n'est pas « Configuré » est ignoré par le " +
          "calcul, sans message d'erreur : ses heures validées ne produisent aucun montant.",
      },
    ],
  };
}

export const openPaieBulletinsPdf = (
  enseignants: EnseignantPaie[],
  o: PaieBulletinsExportOptions,
  win?: Window | null
) => openReportPdf(buildPaieBulletinsReportSpec(enseignants, o), win);
