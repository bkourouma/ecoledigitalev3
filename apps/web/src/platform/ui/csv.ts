/**
 * Export CSV côté navigateur pour les listes dont l'API ne fournit pas de fichier (rapports financiers). Sérialisation
 * PURE des lignes déjà calculées par l'API (aucun total recalculé ici).
 *
 * - séparateur `;` et BOM UTF-8 : s'ouvre correctement dans Excel en français ;
 * - montants et nombres : entiers bruts (pas de séparateur de milliers) ;
 * - texte commençant par `= + - @` : préfixé d'une apostrophe (injection de formules dans un tableur).
 */

export type CsvCell = string | number | boolean | null | undefined;

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Déclenche le téléchargement d'un texte (navigateur uniquement). */
export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
