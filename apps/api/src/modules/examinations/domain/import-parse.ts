/**
 * Analyse d'un fichier d'échange (numéros officiels, notes, résultats) selon un FORMAT D'IMPORT publié (donnée).
 *
 * Aucune valeur du fichier n'est interprétée comme une expression ou une formule : chaque cellule est lue comme du texte
 * puis convertie par une transformation fermée (décimal, entier, code mappé). Les lignes produites ne contiennent ni nom ni
 * adresse : la clé d'un candidat (numéro) et les valeurs utiles seulement (minimisation des données d'enfants, T-E08).
 *
 * Erreurs : codes de ligne stables en MAJUSCULES (`import_rows.error_code`) ; une erreur de FICHIER (en-tête manquant,
 * encodage illisible) refuse tout le lot.
 */
import type { BatchKind, ImportColumn, ImportFormatRow, ResultCode } from "./types";
import { RESULT_CODES, SCORE_STATUSES, type ScoreStatus } from "./types";

export const IMPORT_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxRows: 10_000, maxCell: 200 });

export const IMPORT_ERROR = {
  KEY_MISSING: "KEY_MISSING",
  KEY_DUPLICATE: "KEY_DUPLICATE",
  COLUMN_COUNT: "COLUMN_COUNT",
  RESULT_CODE_UNKNOWN: "RESULT_CODE_UNKNOWN",
  RESULT_CODE_MISSING: "RESULT_CODE_MISSING",
  AVERAGE_INVALID: "AVERAGE_INVALID",
  TOTAL_INVALID: "TOTAL_INVALID",
  RANK_INVALID: "RANK_INVALID",
  MENTION_INVALID: "MENTION_INVALID",
  SCORE_INVALID: "SCORE_INVALID",
  SCORE_STATUS_UNKNOWN: "SCORE_STATUS_UNKNOWN",
  OFFICIAL_NUMBER_INVALID: "OFFICIAL_NUMBER_INVALID",
  VALUE_WITHOUT_RESULT_FORBIDDEN: "VALUE_WITHOUT_RESULT_FORBIDDEN",
  // posés à la résolution des clés (application)
  CANDIDATE_UNKNOWN: "CANDIDATE_UNKNOWN",
  CANDIDATE_NOT_REGISTERED: "CANDIDATE_NOT_REGISTERED",
  PAPER_UNKNOWN: "PAPER_UNKNOWN",
  PAPER_NOT_FOR_TRACK: "PAPER_NOT_FOR_TRACK",
  SCORE_ABOVE_SCALE: "SCORE_ABOVE_SCALE",
  RESULT_ALREADY_PUBLISHED: "RESULT_ALREADY_PUBLISHED",
  OFFICIAL_NUMBER_TAKEN: "OFFICIAL_NUMBER_TAKEN",
} as const;
export type ImportErrorCode = (typeof IMPORT_ERROR)[keyof typeof IMPORT_ERROR];

export class FileError extends Error {
  constructor(
    readonly code: "FILE_EMPTY" | "FILE_TOO_LARGE" | "FILE_UNREADABLE",
    message: string,
  ) {
    super(message);
    this.name = "FileError";
  }
}

export function decodeFile(bytes: Uint8Array, encoding: ImportFormatRow["encoding"]): string {
  if (bytes.byteLength === 0) throw new FileError("FILE_EMPTY", "Le fichier est vide.");
  if (bytes.byteLength > IMPORT_LIMITS.maxBytes) throw new FileError("FILE_TOO_LARGE", "Le fichier dépasse la taille maximale de 5 Mio.");
  try {
    const label = encoding === "UTF-8" ? "utf-8" : encoding === "ISO-8859-1" ? "iso-8859-1" : "windows-1252";
    const text = new TextDecoder(label, { fatal: encoding === "UTF-8" }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    throw new FileError("FILE_UNREADABLE", `Le fichier n'est pas lisible en ${encoding}.`);
  }
}

/** Découpe un texte délimité (RFC 4180 : guillemets, guillemets doublés, retours à la ligne dans un champ). Lignes vides ignorées. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  const pushRow = (): void => {
    pushField();
    if (!(row.length === 1 && row[0]?.trim() === "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delimiter) pushField();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      pushRow();
    } else if (ch === "\n") pushRow();
    else field += ch;
  }
  if (inQuotes) throw new FileError("FILE_UNREADABLE", "Un champ entre guillemets n'est pas refermé.");
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

export interface ParsedRow {
  lineNo: number;
  keyTarget: string;
  keyValue: string;
  resultCode?: ResultCode;
  average?: string;
  totalPoints?: string;
  rank?: number;
  mention?: string;
  officialNumber?: string;
  papers: Record<string, { score?: string; status?: ScoreStatus }>;
  errors: ImportErrorCode[];
}

const DECIMAL = /^\d{1,7}(\.\d{1,3})?$/;

/** Convertit un décimal du fichier (séparateur du format) en chaîne canonique `123.45`, ou `null`. Refuse signe, exposant, milliers. */
export function parseDecimal(raw: string, separator: "." | ","): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const canonical = separator === "," ? trimmed.replace(",", ".") : trimmed;
  if (separator === "," && trimmed.includes(".")) return null;
  if (!DECIMAL.test(canonical)) return null;
  return canonical;
}

export interface AnalysisResult {
  rows: ParsedRow[];
  /** Colonnes de l'en-tête non reconnues par le format (ignorées, signalées). */
  ignoredHeaders: string[];
}

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, "").trim().toLocaleLowerCase("fr-FR");
}

export function analyze(format: Pick<ImportFormatRow, "kind" | "delimiter" | "decimalSeparator" | "hasHeader" | "columns" | "valueMap" | "encoding">, bytes: Uint8Array): AnalysisResult {
  const text = decodeFile(bytes, format.encoding);
  const table = parseDelimited(text, format.delimiter);
  if (table.length === 0) throw new FileError("FILE_EMPTY", "Le fichier ne contient aucune ligne.");
  let body = table;
  let indexOf: Map<ImportColumn, number>;
  let ignoredHeaders: string[] = [];
  if (format.hasHeader) {
    const header = (table[0] as string[]).map(normalizeHeader);
    indexOf = new Map();
    const used = new Set<number>();
    for (const col of format.columns) {
      const at = header.indexOf(normalizeHeader(col.header));
      if (at < 0) throw new FileError("FILE_UNREADABLE", `La colonne « ${col.header} » est absente de l'en-tête du fichier.`);
      indexOf.set(col, at);
      used.add(at);
    }
    ignoredHeaders = (table[0] as string[]).filter((_, i) => !used.has(i)).map((h) => h.trim()).filter(Boolean);
    body = table.slice(1);
  } else {
    indexOf = new Map(format.columns.map((c, i) => [c, i]));
  }
  if (body.length === 0) throw new FileError("FILE_EMPTY", "Le fichier ne contient aucune ligne de données.");
  if (body.length > IMPORT_LIMITS.maxRows) throw new FileError("FILE_TOO_LARGE", `Le fichier dépasse ${IMPORT_LIMITS.maxRows} lignes.`);

  const mapResult = format.valueMap["result.code"] ?? {};
  const mapStatus = format.valueMap["paper.status"] ?? {};
  const lookup = (map: Record<string, string>, raw: string): string | undefined => {
    if (Object.hasOwn(map, raw)) return map[raw];
    const upper = raw.toLocaleUpperCase("fr-FR");
    for (const [k, v] of Object.entries(map)) if (k.toLocaleUpperCase("fr-FR") === upper) return v;
    return undefined;
  };
  const seenKeys = new Set<string>();
  const rows: ParsedRow[] = [];
  const firstLine = format.hasHeader ? 2 : 1;

  body.forEach((cells, i) => {
    const row: ParsedRow = { lineNo: firstLine + i, keyTarget: "", keyValue: "", papers: {}, errors: [] };
    const cell = (col: ImportColumn): string => {
      const v = cells[indexOf.get(col) as number];
      return (v ?? "").trim().slice(0, IMPORT_LIMITS.maxCell);
    };
    const maxIndex = Math.max(...[...indexOf.values()]);
    if (cells.length <= maxIndex) row.errors.push(IMPORT_ERROR.COLUMN_COUNT);
    for (const col of format.columns) {
      const raw = cell(col);
      switch (col.target) {
        case "key.candidate_number":
        case "key.official_number":
        case "key.cepe_code":
        case "key.national_id":
          row.keyTarget = col.target;
          row.keyValue = raw;
          if (raw === "") row.errors.push(IMPORT_ERROR.KEY_MISSING);
          break;
        case "identifier.official_number":
          if (raw === "" || raw.length > 60 || /[\u0000-\u001f]/.test(raw)) row.errors.push(IMPORT_ERROR.OFFICIAL_NUMBER_INVALID);
          else row.officialNumber = raw;
          break;
        case "result.code": {
          if (raw === "") {
            row.errors.push(IMPORT_ERROR.RESULT_CODE_MISSING);
            break;
          }
          const mapped = lookup(mapResult, raw) ?? ((RESULT_CODES as readonly string[]).includes(raw.toUpperCase()) ? raw.toUpperCase() : undefined);
          if (mapped && (RESULT_CODES as readonly string[]).includes(mapped)) row.resultCode = mapped as ResultCode;
          else row.errors.push(IMPORT_ERROR.RESULT_CODE_UNKNOWN);
          break;
        }
        case "result.average":
          if (raw !== "") {
            const d = parseDecimal(raw, format.decimalSeparator);
            if (d === null || Number(d) >= 10_000) row.errors.push(IMPORT_ERROR.AVERAGE_INVALID);
            else row.average = d;
          }
          break;
        case "result.total_points":
          if (raw !== "") {
            const d = parseDecimal(raw, format.decimalSeparator);
            if (d === null) row.errors.push(IMPORT_ERROR.TOTAL_INVALID);
            else row.totalPoints = d;
          }
          break;
        case "result.rank":
          if (raw !== "") {
            if (/^\d{1,6}$/.test(raw) && Number(raw) >= 1) row.rank = Number(raw);
            else row.errors.push(IMPORT_ERROR.RANK_INVALID);
          }
          break;
        case "result.mention":
          if (raw !== "") {
            const m = raw.toUpperCase().replace(/[\s-]+/g, "_");
            if (/^[A-Z][A-Z0-9_]{1,39}$/.test(m)) row.mention = m;
            else row.errors.push(IMPORT_ERROR.MENTION_INVALID);
          }
          break;
        case "paper.score": {
          const p = (row.papers[col.paper as string] ??= {});
          if (raw !== "") {
            const d = parseDecimal(raw, format.decimalSeparator);
            if (d === null || Number(d) >= 10_000) row.errors.push(IMPORT_ERROR.SCORE_INVALID);
            else p.score = d;
          }
          break;
        }
        case "paper.status": {
          const p = (row.papers[col.paper as string] ??= {});
          if (raw !== "") {
            const mapped = lookup(mapStatus, raw) ?? ((SCORE_STATUSES as readonly string[]).includes(raw.toUpperCase()) ? raw.toUpperCase() : undefined);
            if (mapped && (SCORE_STATUSES as readonly string[]).includes(mapped)) p.status = mapped as ScoreStatus;
            else row.errors.push(IMPORT_ERROR.SCORE_STATUS_UNKNOWN);
          }
          break;
        }
        default:
          break;
      }
    }
    if (row.keyValue !== "") {
      const id = `${row.keyTarget}:${row.keyValue}`;
      if (seenKeys.has(id)) row.errors.push(IMPORT_ERROR.KEY_DUPLICATE);
      seenKeys.add(id);
    }
    // cohérence note / statut d'une épreuve : une note n'accompagne qu'un statut ENTERED
    for (const p of Object.values(row.papers)) {
      if (p.status && p.status !== "ENTERED" && p.score !== undefined) row.errors.push(IMPORT_ERROR.SCORE_INVALID);
      if (!p.status && p.score !== undefined) p.status = "ENTERED";
    }
    if (row.resultCode && ["ABSENT", "EXCLUDED", "DEFERRED"].includes(row.resultCode) && (row.average !== undefined || row.rank !== undefined || row.mention !== undefined)) {
      row.errors.push(IMPORT_ERROR.VALUE_WITHOUT_RESULT_FORBIDDEN);
    }
    row.errors = [...new Set(row.errors)];
    rows.push(row);
  });
  return { rows, ignoredHeaders };
}

/** Charge utile d'une ligne d'import (sans nom ni adresse) enregistrée dans `import_rows.payload`. */
export function payloadOf(row: ParsedRow, kind: BatchKind): Record<string, unknown> {
  const base: Record<string, unknown> = { key: { target: row.keyTarget, value: row.keyValue } };
  if (kind === "RESULTS") {
    base.result = { code: row.resultCode ?? null, average: row.average ?? null, totalPoints: row.totalPoints ?? null, rank: row.rank ?? null, mention: row.mention ?? null };
  } else if (kind === "SCORES") {
    base.papers = row.papers;
  } else {
    base.officialNumber = row.officialNumber ?? null;
  }
  return base;
}
