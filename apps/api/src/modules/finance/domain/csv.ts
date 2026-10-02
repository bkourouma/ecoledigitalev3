/**
 * Export CSV (fonctions PURES). Séparateur `;` (tableurs francophones), guillemets doublés, fin de ligne CRLF, BOM UTF-8
 * (Excel) et protection contre l'injection de formule : toute cellule texte commençant par `= + - @` (ou tabulation /
 * retour chariot) est préfixée d'une apostrophe, sauf un nombre signé légitime.
 *
 * Même convention que l'export des élèves (`people`), dupliquée ici : un module n'importe jamais le domaine d'un autre.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const SIGNED_NUMBER = /^[+-]?\d+([.,]\d+)?$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (FORMULA_START.test(s) && !SIGNED_NUMBER.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [header.map(csvCell).join(";"), ...rows.map((r) => r.map(csvCell).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}
