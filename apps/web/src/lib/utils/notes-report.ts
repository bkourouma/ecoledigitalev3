/**
 * Exports PDF et Word des notes — Module Professionnel.
 *
 * Le périmètre suit la sélection de l'écran : filière → semestre → UE. Le
 * document porte une section par UE et, dans chacune, une ligne par couple
 * (étudiant, ECUE) : l'identité de l'étudiant n'est écrite que sur sa première
 * ligne, ses autres lignes se lisant comme une cellule fusionnée. Une grille à
 * trois sous-colonnes par ECUE, comme à l'écran, deviendrait illisible dès
 * quatre ECUE.
 *
 * La note de conduite est semestrielle : elle fait l'objet d'un tableau à part.
 */
import {
  dateEdition,
  effectif,
  slugFichier,
  stampFichier,
  type ReportBlock,
  type ReportColumn,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { apiGet, enParallele } from "@/lib/utils/report-api";
import { openReportPdf } from "@/lib/utils/report-pdf";
import { downloadReportDocx } from "@/lib/utils/report-docx";

/* -------------------------------- Options ------------------------------- */

export const NOTES_EXPORT_CHOICES = [
  { key: "devoirs", label: "Moyenne des devoirs", hint: "Colonne « Devoirs (/20) »" },
  { key: "examen", label: "Note d'examen", hint: "Colonne « Examen (/20) »" },
  { key: "statut", label: "Statut de l'ECUE", hint: "Validé, compensé, insuffisant, éliminatoire" },
  { key: "conduite", label: "Notes de conduite", hint: "Tableau semestriel, en fin de document" },
] as const;

export type NotesExportKey = (typeof NOTES_EXPORT_CHOICES)[number]["key"];

export const NOTES_EXPORT_DEFAUT: NotesExportKey[] = ["devoirs", "examen", "statut"];

export interface NotesExportContexte {
  choix: Set<string>;
  filiere: string;
  semestre: string;
  /** Année scolaire déduite des dates du semestre. */
  annee: string;
  /** UE (cohortes) du semestre, telles que listées à l'écran — toutes exportées. */
  sessions: any[];
  /**
   * Grilles déjà chargées par l'écran, dans l'ordre de `sessions`. Fournies,
   * elles évitent de redemander à l'API ce qui est déjà affiché.
   */
  grilles?: Array<any | null>;
  /** Notes de conduite du semestre, par étudiant. */
  conduite?: any[];
  /** Précision de portée (« Cohortes terminées »), rappelée en tête. */
  porteeLibelle?: string;
}

/* ------------------------------- Formatage ------------------------------ */

/** 12.5 → « 12,50 » ; absent → « — » (même affichage qu'à l'écran). */
const fmtNote = (x: number | null | undefined): string =>
  x == null ? "—" : Number(x).toFixed(2).replace(".", ",");

/** Statut d'un résultat d'ECUE, dérivé comme la cellule « Note » de l'écran. */
function statutEcue(result: any): string {
  if (!result) return "En attente";
  if (result.eliminee) return "Éliminatoire";
  if (result.validee) return "Validé";
  if (result.moyenne == null) return "En attente";
  return result.moyenne >= 5 ? "Insuffisant" : "Éliminatoire";
}

/* ------------------------------- Données -------------------------------- */

/** Grille d'une cohorte : ECUE, étudiants, résultats. */
async function chargerGrille(sessionId: string): Promise<any | null> {
  try {
    return await apiGet<any>(`/api/v1/professional/ue-sessions/${sessionId}/grid`);
  } catch {
    // Une grille illisible ne fait pas échouer l'export : sa section le signale.
    return null;
  }
}

/* ------------------------------ Construction ---------------------------- */

function colonnes(o: NotesExportContexte): ReportColumn[] {
  const cols: ReportColumn[] = [
    { header: "N°", width: 10, align: "center" },
    { header: "Matricule", width: 36, align: "center" },
    { header: "Nom", width: 42 },
    { header: "Prénom(s)", width: 44 },
    { header: "Intitulé de l'ECUE" },
  ];
  if (o.choix.has("devoirs")) cols.push({ header: "Devoirs /20", width: 24, align: "center" });
  if (o.choix.has("examen")) cols.push({ header: "Examen /20", width: 24, align: "center" });
  cols.push({ header: "Note /20", width: 22, align: "center" });
  if (o.choix.has("statut")) cols.push({ header: "Statut", width: 26, align: "center" });
  return cols;
}

/**
 * Bandeau de contexte, repris en tête de chaque page : sans lui, les pages
 * suivantes ne diraient plus de quelle filière ni de quel semestre il s'agit.
 */
function bandeau(o: NotesExportContexte): ReportBlock {
  return {
    kind: "heading",
    text: o.filiere || "Filière",
    note: [o.semestre, o.annee].filter(Boolean).join("  ·  "),
  };
}

/**
 * Section d'une UE : sa grille de notes, étudiant par étudiant.
 *
 * Chaque UE ouvre sa propre page (sauf la première, qui suit le rappel du
 * périmètre) : le relevé d'une UE se détache ainsi pour l'impression.
 */
function sectionUe(
  session: any,
  grille: any | null,
  o: NotesExportContexte,
  premiere: boolean
): ReportBlock[] {
  const titre = `${session.ue_code ?? ""} — ${session.ue_libelle ?? session.libelle ?? ""}`.trim();
  const ouverture: ReportBlock[] = premiere
    ? [bandeau(o)]
    : [{ kind: "pageBreak" }, bandeau(o)];

  if (!grille) {
    return [
      ...ouverture,
      { kind: "heading", level: 2, text: titre || "Unité d'enseignement" },
      { kind: "note", text: "Grille de notes indisponible pour cette UE." },
    ];
  }

  const ecues: any[] = grille.ecues ?? [];
  const etudiants: any[] = [...(grille.students ?? [])].sort((a, b) =>
    `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
      `${b.last_name ?? ""} ${b.first_name ?? ""}`,
      "fr"
    )
  );
  const resultat = (ecueId: string, studentId: string) =>
    (grille.results ?? []).find((r: any) => r.ecue_id === ecueId && r.student_id === studentId) ??
    null;

  const blocs: ReportBlock[] = [
    ...ouverture,
    {
      kind: "heading",
      level: 2,
      text: titre || "Unité d'enseignement",
      note: `${effectif(etudiants.length, "étudiant")}  ·  ${effectif(ecues.length, "ECUE", "ECUE")}`,
    },
  ];

  if (etudiants.length === 0 || ecues.length === 0) {
    blocs.push({ kind: "note", text: "Aucune note à exporter pour cette UE." });
    return blocs;
  }

  const rows: string[][] = [];
  etudiants.forEach((s, i) => {
    ecues.forEach((e, j) => {
      const r = resultat(e.ecue_id, s.student_id);
      const cells = [
        j === 0 ? String(i + 1) : "",
        j === 0 ? s.matricule || "—" : "",
        j === 0 ? (s.last_name || "—").toUpperCase() : "",
        j === 0 ? s.first_name || "—" : "",
        e.libelle ?? "—",
      ];
      if (o.choix.has("devoirs")) cells.push(fmtNote(r?.moyenne_devoirs));
      if (o.choix.has("examen")) cells.push(fmtNote(r?.note_examen));
      cells.push(fmtNote(r?.moyenne));
      if (o.choix.has("statut")) cells.push(statutEcue(r));
      rows.push(cells);
    });
  });

  blocs.push({ kind: "table", table: { columns: colonnes(o), rows } });
  return blocs;
}

/** Tableau semestriel des notes de conduite — sur sa propre page, comme les UE. */
function sectionConduite(conduite: any[], o: NotesExportContexte): ReportBlock[] {
  const ouverture: ReportBlock[] = [{ kind: "pageBreak" }, bandeau(o)];
  if (conduite.length === 0) {
    return [
      ...ouverture,
      { kind: "heading", level: 2, text: "Conduite du semestre" },
      { kind: "note", text: "Aucune note de conduite saisie pour ce semestre." },
    ];
  }
  const triees = [...conduite].sort((a, b) =>
    `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
      `${b.last_name ?? ""} ${b.first_name ?? ""}`,
      "fr"
    )
  );
  const notees = triees.filter((s) => s.note != null);
  const moyenne =
    notees.length > 0 ? notees.reduce((sum, s) => sum + Number(s.note), 0) / notees.length : null;

  return [
    ...ouverture,
    {
      kind: "heading",
      level: 2,
      text: "Conduite du semestre",
      note: `${effectif(notees.length, "note saisie", "notes saisies")} / ${triees.length}`,
    },
    {
      kind: "table",
      table: {
        columns: [
          { header: "N°", width: 10, align: "center" },
          { header: "Matricule", width: 30, align: "center" },
          { header: "Nom", width: 50 },
          { header: "Prénom(s)" },
          { header: "Conduite /20", width: 28, align: "center" },
        ],
        rows: triees.map((s, i) => [
          String(i + 1),
          s.matricule || "—",
          (s.last_name || "—").toUpperCase(),
          s.first_name || "—",
          fmtNote(s.note),
        ]),
        footer: ["", "", `MOYENNE — ${effectif(triees.length, "étudiant")}`, "", fmtNote(moyenne)],
      },
    },
  ];
}

export async function buildNotesReportSpec(o: NotesExportContexte): Promise<ReportSpec> {
  // L'export se fait depuis l'Historique, qui affiche tout le semestre : ce
  // sont donc toutes ses UE qui partent dans le document.
  const cibles = o.sessions;

  // Grilles déjà à l'écran : on les réutilise plutôt que de les redemander.
  const grilles = o.grilles
    ? cibles.map((_, i) => o.grilles![i] ?? null)
    : await enParallele(cibles, (s) => chargerGrille(s.id));

  const perimetre: Array<[string, string]> = [
    ["Filière", o.filiere || "—"],
    ["Semestre", o.semestre || "—"],
    ["Année scolaire", o.annee || "—"],
    ["Périmètre", "Toutes les UE du semestre"],
  ];
  if (o.porteeLibelle) perimetre.push(["Portée", o.porteeLibelle]);

  const blocks: ReportBlock[] = [
    { kind: "keyValues", items: perimetre, columns: 2 },
    ...cibles.flatMap((s, i) => sectionUe(s, grilles[i], o, i === 0)),
  ];

  if (o.choix.has("conduite")) blocks.push(...sectionConduite(o.conduite ?? [], o));

  return {
    title: "Relevé des notes",
    subtitle: [o.filiere, o.semestre, o.annee].filter(Boolean).join("  ·  "),
    // Le nom porte la filière et le semestre : ces documents s'archivent, et
    // « notes-2026-08-21 » ne se distingue pas d'un autre export du même jour.
    filename: `notes-${slugFichier(`${o.filiere} ${o.semestre}`, 50)}-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(cibles.length, "UE exportée", "UE exportées"),
    blocks,
  };
}

export async function openNotesReportPdf(o: NotesExportContexte, win?: Window | null) {
  try {
    return await openReportPdf(await buildNotesReportSpec(o), win);
  } catch (e) {
    // La construction interroge l'API : l'onglet déjà ouvert doit être refermé.
    if (win) win.close();
    throw e;
  }
}

export async function downloadNotesReportDocx(o: NotesExportContexte) {
  return downloadReportDocx(await buildNotesReportSpec(o));
}
