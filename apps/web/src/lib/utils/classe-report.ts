/**
 * Export PDF des classes — /academic/classes.
 *
 * Le document reprend ce que l'écran affiche — le code, le nom, la filière et
 * le cycle de chaque classe — dans le périmètre courant (recherche, filtres
 * filière et cycle), et se termine par la répartition des classes par cycle.
 */
import type { Programme } from "@/lib/hooks/use-programmes";
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

export interface ClasseExportOptions {
  /** Recherche en cours sur l'écran. */
  recherche?: string;
  /** Filière sélectionnée, ou « Toutes les filières ». */
  filiere: string;
  /** Cycle sélectionné, ou « Tous les cycles ». */
  cycle: string;
}

export function buildClassesReportSpec(
  classes: Programme[],
  o: ClasseExportOptions
): ReportSpec {
  // Ordre alphabétique : le document sert de référence, pas de reflet de
  // l'ordre de saisie.
  const triees = [...classes].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  const perimetre: Array<[string, string]> = [
    ["Filière", o.filiere || "—"],
    ["Cycle", o.cycle || "—"],
  ];
  if (o.recherche) perimetre.push(["Recherche", `« ${o.recherche} »`]);

  const parCycle = triees.reduce<Record<string, number>>((acc, c) => {
    const k = c.cycle?.name || "Sans cycle";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    title: "Classes",
    subtitle: [o.filiere, o.cycle, o.recherche ? `Recherche : « ${o.recherche} »` : null]
      .filter(Boolean)
      .join("  ·  "),
    filename: `classes-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "classe"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 12, align: "center" },
            { header: "Code", width: 40, align: "center" },
            { header: "Nom de la classe" },
            { header: "Filière", width: 80 },
            { header: "Cycle", width: 45 },
          ],
          rows: triees.map((c, i) => [
            String(i + 1),
            c.code ?? "—",
            c.name ?? "—",
            c.filiere?.name || "Non rattachée",
            c.cycle?.name || "—",
          ]),
          footer: ["", "", `TOTAL — ${effectif(triees.length, "classe")}`, "", ""],
        },
      },
      {
        kind: "note",
        text: `Répartition par cycle : ${
          Object.entries(parCycle)
            .sort((a, b) => a[0].localeCompare(b[0], "fr"))
            .map(([k, n]) => `${k} : ${n}`)
            .join("  ·  ") || "—"
        }`,
      },
    ],
  };
}

export const openClassesPdf = (
  classes: Programme[],
  o: ClasseExportOptions,
  win?: Window | null
) => openReportPdf(buildClassesReportSpec(classes, o), win);
