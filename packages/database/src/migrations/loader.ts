import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { MigrationFileError } from "./errors";
import { checksumOf, headerDirectives, normalizeSql } from "./sql";

export interface MigrationFile {
  /** Préfixe numérique, ex. `0001`. */
  version: string;
  /** Nom sans préfixe ni extension, ex. `roles`. */
  name: string;
  filename: string;
  path: string;
  /** Contenu normalisé (sans BOM, fins de ligne LF). */
  sql: string;
  checksum: string;
  /** `false` si l'en-tête contient `-- no-transaction`. */
  transactional: boolean;
  /** `false` si l'en-tête contient `-- no-role` : exécuté sous le rôle de connexion (bootstrap). */
  usesRole: boolean;
}

export const MIGRATION_FILENAME = /^(\d{4,})_([a-z0-9][a-z0-9_]*)\.sql$/;

/**
 * Charge et ordonne les migrations de un ou plusieurs dossiers.
 * Strict : tout `.sql` mal nommé et tout doublon de version sont des erreurs
 * (un fichier ignoré en silence est une migration qu'on croit appliquée).
 */
export function loadMigrations(dirs: readonly string[]): MigrationFile[] {
  if (dirs.length === 0) throw new MigrationFileError("Au moins un dossier de migrations est requis.");

  const byVersion = new Map<string, MigrationFile>();

  for (const dir of dirs) {
    const abs = resolve(dir);
    let entries: string[];
    try {
      if (!statSync(abs).isDirectory()) throw new Error("pas un dossier");
      entries = readdirSync(abs);
    } catch (e) {
      throw new MigrationFileError(`Dossier de migrations illisible : ${abs} (${e instanceof Error ? e.message : String(e)}).`);
    }

    for (const filename of entries.sort()) {
      if (!filename.toLowerCase().endsWith(".sql")) continue;
      const m = MIGRATION_FILENAME.exec(filename);
      if (!m) {
        throw new MigrationFileError(
          `Nom de migration invalide : ${filename} (attendu NNNN_nom_en_minuscules.sql, NNNN ≥ 4 chiffres).`,
        );
      }
      const path = join(abs, filename);
      const raw = readFileSync(path, "utf8");
      const sql = normalizeSql(raw);
      if (sql.trim() === "") throw new MigrationFileError(`Migration vide : ${filename}.`);

      const version = m[1] as string;
      const existing = byVersion.get(version);
      if (existing) {
        throw new MigrationFileError(
          `Version ${version} en double : ${existing.path} et ${path}. Les numéros sont globaux à tous les dossiers.`,
        );
      }
      const directives = headerDirectives(raw);
      byVersion.set(version, {
        version,
        name: m[2] as string,
        filename,
        path,
        sql,
        checksum: checksumOf(raw),
        transactional: !directives.has("no-transaction"),
        usesRole: !directives.has("no-role"),
      });
    }
  }

  // Tri numérique : « 0099 » < « 0100 » < « 10000 ».
  return [...byVersion.values()].sort((a, b) => Number(a.version) - Number(b.version));
}
