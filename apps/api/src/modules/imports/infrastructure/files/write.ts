/**
 * Écriture de fichiers de sortie : rapports d'erreurs et modèles de fichier, en CSV et XLSX (INV-S7).
 *
 * TOUTE valeur écrite est neutralisée contre l'injection de formule (`neutralizeCell` : apostrophe devant `=`, `+`, `-`,
 * `@`, tabulation, retour chariot), et les cellules XLSX sont écrites en TEXTE (`t="inlineStr"`), jamais en formule ni en
 * nombre : un tableur ne peut donc rien évaluer à l'ouverture.
 */
import JSZip from "jszip";
import { neutralizeCell } from "../../domain/text";

export type Cell = string | number | boolean | null | undefined;

export function cellText(value: Cell): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

const safeText = (value: Cell): string => neutralizeCell(cellText(value));

function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV UTF-8 avec BOM, séparateur `;` (ouverture directe dans Excel en paramètres régionaux français). */
export function writeCsv(rows: ReadonlyArray<ReadonlyArray<Cell>>): Uint8Array {
  const body = rows.map((r) => r.map((c) => csvField(safeText(c))).join(";")).join("\r\n");
  return new TextEncoder().encode(`﻿${body}\r\n`);
}

// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

function xmlEscape(value: string): string {
  return value.replace(XML_INVALID, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function colRef(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export interface SheetSpec {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<Cell>>;
}

const sheetName = (name: string, i: number): string => xmlEscape(name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Feuille${i + 1}`);

/** XLSX minimal (aucune formule, aucun style) : texte seulement. */
export async function writeXlsx(sheets: readonly SheetSpec[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}</Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${sheetName(s.name, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
  );
  sheets.forEach((s, i) => {
    const rowsXml = s.rows
      .map((row, r) => {
        const cells = row
          .map((value, c) => {
            const text = safeText(value).slice(0, 32_000);
            return text === "" ? "" : `<c r="${colRef(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`);
  });
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME = "text/csv; charset=utf-8";
