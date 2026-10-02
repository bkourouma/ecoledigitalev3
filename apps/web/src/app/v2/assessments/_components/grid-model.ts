/**
 * Modèle de la grille de saisie des notes : logique PURE (testée sans DOM).
 *
 * Ce module traduit ce que l'utilisateur tape (texte d'une cellule) en entrées de lot pour l'API. Il ne calcule JAMAIS
 * de moyenne, de rang, de mention ni de décision : celles-ci viennent de `results`/`rules`. Il applique seulement les
 * contrôles de FORME d'une saisie (nombre décimal, barème, précision) pour éviter un aller-retour inutile ; l'API reste
 * la barrière (elle revalide tout : 0 <= note <= barème, précision, états, versions de ligne).
 *
 * Principes :
 *  - une absence ou une dispense N'EST PAS un zéro : états distincts (`ABSENT_EXCUSED`, `ABSENT_UNEXCUSED`, `EXEMPT`,
 *    `NOT_GRADED`), jamais une note à 0 ;
 *  - les valeurs restent des CHAÎNES décimales (aucun flottant n'est écrit) ;
 *  - une ligne existante est renvoyée avec sa `rowVersion` (détection d'écrasement), une nouvelle ligne sans.
 */

import type { GradeEntryInput } from "@/platform/v2/assess";

export type EntryStatus = "ENTERED" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED" | "EXEMPT" | "NOT_GRADED";

/** Codes tapés dans une cellule -> état d'entrée (comparés sans accent ni casse). */
const CODE_TO_STATUS: Readonly<Record<string, EntryStatus>> = {
  A: "ABSENT_UNEXCUSED",
  ABS: "ABSENT_UNEXCUSED",
  ANJ: "ABSENT_UNEXCUSED",
  J: "ABSENT_EXCUSED",
  AJ: "ABSENT_EXCUSED",
  ABJ: "ABSENT_EXCUSED",
  D: "EXEMPT",
  DI: "EXEMPT",
  DISP: "EXEMPT",
  DISPENSE: "EXEMPT",
  N: "NOT_GRADED",
  NN: "NOT_GRADED",
  NE: "NOT_GRADED",
};

/** Code affiché (et retapable) pour chaque état non noté. */
export const STATUS_CODE: Readonly<Record<Exclude<EntryStatus, "ENTERED">, string>> = {
  ABSENT_UNEXCUSED: "ABS",
  ABSENT_EXCUSED: "ABJ",
  EXEMPT: "DISP",
  NOT_GRADED: "NN",
};

export interface CellContext {
  /** Barème de l'évaluation (chaîne décimale, ex. « 20 »). */
  scaleMax: string;
  /** Nombre maximal de décimales d'une note (réglage du tenant, 3 au plus). */
  maxDecimals: number;
}

export type CellParse =
  | { kind: "empty" }
  | { kind: "score"; value: string }
  | { kind: "status"; status: Exclude<EntryStatus, "ENTERED"> }
  | { kind: "invalid"; reason: "format" | "decimals" | "range" };

const strip = (s: string): string => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();

/** Valeur décimale en millièmes (entier exact) : comparaison sans flottant. */
function toMilli(value: string): number {
  const [int = "0", frac = ""] = value.split(".");
  return Number(int) * 1000 + Number(frac.padEnd(3, "0").slice(0, 3));
}

/** `12.50` et `12.5` désignent la même note. */
export function normalizeDecimal(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export function parseCell(raw: string, ctx: CellContext): CellParse {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };
  const code = CODE_TO_STATUS[strip(text)];
  if (code && code !== "ENTERED") return { kind: "status", status: code as Exclude<EntryStatus, "ENTERED"> };
  const dotted = text.replace(",", ".");
  if (!/^\d{1,5}(\.\d+)?$/.test(dotted)) return { kind: "invalid", reason: "format" };
  const decimals = dotted.includes(".") ? dotted.split(".")[1]!.length : 0;
  if (decimals > Math.min(3, ctx.maxDecimals)) return { kind: "invalid", reason: "decimals" };
  if (toMilli(dotted) > toMilli(ctx.scaleMax)) return { kind: "invalid", reason: "range" };
  return { kind: "score", value: dotted };
}

// ---------------------------------------------------------------------------
// Lignes
// ---------------------------------------------------------------------------

export interface GridBase {
  entryStatus: EntryStatus;
  score: string | null;
  comment: string | null;
}

export interface GridRow {
  /** Identifiant de la note (absent tant qu'aucune note n'est enregistrée). */
  gradeId: string | null;
  enrollmentId: string;
  studentId: string;
  /** Version de la ligne lue ; `null` : pas encore de note enregistrée. */
  rowVersion: number | null;
  base: GridBase | null;
  /** Contenu de la cellule (source unique : note, code d'état ou vide). */
  text: string;
  comment: string;
  /** Erreur renvoyée par l'API pour cette ligne (effacée à la prochaine modification). */
  apiError: string | null;
}

interface GradeLike {
  id: string;
  enrollmentId: string;
  studentId: string;
  score: string | null;
  entryStatus: EntryStatus;
  comment: string | null;
  rowVersion: number;
}

export function textOf(status: EntryStatus, score: string | null): string {
  if (status === "ENTERED") return score === null ? "" : score.replace(".", ",");
  if (status === "NOT_GRADED") return "";
  return STATUS_CODE[status];
}

export function rowFromGrade(g: GradeLike): GridRow {
  return {
    gradeId: g.id,
    enrollmentId: g.enrollmentId,
    studentId: g.studentId,
    rowVersion: g.rowVersion,
    base: { entryStatus: g.entryStatus, score: normalizeDecimal(g.score), comment: g.comment },
    text: textOf(g.entryStatus, normalizeDecimal(g.score)),
    comment: g.comment ?? "",
    apiError: null,
  };
}

export function rowFromPending(p: { enrollmentId: string; studentId: string }): GridRow {
  return { gradeId: null, enrollmentId: p.enrollmentId, studentId: p.studentId, rowVersion: null, base: null, text: "", comment: "", apiError: null };
}

/** Entrée effective d'une ligne (ce qu'on enverrait), ou `none` si rien à écrire / `invalid` si la saisie est incorrecte. */
export type Effective = { kind: "none" } | { kind: "ok"; status: EntryStatus; score: string | null } | { kind: "invalid"; reason: "format" | "decimals" | "range" };

export function effectiveOf(row: GridRow, ctx: CellContext): Effective {
  const parsed = parseCell(row.text, ctx);
  switch (parsed.kind) {
    case "invalid":
      return parsed;
    case "score":
      return { kind: "ok", status: "ENTERED", score: normalizeDecimal(parsed.value) };
    case "status":
      return { kind: "ok", status: parsed.status, score: null };
    case "empty":
      // Cellule vidée : sans note enregistrée, rien à écrire ; avec une note enregistrée, retour à « non évalué ».
      return row.base ? { kind: "ok", status: "NOT_GRADED", score: null } : { kind: "none" };
  }
}

export function isDirty(row: GridRow, ctx: CellContext): boolean {
  const eff = effectiveOf(row, ctx);
  const commentChanged = (row.comment.trim() || null) !== (row.base?.comment?.trim() || null);
  if (eff.kind === "invalid") return true;
  if (eff.kind === "none") return false;
  if (!row.base) return true;
  return eff.status !== row.base.entryStatus || normalizeDecimal(eff.score) !== normalizeDecimal(row.base.score) || commentChanged;
}

export type RowIssue = "format" | "decimals" | "range";

export function issueOf(row: GridRow, ctx: CellContext): RowIssue | null {
  const eff = effectiveOf(row, ctx);
  return eff.kind === "invalid" ? eff.reason : null;
}

/** Lot à envoyer : lignes modifiées et valides. Les lignes invalides ne partent pas (elles bloquent l'enregistrement). */
export function buildBatch(rows: ReadonlyArray<GridRow>, ctx: CellContext): { entries: GradeEntryInput[]; invalid: string[] } {
  const entries: GradeEntryInput[] = [];
  const invalid: string[] = [];
  for (const row of rows) {
    const eff = effectiveOf(row, ctx);
    if (eff.kind === "invalid") {
      invalid.push(row.enrollmentId);
      continue;
    }
    if (eff.kind === "none" || !isDirty(row, ctx)) continue;
    const comment = row.comment.trim();
    entries.push({
      enrollmentId: row.enrollmentId,
      entryStatus: eff.status,
      ...(eff.status === "ENTERED" && eff.score !== null ? { score: eff.score } : {}),
      ...(comment !== "" ? { comment } : row.base?.comment ? { comment: null } : {}),
      ...(row.rowVersion !== null ? { rowVersion: row.rowVersion } : {}),
    });
  }
  return { entries, invalid };
}

export type SavedGrade = GradeLike;

/**
 * Fusionne le résultat d'un lot : la ligne reçoit sa nouvelle version et sa valeur enregistrée. Si l'utilisateur a
 * continué à taper pendant l'envoi (`sentTexts` diffère du texte courant), son texte est conservé (la ligne reste
 * modifiée), mais la version et la référence sont mises à jour (sinon le lot suivant serait refusé comme périmé).
 */
export function mergeSaved(rows: ReadonlyArray<GridRow>, saved: ReadonlyArray<SavedGrade>, sentTexts: ReadonlyMap<string, string>): GridRow[] {
  const byEnrollment = new Map(saved.map((g) => [g.enrollmentId, g]));
  return rows.map((row) => {
    const g = byEnrollment.get(row.enrollmentId);
    if (!g) return row;
    const unchanged = sentTexts.get(row.enrollmentId) === row.text;
    const next = rowFromGrade(g);
    return unchanged ? next : { ...next, text: row.text, comment: row.comment };
  });
}

// ---------------------------------------------------------------------------
// Hors ligne : brouillons locaux (voir `platform/offline/grade-drafts.ts`)
// ---------------------------------------------------------------------------

/** Lot de la grille -> saisies à garder sur l'appareil (valeurs canoniques, version de ligne lue). */
export function toDraftEntries(entries: ReadonlyArray<GradeEntryInput>): Array<{ enrollmentId: string; entryStatus: EntryStatus; score: string | null; comment: string | null; baseVersion: number | null }> {
  return entries.map((e) => ({
    enrollmentId: e.enrollmentId,
    entryStatus: (e.entryStatus ?? "ENTERED") as EntryStatus,
    score: e.score === undefined || e.score === null ? null : String(e.score),
    comment: e.comment ?? null,
    baseVersion: e.rowVersion ?? null,
  }));
}

/** Restitue dans la grille les saisies hors ligne retrouvées sur l'appareil (leur version de ligne est celle de la feuille lue). */
export function applyRestored(rows: ReadonlyArray<GridRow>, restored: ReadonlyArray<{ enrollmentId: string; entryStatus: EntryStatus; score: string | null; comment: string | null }>): GridRow[] {
  const byEnrollment = new Map(restored.map((r) => [r.enrollmentId, r]));
  return rows.map((row) => {
    const r = byEnrollment.get(row.enrollmentId);
    return r ? { ...row, text: textOf(r.entryStatus, normalizeDecimal(r.score)), comment: r.comment ?? "", apiError: null } : row;
  });
}

/**
 * Notes que le serveur vient d'enregistrer (ou, pour `resetIds`, valeur courante d'une ligne en CONFLIT) :
 *  - ligne en conflit -> remise à la valeur du serveur ; la saisie est en lieu sûr dans le brouillon, jamais renvoyée seule ;
 *  - sinon -> nouvelle version de ligne ; si la personne a retapé entre-temps, son texte est gardé (la ligne reste modifiée).
 */
export function applyApplied(rows: ReadonlyArray<GridRow>, grades: ReadonlyArray<Omit<SavedGrade, "id" | "studentId"> & { id?: string }>, resetIds: ReadonlySet<string>, ctx: CellContext): GridRow[] {
  const byEnrollment = new Map(grades.map((g) => [g.enrollmentId, g]));
  return rows.map((row) => {
    const g = byEnrollment.get(row.enrollmentId);
    if (!g) return row;
    const fresh = rowFromGrade({ ...g, id: g.id ?? row.gradeId ?? row.enrollmentId, studentId: row.studentId });
    if (resetIds.has(row.enrollmentId)) return fresh;
    const kept = { ...fresh, text: row.text, comment: row.comment };
    return isDirty(kept, ctx) ? kept : fresh;
  });
}

// ---------------------------------------------------------------------------
// Collage depuis un tableur
// ---------------------------------------------------------------------------

export interface PasteOutcome {
  rows: GridRow[];
  applied: number;
  /** Lignes collées qui n'ont pu être placées (matricule inconnu, au-delà de la dernière ligne). */
  skipped: number;
  mode: "keyed" | "positional";
}

const norm = (s: string): string => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, "").toUpperCase();

/**
 * Collage de cellules copiées d'un tableur (colonnes séparées par des tabulations, lignes par des retours).
 *  - mode `keyed` : chaque ligne commence par un matricule connu (colonne 1) ; la dernière colonne est la note ;
 *  - mode `positional` : la première colonne de chaque ligne remplit les lignes à partir de la cellule active.
 */
export function applyPaste(rows: ReadonlyArray<GridRow>, startIndex: number, clipboard: string, numberOf: (row: GridRow) => string | null): PasteOutcome {
  const lines = clipboard.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  const table = lines.map((l) => l.split("\t"));
  const next = rows.map((r) => ({ ...r, apiError: null }) as GridRow);
  if (table.length === 0) return { rows: next, applied: 0, skipped: 0, mode: "positional" };

  const index = new Map<string, number>();
  next.forEach((row, i) => {
    const n = numberOf(row);
    if (n) index.set(norm(n), i);
  });
  const keyedHits = table.filter((cells) => cells.length >= 2 && index.has(norm(cells[0]!))).length;
  const keyed = keyedHits > 0 && keyedHits >= Math.ceil(table.length / 2);

  let applied = 0;
  let skipped = 0;
  if (keyed) {
    for (const cells of table) {
      const i = cells.length >= 2 ? index.get(norm(cells[0]!)) : undefined;
      if (i === undefined) {
        skipped += 1;
        continue;
      }
      next[i] = { ...next[i]!, text: cells[cells.length - 1]!.trim() };
      applied += 1;
    }
    return { rows: next, applied, skipped, mode: "keyed" };
  }
  table.forEach((cells, k) => {
    const i = startIndex + k;
    if (i >= next.length) {
      skipped += 1;
      return;
    }
    next[i] = { ...next[i]!, text: cells[0]!.trim() };
    applied += 1;
  });
  return { rows: next, applied, skipped, mode: "positional" };
}

// ---------------------------------------------------------------------------
// Avancement de la saisie (comptages, jamais de statistique de notes)
// ---------------------------------------------------------------------------

export interface Progress {
  total: number;
  entered: number;
  excused: number;
  unexcused: number;
  exempt: number;
  empty: number;
  invalid: number;
  dirty: number;
}

export function progressOf(rows: ReadonlyArray<GridRow>, ctx: CellContext): Progress {
  const p: Progress = { total: rows.length, entered: 0, excused: 0, unexcused: 0, exempt: 0, empty: 0, invalid: 0, dirty: 0 };
  for (const row of rows) {
    const parsed = parseCell(row.text, ctx);
    if (parsed.kind === "invalid") p.invalid += 1;
    else if (parsed.kind === "score") p.entered += 1;
    else if (parsed.kind === "empty" || parsed.status === "NOT_GRADED") p.empty += 1;
    else if (parsed.status === "ABSENT_EXCUSED") p.excused += 1;
    else if (parsed.status === "ABSENT_UNEXCUSED") p.unexcused += 1;
    else p.exempt += 1;
    if (isDirty(row, ctx)) p.dirty += 1;
  }
  return p;
}

/** Index de ligne cible d'une navigation clavier (bornée) : Entrée/Bas = +1, Haut/Maj+Entrée = -1. */
export function nextIndex(current: number, delta: 1 | -1, length: number): number {
  return Math.min(length - 1, Math.max(0, current + delta));
}
