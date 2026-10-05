/**
 * Lecteur des classeurs .xls (Excel 97-2003) et .ods (OpenDocument) : contrôles côté parent, conversion dans le
 * processus enfant isolé (`convert.ts`), puis table normalisée au même format interne que `.xlsx` / `.csv`.
 *
 * Contrôles avant tout envoi à l'enfant :
 *  - .ods : archive ZIP inspectée (entrées, noms, tailles déclarées, rapport de compression) PUIS décompression
 *    réellement COMPTÉE de chaque entrée (une taille déclarée peut mentir) ; `mimetype` obligatoire ;
 *  - .xls : conteneur OLE2 contenant un flux `Workbook` / `Book` (sinon c'est un autre document Office).
 * Toute violation lève `FileRejectedError`, jamais une erreur interne.
 */
import JSZip from "jszip";
import type { ImportWarning } from "@ecoledigitale/contracts/src/v2/imports";
import { FileRejectedError } from "../../../domain/errors";
import { cleanCell } from "../../../domain/text";
import { hasExcelWorkbookStream } from "../sniff";
import { Budget, inspectZip, sizesOf, streamPart } from "../xlsx";
import { finalizeHeaders, MIB, type FileLimits, type OpenTableOptions, type RawRow, type TableReader } from "../types";
import { convertLegacyWorkbook, type LegacyKind } from "./convert";

export const ODS_MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet";

const corrupt = (message: string): FileRejectedError => new FileRejectedError("imports.file_corrupt", message);
const unsafe = (message: string, details?: Record<string, unknown>): FileRejectedError => new FileRejectedError("imports.file_unsafe", message, details);

/** Projet VBA présent dans un .xls : signalé, jamais lu (le convertisseur n'extrait pas les macros). */
function xlsHasMacros(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(Buffer.from("_VBA_PROJECT", "utf16le"));
}

const RATIO_FLOOR_BYTES = MIB;

/** Inspecte l'archive .ods ; retourne `true` si elle embarque des macros (jamais exécutées). */
async function inspectOds(bytes: Uint8Array, limits: FileLimits): Promise<{ macros: boolean }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  } catch {
    throw corrupt("Archive du classeur illisible : le fichier est corrompu ou n'est pas un .ods.");
  }
  inspectZip(zip, limits);
  const budget = new Budget(limits.maxZipUncompressedBytes);

  // `mimetype` : texte court qui DÉCLARE le type OpenDocument tableur.
  const mime = zip.file("mimetype");
  if (!mime) throw new FileRejectedError("imports.file_type_mismatch", "Cette archive n'est pas un classeur OpenDocument (.ods) : la partie « mimetype » est absente.");
  let mimeText = "";
  const decoder = new TextDecoder("utf-8");
  for await (const chunk of streamPart(zip, "mimetype", 256, new Budget(256))) mimeText += decoder.decode(chunk, { stream: true });
  if (mimeText.trim() !== ODS_MIMETYPE) throw new FileRejectedError("imports.file_type_mismatch", "Cette archive n'est pas un classeur OpenDocument de type tableur.");
  if (!zip.file("content.xml")) throw corrupt("Classeur OpenDocument incomplet (partie « content.xml » absente).");

  // Décompression RÉELLEMENT comptée (budget global et rapport de compression par entrée), sans rien conserver.
  let macros = false;
  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name] as JSZip.JSZipObject;
    if (name.startsWith("Basic/") || name.startsWith("Scripts/")) macros = true;
    if (file.dir) continue;
    const { compressedSize } = sizesOf(file);
    let real = 0;
    for await (const chunk of streamPart(zip, name, limits.maxZipUncompressedBytes, budget)) real += chunk.length;
    if (real > RATIO_FLOOR_BYTES && real / Math.max(1, compressedSize) > limits.maxZipRatio) {
      throw unsafe("Taux de compression anormal (archive piégée ?) : fichier refusé.", { ratio: Math.round(real / Math.max(1, compressedSize)) });
    }
  }
  return { macros };
}

export async function openLegacy(bytes: Uint8Array, kind: LegacyKind, options: OpenTableOptions): Promise<TableReader> {
  const { limits } = options;
  const warnings: ImportWarning[] = [];
  let macros: boolean;
  if (kind === "ODS") macros = (await inspectOds(bytes, limits)).macros;
  else {
    if (!hasExcelWorkbookStream(bytes)) throw new FileRejectedError("imports.file_type_unsupported", "Ce fichier est un document Office ancien mais pas un classeur Excel (.xls) : il ne peut pas être importé.");
    macros = xlsHasMacros(bytes);
  }
  if (macros) warnings.push({ code: "imports.macros_ignored", message: "Le classeur contient des macros : elles sont ignorées (jamais exécutées)." });

  const table = await convertLegacyWorkbook(bytes, kind, limits, options.sheet);

  const [first, ...rest] = table.rows;
  if (!first) throw new FileRejectedError("imports.no_header", "La feuille ne contient aucune ligne d'en-têtes.");
  const headerCells = first[1].map(cleanCell);
  let width = headerCells.length;
  while (width > 0 && (headerCells[width - 1] as string) === "") width -= 1;
  if (width === 0) throw new FileRejectedError("imports.no_header", "La ligne d'en-têtes est vide.");
  if (width > limits.maxColumns) throw new FileRejectedError("imports.too_many_columns", `La feuille compte ${width} colonnes ; le maximum est ${limits.maxColumns}.`);
  const headers = finalizeHeaders(Array.from({ length: width }, (_, i) => headerCells[i] ?? ""), warnings);

  if (table.formulas > 0) {
    warnings.push({ code: "imports.formulas_ignored", message: `${table.formulas} cellule(s) contiennent une formule : seule la valeur enregistrée est lue, jamais recalculée.`, count: table.formulas });
  }
  if (table.links > 0) {
    warnings.push({ code: "imports.links_ignored", message: `${table.links} cellule(s) contiennent un lien : il est ignoré (jamais ouvert ni suivi).`, count: table.links });
  }
  if (table.errors > 0) warnings.push({ code: "imports.cell_errors", message: `${table.errors} cellule(s) en erreur (#N/A, #REF!...) ont été lues comme vides.`, count: table.errors });

  async function* rows(): AsyncGenerator<RawRow, void, void> {
    let count = 0;
    for (const [rowNo, raw] of rest) {
      count += 1;
      if (count > limits.maxRows) throw new FileRejectedError("imports.too_many_rows", `Le fichier dépasse ${limits.maxRows} lignes de données.`, { maxRows: limits.maxRows });
      const cells: string[] = new Array<string>(width);
      for (let i = 0; i < width; i += 1) {
        const value = raw[i] ?? "";
        cells[i] = cleanCell(value.length > limits.maxCellChars + 1 ? value.slice(0, limits.maxCellChars + 1) : value);
      }
      if (cells.every((c) => c === "")) {
        count -= 1;
        continue;
      }
      yield { rowNo, cells };
    }
  }

  return { kind, sheetName: table.sheetName, sheetNames: table.sheetNames, headers, headerRowNo: first[0], rows, warnings };
}
