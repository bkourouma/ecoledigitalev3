/**
 * Colonnes de la liste des enseignants — source unique des exports PDF
 * (`teacher-pdf.ts`) et Word (`teacher-docx.ts`), pour que les deux documents
 * portent les mêmes données dans les mêmes largeurs.
 */
import { Teacher } from "@ecoledigitale/contracts";

/** A4 paysage, en millimètres. */
export const PAGE_WIDTH_MM = 297;
export const PAGE_HEIGHT_MM = 210;
export const PAGE_MARGIN_MM = 12;
/** Laize utile : 297 − 2 × 12. Les largeurs de colonnes la totalisent exactement. */
export const USABLE_WIDTH_MM = PAGE_WIDTH_MM - 2 * PAGE_MARGIN_MM;

export const CONTRACT_LABELS: Record<string, string> = {
  permanent: "Permanent (CDI)",
  temporary: "Temporaire (CDD)",
  freelance: "Vacataire",
};

export const contractLabel = (value: string) => CONTRACT_LABELS[value] ?? value;

export interface TeacherColumn {
  header: string;
  /** Largeur en millimètres. */
  width: number;
  align: "left" | "center";
  value: (teacher: Teacher, index: number) => string;
}

/** Colonnes dans l'ordre d'affichage ; les largeurs totalisent `USABLE_WIDTH_MM`. */
export const COLUMNS: TeacherColumn[] = [
  { header: "N°", width: 12, align: "center", value: (_t, i) => String(i + 1) },
  { header: "Nom", width: 48, align: "left", value: (t) => (t.lastName || "—").toUpperCase() },
  { header: "Prénom(s)", width: 52, align: "left", value: (t) => t.firstName || "—" },
  { header: "Email", width: 82, align: "left", value: (t) => t.email || "—" },
  { header: "Téléphone", width: 40, align: "center", value: (t) => t.phone || "—" },
  {
    header: "Type de contrat",
    width: 39,
    align: "center",
    value: (t) => contractLabel(t.contractType),
  },
];
