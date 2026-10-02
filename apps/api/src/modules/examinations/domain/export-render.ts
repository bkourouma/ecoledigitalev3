/**
 * Production d'un fichier d'export à partir d'un format publié : résolution des champs (liste blanche), transformations
 * (liste blanche), neutralisation des formules de tableur, sérialisation CSV / largeur fixe / JSON, encodage.
 * (XLSX : `infrastructure/xlsx.ts`, qui reçoit la matrice de cellules produite ici.)
 *
 * Aucune expression n'est évaluée : une colonne désigne un champ et une transformation d'une liste fermée. Domaine pur.
 */
import { createHash } from "node:crypto";
import type { ExportColumn, ExportFileFormat, FileEncoding } from "./types";

/** Les faits d'une ligne d'export : un candidat et ce qui s'y rattache. Valeurs déjà lues en base, jamais interprétées. */
export interface ExportFacts {
  candidate?: {
    number: string | null;
    officialNumber: string | null;
    lastName: string | null;
    firstName: string | null;
    birthDate: string | null;
    birthPlace: string | null;
    sex: string | null;
    track: string | null;
    gradeLevel: string | null;
    institution: string | null;
    status: string | null;
    cepeCode: string | null;
    nationalId: string | null;
  };
  assignment?: { centerCode: string | null; centerName: string | null; roomCode: string | null; seatNumber: number | null; tableNumber: string | null };
  result?: { code: string | null; average: string | null; rank: number | null; mention: string | null; totalPoints: string | null };
  /** Note par code d'épreuve (texte décimal exact, ou `null` si absent). */
  papers?: Readonly<Record<string, string | null>>;
  stat?: { group: string; registered: number; present: number; admitted: number; failed: number; absent: number; excluded: number; deferred: number; rate: string | null };
}

/** Valeur résolue : le texte, et si elle est d'origine NUMÉRIQUE (calculée ici, jamais neutralisée) ou saisie (texte). */
export interface Cell {
  value: string;
  numeric: boolean;
}

const EMPTY: Cell = { value: "", numeric: false };
const text = (v: string | null | undefined): Cell => (v === null || v === undefined ? EMPTY : { value: v, numeric: false });
const num = (v: string | number | null | undefined): Cell => (v === null || v === undefined ? { value: "", numeric: true } : { value: String(v), numeric: true });

export function resolveSource(column: ExportColumn, facts: ExportFacts): Cell {
  const c = facts.candidate;
  const a = facts.assignment;
  const r = facts.result;
  const s = facts.stat;
  switch (column.source) {
    case "candidate.number": return text(c?.number);
    case "candidate.official_number": return text(c?.officialNumber);
    case "candidate.last_name": return text(c?.lastName);
    case "candidate.first_name": return text(c?.firstName);
    case "candidate.birth_date": return text(c?.birthDate);
    case "candidate.birth_place": return text(c?.birthPlace);
    case "candidate.sex": return text(c?.sex);
    case "candidate.track": return text(c?.track);
    case "candidate.grade_level": return text(c?.gradeLevel);
    case "candidate.institution": return text(c?.institution);
    case "candidate.status": return text(c?.status);
    case "candidate.identifier.cepe_code": return text(c?.cepeCode);
    case "candidate.identifier.national_id": return text(c?.nationalId);
    case "assignment.center_code": return text(a?.centerCode);
    case "assignment.center_name": return text(a?.centerName);
    case "assignment.room_code": return text(a?.roomCode);
    case "assignment.seat_number": return num(a?.seatNumber);
    case "assignment.table_number": return text(a?.tableNumber);
    case "result.code": return text(r?.code);
    case "result.average": return num(r?.average);
    case "result.rank": return num(r?.rank);
    case "result.mention": return text(r?.mention);
    case "result.total_points": return num(r?.totalPoints);
    case "paper.score": return num(column.paper ? facts.papers?.[column.paper] ?? null : null);
    case "stat.group": return text(s?.group);
    case "stat.registered": return num(s?.registered);
    case "stat.present": return num(s?.present);
    case "stat.admitted": return num(s?.admitted);
    case "stat.failed": return num(s?.failed);
    case "stat.absent": return num(s?.absent);
    case "stat.excluded": return num(s?.excluded);
    case "stat.deferred": return num(s?.deferred);
    case "stat.rate": return num(s?.rate);
    case "constant": return text(column.value ?? "");
    default: return EMPTY; // jamais atteint : le format a été validé (liste blanche) ; une source inconnue donne une cellule vide
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export function applyTransform(cell: Cell, transform: string | undefined): Cell {
  const v = cell.value;
  switch (transform ?? "none") {
    case "upper": return { value: v.toLocaleUpperCase("fr-FR"), numeric: cell.numeric };
    case "lower": return { value: v.toLocaleLowerCase("fr-FR"), numeric: cell.numeric };
    case "date_iso": {
      const m = ISO_DATE.exec(v);
      return { value: m ? `${m[1]}-${m[2]}-${m[3]}` : v, numeric: false };
    }
    case "date_dmy": {
      const m = ISO_DATE.exec(v);
      return { value: m ? `${m[3]}/${m[2]}/${m[1]}` : v, numeric: false };
    }
    case "sex_fm": return { value: v === "F" || v === "M" ? v : "", numeric: false };
    case "decimal_comma": return { value: v.replace(".", ","), numeric: cell.numeric };
    case "pad_left_8": return { value: v.length >= 8 ? v : v.padStart(8, "0"), numeric: false };
    default: return cell;
  }
}

/**
 * Neutralisation de l'injection de formule (CSV / XLSX) : une cellule TEXTE dont le premier caractère significatif est
 * `=`, `+`, `-`, `@` (y compris leurs formes pleine chasse), tabulation ou retour chariot est précédée d'une apostrophe.
 * Les cellules numériques produites par le module (moyennes, rangs, effectifs) ne sont pas modifiées.
 */
export function neutralizeFormula(value: string): string {
  if (value.length === 0) return value;
  if (/^[\t\r\n\u0000-\u001f ]*[=+\-@＝＋－＠]/.test(value) || value.startsWith("\t") || value.startsWith("\r")) return `'${value}`;
  return value;
}

export interface RenderedTable {
  headers: string[];
  /** Cellules déjà transformées (neutralisation NON appliquée : selon le format de fichier). */
  rows: Cell[][];
}

export function buildTable(columns: readonly ExportColumn[], facts: readonly ExportFacts[]): RenderedTable {
  return {
    headers: columns.map((c) => c.header),
    rows: facts.map((f) => columns.map((c) => applyTransform(resolveSource(c, f), c.transform))),
  };
}

const CSV_SPECIAL = /["\r\n]/;

export function csvField(value: string, delimiter: string): string {
  if (CSV_SPECIAL.test(value) || value.includes(delimiter)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** CSV : fins de ligne CRLF, en-tête, cellules texte neutralisées. */
export function toCsv(table: RenderedTable, delimiter: string): string {
  const lines = [table.headers.map((h) => csvField(neutralizeFormula(h), delimiter)).join(delimiter)];
  for (const row of table.rows) lines.push(row.map((c) => csvField(c.numeric ? c.value : neutralizeFormula(c.value), delimiter)).join(delimiter));
  return lines.join("\r\n") + "\r\n";
}

/** Largeur fixe : texte à gauche complété d'espaces, nombre à droite ; une valeur trop longue est TRONQUÉE (elle ne décale jamais la ligne). */
export function toFixedWidth(table: RenderedTable, columns: readonly ExportColumn[]): string {
  const lines: string[] = [];
  for (const row of table.rows) {
    lines.push(
      row
        .map((c, i) => {
          const width = columns[i]?.width ?? 1;
          const v = c.value.replace(/[\r\n\t]+/g, " ");
          const cut = v.length > width ? v.slice(0, width) : v;
          return c.numeric ? cut.padStart(width, " ") : cut.padEnd(width, " ");
        })
        .join(""),
    );
  }
  return lines.join("\r\n") + (lines.length > 0 ? "\r\n" : "");
}

/** JSON : tableau d'objets { en-tête: valeur } ; les nombres issus du module restent des chaînes décimales exactes. */
export function toJson(table: RenderedTable): string {
  const items = table.rows.map((row) => Object.fromEntries(table.headers.map((h, i) => [h, row[i]?.value ?? ""])));
  return JSON.stringify(items, null, 2) + "\n";
}

// ---------------------------------------------------------------------------- encodage

/** Points de code de Windows-1252 pour 0x80–0x9F (le reste coïncide avec ISO-8859-1). */
const CP1252: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Encode un texte ; un caractère non représentable devient « ? » (jamais une perte silencieuse de ligne). */
export function encodeText(value: string, encoding: FileEncoding): Buffer {
  if (encoding === "UTF-8") return Buffer.from(value, "utf8");
  const out = Buffer.alloc([...value].length);
  let i = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number;
    if (encoding === "WINDOWS-1252") {
      const mapped = CP1252[cp];
      out[i] = mapped !== undefined ? mapped : cp <= 0xff && !(cp >= 0x80 && cp <= 0x9f) ? cp : 0x3f;
    } else {
      out[i] = cp <= 0xff ? cp : 0x3f;
    }
    i += 1;
  }
  return out;
}

export const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

export const FILE_EXTENSION: Readonly<Record<ExportFileFormat, string>> = { CSV: "csv", XLSX: "xlsx", FIXED_WIDTH: "txt", JSON: "json" };
export const FILE_MIME: Readonly<Record<ExportFileFormat, string>> = {
  CSV: "text/csv",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  FIXED_WIDTH: "text/plain",
  JSON: "application/json",
};
