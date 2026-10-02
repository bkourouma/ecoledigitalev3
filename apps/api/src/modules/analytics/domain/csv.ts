/**
 * Export CSV : séparateur `;` (Excel fr), BOM UTF-8, guillemets doublés, protection contre l'injection de formule.
 * Une cellule TEXTE commençant par `= + - @` ou une tabulation / un retour chariot est préfixée d'une apostrophe ;
 * un NOMBRE n'est jamais préfixé (un montant négatif reste un nombre).
 */
export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "oui" : "non";
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(columns: ReadonlyArray<CsvColumn<T>>, rows: readonly T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(CSV_SEPARATOR)];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(CSV_SEPARATOR));
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
