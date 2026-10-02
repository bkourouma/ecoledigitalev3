/**
 * Fabrique de fichiers FICTIFS pour les tests : CSV, XLSX bien formés (écrits par `writeXlsx` ou à la main pour tester
 * formules, chaînes partagées, macros) et archives hostiles (zip-bomb, DOCTYPE, chemin `..`). Aucune donnée réelle.
 */
import JSZip from "jszip";
import { writeXlsx, type Cell } from "../../infrastructure/files/write";

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

export const FIRST_NAMES = ["Aminata", "Ibrahim", "Fatoumata", "Kouadio", "Awa", "Yao", "Mariam", "Seydou", "Adjoua", "Koffi", "Salimata", "Amara"];
export const LAST_NAMES = ["KONE", "TRAORE", "YAO", "BAMBA", "COULIBALY", "OUATTARA", "DIALLO", "KOUASSI", "N'GUESSAN", "SANGARE"];

export const STUDENT_HEADERS = ["Matricule", "Nom", "Prénoms", "Sexe", "Date de naissance", "Lieu de naissance", "Téléphone"];

/** Lignes d'élèves fictives, déterministes : matricule `T<prefix>-00001`… */
export function studentRows(count: number, prefix = "A", start = 1): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < count; i += 1) {
    const n = start + i;
    const day = String((n % 27) + 1).padStart(2, "0");
    const month = String((n % 12) + 1).padStart(2, "0");
    rows.push([
      `T${prefix}-${String(n).padStart(5, "0")}`,
      LAST_NAMES[n % LAST_NAMES.length] as string,
      `${FIRST_NAMES[(n * 7) % FIRST_NAMES.length]} ${prefix}${n}`,
      n % 2 === 0 ? "F" : "M",
      `${day}/${month}/${2008 + (n % 8)}`,
      "Abidjan",
      `07${String(10_000_000 + n).slice(-8)}`,
    ]);
  }
  return rows;
}

export function csvOf(rows: readonly (readonly string[])[], delimiter = ";"): Uint8Array {
  const esc = (v: string): string => (/["\r\n;,\t]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return enc(rows.map((r) => r.map(esc).join(delimiter)).join("\r\n") + "\r\n");
}

export async function xlsxOf(rows: ReadonlyArray<ReadonlyArray<Cell>>, sheetName = "Feuil1"): Promise<Uint8Array> {
  return writeXlsx([{ name: sheetName, rows }]);
}

export interface RawCell {
  /** Référence `B3`. */
  r: string;
  /** Type : `s` (chaîne partagée), `n`, `str`, `b`, `e`, `inlineStr`. */
  t?: string;
  v?: string;
  f?: string;
  is?: string;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export interface HandmadeOptions {
  sharedStrings?: string[];
  rows: Array<{ r: number; cells: RawCell[] }>;
  macros?: boolean;
  extraParts?: Record<string, string>;
  workbookXml?: string;
  contentTypes?: string;
  sheetXml?: string;
  sheets?: Array<{ name: string; state?: string }>;
}

/** Classeur fabriqué à la main (contrôle total du XML : formules, chaînes partagées, types de cellules, macros). */
export async function handmadeXlsx(options: HandmadeOptions): Promise<Uint8Array> {
  const zip = new JSZip();
  const sheets = options.sheets ?? [{ name: "Feuil1" }];
  zip.file(
    "[Content_Types].xml",
    options.contentTypes ??
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet${options.macros ? ".macroEnabled" : ""}.main+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file(
    "xl/workbook.xml",
    options.workbookXml ??
      `<?xml version="1.0"?><workbook ${NS}><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ""} r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
  );
  if (options.sharedStrings) {
    zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst ${NS} count="${options.sharedStrings.length}" uniqueCount="${options.sharedStrings.length}">${options.sharedStrings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`);
  }
  const rowsXml = options.rows
    .map((row) => `<row r="${row.r}">${row.cells.map((c) => `<c r="${c.r}"${c.t ? ` t="${c.t}"` : ""}>${c.f !== undefined ? `<f>${c.f}</f>` : ""}${c.v !== undefined ? `<v>${c.v}</v>` : ""}${c.is !== undefined ? `<is><t>${c.is}</t></is>` : ""}</c>`).join("")}</row>`)
    .join("");
  const sheetXml = options.sheetXml ?? `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rowsXml}</sheetData></worksheet>`;
  sheets.forEach((_, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml));
  if (options.macros) zip.file("xl/vbaProject.bin", new Uint8Array([1, 2, 3, 4]));
  for (const [name, content] of Object.entries(options.extraParts ?? {})) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Feuille « légitime » de `rowCount` lignes, dont la taille décompressée vaut environ `rowCount * 130` octets. */
export function bigSheetXml(rowCount: number, columns = 4): string {
  const parts: string[] = [`<?xml version="1.0"?><worksheet ${NS}><sheetData>`];
  for (let r = 1; r <= rowCount; r += 1) {
    parts.push(`<row r="${r}">`);
    for (let c = 0; c < columns; c += 1) parts.push(`<c r="${String.fromCharCode(65 + c)}${r}" t="inlineStr"><is><t>${r === 1 ? `H${c}` : `valeur-${r}-${c}-xxxxxxxxxx`}</t></is></c>`);
    parts.push("</row>");
  }
  parts.push("</sheetData></worksheet>");
  return parts.join("");
}

/** Remplace, dans l'annuaire central d'une archive, la taille décompressée déclarée de CHAQUE entrée (mensonge). */
export function lieAboutUncompressedSize(zip: Uint8Array, declared: number): Uint8Array {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i + 46 < out.length; i += 1) {
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, declared, true);
  }
  return out;
}
