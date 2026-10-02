/**
 * Formats d'export et d'import : LISTES BLANCHES (champ source, transformation, cible d'import).
 *
 * Un format est une ligne de données (R-EXA-10) : ses colonnes ne peuvent citer qu'un champ de cette liste et qu'une
 * transformation de cette liste — AUCUNE expression libre, AUCUNE interpolation. Les listes sont IDENTIQUES à celles de la
 * base (`examinations.valid_export_columns`, `valid_import_columns`) : un test de parité les compare à une base réelle.
 * Un besoin hors liste = une NOUVELLE transformation (livraison de code minimale), jamais une expression.
 */
import type { ExportColumn, ExportFileFormat, ExportKind, ImportColumn, BatchKind } from "./types";

export const EXPORT_SOURCES = [
  "candidate.number",
  "candidate.official_number",
  "candidate.last_name",
  "candidate.first_name",
  "candidate.birth_date",
  "candidate.birth_place",
  "candidate.sex",
  "candidate.track",
  "candidate.grade_level",
  "candidate.institution",
  "candidate.status",
  "candidate.identifier.cepe_code",
  "candidate.identifier.national_id",
  "assignment.center_code",
  "assignment.center_name",
  "assignment.room_code",
  "assignment.seat_number",
  "assignment.table_number",
  "result.code",
  "result.average",
  "result.rank",
  "result.mention",
  "result.total_points",
  "paper.score",
  "stat.group",
  "stat.registered",
  "stat.present",
  "stat.admitted",
  "stat.failed",
  "stat.absent",
  "stat.excluded",
  "stat.deferred",
  "stat.rate",
  "constant",
] as const;
export type ExportSource = (typeof EXPORT_SOURCES)[number];

export const EXPORT_TRANSFORMS = ["none", "upper", "lower", "date_iso", "date_dmy", "sex_fm", "decimal_comma", "pad_left_8"] as const;
export type ExportTransform = (typeof EXPORT_TRANSFORMS)[number];

/** Sources valides par nature d'export (une liste de candidats n'a ni résultat ni place, etc.). */
export const SOURCES_BY_KIND: Readonly<Record<ExportKind, readonly string[]>> = Object.freeze({
  CANDIDATE_LIST: EXPORT_SOURCES.filter((s) => !s.startsWith("result.") && !s.startsWith("paper.") && !s.startsWith("assignment.") && !s.startsWith("stat.")),
  CENTER_ASSIGNMENTS: EXPORT_SOURCES.filter((s) => !s.startsWith("result.") && !s.startsWith("paper.") && !s.startsWith("stat.")),
  RESULTS: EXPORT_SOURCES.filter((s) => !s.startsWith("stat.")),
  // Les statistiques sont des compteurs par groupe : aucun champ de candidat (R-EXA-12 : pas d'identité dans un agrégat).
  STATISTICS: EXPORT_SOURCES.filter((s) => s.startsWith("stat.") || s === "constant"),
});

export const FILE_FORMATS: readonly ExportFileFormat[] = ["CSV", "XLSX", "FIXED_WIDTH", "JSON"];
export const DELIMITERS = [",", ";", "\t", "|"] as const;

export interface SpecIssue {
  index: number;
  field: string;
  message: string;
}

const HEADER_MAX = 80;

/** Valide les colonnes d'un format d'export. Renvoie la liste des problèmes (vide = valide). */
export function validateExportColumns(columns: unknown, kind: ExportKind, fileFormat: ExportFileFormat): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (!Array.isArray(columns)) return [{ index: -1, field: "columns", message: "Les colonnes doivent former une liste." }];
  if (columns.length < 1 || columns.length > 60) issues.push({ index: -1, field: "columns", message: "Un format compte de 1 à 60 colonnes." });
  const allowed = SOURCES_BY_KIND[kind];
  const headers = new Set<string>();
  columns.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push({ index, field: "column", message: "Une colonne est un objet." });
      return;
    }
    const c = raw as Record<string, unknown>;
    const header = typeof c.header === "string" ? c.header : "";
    if (header === "" || header.length > HEADER_MAX) issues.push({ index, field: "header", message: `L'en-tête est obligatoire (${HEADER_MAX} caractères au plus).` });
    else if (headers.has(header)) issues.push({ index, field: "header", message: `L'en-tête « ${header} » est en double.` });
    headers.add(header);
    const source = typeof c.source === "string" ? c.source : "";
    if (!(EXPORT_SOURCES as readonly string[]).includes(source) && !allowed.includes(source)) {
      issues.push({ index, field: "source", message: `Champ source hors liste blanche : « ${source} ».` });
    } else if (!allowed.includes(source)) {
      issues.push({ index, field: "source", message: `Le champ « ${source} » n'existe pas dans un export de nature ${kind}.` });
    }
    if (source.startsWith("paper.") && (typeof c.paper !== "string" || c.paper === "")) issues.push({ index, field: "paper", message: "Une colonne de note désigne son épreuve." });
    const transform = c.transform === undefined ? "none" : c.transform;
    if (typeof transform !== "string" || !(EXPORT_TRANSFORMS as readonly string[]).includes(transform)) {
      issues.push({ index, field: "transform", message: `Transformation hors liste blanche : « ${String(transform)} ».` });
    }
    if (source === "constant" && (typeof c.value !== "string" || c.value.length > 200)) issues.push({ index, field: "value", message: "Une colonne constante porte sa valeur (200 caractères au plus)." });
    if (fileFormat === "FIXED_WIDTH") {
      if (typeof c.width !== "number" || !Number.isInteger(c.width) || c.width < 1 || c.width > 500) issues.push({ index, field: "width", message: "Une colonne à largeur fixe porte sa largeur (1 à 500)." });
    }
    for (const key of Object.keys(c)) {
      if (!["header", "source", "transform", "paper", "width", "value"].includes(key)) issues.push({ index, field: key, message: `Propriété inconnue : « ${key} » (aucune expression libre).` });
    }
  });
  return issues;
}

export function validateExportFormatShape(input: { kind: ExportKind; fileFormat: ExportFileFormat; delimiter: string | null | undefined }): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (input.fileFormat === "CSV" && !input.delimiter) issues.push({ index: -1, field: "delimiter", message: "Un format CSV porte son séparateur." });
  if (input.delimiter && !(DELIMITERS as readonly string[]).includes(input.delimiter)) issues.push({ index: -1, field: "delimiter", message: "Séparateur admis : « , », « ; », tabulation, « | »." });
  return issues;
}

// ---------------------------------------------------------------------------- import

export const IMPORT_KEY_TARGETS = ["key.candidate_number", "key.official_number", "key.cepe_code", "key.national_id"] as const;
export const IMPORT_TARGETS = [
  ...IMPORT_KEY_TARGETS,
  "identifier.official_number",
  "result.code",
  "result.average",
  "result.rank",
  "result.mention",
  "result.total_points",
  "paper.score",
  "paper.status",
] as const;
export const IMPORT_VALUE_MAP_KEYS = ["result.code", "paper.status"] as const;

const REQUIRED_TARGET: Readonly<Record<BatchKind, string>> = { RESULTS: "result.code", SCORES: "paper.score", OFFICIAL_NUMBERS: "identifier.official_number" };

export function validateImportColumns(columns: unknown, kind: BatchKind): SpecIssue[] {
  const issues: SpecIssue[] = [];
  if (!Array.isArray(columns)) return [{ index: -1, field: "columns", message: "Les colonnes doivent former une liste." }];
  if (columns.length < 2 || columns.length > 60) issues.push({ index: -1, field: "columns", message: "Un format d'import compte de 2 à 60 colonnes." });
  let keys = 0;
  let hasRequired = false;
  const headers = new Set<string>();
  columns.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push({ index, field: "column", message: "Une colonne est un objet." });
      return;
    }
    const c = raw as Record<string, unknown>;
    const header = typeof c.header === "string" ? c.header : "";
    if (header === "" || header.length > HEADER_MAX) issues.push({ index, field: "header", message: `L'en-tête est obligatoire (${HEADER_MAX} caractères au plus).` });
    else if (headers.has(header)) issues.push({ index, field: "header", message: `L'en-tête « ${header} » est en double.` });
    headers.add(header);
    const target = typeof c.target === "string" ? c.target : "";
    if (!(IMPORT_TARGETS as readonly string[]).includes(target)) issues.push({ index, field: "target", message: `Cible hors liste blanche : « ${target} ».` });
    if (target.startsWith("key.")) keys += 1;
    if (target === REQUIRED_TARGET[kind]) hasRequired = true;
    if (target.startsWith("paper.") && (typeof c.paper !== "string" || c.paper === "")) issues.push({ index, field: "paper", message: "Une colonne de note désigne son épreuve." });
    for (const key of Object.keys(c)) if (!["header", "target", "paper"].includes(key)) issues.push({ index, field: key, message: `Propriété inconnue : « ${key} ».` });
  });
  if (keys !== 1) issues.push({ index: -1, field: "columns", message: "Exactement une colonne identifie le candidat (cible key.*)." });
  if (!hasRequired) issues.push({ index: -1, field: "columns", message: `Un fichier de nature ${kind} exige une colonne « ${REQUIRED_TARGET[kind]} ».` });
  return issues;
}

const RESULT_CODE_VALUES = ["ADMITTED", "FAILED", "ABSENT", "EXCLUDED", "DEFERRED"];
const SCORE_STATUS_VALUES = ["ENTERED", "ABSENT", "EXCUSED", "MALPRACTICE"];

export function validateImportValueMap(map: unknown): SpecIssue[] {
  if (typeof map !== "object" || map === null || Array.isArray(map)) return [{ index: -1, field: "valueMap", message: "La table de correspondance est un objet." }];
  const issues: SpecIssue[] = [];
  for (const [key, inner] of Object.entries(map as Record<string, unknown>)) {
    if (!(IMPORT_VALUE_MAP_KEYS as readonly string[]).includes(key)) {
      issues.push({ index: -1, field: key, message: `Clé de correspondance inconnue : « ${key} ».` });
      continue;
    }
    if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
      issues.push({ index: -1, field: key, message: "Chaque correspondance est un objet { valeur du fichier : code }." });
      continue;
    }
    const allowed = key === "result.code" ? RESULT_CODE_VALUES : SCORE_STATUS_VALUES;
    for (const [from, to] of Object.entries(inner as Record<string, unknown>)) {
      if (typeof to !== "string" || !allowed.includes(to)) issues.push({ index: -1, field: `${key}.${from}`, message: `Code inconnu : « ${String(to)} ».` });
    }
  }
  return issues;
}

export type { ExportColumn, ImportColumn };
