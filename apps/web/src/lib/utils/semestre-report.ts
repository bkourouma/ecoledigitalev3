/**
 * Exports PDF et Word des semestres — Module Professionnel.
 *
 * Lecture du document : un bandeau par filière, puis un tableau par semestre
 * détaillant ses UE et, pour chacune, ses ECUE avec leurs crédits, le total de
 * crédits de l'UE et son montant. Le code et l'intitulé de l'UE ne sont écrits
 * que sur sa première ligne d'ECUE — ses autres lignes se lisent comme une
 * cellule fusionnée.
 *
 * La liste affichée ne portant que des compteurs (nb_ue, nb_uv), le détail de
 * chaque semestre est chargé à l'export via `GET /semestres/:id`.
 */
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportBlock,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { apiGet, enParallele } from "@/lib/utils/report-api";
import { openReportPdf } from "@/lib/utils/report-pdf";
import { downloadReportDocx } from "@/lib/utils/report-docx";
import { fmtMontant } from "@/lib/utils/ue-report";

/** Charge le détail (UE + ECUE) de chaque semestre affiché. */
async function chargerDetails(semestres: any[]): Promise<any[]> {
  return enParallele(semestres, async (s) => {
    try {
      return await apiGet<any>(`/api/v1/professional/semestres/${s.id}`);
    } catch {
      // Un semestre illisible ne fait pas échouer l'export : sa section le dit.
      return { ...s, ues: null };
    }
  });
}

/** Tableau d'un semestre : une ligne par ECUE, regroupées par UE. */
function tableauSemestre(detail: any): ReportBlock[] {
  const ues: any[] = detail.ues ?? [];
  if (detail.ues === null) {
    return [{ kind: "note", text: "Détail indisponible pour ce semestre." }];
  }
  if (ues.length === 0) {
    return [{ kind: "note", text: "Aucune UE rattachée à ce semestre." }];
  }

  const rows: string[][] = [];
  let numero = 0;
  ues.forEach((u) => {
    const ecues: any[] = u.ecues ?? [];
    numero += 1;
    const montant = fmtMontant(u.prix, u.devise);
    const credits = String(u.nb_uv ?? 0);

    if (ecues.length === 0) {
      rows.push([String(numero), u.code ?? "—", u.libelle ?? "—", "—", "Aucun ECUE", "—", credits, montant]);
      return;
    }
    ecues.forEach((e, j) => {
      rows.push([
        j === 0 ? String(numero) : "",
        j === 0 ? (u.code ?? "—") : "",
        j === 0 ? (u.libelle ?? "—") : "",
        e.ecue_code ?? "—",
        e.ecue_libelle ?? "—",
        e.ecue_credits == null ? "—" : String(e.ecue_credits),
        j === 0 ? credits : "",
        j === 0 ? montant : "",
      ]);
    });
  });

  const totalCredits = ues.reduce((s, u) => s + Number(u.nb_uv ?? 0), 0);
  const totalMontant = ues.reduce((s, u) => s + Number(u.prix ?? 0), 0);

  return [
    {
      kind: "table",
      table: {
        columns: [
          // Les codes réels (« M2ACG-S1-UE2 ») imposent des colonnes larges :
          // un code coupé en deux lignes ne se lit plus.
          { header: "N°", width: 10, align: "center" },
          { header: "Code UE", width: 34 },
          { header: "Intitulé de l'UE", width: 48 },
          { header: "Code ECUE", width: 30 },
          // Largeur libre : cette colonne absorbe la place restante.
          { header: "Intitulé de l'ECUE" },
          { header: "Crédits ECUE", width: 28, align: "center" },
          { header: "Crédits UE", width: 24, align: "center" },
          { header: "Montant UE", width: 32, align: "right" },
        ],
        rows,
        footer: [
          "",
          "",
          `TOTAL — ${effectif(ues.length, "UE", "UE")}`,
          "",
          "",
          "",
          String(totalCredits),
          fmtMontant(totalMontant, ues[0]?.devise),
        ],
      },
    },
  ];
}

/**
 * Ordre de lecture des semestres d'une filière : Semestre 1, puis 2, puis 3.
 *
 * L'API les renvoie dans l'ordre de saisie, souvent du plus récent au plus
 * ancien. La collation numérique classe « Semestre 2 » avant « Semestre 10 »,
 * ce qu'un tri alphabétique ne ferait pas.
 */
const ordreSemestre = (a: any, b: any) =>
  String(a.libelle ?? "").localeCompare(String(b.libelle ?? ""), "fr", {
    numeric: true,
    sensitivity: "base",
  });

/** Regroupe les semestres par filière (ordre alphabétique), chacun trié. */
function parFiliere(details: any[]) {
  const groupes = new Map<string, any[]>();
  details.forEach((d) => {
    const nom = d.filiere_nom ?? "Filière non renseignée";
    if (!groupes.has(nom)) groupes.set(nom, []);
    groupes.get(nom)!.push(d);
  });
  return [...groupes.entries()]
    .map(([nom, liste]) => ({ nom, liste: [...liste].sort(ordreSemestre) }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export interface SemestreExportOptions {
  /** Filtre actif sur l'écran, rappelé en sous-titre. */
  filtreLibelle?: string;
}

export async function buildSemestreReportSpec(
  semestres: any[],
  o: SemestreExportOptions = {}
): Promise<ReportSpec> {
  const details = await chargerDetails(semestres);
  const groupes = parFiliere(details);

  // Un semestre par page : chacun se lit — et s'imprime — séparément. Le
  // bandeau de la filière est repris en tête de chaque page, sans quoi les
  // pages suivantes ne diraient plus de quelle filière elles relèvent.
  const blocks: ReportBlock[] = [];
  groupes.forEach((g) => {
    g.liste.forEach((d) => {
      if (blocks.length > 0) blocks.push({ kind: "pageBreak" });
      blocks.push({
        kind: "heading",
        text: g.nom,
        note: effectif(g.liste.length, "semestre"),
      });

      const ues: any[] = d.ues ?? [];
      const credits = ues.reduce((s, u) => s + Number(u.nb_uv ?? 0), 0);
      const montant = ues.reduce((s, u) => s + Number(u.prix ?? 0), 0);
      blocks.push({
        kind: "heading",
        level: 2,
        text: d.libelle ?? "Semestre",
        note:
          d.ues === null
            ? ""
            : `${effectif(ues.length, "UE", "UE")}  ·  ${credits} crédits  ·  ${fmtMontant(montant, ues[0]?.devise)}`,
      });
      blocks.push(...tableauSemestre(d));
    });
  });

  return {
    title: "Semestres et composition",
    subtitle: o.filtreLibelle,
    filename: `semestres-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(semestres.length, "semestre"),
    blocks,
  };
}

export async function openSemestreReportPdf(
  semestres: any[],
  o: SemestreExportOptions,
  win?: Window | null
) {
  try {
    return await openReportPdf(await buildSemestreReportSpec(semestres, o), win);
  } catch (e) {
    // La construction interroge l'API : l'onglet déjà ouvert doit être refermé.
    if (win) win.close();
    throw e;
  }
}

export async function downloadSemestreReportDocx(semestres: any[], o: SemestreExportOptions = {}) {
  return downloadReportDocx(await buildSemestreReportSpec(semestres, o));
}
