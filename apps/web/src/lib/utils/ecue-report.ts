/**
 * Export PDF du catalogue des ECUE — Module Professionnel.
 *
 * Le document reprend la liste telle qu'elle est filtrée à l'écran (classe,
 * UE), regroupée par UE de rattachement : l'intitulé de l'UE n'est écrit que
 * sur sa première ligne, ses autres lignes se lisent comme une cellule
 * fusionnée. Une ECUE mutualisée entre plusieurs UE figure sous chacune
 * d'elles — le pied de tableau, lui, ne la compte qu'une fois.
 *
 * Comme le catalogue des UE, cet écran n'a pas d'export Word : c'est un
 * document de consultation.
 */
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportBlock,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

const STATUT_LABEL: Record<string, string> = {
  actif: "Active",
  inactif: "Inactive",
};

/** Groupe sans UE : toujours présenté en dernier. */
const SANS_UE = "__sans_ue__";

export interface EcueExportOptions {
  /** Classe sélectionnée, ou « Toutes les classes ». */
  classe: string;
  /** UE sélectionnée, ou « Toutes les UE ». */
  ue: string;
}

interface GroupeUe {
  libelle: string;
  ecues: any[];
}

/**
 * Répartit les ECUE sous leurs UE. Une ECUE rattachée à plusieurs UE est
 * répétée dans chaque groupe : c'est le sens même du regroupement.
 */
function grouperParUe(items: any[]): GroupeUe[] {
  const groupes = new Map<string, GroupeUe>();

  const poser = (cle: string, libelle: string, ecue: any) => {
    const g = groupes.get(cle) ?? { libelle, ecues: [] };
    g.ecues.push(ecue);
    groupes.set(cle, g);
  };

  for (const e of items) {
    const liste: any[] = Array.isArray(e.ue) ? e.ue : [];
    if (liste.length === 0) {
      poser(SANS_UE, "Non rattachée", e);
      continue;
    }
    for (const u of liste) poser(String(u.id), u.libelle ?? "—", e);
  }

  return Array.from(groupes.entries())
    .sort(([cleA, a], [cleB, b]) => {
      if (cleA === SANS_UE) return 1;
      if (cleB === SANS_UE) return -1;
      return a.libelle.localeCompare(b.libelle, "fr");
    })
    .map(([, g]) => ({
      ...g,
      ecues: [...g.ecues].sort((a, b) =>
        String(a.libelle ?? "").localeCompare(String(b.libelle ?? ""), "fr")
      ),
    }));
}

/** Tableau unique : un bloc de lignes par UE. */
function tableau(groupes: GroupeUe[], distinctes: any[]): ReportBlock {
  const rows: string[][] = [];
  let numero = 0;

  for (const g of groupes) {
    numero += 1;
    g.ecues.forEach((e, j) => {
      rows.push([
        j === 0 ? String(numero) : "",
        j === 0 ? g.libelle : "",
        e.code ?? "—",
        e.libelle ?? "—",
        e.credits == null ? "—" : String(e.credits),
      ]);
    });
  }

  return {
    kind: "table",
    table: {
      columns: [
        { header: "N°", width: 12, align: "center" },
        { header: "UE de rattachement", width: 90 },
        { header: "Code", width: 36 },
        { header: "Intitulé de l'ECUE" },
        { header: "Crédits", width: 20, align: "center" },
      ],
      rows,
      footer: [
        "",
        `${effectif(groupes.length, "UE", "UE")}`,
        "",
        `TOTAL — ${effectif(distinctes.length, "ECUE", "ECUE")}`,
        String(distinctes.reduce((s, e) => s + Number(e.credits ?? 0), 0)),
      ],
    },
  };
}

export function buildEcueReportSpec(items: any[], o: EcueExportOptions): ReportSpec {
  const groupes = grouperParUe(items);

  const parStatut = items.reduce<Record<string, number>>((acc, e) => {
    const k = STATUT_LABEL[String(e.statut)] ?? String(e.statut ?? "—");
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  // Les ECUE mutualisées apparaissent plusieurs fois dans le tableau : le pied
  // et la mention finale raisonnent sur les ECUE distinctes.
  const mutualisees = items.filter((e) => (Array.isArray(e.ue) ? e.ue.length : 0) > 1).length;

  const notes: ReportBlock[] = [
    {
      kind: "note",
      text: `Répartition par statut : ${
        Object.entries(parStatut)
          .sort((a, b) => a[0].localeCompare(b[0], "fr"))
          .map(([k, n]) => `${k} : ${n}`)
          .join("  ·  ") || "—"
      }`,
    },
  ];
  if (mutualisees > 0) {
    notes.push({
      kind: "note",
      text: `${effectif(mutualisees, "ECUE", "ECUE")} ${
        mutualisees === 1 ? "est rattachée" : "sont rattachées"
      } à plusieurs UE : ${
        mutualisees === 1 ? "elle figure" : "elles figurent"
      } sous chacune d'elles, mais ${
        mutualisees === 1 ? "n'est comptée" : "ne sont comptées"
      } qu'une fois dans le total.`,
    });
  }

  return {
    title: "Catalogue des ECUE",
    subtitle: [o.classe, o.ue].filter(Boolean).join("  ·  "),
    filename: `catalogue-ecue-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(items.length, "ECUE", "ECUE"),
    blocks: [tableau(groupes, items), ...notes],
  };
}

export const openEcueReportPdf = (
  items: any[],
  o: EcueExportOptions,
  win?: Window | null
) => openReportPdf(buildEcueReportSpec(items, o), win);
