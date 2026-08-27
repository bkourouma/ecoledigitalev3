/**
 * Export PDF des étudiants inscrits — Module Professionnel (admin).
 *
 * Le document reprend exactement ce que l'écran affiche : une ligne par carte,
 * c'est-à-dire par binôme étudiant + classe, dans le périmètre courant (année
 * scolaire, nom de classe, recherche). Le statut est celui calculé par la page
 * elle-même, transmis en option : le document ne peut donc pas diverger de ce
 * qui est sous les yeux.
 */
import {
  dateEdition,
  effectif,
  stampFichier,
  type ReportSpec,
} from "@/lib/utils/report-doc";
import { openReportPdf } from "@/lib/utils/report-pdf";

export interface InscritsExportOptions {
  /** Année scolaire sélectionnée, ou « Toutes les années ». */
  annee: string;
  /** Nom de classe sélectionné, ou « Tous les noms de classe ». */
  nomClasse: string;
  /** Recherche en cours sur l'écran. */
  recherche?: string;
  /** Statut résumé d'un groupe, tel qu'affiché sur sa carte. */
  statutOf: (groupe: any) => string;
}

export function buildInscritsReportSpec(
  groupes: any[],
  o: InscritsExportOptions
): ReportSpec {
  // Les cartes sont déjà triées par nom : on conserve cet ordre.
  const totalInscriptions = groupes.reduce(
    (s, g) => s + (Array.isArray(g.enrollments) ? g.enrollments.length : 0),
    0
  );
  const etudiants = new Set(groupes.map((g) => String(g.student_id))).size;

  const perimetre: Array<[string, string]> = [
    ["Année scolaire", o.annee || "—"],
    ["Nom de classe", o.nomClasse || "—"],
    ["Étudiants distincts", effectif(etudiants, "étudiant")],
    ["Inscriptions aux UE", String(totalInscriptions)],
  ];
  if (o.recherche) perimetre.push(["Recherche", `« ${o.recherche} »`]);

  const parStatut = groupes.reduce<Record<string, number>>((acc, g) => {
    const k = o.statutOf(g) || "—";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    title: "Étudiants inscrits",
    subtitle: [o.annee, o.nomClasse].filter(Boolean).join("  ·  "),
    filename: `inscrits-${stampFichier()}`,
    metaLeft: `Édité le ${dateEdition()}`,
    metaRight: effectif(groupes.length, "inscription"),
    blocks: [
      { kind: "keyValues", items: perimetre, columns: 2 },
      {
        kind: "table",
        table: {
          columns: [
            { header: "N°", width: 12, align: "center" },
            // Assez large pour qu'un matricule tienne sur une seule ligne.
            { header: "Matricule", width: 42, align: "center" },
            { header: "Nom & Prénom(s)" },
            { header: "UE", width: 16, align: "center" },
            { header: "Statut", width: 42, align: "center" },
          ],
          rows: groupes.map((g, i) => [
            String(i + 1),
            g.matricule || "—",
            `${String(g.last_name || "—").toUpperCase()} ${g.first_name || ""}`.trim(),
            String(Array.isArray(g.enrollments) ? g.enrollments.length : 0),
            o.statutOf(g) || "—",
          ]),
          footer: [
            "",
            "",
            `TOTAL — ${effectif(groupes.length, "inscription")}`,
            String(totalInscriptions),
            "",
          ],
        },
      },
      {
        kind: "note",
        text: `Répartition par statut : ${
          Object.entries(parStatut)
            .sort((a, b) => a[0].localeCompare(b[0], "fr"))
            .map(([k, n]) => `${k} : ${n}`)
            .join("  ·  ") || "—"
        }`,
      },
    ],
  };
}

export const openInscritsPdf = (
  groupes: any[],
  o: InscritsExportOptions,
  win?: Window | null
) => openReportPdf(buildInscritsReportSpec(groupes, o), win);
