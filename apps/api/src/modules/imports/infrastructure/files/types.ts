/**
 * Types communs des lecteurs de fichiers (CSV, XLSX) : limites, ligne lue, lecteur de table.
 */
import type { ImportFileKind, ImportWarning } from "@ecoledigitale/contracts/src/v2/imports";

export const MIB = 1024 * 1024;

export interface FileLimits {
  /** Taille maximale du fichier (octets). */
  readonly maxBytes: number;
  /** Lignes de données (hors en-têtes). */
  readonly maxRows: number;
  readonly maxColumns: number;
  /** Au-delà, la cellule est tronquée à `maxCellChars + 1` (la ligne sera refusée par la validation). */
  readonly maxCellChars: number;
  /** XLSX : entrées de l'archive. */
  readonly maxZipEntries: number;
  /** XLSX : somme des tailles décompressées (déclarée ET comptée). */
  readonly maxZipUncompressedBytes: number;
  /** XLSX : rapport taille décompressée / compressée maximal d'une entrée volumineuse. */
  readonly maxZipRatio: number;
}

export const DEFAULT_FILE_LIMITS: FileLimits = {
  maxBytes: 5 * MIB,
  maxRows: 5000,
  maxColumns: 100,
  maxCellChars: 2000,
  maxZipEntries: 500,
  maxZipUncompressedBytes: 50 * MIB,
  maxZipRatio: 100,
};

export interface RawRow {
  /** Numéro de ligne dans le fichier (1 = première ligne ; celui qu'affiche le tableur). */
  readonly rowNo: number;
  /** Cellules en texte, alignées sur les en-têtes (longueur = nombre d'en-têtes). */
  readonly cells: string[];
}

export interface TableReader {
  readonly kind: ImportFileKind;
  readonly sheetName: string | null;
  readonly sheetNames: readonly string[];
  readonly headers: string[];
  /** Numéro de la ligne d'en-têtes dans le fichier. */
  readonly headerRowNo: number;
  /** Lignes de données non vides ; lève `FileRejectedError` au dépassement des plafonds. Un seul parcours. */
  rows(): AsyncGenerator<RawRow, void, void>;
  /** Avertissements accumulés (complets une fois `rows()` épuisé). */
  readonly warnings: ImportWarning[];
}

export interface OpenTableOptions {
  readonly limits: FileLimits;
  readonly sheet?: string | undefined;
}

/** Normalise les en-têtes lus : vides -> « Colonne X », doublons -> « Nom (2) ». */
export function finalizeHeaders(raw: readonly string[], warnings: ImportWarning[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  let renamed = 0;
  raw.forEach((value, i) => {
    let name = value.trim();
    if (name === "") name = `Colonne ${columnLetter(i)}`;
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) {
      name = `${name} (${n})`;
      renamed += 1;
    }
    out.push(name);
  });
  if (renamed > 0) warnings.push({ code: "imports.duplicate_header", message: `${renamed} en-tête(s) en double ont été renommés (« Nom (2) »).`, count: renamed });
  return out;
}

export function columnLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Index de colonne (0-based) d'une référence de cellule `B12` -> 1 ; `-1` si invalide. */
export function columnIndexOf(ref: string): number {
  const m = /^([A-Z]{1,3})\d*$/.exec(ref.toUpperCase());
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1] as string) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
