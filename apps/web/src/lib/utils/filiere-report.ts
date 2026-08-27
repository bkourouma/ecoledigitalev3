/**
 * Export PDF des filières — /academic/programmes.
 *
 * Le document reprend ce que l'écran affiche — le nom de la filière et son
 * domaine — dans le périmètre courant (recherche et filtre par domaine), et se
 * termine par la répartition des filières par domaine.
 */
import type { Filiere } from "@/lib/hooks/use-filieres";
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

export interface FiliereExportOptions {
  /** Recherche en cours sur l'écran. */
  recherche?: string;
  /** Domaine sélectionné, ou « Tous les domaines ». */
  domaine: string;
}

export function buildFilieresReportSpec(
  filieres: Filiere[],
  o: FiliereExportOptions
): ReportSpec {
  // Ordre alphabétique : le document sert de référence, pas de reflet de
  // l'ordre de saisie.
  const triees = [...filieres].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  // Le domaine filtré est déjà rappelé en sous-titre : le périmètre ne reprend
  // que la recherche, et disparaît quand il n'y en a pas.
  const perimetre: Array<[string, string]> = [];
  if (o.recherche) perimetre.push(["Recherche", `« ${o.recherche} »`]);

  const parDomaine = triees.reduce<Record<string, number>>((acc, f) => {
    const k = f.domaine || "Sans domaine";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    title: "Filières",
    subtitle: [o.domaine, o.recherche ? `Recherche : « ${o.recherche} »` : null]
      .filter(Boolean)
      .join("  ·  "),
    filename: `filieres-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "filière"),
    orientation: "portrait",
    blocks: [
      ...(perimetre.length
        ? [{ kind: "keyValues" as const, items: perimetre, columns: 2 as const }]
        : []),
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 16, align: "center" },
            { header: "Nom de la filière" },
            { header: "Domaine", width: 60 },
          ],
          rows: triees.map((f, i) => [String(i + 1), f.name ?? "—", f.domaine || "—"]),
          footer: ["", `TOTAL — ${effectif(triees.length, "filière")}`, ""],
        },
      },
      {
        kind: "note",
        text: `Répartition par domaine : ${
          Object.entries(parDomaine)
            .sort((a, b) => a[0].localeCompare(b[0], "fr"))
            .map(([k, n]) => `${k} : ${n}`)
            .join("  ·  ") || "—"
        }`,
      },
    ],
  };
}

export const openFilieresPdf = (
  filieres: Filiere[],
  o: FiliereExportOptions,
  win?: Window | null
) => openReportPdf(buildFilieresReportSpec(filieres, o), win);
