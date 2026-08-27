/**
 * Assemblage des rapports PDF de l'espace propriétaire.
 *
 * RÈGLE FONDATRICE DE CE FICHIER : un chiffre exporté sans son périmètre n'est
 * pas interprétable. Une page de « reste à recouvrer » filtrée sur une filière
 * et une page non filtrée se ressemblent trait pour trait une fois imprimées —
 * et se lisent pourtant à l'opposé l'une de l'autre. Tout rapport produit ici
 * s'ouvre donc sur un bloc « Périmètre du rapport » qui énumère les filtres
 * réellement appliqués.
 *
 * Deuxième règle : les dimensions rappelées sont celles de `OWNER_FILTER_SCOPE`,
 * la table qui pilote déjà la barre de filtres. Un écran qui n'accepte pas le
 * filtre « cycle » ne le mentionne pas dans son PDF — sinon le document
 * laisserait croire à une restriction qui n'a pas eu lieu.
 *
 * Les pages ne décrivent que LEUR contenu (une liste de blocs). Le titre, le
 * sous-titre, la date d'édition, le périmètre et la charte sont ajoutés ici :
 * les dix-sept rapports de l'espace sortent ainsi de la même moulinette et se
 * lisent de la même façon.
 */

import type { ReportBlock, ReportColumn, ReportSpec } from "./report-doc";
import type { OwnerFilterDimension } from "@/components/owner/filters/OwnerFilterBar";
import type { OwnerPeriod } from "@/components/owner/filters/owner-filters-context";
import type { OwnerStatsFiltersResponse } from "@ecoledigitale/contracts";

/** Libellés des périodes, identiques à ceux de la barre de filtres. */
const PERIOD_LABELS: Record<OwnerPeriod, string> = {
  month: "Mois en cours",
  quarter: "Trimestre en cours",
  year: "Année scolaire",
  custom: "Période personnalisée",
};

/** Sélection courante, telle que la porte le contexte de filtres. */
export interface OwnerReportFilters {
  academicYearId?: string;
  academicYearName?: string;
  cycleId?: string;
  filiereIds: string[];
  period: OwnerPeriod;
  dateDebut?: string;
  dateFin?: string;
}

/** Une date ISO (AAAA-MM-JJ) en JJ/MM/AAAA ; renvoie l'entrée si illisible. */
export function jourFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Le périmètre du rapport, en « Libellé : valeur ».
 *
 * Une dimension hors de la portée de l'écran est omise ; une dimension dans la
 * portée mais non renseignée est affichée à « Toutes » / « Tous ». Cette
 * distinction est le cœur du bloc : elle sépare « ce filtre n'existe pas ici »
 * de « ce filtre existe et je ne l'ai pas restreint ».
 */
export function describeOwnerScope(
  dimensions: OwnerFilterDimension[],
  filters: OwnerReportFilters,
  options: OwnerStatsFiltersResponse | undefined
): Array<[string, string]> {
  const items: Array<[string, string]> = [];

  if (dimensions.includes("year")) {
    items.push([
      "Année scolaire",
      filters.academicYearName ??
        options?.academicYears.find((y) => y.id === filters.academicYearId)?.name ??
        "Toutes",
    ]);
  }

  if (dimensions.includes("cycle")) {
    const cycle = options?.cycles.find((c) => c.id === filters.cycleId);
    items.push(["Cycle", cycle?.name ?? "Tous"]);
  }

  if (dimensions.includes("filieres")) {
    const noms = filters.filiereIds
      .map((id) => options?.filieres.find((f) => f.id === id)?.name)
      .filter((n): n is string => !!n);
    // Au-delà de trois, la liste déborde de la cellule : on annonce le compte,
    // qui suffit à savoir que le chiffre est restreint.
    items.push([
      "Filières",
      noms.length === 0
        ? "Toutes"
        : noms.length <= 3
          ? noms.join(", ")
          : `${noms.length} filières sélectionnées`,
    ]);
  }

  if (dimensions.includes("period")) {
    const du = filters.dateDebut ? jourFr(filters.dateDebut) : undefined;
    const au = filters.dateFin ? jourFr(filters.dateFin) : undefined;
    items.push([
      "Période",
      filters.period === "custom" && (du || au)
        ? `Du ${du ?? "…"} au ${au ?? "…"}`
        : PERIOD_LABELS[filters.period],
    ]);
  }

  if (items.length === 0) {
    items.push(["Périmètre", "Tout l'établissement, sans restriction"]);
  }
  return items;
}

/** Le même périmètre sur une ligne, pour le bandeau de l'écran et le PDF. */
export function ownerScopeLine(items: Array<[string, string]>): string {
  return items.map(([k, v]) => `${k} : ${v}`).join("  ·  ");
}

/** « Édité le 26/08/2026 à 14:32 » — repère de fraîcheur du document imprimé. */
export function editionStamp(now: Date = new Date()): string {
  const d = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(now);
  const h = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(now);
  return `Édité le ${d} à ${h}`;
}

/** Contenu propre à un écran : tout le reste est ajouté par `buildOwnerReport`. */
export interface OwnerReportContent {
  /** Nom du fichier, sans extension ni horodatage — celui-ci est ajouté ici. */
  filename: string;
  orientation?: "landscape" | "portrait";
  blocks: ReportBlock[];
}

/**
 * Rapport complet : chrome commun + périmètre + contenu de l'écran.
 *
 * L'horodatage dans le nom de fichier n'est pas cosmétique : un propriétaire
 * exporte le même écran à quinze jours d'intervalle, et deux fichiers de même
 * nom dans un dossier de téléchargements se recouvrent en silence.
 */
export function buildOwnerReport(
  title: string,
  question: string,
  scope: Array<[string, string]>,
  content: OwnerReportContent,
  now: Date = new Date()
): ReportSpec {
  const horodatage = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;

  return {
    title,
    subtitle: question,
    metaLeft: editionStamp(now),
    metaRight: "Espace propriétaire",
    orientation: content.orientation ?? "landscape",
    filename: `${content.filename}-${horodatage}`,
    blocks: [
      { kind: "heading", text: "Périmètre du rapport", level: 2 },
      { kind: "keyValues", items: scope, columns: 2 },
      ...content.blocks,
    ],
  };
}

/* ----------------------------- Aides d'écriture --------------------------- */

/** Bloc de tableau, ou mention d'absence quand il n'y a rien à imprimer. */
export function tableOrNote(
  columns: ReportColumn[],
  rows: string[][],
  vide: string,
  footer?: string[]
): ReportBlock {
  if (rows.length === 0) return { kind: "note", text: vide };
  return { kind: "table", table: { columns, rows, footer } };
}
