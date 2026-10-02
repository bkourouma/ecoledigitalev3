/**
 * Lecteur CSV (RFC 4180 tolérant) : décodage (UTF-8 avec ou sans BOM, UTF-16 avec BOM, repli windows-1252), détection du
 * séparateur (`,` `;` tabulation), guillemets doublés, sauts de ligne CRLF / LF dans les champs entre guillemets.
 *
 * Aucune cellule n'est interprétée : une valeur qui commence par `=` reste le TEXTE « =... » (INV-S5).
 */
import type { ImportWarning } from "@ecoledigitale/contracts/src/v2/imports";
import { FileRejectedError } from "../../domain/errors";
import { cleanCell } from "../../domain/text";
import { finalizeHeaders, type OpenTableOptions, type RawRow, type TableReader } from "./types";

export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Séparateur le plus fréquent (hors guillemets) dans les premières lignes non vides. */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 5; i += 1) {
    const c = text[i] as string;
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === "\n") lines += 1;
      else if (c === "," || c === ";" || c === "\t") counts[c] += 1;
    }
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
}

/** Lit les enregistrements un à un (générateur) : `[numéro de ligne physique de début, cellules]`. */
export function* parseCsvRecords(text: string, delimiter: string): Generator<[number, string[]], void, void> {
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let startLine = 1;
  let fieldStarted = false;
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text[i] as string;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        if (c === "\n") line += 1;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "" && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (c === delimiter) {
      record.push(field);
      field = "";
      fieldStarted = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      yield [startLine, record];
      record = [];
      field = "";
      fieldStarted = false;
      line += 1;
      startLine = line;
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new FileRejectedError("imports.file_corrupt", "Fichier CSV invalide : un guillemet n'est jamais refermé.");
  if (field !== "" || record.length > 0 || fieldStarted) {
    record.push(field);
    yield [startLine, record];
  }
}

const isBlank = (cells: readonly string[]): boolean => cells.every((c) => c.trim() === "");

export function openCsv(bytes: Uint8Array, options: OpenTableOptions): TableReader {
  const { limits } = options;
  const text = decodeCsv(bytes);
  const delimiter = detectDelimiter(text);
  const warnings: ImportWarning[] = [];
  const records = parseCsvRecords(text, delimiter);

  let headerRowNo = 0;
  let headerCells: string[] | null = null;
  // Lecture manuelle : un `break` dans un `for…of` fermerait le générateur (les lignes suivantes seraient perdues).
  for (let step = records.next(); !step.done; step = records.next()) {
    const [lineNo, cells] = step.value;
    if (isBlank(cells)) continue;
    headerRowNo = lineNo;
    headerCells = cells.map(cleanCell);
    break;
  }
  if (!headerCells) throw new FileRejectedError("imports.no_header", "Le fichier ne contient aucune ligne d'en-têtes.");
  // Les colonnes vides en queue d'en-têtes sont ignorées.
  let width = headerCells.length;
  while (width > 0 && (headerCells[width - 1] as string) === "") width -= 1;
  if (width === 0) throw new FileRejectedError("imports.no_header", "La ligne d'en-têtes est vide.");
  if (width > limits.maxColumns) throw new FileRejectedError("imports.too_many_columns", `Le fichier compte ${width} colonnes ; le maximum est ${limits.maxColumns}.`);
  const headers = finalizeHeaders(headerCells.slice(0, width), warnings);

  async function* rows(): AsyncGenerator<RawRow, void, void> {
    let count = 0;
    for (const [lineNo, cells] of records) {
      if (isBlank(cells)) continue;
      count += 1;
      if (count > limits.maxRows) throw new FileRejectedError("imports.too_many_rows", `Le fichier dépasse ${limits.maxRows} lignes de données.`, { maxRows: limits.maxRows });
      const out: string[] = new Array<string>(width);
      for (let i = 0; i < width; i += 1) {
        const raw = cells[i] ?? "";
        out[i] = cleanCell(raw.length > limits.maxCellChars + 1 ? raw.slice(0, limits.maxCellChars + 1) : raw);
      }
      yield { rowNo: lineNo, cells: out };
    }
  }

  return { kind: "CSV", sheetName: null, sheetNames: [], headers, headerRowNo, rows, warnings };
}
