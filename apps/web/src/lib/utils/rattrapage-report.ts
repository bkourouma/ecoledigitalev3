/**
 * Export PDF de la liste des étudiants en session de rattrapage — Module
 * Professionnel.
 *
 * Le document reprend ce que l'écran affiche pour le semestre sélectionné,
 * recherche comprise : une ligne par ECUE à repasser, l'identité de l'étudiant
 * n'étant écrite que sur sa première ligne — ses lignes suivantes se lisent
 * comme une cellule fusionnée, comme dans l'export des notes.
 *
 * UE et ECUE ne portent que leur intitulé : le code, utile à l'écran pour lever
 * une ambiguïté au survol, ne fait qu'allonger la cellule sur le papier.
 */
import {
  dateEdition,
  effectif,
  slugFichier,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

/** 12.5 → « 12,50 » ; absent → « — » (même affichage qu'à l'écran). */
const fmtNote = (x: number | null | undefined): string =>
  x == null ? "—" : Number(x).toFixed(2).replace(".", ",");

/** Un étudiant et les ECUE qu'il doit repasser, tels que groupés à l'écran. */
export interface RattrapageGroupe {
  student: any;
  rows: any[];
}

export interface RattrapageExportContexte {
  filiere: string;
  semestre: string;
  recherche?: string;
}

export function buildRattrapageReportSpec(
  groupes: RattrapageGroupe[],
  ctx: RattrapageExportContexte
): ReportSpec {
  // Ordre alphabétique : le tableau à l'écran suit l'ordre de l'API.
  const triees = [...groupes].sort((a, b) =>
    `${a.student.last_name ?? ""} ${a.student.first_name ?? ""}`.localeCompare(
      `${b.student.last_name ?? ""} ${b.student.first_name ?? ""}`,
      "fr"
    )
  );

  const nbEcues = triees.reduce((n, g) => n + g.rows.length, 0);
  const nbEliminatoires = triees.reduce(
    (n, g) => n + g.rows.filter((r) => r.eliminee).length,
    0
  );
  const nbDejaSaisies = triees.reduce(
    (n, g) => n + g.rows.filter((r) => r.note_examen_s2 != null).length,
    0
  );

  const perimetre: Array<[string, string]> = [
    ["Filière", ctx.filiere || "—"],
    ["Semestre", ctx.semestre || "—"],
    ["Étudiants concernés", effectif(triees.length, "étudiant")],
    ["ECUE à repasser", effectif(nbEcues, "ECUE", "ECUE")],
    ["Dont éliminatoires (< 5/20)", effectif(nbEliminatoires, "ECUE", "ECUE")],
    ["Notes de session 2 saisies", `${nbDejaSaisies} / ${nbEcues}`],
  ];
  if (ctx.recherche) perimetre.push(["Recherche", `« ${ctx.recherche} »`]);

  const rows: string[][] = [];
  triees.forEach((g, i) => {
    g.rows.forEach((r, j) => {
      // Note d'examen de session 1 : l'écran retombe sur `note_examen` tant
      // qu'aucune note de session 2 n'a été saisie.
      const examenS1 = r.note_examen_s1 ?? (r.note_examen_s2 == null ? r.note_examen : null);
      rows.push([
        j === 0 ? String(i + 1) : "",
        j === 0 ? g.student.matricule || "—" : "",
        j === 0 ? (g.student.last_name || "—").toUpperCase() : "",
        j === 0 ? g.student.first_name || "—" : "",
        r.ue_libelle || r.ue_code || "—",
        r.ecue_libelle || r.ecue_code || "—",
        fmtNote(r.moyenne_devoirs),
        fmtNote(examenS1),
        fmtNote(r.moyenne),
        r.eliminee ? "Éliminatoire" : "Insuffisant",
      ]);
    });
  });

  return {
    title: "Étudiants en session de rattrapage",
    subtitle: [ctx.filiere, ctx.semestre].filter(Boolean).join("  ·  "),
    filename: `rattrapages-${slugFichier(ctx.semestre)}-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "étudiant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      ...(rows.length === 0
        ? ([{ kind: "note", text: "Aucun étudiant en rattrapage sur ce périmètre." }] as const)
        : ([
            {
              kind: "table",
              table: {
                columns: [
                  { header: "N°", width: 10, align: "center" },
                  { header: "Matricule", width: 34, align: "center" },
                  { header: "Nom", width: 34 },
                  { header: "Prénom(s)", width: 34 },
                  { header: "UE" },
                  { header: "ECUE" },
                  { header: "Devoirs /20", width: 20, align: "center" },
                  { header: "Examen S1 /20", width: 22, align: "center" },
                  { header: "Note actuelle", width: 22, align: "center" },
                  { header: "Statut", width: 26, align: "center" },
                ],
                rows,
                footer: [
                  "",
                  "",
                  `TOTAL — ${effectif(triees.length, "étudiant")}`,
                  "",
                  "",
                  effectif(nbEcues, "ECUE à repasser", "ECUE à repasser"),
                  "",
                  "",
                  "",
                  `${nbEliminatoires} éliminatoire${nbEliminatoires > 1 ? "s" : ""}`,
                ],
              },
            },
          ] as const)),
    ] as ReportSpec["blocks"],
  };
}

export const openRattrapagePdf = (
  groupes: RattrapageGroupe[],
  ctx: RattrapageExportContexte,
  win?: Window | null
) => openReportPdf(buildRattrapageReportSpec(groupes, ctx), win);
