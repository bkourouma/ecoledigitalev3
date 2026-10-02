/**
 * Écriture d'un classeur XLSX MINIMAL (une feuille) à partir d'une table de cellules, avec JSZip : aucune formule, aucun style.
 *
 * Toutes les chaînes sont écrites en `inlineStr` (jamais en `<f>`) ET les cellules TEXTE débutant par `=`, `+`, `-`, `@` sont
 * préfixées d'une apostrophe (même neutralisation que le CSV : un tableur qui réécrit la cellule ne l'interprète pas comme une
 * formule). Les nombres issus du module (moyennes, rangs, effectifs) sont écrits en cellules numériques.
 */
import JSZip from "jszip";
import { neutralizeFormula, type RenderedTable } from "../domain/export-render";

const XML_INVALID = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

const escapeXml = (s: string): string =>
  s.replace(XML_INVALID, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Lettre(s) de colonne : 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const NUMERIC = /^\d{1,15}(\.\d{1,6})?$/;

function cell(ref: string, value: string, numeric: boolean): string {
  if (numeric && NUMERIC.test(value)) return `<c r="${ref}"><v>${value}</v></c>`;
  if (value === "") return `<c r="${ref}"/>`;
  const text = numeric ? value : neutralizeFormula(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

export async function buildXlsx(table: RenderedTable, sheetName = "Export"): Promise<Uint8Array> {
  const rows: string[] = [];
  rows.push(`<row r="1">${table.headers.map((h, c) => cell(`${columnName(c)}1`, h, false)).join("")}</row>`);
  table.rows.forEach((r, i) => {
    const n = i + 2;
    rows.push(`<row r="${n}">${r.map((c, k) => cell(`${columnName(k)}${n}`, c.value, c.numeric)).join("")}</row>`);
  });
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
