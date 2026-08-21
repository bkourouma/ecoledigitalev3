/**
 * Export PDF de la liste des attestations de réussite — Module Professionnel.
 *
 * Le document reprend le tableau tel qu'il est filtré à l'écran (cycle,
 * filière, année scolaire, statut, recherche) : une ligne par étudiant, son
 * avancement en UV et son éligibilité. Le périmètre exact est rappelé en tête.
 *
 * Ce n'est PAS l'attestation elle-même — celle-ci est un document nominatif,
 * produit par `attestation-pdf.ts` au clic sur la ligne d'un étudiant. Ici on
 * édite la liste de travail : qui peut recevoir son attestation, et qui non.
 */
import {
  dateEdition,
  effectif,
  slugFichier,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

export interface AttestationExportContexte {
  cycle: string;
  filiere: string;
  annee: string;
  /** Filtre d'affichage : « Tous les inscrits » ou « Éligibles uniquement ». */
  statut: string;
  recherche?: string;
  /** UE requises pour la filière, telles qu'annoncées au-dessus du tableau. */
  ueRequises: number;
  uvTotal: number;
  /** Intitulé du diplôme délivré, quand il est connu. */
  diplome?: string | null;
}

/** Éligibilité : « Validés », sinon le nombre d'UE encore à valider. */
function statutEtudiant(s: any): string {
  if (s.eligible) return "Validés";
  const n = s.ue_manquantes?.length ?? 0;
  return `${n} UE restante${n > 1 ? "s" : ""}`;
}

export function buildAttestationReportSpec(
  students: any[],
  ctx: AttestationExportContexte
): ReportSpec {
  // L'API trie déjà par nom complet ; on ne réordonne pas.
  const nbEligibles = students.filter((s) => s.eligible).length;

  const perimetre: Array<[string, string]> = [
    ["Cycle", ctx.cycle || "Tous les cycles"],
    ["Filière", ctx.filiere || "—"],
    ["Année scolaire", ctx.annee || "Toutes les années"],
    ["Affichage", ctx.statut || "—"],
    ["UE requises", `${ctx.ueRequises} UE  ·  ${ctx.uvTotal} UV`],
    ["Attestations délivrables", effectif(nbEligibles, "étudiant")],
  ];
  if (ctx.diplome) perimetre.push(["Diplôme délivré", ctx.diplome]);
  if (ctx.recherche) perimetre.push(["Recherche", `« ${ctx.recherche} »`]);

  return {
    title: "Attestations de réussite",
    subtitle: [ctx.filiere, ctx.annee].filter(Boolean).join("  ·  "),
    filename: `attestations-${slugFichier(ctx.filiere)}-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(students.length, "étudiant"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      ...(students.length === 0
        ? [{ kind: "note" as const, text: "Aucun étudiant ne correspond à ce périmètre." }]
        : [
            {
              kind: "table" as const,
              table: {
                columns: [
                  { header: "N°", width: 10, align: "center" as const },
                  { header: "Matricule", width: 34, align: "center" as const },
                  { header: "Étudiant" },
                  { header: "Année scolaire", width: 30, align: "center" as const },
                  { header: "UV validées", width: 26, align: "center" as const },
                  { header: "Avancement", width: 24, align: "center" as const },
                  { header: "Statut", width: 34, align: "center" as const },
                ],
                rows: students.map((s, i) => [
                  String(i + 1),
                  s.matricule || "—",
                  s.nom_complet || "—",
                  s.annee_scolaire || "—",
                  `${s.uv_validees}/${s.uv_required}`,
                  `${s.pourcentage} %`,
                  statutEtudiant(s),
                ]),
                footer: [
                  "",
                  "",
                  `TOTAL — ${effectif(students.length, "étudiant")}`,
                  "",
                  "",
                  "",
                  `${nbEligibles} délivrable${nbEligibles > 1 ? "s" : ""}`,
                ],
              },
            },
          ]),
    ],
  };
}

export const openAttestationListePdf = (
  students: any[],
  ctx: AttestationExportContexte,
  win?: Window | null
) => openReportPdf(buildAttestationReportSpec(students, ctx), win);
