/**
 * Export PDF de la liste des diplômes d'un cycle — Module Professionnel.
 *
 * Le document reprend le tableau tel qu'il est filtré à l'écran (grade, cycle,
 * année d'obtention, statut, recherche) : une ligne par étudiant du cycle, sa
 * progression et son statut d'octroi. Le périmètre exact est rappelé en tête.
 *
 * Ce n'est PAS le diplôme lui-même, ni son attestation d'authenticité — ces
 * documents nominatifs sont produits par `diplome-pdf.ts` et
 * `attestation-authenticite-pdf.ts` au clic sur la ligne d'un étudiant. Ici on
 * édite la liste de travail : qui est diplômé, qui est éligible, qui non.
 */
import {
  dateEdition,
  effectif,
  slugFichier,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

export interface DiplomeExportContexte {
  /** Grade filtré : « Licence », « Master », ou « Tous les cycles ». */
  grade: string;
  /** Cycle (spécialité) sélectionné, tel qu'affiché au-dessus du tableau. */
  cycle: string;
  /** Années du cycle (« L1GL, L2GL, L3GL »). */
  annees: string;
  /** Filtre d'année d'obtention. */
  annee: string;
  /** Filtre d'affichage : tous / éligibles / diplômés. */
  statut: string;
  recherche?: string;
}

/**
 * Statut d'octroi, dérivé comme le badge de l'écran. L'ordre compte : un
 * diplôme révoqué reste révoqué même si l'étudiant est toujours éligible.
 */
function statutOctroi(c: any): string {
  if (c.statut_octroi === "obtenu") return "Diplômé";
  if (c.statut_octroi === "revoque") return "Révoqué";
  return c.eligible ? "Éligible" : "En cours";
}

export function buildDiplomeReportSpec(
  candidats: any[],
  ctx: DiplomeExportContexte,
  /** Année scolaire d'une date d'octroi — la dérivation de l'écran. */
  anneeDe: (date: string | null | undefined) => string | null
): ReportSpec {
  // L'API trie déjà par nom complet ; on ne réordonne pas.
  const nbDiplomes = candidats.filter((c) => c.statut_octroi === "obtenu").length;
  const nbEligibles = candidats.filter(
    (c) => c.statut_octroi !== "obtenu" && c.statut_octroi !== "revoque" && c.eligible
  ).length;
  const nbRevoques = candidats.filter((c) => c.statut_octroi === "revoque").length;

  const perimetre: Array<[string, string]> = [
    ["Grade", ctx.grade || "Tous les cycles"],
    ["Cycle (spécialité)", ctx.cycle || "—"],
    ["Années du cycle", ctx.annees || "—"],
    ["Année d'obtention", ctx.annee || "Toutes les années"],
    ["Affichage", ctx.statut || "—"],
    ["Diplômés", effectif(nbDiplomes, "étudiant")],
    ["Éligibles non encore diplômés", effectif(nbEligibles, "étudiant")],
  ];
  if (nbRevoques > 0) perimetre.push(["Diplômes révoqués", effectif(nbRevoques, "étudiant")]);
  if (ctx.recherche) perimetre.push(["Recherche", `« ${ctx.recherche} »`]);

  return {
    title: "Diplômes du cycle",
    subtitle: [ctx.cycle, ctx.annee].filter(Boolean).join("  ·  "),
    filename: `diplomes-${slugFichier(ctx.cycle)}-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(candidats.length, "étudiant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      ...(candidats.length === 0
        ? [{ kind: "note" as const, text: "Aucun étudiant ne correspond à ce périmètre." }]
        : [
            {
              kind: "table" as const,
              table: {
                columns: [
                  { header: "N°", width: 10, align: "center" as const },
                  { header: "Matricule", width: 34, align: "center" as const },
                  { header: "Étudiant" },
                  { header: "Année d'obtention", width: 32, align: "center" as const },
                  { header: "UV validées", width: 26, align: "center" as const },
                  { header: "Progression", width: 24, align: "center" as const },
                  { header: "Statut", width: 28, align: "center" as const },
                ],
                rows: candidats.map((c, i) => [
                  String(i + 1),
                  c.student_number || "—",
                  c.nom_complet || "—",
                  // L'année n'a de sens que pour un diplôme effectivement octroyé.
                  c.statut_octroi === "obtenu" ? c.annee_classe || anneeDe(c.date_obtention) || "—" : "—",
                  String(c.uv_validees ?? 0),
                  `${c.pourcentage ?? 0} %`,
                  statutOctroi(c),
                ]),
                footer: [
                  "",
                  "",
                  `TOTAL — ${effectif(candidats.length, "étudiant")}`,
                  "",
                  "",
                  "",
                  `${nbDiplomes} diplômé${nbDiplomes > 1 ? "s" : ""}`,
                ],
              },
            },
          ]),
    ],
  };
}

export const openDiplomeListePdf = (
  candidats: any[],
  ctx: DiplomeExportContexte,
  anneeDe: (date: string | null | undefined) => string | null,
  win?: Window | null
) => openReportPdf(buildDiplomeReportSpec(candidats, ctx, anneeDe), win);
