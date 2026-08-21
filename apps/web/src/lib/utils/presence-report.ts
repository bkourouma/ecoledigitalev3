/**
 * Export PDF de la synthèse des présences — Module Professionnel.
 *
 * Le document reprend le tableau tel qu'il est filtré à l'écran (filière,
 * année scolaire, statut des sessions, semestre, recherche), sans la colonne
 * « Détails » qui n'a de sens que dans l'application. Le périmètre exact est
 * rappelé en tête du document.
 */
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

/** 4.5 → « 4h30 » ; 2 → « 2h » — identique à l'affichage de l'écran. */
export function fmtHeures(h: number | null | undefined): string {
  const v = Number(h ?? 0);
  const heures = Math.floor(v);
  const minutes = Math.round((v - heures) * 60);
  return minutes > 0 ? `${heures}h${String(minutes).padStart(2, "0")}` : `${heures}h`;
}

export interface PresenceExportContexte {
  filiere: string;
  annee: string;
  statut: string;
  semestre: string;
  recherche?: string;
  /** Statistiques affichées au-dessus du tableau. */
  stats: {
    appels: number;
    seances: number;
    heuresPointees: number;
    heuresAbsence: number;
    taux: number | null;
  };
}

export function buildPresenceReportSpec(
  students: any[],
  ctx: PresenceExportContexte
): ReportSpec {
  // Ordre alphabétique : le tableau à l'écran suit l'ordre de l'API.
  const triees = [...students].sort((a, b) =>
    `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
      `${b.last_name ?? ""} ${b.first_name ?? ""}`,
      "fr"
    )
  );

  const totalAppels = triees.reduce((s, e) => s + Number(e.nb_appels ?? 0), 0);
  const totalPresent = triees.reduce((s, e) => s + Number(e.nb_present ?? 0), 0);
  const totalAbsent = triees.reduce((s, e) => s + Number(e.nb_absent ?? 0), 0);
  const totalRetard = triees.reduce((s, e) => s + Number(e.nb_retard ?? 0), 0);
  const totalExcuse = triees.reduce((s, e) => s + Number(e.nb_excuse ?? 0), 0);
  const totalHeures = triees.reduce((s, e) => s + Number(e.heures_absence ?? 0), 0);

  const tauxDe = (e: any) =>
    Number(e.nb_appels) > 0
      ? `${Math.round((Number(e.nb_present) / Number(e.nb_appels)) * 100)} %`
      : "—";

  const perimetre: Array<[string, string]> = [
    ["Filière", ctx.filiere || "—"],
    ["Année scolaire", ctx.annee || "—"],
    ["Sessions", ctx.statut || "—"],
    ["Semestre", ctx.semestre || "—"],
    ["Séances pointées", `${ctx.stats.appels} / ${ctx.stats.seances}`],
    ["Heures de cours pointées", fmtHeures(ctx.stats.heuresPointees)],
    ["Heures d'absence cumulées", fmtHeures(ctx.stats.heuresAbsence)],
    ["Taux de présence global", ctx.stats.taux == null ? "—" : `${ctx.stats.taux} %`],
  ];
  if (ctx.recherche) perimetre.push(["Recherche", `« ${ctx.recherche} »`]);

  return {
    title: "Synthèse des présences",
    subtitle: [ctx.filiere, ctx.semestre, ctx.annee].filter(Boolean).join("  ·  "),
    filename: `presences-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "étudiant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 10, align: "center" },
            { header: "Matricule", width: 28, align: "center" },
            { header: "Nom", width: 42 },
            { header: "Prénom(s)" },
            { header: "Pointages", width: 22, align: "center" },
            { header: "Présent", width: 20, align: "center" },
            { header: "Absent", width: 20, align: "center" },
            { header: "Retard", width: 20, align: "center" },
            { header: "Excusé", width: 20, align: "center" },
            { header: "Heures d'absence", width: 30, align: "center" },
            { header: "Taux", width: 20, align: "center" },
          ],
          rows: triees.map((e, i) => [
            String(i + 1),
            e.matricule || "—",
            (e.last_name || "—").toUpperCase(),
            e.first_name || "—",
            String(e.nb_appels ?? 0),
            String(e.nb_present ?? 0),
            String(e.nb_absent ?? 0),
            String(e.nb_retard ?? 0),
            String(e.nb_excuse ?? 0),
            fmtHeures(e.heures_absence),
            tauxDe(e),
          ]),
          footer: [
            "",
            "",
            `TOTAL — ${effectif(triees.length, "étudiant")}`,
            "",
            String(totalAppels),
            String(totalPresent),
            String(totalAbsent),
            String(totalRetard),
            String(totalExcuse),
            fmtHeures(totalHeures),
            totalAppels > 0 ? `${Math.round((totalPresent / totalAppels) * 100)} %` : "—",
          ],
        },
      },
    ],
  };
}

export const openPresencePdf = (
  students: any[],
  ctx: PresenceExportContexte,
  win?: Window | null
) => openReportPdf(buildPresenceReportSpec(students, ctx), win);
