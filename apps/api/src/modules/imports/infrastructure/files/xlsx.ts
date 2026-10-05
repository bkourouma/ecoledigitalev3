/**
 * Lecteur XLSX SÛR (INV-S3 à S6). Un XLSX est une archive ZIP de parties XML : on la lit sans jamais exécuter ni évaluer.
 *
 *  1. Annuaire du ZIP inspecté AVANT toute décompression : nombre d'entrées, noms (pas de `..`, ni chemin absolu), taille
 *     déclarée par entrée et totale, rapport de compression (zip-bomb).
 *  2. Les tailles déclarées pouvant MENTIR, la décompression est COMPTÉE octet par octet et interrompue au plafond.
 *  3. Seules les parties nécessaires sont décompressées : `[Content_Types].xml`, `xl/workbook.xml`, ses relations,
 *     `xl/sharedStrings.xml` et la feuille choisie (en flux). Macros (`vbaProject.bin`), liens externes, objets OLE,
 *     images, styles : jamais lus.
 *  4. Formules NON évaluées : on lit la valeur mise en cache (`<v>`), jamais le calcul ; le nombre de cellules à formule
 *     est signalé.
 *  5. XML en flux par `XmlScanner` (DOCTYPE / ENTITY refusés).
 *
 * Toute violation lève `FileRejectedError` (`imports.file_unsafe` | `imports.file_corrupt` | ...), jamais une erreur interne.
 */
import JSZip from "jszip";
import type { ImportWarning } from "@ecoledigitale/contracts/src/v2/imports";
import { FileRejectedError } from "../../domain/errors";
import { cleanCell } from "../../domain/text";
import { createUtf8Decoder, XmlScanner, type XmlEvent } from "./xml";
import { columnIndexOf, finalizeHeaders, MIB, type FileLimits, type OpenTableOptions, type RawRow, type TableReader } from "./types";

const unsafe = (message: string, details?: Record<string, unknown>): FileRejectedError => new FileRejectedError("imports.file_unsafe", message, details);
const corrupt = (message: string): FileRejectedError => new FileRejectedError("imports.file_corrupt", message);

/** Au-delà de ce rapport de compression, une entrée de plus de 1 Mio décompressé est refusée (zip-bomb). */
const RATIO_FLOOR_BYTES = MIB;
/** Plafond d'une petite partie XML (workbook, relations, types de contenu). */
const SMALL_PART_MAX = 2 * MIB;
/** Plafond de chaînes partagées. */
const MAX_SHARED_STRINGS = 2_000_000;
const MAX_CELL_SOURCE_CHARS = 200_000;
const MAX_SCAN_COLUMN = 16_384;

export interface EntrySizes {
  readonly uncompressedSize: number;
  readonly compressedSize: number;
}

export const sizesOf = (file: JSZip.JSZipObject): EntrySizes => {
  const data = (file as unknown as { _data?: Partial<EntrySizes> })._data;
  if (!data || typeof data.uncompressedSize !== "number" || typeof data.compressedSize !== "number" || data.uncompressedSize < 0 || data.compressedSize < 0) {
    throw corrupt("Archive du classeur illisible (tailles d'entrées absentes).");
  }
  return { uncompressedSize: data.uncompressedSize, compressedSize: data.compressedSize };
};

/** Contrôle de l'annuaire du ZIP, sans décompresser. */
export function inspectZip(zip: JSZip, limits: FileLimits): { totalDeclared: number } {
  const names = Object.keys(zip.files);
  if (names.length === 0) throw corrupt("Archive vide : le classeur est illisible.");
  if (names.length > limits.maxZipEntries) throw unsafe(`Le classeur contient trop de parties (${names.length} ; ${limits.maxZipEntries} au plus).`, { entries: names.length });
  let total = 0;
  for (const name of names) {
    if (name.length > 300 || name.includes("\0") || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..")) {
      throw unsafe("Le classeur contient un chemin d'entrée interdit.");
    }
    const file = zip.files[name] as JSZip.JSZipObject;
    if (file.dir) continue;
    const { uncompressedSize, compressedSize } = sizesOf(file);
    if (uncompressedSize > limits.maxZipUncompressedBytes) throw unsafe("Le classeur décompressé serait trop volumineux.", { declared: uncompressedSize });
    if (uncompressedSize > RATIO_FLOOR_BYTES && uncompressedSize / Math.max(1, compressedSize) > limits.maxZipRatio) {
      throw unsafe("Taux de compression anormal (archive piégée ?) : fichier refusé.", { ratio: Math.round(uncompressedSize / Math.max(1, compressedSize)) });
    }
    total += uncompressedSize;
    if (total > limits.maxZipUncompressedBytes) throw unsafe("Le classeur décompressé serait trop volumineux.", { declared: total });
  }
  return { totalDeclared: total };
}

/** Budget partagé de décompression (compté sur les octets RÉELLEMENT produits). */
export class Budget {
  private used = 0;
  constructor(private readonly max: number) {}
  take(n: number): void {
    this.used += n;
    if (this.used > this.max) throw unsafe("Le classeur décompressé dépasse la taille autorisée : fichier refusé.", { max: this.max });
  }
}

/** Sous-ensemble de `StreamHelper` de JSZip (flux d'événements avec contre-pression par pause / reprise). */
interface JsZipStream {
  on(event: "data", listener: (chunk: Uint8Array) => void): JsZipStream;
  on(event: "end", listener: () => void): JsZipStream;
  on(event: "error", listener: (error: unknown) => void): JsZipStream;
  pause(): JsZipStream;
  resume(): JsZipStream;
}

/**
 * Parcourt la décompression d'une partie, morceau par morceau, avec contre-pression : un seul morceau est en mémoire à la
 * fois. À l'arrêt (plafond dépassé, erreur ou sortie anticipée du consommateur), le flux est mis en pause et abandonné :
 * la décompression ne se poursuit pas.
 */
export async function* streamPart(zip: JSZip, name: string, partCap: number, budget: Budget): AsyncGenerator<Uint8Array, void, void> {
  const file = zip.file(name);
  if (!file) throw corrupt(`Partie « ${name} » absente du classeur.`);
  const stream = (file as unknown as { internalStream(type: "uint8array"): JsZipStream }).internalStream("uint8array");
  const queue: Uint8Array[] = [];
  let finished = false;
  let failure: unknown;
  let wake: (() => void) | null = null;
  const notify = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  stream.on("data", (chunk) => {
    queue.push(chunk);
    stream.pause();
    notify();
  });
  stream.on("error", (e) => {
    failure = e ?? new Error("flux interrompu");
    notify();
  });
  stream.on("end", () => {
    finished = true;
    notify();
  });
  let count = 0;
  try {
    stream.resume();
    for (;;) {
      if (queue.length === 0 && !finished && failure === undefined) await new Promise<void>((resolve) => (wake = resolve));
      if (failure !== undefined) throw failure;
      const chunk = queue.shift();
      if (chunk === undefined) {
        if (finished) return;
        continue;
      }
      count += chunk.length;
      if (count > partCap) throw unsafe("Une partie du classeur dépasse la taille autorisée : fichier refusé.", { part: name });
      budget.take(chunk.length);
      yield chunk;
      if (queue.length === 0 && !finished) stream.resume();
    }
  } catch (e) {
    if (e instanceof FileRejectedError) throw e;
    throw corrupt("Classeur illisible (données compressées corrompues).");
  } finally {
    stream.pause();
  }
}

async function readSmallPart(zip: JSZip, name: string, budget: Budget): Promise<string> {
  const decode = createUtf8Decoder();
  let out = "";
  for await (const chunk of streamPart(zip, name, SMALL_PART_MAX, budget)) out += decode(chunk);
  return out + decode(new Uint8Array(0), true);
}

function scanText(xml: string, onEvent: (e: XmlEvent) => void): void {
  const scanner = new XmlScanner();
  for (const e of scanner.push(xml)) onEvent(e);
  scanner.end();
}

interface SheetRef {
  readonly name: string;
  readonly path: string;
  readonly hidden: boolean;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = ["xl", ...target.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

async function readWorkbook(zip: JSZip, budget: Budget): Promise<{ sheets: SheetRef[]; macros: boolean }> {
  if (!zip.file("[Content_Types].xml") || !zip.file("xl/workbook.xml")) {
    throw new FileRejectedError("imports.file_type_unsupported", "Cette archive ZIP n'est pas un classeur Excel (.xlsx).");
  }
  let isWorkbook = false;
  let macros = Boolean(zip.file("xl/vbaProject.bin"));
  scanText(await readSmallPart(zip, "[Content_Types].xml", budget), (e) => {
    if (e.type !== "open") return;
    const ct = e.attrs["ContentType"] ?? "";
    if (/spreadsheetml\.(sheet|template)(\.macroEnabled)?\.main\+xml$/.test(ct)) isWorkbook = true;
    if (/macroEnabled/.test(ct)) macros = true;
  });
  if (!isWorkbook) throw new FileRejectedError("imports.file_type_unsupported", "Cette archive ZIP n'est pas un classeur Excel (.xlsx).");

  const rels = new Map<string, { target: string; type: string }>();
  if (zip.file("xl/_rels/workbook.xml.rels")) {
    scanText(await readSmallPart(zip, "xl/_rels/workbook.xml.rels", budget), (e) => {
      if (e.type === "open" && e.name === "Relationship" && e.attrs["Id"] && e.attrs["Target"]) rels.set(e.attrs["Id"], { target: e.attrs["Target"], type: e.attrs["Type"] ?? "" });
    });
  }
  const sheets: SheetRef[] = [];
  scanText(await readSmallPart(zip, "xl/workbook.xml", budget), (e) => {
    if (e.type !== "open" || e.name !== "sheet") return;
    const rel = e.attrs["id"] ? rels.get(e.attrs["id"]) : undefined;
    if (!rel || !/\/worksheet$/.test(rel.type) || !e.attrs["name"]) return;
    sheets.push({ name: e.attrs["name"], path: resolveTarget(rel.target), hidden: e.attrs["state"] === "hidden" || e.attrs["state"] === "veryHidden" });
  });
  if (sheets.length === 0) throw corrupt("Le classeur ne contient aucune feuille de calcul.");
  return { sheets, macros };
}

async function readSharedStrings(zip: JSZip, limits: FileLimits, budget: Budget): Promise<string[]> {
  const strings: string[] = [];
  if (!zip.file("xl/sharedStrings.xml")) return strings;
  const scanner = new XmlScanner();
  const decode = createUtf8Decoder();
  let current = "";
  let inSi = false;
  let inT = false;
  let phonetic = 0;
  let chars = 0;
  const handle = (e: XmlEvent): void => {
    if (e.type === "open") {
      if (e.name === "si") {
        inSi = true;
        current = "";
      } else if (e.name === "rPh") phonetic += 1;
      else if (e.name === "t" && inSi) inT = true;
    } else if (e.type === "close") {
      if (e.name === "si") {
        inSi = false;
        if (strings.length >= MAX_SHARED_STRINGS) throw unsafe("Trop de chaînes partagées dans le classeur.");
        strings.push(current);
      } else if (e.name === "rPh") phonetic -= 1;
      else if (e.name === "t") inT = false;
    } else if (inT && phonetic === 0) {
      chars += e.text.length;
      if (chars > limits.maxZipUncompressedBytes) throw unsafe("Chaînes partagées trop volumineuses.");
      current += e.text;
    }
  };
  for await (const chunk of streamPart(zip, "xl/sharedStrings.xml", limits.maxZipUncompressedBytes, budget)) {
    for (const e of scanner.push(decode(chunk))) handle(e);
  }
  for (const e of scanner.push(decode(new Uint8Array(0), true))) handle(e);
  scanner.end();
  return strings;
}

function normalizeNumber(text: string): string {
  const t = text.trim();
  if (/[eE]/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) {
      const plain = n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 15 });
      return plain;
    }
  }
  return t;
}

interface SheetStats {
  formulas: number;
  errors: number;
}

/** Lignes brutes (non vides) d'une feuille, en flux. `cells` est creux : trous = chaîne vide. */
async function* sheetRows(zip: JSZip, path: string, shared: readonly string[], limits: FileLimits, budget: Budget, stats: SheetStats): AsyncGenerator<{ rowNo: number; cells: string[] }, void, void> {
  const scanner = new XmlScanner();
  const decode = createUtf8Decoder();
  let rowNo = 0;
  let autoRow = 0;
  let cells: string[] = [];
  let hasContent = false;
  let col = 0;
  let type = "n";
  let v = "";
  let inlineText = "";
  let formula = false;
  let inCell = false;
  let inV = false;
  let inIs = false;
  let inT = false;
  let phonetic = 0;
  let inRow = false;
  const out: Array<{ rowNo: number; cells: string[] }> = [];

  const finishCell = (): void => {
    let value: string;
    switch (type) {
      case "s": {
        const idx = Number(v);
        value = Number.isInteger(idx) && idx >= 0 ? (shared[idx] ?? "") : "";
        break;
      }
      case "inlineStr":
        value = inlineText;
        break;
      case "str":
      case "d":
        value = v;
        break;
      case "b":
        value = v.trim() === "1" ? "TRUE" : "FALSE";
        break;
      case "e":
        stats.errors += 1;
        value = "";
        break;
      default:
        value = normalizeNumber(v);
    }
    if (formula) stats.formulas += 1;
    if (value !== "" && col >= 0 && col < MAX_SCAN_COLUMN) {
      while (cells.length < col) cells.push("");
      cells[col] = value;
      hasContent = true;
    }
  };

  const handle = (e: XmlEvent): void => {
    if (e.type === "open") {
      switch (e.name) {
        case "row":
          inRow = true;
          autoRow += 1;
          rowNo = Number(e.attrs["r"]) || autoRow;
          autoRow = rowNo;
          cells = [];
          hasContent = false;
          break;
        case "c":
          if (!inRow) break;
          inCell = true;
          col = e.attrs["r"] ? columnIndexOf(e.attrs["r"]) : cells.length;
          type = e.attrs["t"] ?? "n";
          v = "";
          inlineText = "";
          formula = false;
          break;
        case "v":
          if (inCell) inV = true;
          break;
        case "f":
          if (inCell) formula = true;
          break;
        case "is":
          if (inCell) inIs = true;
          break;
        case "rPh":
          phonetic += 1;
          break;
        case "t":
          if (inIs) inT = true;
          break;
      }
    } else if (e.type === "close") {
      switch (e.name) {
        case "c":
          if (inCell) finishCell();
          inCell = false;
          inV = false;
          inIs = false;
          inT = false;
          break;
        case "v":
          inV = false;
          break;
        case "is":
          inIs = false;
          break;
        case "t":
          inT = false;
          break;
        case "rPh":
          phonetic -= 1;
          break;
        case "row":
          if (inRow && hasContent) out.push({ rowNo, cells });
          inRow = false;
          break;
      }
    } else if (inCell) {
      if (inV && v.length < MAX_CELL_SOURCE_CHARS) v += e.text;
      else if (inT && phonetic === 0 && inlineText.length < MAX_CELL_SOURCE_CHARS) inlineText += e.text;
    }
  };

  for await (const chunk of streamPart(zip, path, limits.maxZipUncompressedBytes, budget)) {
    for (const e of scanner.push(decode(chunk))) handle(e);
    while (out.length > 0) yield out.shift() as { rowNo: number; cells: string[] };
  }
  for (const e of scanner.push(decode(new Uint8Array(0), true))) handle(e);
  scanner.end();
  while (out.length > 0) yield out.shift() as { rowNo: number; cells: string[] };
}

export async function openXlsx(bytes: Uint8Array, options: OpenTableOptions): Promise<TableReader> {
  const { limits } = options;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  } catch {
    throw corrupt("Archive du classeur illisible : le fichier est corrompu ou n'est pas un .xlsx.");
  }
  inspectZip(zip, limits);
  const budget = new Budget(limits.maxZipUncompressedBytes);
  const { sheets, macros } = await readWorkbook(zip, budget);
  const warnings: ImportWarning[] = [];
  if (macros) warnings.push({ code: "imports.macros_ignored", message: "Le classeur contient des macros : elles sont ignorées (jamais exécutées)." });

  const visible = sheets.filter((s) => !s.hidden);
  let sheet: SheetRef | undefined;
  if (options.sheet) {
    sheet = sheets.find((s) => s.name.toLowerCase() === (options.sheet as string).toLowerCase());
    if (!sheet) throw new FileRejectedError("imports.sheet_unknown", `La feuille « ${options.sheet} » n'existe pas dans le classeur.`, { sheets: sheets.map((s) => s.name) });
  } else sheet = visible[0] ?? sheets[0];
  if (!sheet || !zip.file(sheet.path)) throw corrupt("Feuille de calcul introuvable dans le classeur.");

  const shared = await readSharedStrings(zip, limits, budget);
  const stats: SheetStats = { formulas: 0, errors: 0 };
  const source = sheetRows(zip, sheet.path, shared, limits, budget, stats);

  const first = await source.next();
  if (first.done) throw new FileRejectedError("imports.no_header", "La feuille ne contient aucune ligne d'en-têtes.");
  const headerCells = first.value.cells.map(cleanCell);
  let width = headerCells.length;
  while (width > 0 && (headerCells[width - 1] as string) === "") width -= 1;
  if (width === 0) throw new FileRejectedError("imports.no_header", "La ligne d'en-têtes est vide.");
  if (width > limits.maxColumns) throw new FileRejectedError("imports.too_many_columns", `La feuille compte ${width} colonnes ; le maximum est ${limits.maxColumns}.`);
  const headers = finalizeHeaders(Array.from({ length: width }, (_, i) => headerCells[i] ?? ""), warnings);
  const headerRowNo = first.value.rowNo;

  async function* rows(): AsyncGenerator<RawRow, void, void> {
    let count = 0;
    try {
      for await (const r of source) {
        count += 1;
        if (count > limits.maxRows) throw new FileRejectedError("imports.too_many_rows", `Le fichier dépasse ${limits.maxRows} lignes de données.`, { maxRows: limits.maxRows });
        const cells: string[] = new Array<string>(width);
        for (let i = 0; i < width; i += 1) {
          const raw = r.cells[i] ?? "";
          cells[i] = cleanCell(raw.length > limits.maxCellChars + 1 ? raw.slice(0, limits.maxCellChars + 1) : raw);
        }
        yield { rowNo: r.rowNo, cells };
      }
    } finally {
      if (stats.formulas > 0) {
        warnings.push({
          code: "imports.formulas_ignored",
          message: `${stats.formulas} cellule(s) contiennent une formule : seule la valeur enregistrée est lue, jamais recalculée.`,
          count: stats.formulas,
        });
      }
      if (stats.errors > 0) warnings.push({ code: "imports.cell_errors", message: `${stats.errors} cellule(s) en erreur (#N/A, #REF!...) ont été lues comme vides.`, count: stats.errors });
    }
  }

  return { kind: "XLSX", sheetName: sheet.name, sheetNames: sheets.map((s) => s.name), headers, headerRowNo, rows, warnings };
}
