/**
 * Exports et états pour l'administration — FORMATS EN DONNÉES.
 *
 * Aucun format officiel n'est codé. Le module publie un CATALOGUE de colonnes par jeu de données (clés stables, libellés
 * français) ; un établissement compose ses formats (colonnes, ordre, en-têtes, séparateur) dans `stateassign.export_formats`.
 * Sans format choisi, un format NEUTRE intégré (toutes les colonnes utiles) sert de repli : ce n'est pas un format officiel.
 *
 * CSV : UTF-8 (BOM au choix), fins de ligne CRLF, séparateur du format. Anti-injection de formule : une cellule TEXTE qui
 * commence par `=`, `+`, `-`, `@`, tabulation ou retour chariot est préfixée par une apostrophe ; les nombres sont écrits tels quels.
 */
import type { ExportColumn, ExportDataset } from "@ecoledigitale/contracts/src/v2/stateassign";
import { StateassignCode, validation } from "./errors";

export type CellValue = string | number | boolean | null | undefined;
export type ExportRow = Readonly<Record<string, CellValue>>;

export interface CatalogColumn {
  readonly key: string;
  readonly label: string;
}

export interface DatasetCatalog {
  readonly dataset: ExportDataset;
  readonly label: string;
  readonly columns: readonly CatalogColumn[];
  readonly standardColumns: readonly ExportColumn[];
}

const col = (key: string, label: string): CatalogColumn => ({ key, label });

const ASSIGNMENT_COLUMNS: readonly CatalogColumn[] = [
  col("reference", "Référence d'affectation"),
  col("studentName", "Élève"),
  col("studentId", "Identifiant de l'élève"),
  col("enrollmentId", "Identifiant de l'inscription"),
  col("institutionId", "Identifiant de l'établissement"),
  col("academicYearId", "Identifiant de l'année"),
  col("version", "Version du dossier"),
  col("status", "Statut du dossier"),
  col("issuedOn", "Date de l'acte"),
  col("issuingAuthority", "Autorité émettrice"),
  col("source", "Source"),
  col("declaredStateAmount", "Part de l'État déclarée"),
  col("declaredParentAmount", "Part de la famille déclarée"),
  col("currency", "Devise"),
  col("stateBilledAmount", "Part de l'État facturée"),
  col("parentBilledAmount", "Part de la famille facturée"),
  col("stateDelta", "Écart État (facturé − déclaré)"),
  col("parentDelta", "Écart famille (facturé − déclaré)"),
  col("reconciliationStatus", "Statut de rapprochement"),
  col("lastReconciledAt", "Dernier rapprochement"),
  col("verifiedAt", "Vérifié le"),
  col("endedOn", "Date de fin"),
];

const RECEIVABLE_COLUMNS: readonly CatalogColumn[] = [
  col("assignmentReference", "Référence d'affectation"),
  col("studentName", "Élève"),
  col("studentId", "Identifiant de l'élève"),
  col("seq", "N° d'échéance"),
  col("label", "Libellé"),
  col("dueOn", "Échéance"),
  col("expectedAmount", "Montant attendu de l'État"),
  col("receivedAmount", "Montant reçu"),
  col("outstandingAmount", "Reste à recevoir"),
  col("currency", "Devise"),
  col("status", "Statut"),
  col("daysOverdue", "Jours de retard"),
  col("agingBucket", "Tranche de retard"),
];

const CONTROL_COLUMNS: readonly CatalogColumn[] = [
  col("assignmentReference", "Référence d'affectation"),
  col("studentName", "Élève"),
  col("studentId", "Identifiant de l'élève"),
  col("kind", "Nature du contrôle"),
  col("dueOn", "Échéance"),
  col("status", "Statut"),
  col("performedAt", "Réalisé le"),
  col("findings", "Constat"),
  col("anomalyResolution", "Résolution de l'anomalie"),
  col("overdue", "En retard"),
];

const standard = (columns: readonly CatalogColumn[]): readonly ExportColumn[] => columns.map((c) => ({ key: c.key, header: c.label }));

export const EXPORT_CATALOG: Readonly<Record<ExportDataset, DatasetCatalog>> = Object.freeze({
  ASSIGNMENTS: { dataset: "ASSIGNMENTS", label: "Dossiers d'affectation", columns: ASSIGNMENT_COLUMNS, standardColumns: standard(ASSIGNMENT_COLUMNS) },
  RECEIVABLES: { dataset: "RECEIVABLES", label: "Créances sur l'État (échéances)", columns: RECEIVABLE_COLUMNS, standardColumns: standard(RECEIVABLE_COLUMNS) },
  CONTROLS: { dataset: "CONTROLS", label: "Contrôles", columns: CONTROL_COLUMNS, standardColumns: standard(CONTROL_COLUMNS) },
});

/** Valide les colonnes d'un format contre le catalogue du jeu : clé inconnue ou doublon refusés. */
export function validateColumns(dataset: ExportDataset, columns: readonly ExportColumn[]): ExportColumn[] {
  const known = new Set(EXPORT_CATALOG[dataset].columns.map((c) => c.key));
  const seen = new Set<string>();
  const out: ExportColumn[] = [];
  for (const c of columns) {
    if (!known.has(c.key)) {
      throw validation(StateassignCode.EXPORT_COLUMN_UNKNOWN, `La colonne « ${c.key} » n'existe pas dans le jeu ${dataset}.`, ["columns"], { key: c.key });
    }
    if (seen.has(c.key)) {
      throw validation(StateassignCode.INVALID_INPUT, `La colonne « ${c.key} » est répétée.`, ["columns"], { key: c.key });
    }
    seen.add(c.key);
    out.push({ key: c.key, header: c.header.trim() });
  }
  return out;
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Une cellule : nombre tel quel ; texte neutralisé contre l'injection de formule puis mis entre guillemets si besoin. */
export function csvCell(value: CellValue, delimiter: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "oui" : "non";
  let text = value.replace(/\u0000/g, "");
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (text.includes(delimiter) || /["\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvOptions {
  readonly delimiter: ";" | "," | "\t";
  readonly includeBom: boolean;
}

export function toCsv(columns: readonly ExportColumn[], rows: readonly ExportRow[], options: CsvOptions): string {
  const d = options.delimiter;
  const lines = [columns.map((c) => csvCell(c.header, d)).join(d)];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key], d)).join(d));
  return (options.includeBom ? "﻿" : "") + lines.join("\r\n") + "\r\n";
}
