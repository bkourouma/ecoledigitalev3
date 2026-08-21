/**
 * Export PDF des salles de classe.
 *
 * Le document reprend ce que l'écran affiche — le nom et le code de chaque
 * salle — et se termine par la répartition des salles par état.
 */
import { Classroom } from "@ecoledigitale/contracts";
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

const STATUT_LABEL: Record<string, string> = {
  disponible: "Disponible",
  occupe: "Occupée",
  maintenance: "Maintenance",
  hors_service: "Hors service",
};

export interface ClassroomExportOptions {
  /** Recherche en cours sur l'écran, rappelée en sous-titre. */
  filtreLibelle?: string;
}

export function buildClassroomsReportSpec(
  classrooms: Classroom[],
  o: ClassroomExportOptions = {}
): ReportSpec {
  // Ordre alphabétique : le document sert de référence, pas de reflet de l'ordre
  // de saisie.
  const triees = [...classrooms].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "fr"));

  return {
    title: "Salles de classe",
    subtitle: o.filtreLibelle,
    filename: `salles-de-classe-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "salle"),
    orientation: "portrait",
    blocks: [
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 16, align: "center" },
            { header: "Nom de la salle" },
            { header: "Code", width: 40, align: "center" },
          ],
          rows: triees.map((c, i) => [String(i + 1), c.name ?? "—", c.code ?? "—"]),
          footer: ["", `TOTAL — ${effectif(triees.length, "salle")}`, ""],
        },
      },
      {
        kind: "note",
        text: `État des salles : ${
          Object.entries(
            triees.reduce<Record<string, number>>((acc, c) => {
              const k = STATUT_LABEL[String(c.status)] ?? String(c.status ?? "—");
              acc[k] = (acc[k] ?? 0) + 1;
              return acc;
            }, {})
          )
            .map(([k, n]) => `${k} : ${n}`)
            .join("  ·  ") || "—"
        }`,
      },
    ],
  };
}

export const openClassroomsPdf = (
  classrooms: Classroom[],
  o: ClassroomExportOptions,
  win?: Window | null
) => openReportPdf(buildClassroomsReportSpec(classrooms, o), win);
