/**
 * Mapping de colonnes (pur) : détection automatique par en-têtes, modèles enregistrés, validation du mapping.
 *
 * Un mapping associe CHAQUE champ cible (`ColumnDef.key`) à l'en-tête exact d'une colonne du fichier, ou à `null`
 * (champ non importé). Un en-tête n'alimente jamais deux champs.
 */
import { headerTokens, normalizeHeader } from "./text";
import type { ColumnDef } from "./types";

export type Mapping = Record<string, string | null>;

export const TEMPLATE_MIN_MATCH = 0.8;
const MIN_SCORE = 70;

function levenshteinAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (la > lb) i += 1;
    else if (lb > la) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** Score 0-100 d'un en-tête pour un alias (0 : aucun lien). */
export function scoreHeader(header: string, alias: string): number {
  const h = normalizeHeader(header);
  const a = normalizeHeader(alias);
  if (h === "" || a === "") return 0;
  if (h === a) return 100;
  if (h.replace(/ /g, "") === a.replace(/ /g, "")) return 95;
  const ht = headerTokens(header);
  const at = headerTokens(alias);
  const hs = new Set(ht);
  // Tous les jetons de l'alias figurent dans l'en-tête (« date de naissance de l'élève » pour « date naissance »).
  if (at.length > 0 && at.every((t) => hs.has(t))) return 85 - Math.min(10, Math.max(0, ht.length - at.length) * 3);
  // L'en-tête est un sous-ensemble de l'alias, avec au moins un jeton significatif.
  const as = new Set(at);
  if (ht.length > 0 && ht.length < at.length && ht.every((t) => as.has(t)) && ht.some((t) => t.length >= 4)) return 72;
  // Une faute de frappe sur un mot long.
  if (a.length > 5 && levenshteinAtMostOne(h, a)) return 78;
  return 0;
}

export interface Detection {
  readonly mapping: Mapping;
  /** Champs obligatoires sans en-tête trouvé. */
  readonly missingRequired: readonly string[];
  /** En-têtes non affectés. */
  readonly unmappedHeaders: readonly string[];
}

/** Détecte le mapping par en-têtes : meilleurs scores d'abord, chaque en-tête et chaque champ au plus une fois. */
export function detectMapping(columns: readonly ColumnDef[], headers: readonly string[]): Detection {
  const candidates: Array<{ column: ColumnDef; header: string; headerIndex: number; score: number; order: number }> = [];
  columns.forEach((column, order) => {
    headers.forEach((header, headerIndex) => {
      let best = scoreHeader(header, column.key);
      best = Math.max(best, scoreHeader(header, column.label));
      for (const alias of column.aliases) best = Math.max(best, scoreHeader(header, alias));
      if (best >= MIN_SCORE) candidates.push({ column, header, headerIndex, score: best, order });
    });
  });
  candidates.sort((x, y) => y.score - x.score || x.order - y.order || x.headerIndex - y.headerIndex);
  const mapping: Mapping = Object.fromEntries(columns.map((c) => [c.key, null]));
  const usedHeaders = new Set<number>();
  const assigned = new Set<string>();
  for (const c of candidates) {
    if (assigned.has(c.column.key) || usedHeaders.has(c.headerIndex)) continue;
    mapping[c.column.key] = c.header;
    assigned.add(c.column.key);
    usedHeaders.add(c.headerIndex);
  }
  return {
    mapping,
    missingRequired: columns.filter((c) => c.required && mapping[c.key] === null).map((c) => c.key),
    unmappedHeaders: headers.filter((_, i) => !usedHeaders.has(i)),
  };
}

export interface SavedTemplate {
  readonly id: string;
  readonly mapping: Mapping;
  readonly headers: readonly string[];
  readonly updatedAt: string;
}

/**
 * Applique un modèle enregistré aux en-têtes du fichier : le modèle est retenu si au moins 80 % de ses en-têtes
 * (normalisés) sont présents ; le meilleur taux gagne (à égalité, le plus récent). Les champs dont l'en-tête manque sont
 * rendus `null`.
 */
export function matchTemplate(templates: readonly SavedTemplate[], headers: readonly string[], columns: readonly ColumnDef[]): { template: SavedTemplate; mapping: Mapping } | null {
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!byNorm.has(normalizeHeader(h))) byNorm.set(normalizeHeader(h), h);
  let best: { template: SavedTemplate; ratio: number } | null = null;
  for (const t of templates) {
    const used = [...new Set(t.headers.map(normalizeHeader).filter((h) => h !== ""))];
    if (used.length === 0) continue;
    const found = used.filter((h) => byNorm.has(h)).length;
    const ratio = found / used.length;
    if (ratio < TEMPLATE_MIN_MATCH) continue;
    if (!best || ratio > best.ratio || (ratio === best.ratio && t.updatedAt > best.template.updatedAt)) best = { template: t, ratio };
  }
  if (!best) return null;
  const mapping: Mapping = Object.fromEntries(columns.map((c) => [c.key, null]));
  const taken = new Set<string>();
  for (const c of columns) {
    const wanted = best.template.mapping[c.key];
    if (!wanted) continue;
    const actual = byNorm.get(normalizeHeader(wanted));
    if (actual && !taken.has(actual)) {
      mapping[c.key] = actual;
      taken.add(actual);
    }
  }
  return { template: best.template, mapping };
}

export interface MappingProblem {
  readonly field: string | null;
  readonly code: "imports.mapping_invalid" | "imports.mapping_incomplete";
  readonly message: string;
}

/** Valide un mapping : champs connus, en-têtes existants et uniques, champs obligatoires affectés. */
export function validateMapping(columns: readonly ColumnDef[], headers: readonly string[], mapping: Mapping): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const known = new Map(columns.map((c) => [c.key, c]));
  const headerSet = new Set(headers);
  const usage = new Map<string, string>();
  for (const [field, header] of Object.entries(mapping)) {
    if (!known.has(field)) {
      problems.push({ field, code: "imports.mapping_invalid", message: `Champ inconnu : « ${field} ».` });
      continue;
    }
    if (header === null) continue;
    if (!headerSet.has(header)) {
      problems.push({ field, code: "imports.mapping_invalid", message: `La colonne « ${header} » n'existe pas dans le fichier.` });
      continue;
    }
    const other = usage.get(header);
    if (other) problems.push({ field, code: "imports.mapping_invalid", message: `La colonne « ${header} » ne peut pas alimenter deux champs (« ${other} » et « ${field} »).` });
    else usage.set(header, field);
  }
  for (const c of columns) {
    if (c.required && !mapping[c.key]) problems.push({ field: c.key, code: "imports.mapping_incomplete", message: `Le champ obligatoire « ${c.label} » n'est associé à aucune colonne.` });
  }
  return problems;
}

/** Cellules d'une ligne brute (dans l'ordre des en-têtes) -> valeurs par champ cible (texte, vide omis). */
export function cellsFor(mapping: Mapping, headers: readonly string[], rawRow: readonly string[]): Record<string, string> {
  const indexOf = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!indexOf.has(h)) indexOf.set(h, i);
  });
  const out: Record<string, string> = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (header === null) continue;
    const i = indexOf.get(header);
    if (i === undefined) continue;
    const value = (rawRow[i] ?? "").trim();
    if (value !== "") out[field] = value;
  }
  return out;
}
