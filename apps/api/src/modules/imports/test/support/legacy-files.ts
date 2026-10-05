/**
 * Fabrique de classeurs .xls / .ods FICTIFS pour les tests du convertisseur isolé (O-11) : fichiers bien formés
 * (écrits par la bibliothèque) et fichiers piégés (bombe de décompression, faux types, liens, entités externes).
 * Aucune donnée réelle.
 */
import JSZip from "jszip";
import * as XLSX from "xlsx";

export type LegacyCell = string | number | boolean | Date | null;

interface SheetSpec {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<LegacyCell>>;
  readonly hidden?: boolean;
  /** Cellules à formule : `{ "B2": "SUM(1,1)" }` (la valeur calculée reste celle de la cellule). */
  readonly formulas?: Readonly<Record<string, string>>;
  /** Liens hypertextes : `{ "A2": "http://..." }`. */
  readonly links?: Readonly<Record<string, string>>;
}

function workbookOf(sheets: readonly SheetSpec[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map((r) => [...r]) as unknown[][], { cellDates: false });
    for (const [ref, f] of Object.entries(s.formulas ?? {})) (ws[ref] as XLSX.CellObject).f = f;
    for (const [ref, target] of Object.entries(s.links ?? {})) (ws[ref] as XLSX.CellObject).l = { Target: target };
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  sheets.forEach((s, i) => {
    if (s.hidden) {
      wb.Workbook ??= { Sheets: [] };
      wb.Workbook.Sheets ??= [];
      wb.Workbook.Sheets[i] = { Hidden: 1 };
    }
  });
  return wb;
}

const toBytes = (buffer: Buffer): Uint8Array => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

/** Classeur Excel 97-2003 (BIFF8 dans un conteneur OLE2). */
export function xlsOf(rows: ReadonlyArray<ReadonlyArray<LegacyCell>>, sheetName = "Feuil1"): Uint8Array {
  return xlsSheets([{ name: sheetName, rows }]);
}

export function xlsSheets(sheets: readonly SheetSpec[]): Uint8Array {
  return toBytes(XLSX.write(workbookOf(sheets), { type: "buffer", bookType: "biff8" }) as Buffer);
}

/** Classeur OpenDocument (.ods) écrit par la bibliothèque. */
export function odsOf(rows: ReadonlyArray<ReadonlyArray<LegacyCell>>, sheetName = "Feuil1"): Uint8Array {
  return odsSheets([{ name: sheetName, rows }]);
}

export function odsSheets(sheets: readonly SheetSpec[]): Uint8Array {
  return toBytes(XLSX.write(workbookOf(sheets), { type: "buffer", bookType: "ods" }) as Buffer);
}

const OFFICE_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"';

export const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";

export interface HandmadeOds {
  /** Contenu complet de `content.xml` (sinon un tableau d'une cellule). */
  contentXml?: string;
  /** Corps seul : lignes `<table:table-row>` d'une feuille « Feuil1 ». */
  rowsXml?: string;
  mimetype?: string | null;
  macros?: boolean;
  /** Parties supplémentaires. */
  extraParts?: Record<string, string | Uint8Array>;
  /** Pas de partie `content.xml`. */
  noContent?: boolean;
}

export const odsCell = (text: string): string => `<table:table-cell office:value-type="string"><text:p>${text}</text:p></table:table-cell>`;
export const odsRow = (...cells: string[]): string => `<table:table-row>${cells.join("")}</table:table-row>`;

/** Classeur .ods fabriqué à la main : `mimetype` en première entrée non compressée, comme LibreOffice. */
export async function handmadeOds(options: HandmadeOds = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  if (options.mimetype !== null) zip.file("mimetype", options.mimetype ?? ODS_MIME, { compression: "STORE" });
  zip.file("META-INF/manifest.xml", `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>`);
  if (!options.noContent) {
    const content =
      options.contentXml ??
      `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${OFFICE_NS} office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Feuil1">${options.rowsXml ?? odsRow(odsCell("A"))}</table:table></office:spreadsheet></office:body></office:document-content>`;
    zip.file("content.xml", content);
  }
  if (options.macros) {
    zip.file("Basic/script-lc.xml", "<x/>");
    zip.file("Scripts/python/exploit.py", "import os");
  }
  for (const [name, data] of Object.entries(options.extraParts ?? {})) zip.file(name, data);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Annuaire central : remplace la taille décompressée DÉCLARÉE de l'entrée `name` (mensonge). */
export function lieAboutEntrySize(zip: Uint8Array, name: string, declared: number): Uint8Array {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const decoder = new TextDecoder();
  for (let i = 0; i + 46 < out.length; i += 1) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(i + 28, true);
    if (decoder.decode(out.subarray(i + 46, i + 46 + nameLength)) === name) view.setUint32(i + 24, declared, true);
  }
  return out;
}

/** Binaire OLE2 minimal qui n'est PAS un classeur Excel (aucun flux « Workbook »). */
export function fakeOle2(): Uint8Array {
  const out = new Uint8Array(2048);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return out;
}

/** OLE2 qui annonce un flux « Workbook » mais dont le contenu est du bruit (faux .xls). */
export function corruptXls(): Uint8Array {
  const out = new Uint8Array(4096);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  out.set(new TextEncoder().encode("W\0o\0r\0k\0b\0o\0o\0k\0"), 512);
  for (let i = 1024; i < out.length; i += 1) out[i] = (i * 31) & 0xff;
  return out;
}
