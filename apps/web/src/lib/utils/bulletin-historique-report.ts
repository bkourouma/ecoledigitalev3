/**
 * Export PDF de l'historique des bulletins — Module Professionnel.
 *
 * Le document reprend le tableau tel qu'il est affiché : une ligne par
 * étudiant, une colonne par semestre de l'année scolaire choisie, puis le
 * statut global de la filière. Le périmètre exact (filière, année, recherche)
 * est rappelé en tête.
 *
 * Les deux dérivations de l'écran — le contenu d'une cellule de semestre et le
 * statut de filière — sont passées en paramètres plutôt que réécrites ici : le
 * papier ne peut pas diverger de ce que l'utilisateur a sous les yeux.
 */
import {
  dateEdition,
  effectif,
  slugFichier,
  stampFichier,
  type ReportColumn,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

/** 12.5 → « 12,50 » ; absent → « — » (même affichage qu'à l'écran). */
const fmtNote = (x: number | null | undefined): string =>
  x == null ? "—" : Number(x).toFixed(2).replace(".", ",");

export interface BulletinHistoriqueExportContexte {
  filiere: string;
  /** Année scolaire sélectionnée (« 2025-2026 »). */
  annee: string;
  /** Semestres affichés, dans l'ordre des colonnes de l'écran. */
  semestres: Array<{
    id: string;
    libelle: string;
    /** Statut dérivé de l'avancement des bulletins (« terminee », « en_cours »). */
    statut?: string;
    /** Date de clôture des bulletins, si le semestre a été archivé. */
    clotureAt?: string | null;
  }>;
  recherche?: string;
  /** Bulletin généré d'un étudiant pour un semestre, ou `null`. */
  bulletinOf: (studentId: string, semestreId: string) => any | null;
  /** Statut global de la filière, tel que calculé par l'écran. */
  statutFiliereOf: (studentId: string) => { label: string; detail?: string };
}

/** Contenu d'une cellule de semestre : moyenne et crédits validés. */
function celluleSemestre(b: any | null): string {
  if (!b) return "Non généré";
  return `${fmtNote(b.moyenne_session)}  ·  ${b.credits_valides}/${b.credits_total} cr.`;
}

export function buildBulletinHistoriqueReportSpec(
  students: any[],
  ctx: BulletinHistoriqueExportContexte
): ReportSpec {
  // Ordre alphabétique : le tableau à l'écran suit l'ordre de l'API.
  const triees = [...students].sort((a, b) =>
    `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
      `${b.last_name ?? ""} ${b.first_name ?? ""}`,
      "fr"
    )
  );

  // Bulletins générés par semestre — sert au pied de tableau, colonne par colonne.
  const generesPar = ctx.semestres.map(
    (sm) => triees.filter((st) => ctx.bulletinOf(st.student_id, sm.id)).length
  );
  const nbValidees = triees.filter(
    (st) => ctx.statutFiliereOf(st.student_id).label === "Filière validée"
  ).length;

  const perimetre: Array<[string, string]> = [
    ["Filière", ctx.filiere || "—"],
    ["Année scolaire", ctx.annee || "—"],
    ["Semestres affichés", ctx.semestres.map((s) => s.libelle).join(", ") || "—"],
    ["Étudiants", effectif(triees.length, "étudiant")],
    ["Filières validées", effectif(nbValidees, "étudiant")],
  ];
  if (ctx.recherche) perimetre.push(["Recherche", `« ${ctx.recherche} »`]);

  const columns: ReportColumn[] = [
    { header: "N°", width: 10, align: "center" },
    { header: "Matricule", width: 32, align: "center" },
    { header: "Nom", width: 36 },
    { header: "Prénom(s)", width: 36 },
    // Les colonnes de semestre se partagent la place restante.
    // Seule la clôture est signalée : le statut « terminé », dérivé de
    // l'avancement, n'apprend rien de plus sur le papier.
    ...ctx.semestres.map((sm) => ({
      header: sm.clotureAt ? `${sm.libelle} (clôturé)` : sm.libelle,
      align: "center" as const,
    })),
    { header: "Statut filière", width: 40, align: "center" },
  ];

  const rows = triees.map((st, i) => {
    const fs = ctx.statutFiliereOf(st.student_id);
    return [
      String(i + 1),
      st.matricule || "—",
      (st.last_name || "—").toUpperCase(),
      st.first_name || "—",
      ...ctx.semestres.map((sm) => celluleSemestre(ctx.bulletinOf(st.student_id, sm.id))),
      fs.detail ? `${fs.label}  ·  ${fs.detail}` : fs.label,
    ];
  });

  const footer = [
    "",
    "",
    `TOTAL — ${effectif(triees.length, "étudiant")}`,
    "",
    ...generesPar.map((n) => `${n} généré${n > 1 ? "s" : ""}`),
    `${nbValidees} validée${nbValidees > 1 ? "s" : ""}`,
  ];

  return {
    title: "Historique des bulletins",
    subtitle: [ctx.filiere, ctx.annee].filter(Boolean).join("  ·  "),
    filename: `bulletins-historique-${slugFichier(`${ctx.filiere} ${ctx.annee}`)}-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(triees.length, "étudiant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      ...(rows.length === 0
        ? [{ kind: "note" as const, text: "Aucun étudiant à exporter sur ce périmètre." }]
        : [{ kind: "table" as const, table: { columns, rows, footer } }]),
    ],
  };
}

export const openBulletinHistoriquePdf = (
  students: any[],
  ctx: BulletinHistoriqueExportContexte,
  win?: Window | null
) => openReportPdf(buildBulletinHistoriqueReportSpec(students, ctx), win);
