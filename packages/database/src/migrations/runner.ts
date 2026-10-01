/**
 * Runner de migrations SQL, `up` seulement.
 *
 * Garanties :
 *  - une migration appliquée est IMMUABLE : son checksum (SHA-256 du contenu
 *    normalisé) est comparé à chaque exécution, tout écart fait échouer le run
 *    AVANT d'appliquer quoi que ce soit ;
 *  - une seule exécution à la fois : verrou advisory de session ; un second
 *    runner attend (jusqu'à `lockTimeoutMs`) puis échoue proprement ;
 *  - une transaction par fichier (sauf `-- no-transaction`) : l'enregistrement
 *    dans `schema_migrations` est dans la MÊME transaction que le DDL ;
 *  - garde-fou : une base dont le nom ne finit pas par `_test|_dev|_local`
 *    n'est migrée qu'avec `yes: true` ;
 *  - pas de « down » : on corrige par une nouvelle migration.
 */
import { consoleLogger, type Logger } from "@ecoledigitale/kernel";
import {
  MigrationError,
  MigrationChecksumError,
  MigrationExecutionError,
  MigrationLockTimeoutError,
  MigrationMissingError,
  MigrationOrderError,
  UnsafeDatabaseError,
} from "./errors";
import { loadMigrations, type MigrationFile } from "./loader";
import { lineAt, splitStatements } from "./sql";

/** Connexion DÉDIÉE (pas un pool : le verrou advisory et SET ROLE sont liés à la session). */
export interface MigrationClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface MigrateOptions {
  client: MigrationClient;
  dirs: readonly string[];
  /** Table de suivi ; défaut `schema_migrations` (résolue via le search_path). */
  table?: string;
  /**
   * Rôle sous lequel exécuter les fichiers (`SET ROLE`), p. ex. `migrator` : les
   * objets créés lui appartiennent. S'il n'existe pas encore (fichier de
   * bootstrap qui le crée), le fichier s'exécute sous le rôle de connexion.
   */
  role?: string;
  /** Confirmation explicite pour une base dont le nom ne finit pas par _test/_dev/_local. */
  yes?: boolean;
  /** N'écrit rien : liste ce qui serait appliqué. */
  dryRun?: boolean;
  allowOutOfOrder?: boolean;
  lockTimeoutMs?: number;
  logger?: Logger;
}

export interface MigrateResult {
  database: string;
  applied: string[];
  alreadyApplied: string[];
  /** Dry-run : migrations qui seraient appliquées. */
  pending: string[];
}

const SAFE_DB_NAME = /_(test|dev|local)$/;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const TABLE_IDENT = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;
const LOCK_KEY = "ecoledigitale:schema_migrations";

const quoteIdent = (id: string): string => id.split(".").map((p) => `"${p}"`).join(".");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function isSafeDatabaseName(name: string): boolean {
  return SAFE_DB_NAME.test(name);
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const { client, dryRun = false } = options;
  const logger = options.logger ?? consoleLogger;
  const table = options.table ?? "schema_migrations";
  const lockTimeoutMs = options.lockTimeoutMs ?? 60_000;

  if (!TABLE_IDENT.test(table)) {
    throw new MigrationError("MIGRATION_OPTIONS_INVALID", `Nom de table de suivi invalide : "${table}".`);
  }
  if (options.role !== undefined && !IDENT.test(options.role)) {
    throw new MigrationError("MIGRATION_OPTIONS_INVALID", `Nom de rôle invalide : "${options.role}".`);
  }

  // Les fichiers sont lus et validés AVANT toute action sur la base.
  const files = loadMigrations(options.dirs);

  const database = (await client.query("SELECT current_database() AS db")).rows[0]?.db as string;
  if (!dryRun && !options.yes && !isSafeDatabaseName(database)) {
    throw new UnsafeDatabaseError(database);
  }

  const T = quoteIdent(table);
  let locked = false;

  try {
    if (!dryRun) {
      await acquireLock(client, lockTimeoutMs);
      locked = true;
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${T} (
           version    text PRIMARY KEY,
           name       text NOT NULL,
           checksum   text NOT NULL,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
    }

    const tableExists =
      (await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [T])).rows[0]?.ok === true;
    const appliedRows: Array<{ version: string; name: string; checksum: string }> = tableExists
      ? (await client.query(`SELECT version, name, checksum FROM ${T} ORDER BY version`)).rows
      : [];
    const applied = new Map(appliedRows.map((r) => [r.version, r]));
    const byVersion = new Map(files.map((f) => [f.version, f]));

    // 1. Une migration enregistrée dont le fichier a disparu.
    const missing = appliedRows.filter((r) => !byVersion.has(r.version)).map((r) => `${r.version}_${r.name}`);
    if (missing.length > 0) throw new MigrationMissingError(missing);

    // 2. Une migration enregistrée dont le contenu a changé.
    const mismatches = appliedRows.flatMap((r) => {
      const file = byVersion.get(r.version) as MigrationFile;
      return file.checksum === r.checksum
        ? []
        : [{ version: r.version, name: r.name, applied: r.checksum, current: file.checksum }];
    });
    if (mismatches.length > 0) throw new MigrationChecksumError(mismatches);

    // 3. Ordre : rien de nouveau ne doit s'insérer avant l'historique.
    const pendingFiles = files.filter((f) => !applied.has(f.version));
    const maxApplied = appliedRows.reduce((m, r) => (Number(r.version) > Number(m) ? r.version : m), "0");
    const late = pendingFiles.filter((f) => Number(f.version) < Number(maxApplied));
    if (late.length > 0 && !options.allowOutOfOrder) {
      throw new MigrationOrderError(late.map((f) => `${f.version}_${f.name}`), maxApplied);
    }

    const result: MigrateResult = {
      database,
      applied: [],
      alreadyApplied: files.filter((f) => applied.has(f.version)).map((f) => f.filename),
      pending: [],
    };

    if (dryRun) {
      result.pending = pendingFiles.map((f) => f.filename);
      return result;
    }

    for (const file of pendingFiles) {
      const started = Date.now();
      await applyFile(client, file, T, options.role, logger);
      result.applied.push(file.filename);
      logger.info({ event: "migration", file: file.filename, durationMs: Date.now() - started }, "Migration appliquée");
    }
    return result;
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]);
      } catch {
        /* la déconnexion libère le verrou de toute façon */
      }
    }
  }
}

async function acquireLock(client: MigrationClient, timeoutMs: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    const row = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS got", [LOCK_KEY])).rows[0];
    if (row?.got === true) return;
    if (Date.now() - started >= timeoutMs) throw new MigrationLockTimeoutError(Date.now() - started);
    await sleep(100);
  }
}

async function roleExists(client: MigrationClient, role: string): Promise<boolean> {
  return (await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rows.length > 0;
}

const TX_CONTROL = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK", "ABORT", "START"]);

async function applyFile(
  client: MigrationClient,
  file: MigrationFile,
  quotedTable: string,
  role: string | undefined,
  logger: Logger,
): Promise<void> {
  const useRole = role !== undefined && file.usesRole && (await roleExists(client, role));
  if (role !== undefined && file.usesRole && !useRole) {
    logger.warn(
      { event: "migration", file: file.filename, role },
      "Rôle absent : fichier exécuté sous le rôle de connexion (bootstrap)",
    );
  }
  const record = (): Promise<unknown> =>
    client.query(`INSERT INTO ${quotedTable} (version, name, checksum) VALUES ($1, $2, $3)`, [
      file.version,
      file.name,
      file.checksum,
    ]);

  if (file.transactional) {
    // Un BEGIN/COMMIT explicite casserait l'atomicité fichier + enregistrement.
    const offending = splitStatements(file.sql).find((s) => TX_CONTROL.has(s.keyword));
    if (offending) {
      throw new MigrationExecutionError(
        file.version,
        file.filename,
        undefined,
        new Error(
          `contrôle de transaction explicite (${offending.keyword}) interdit : le runner gère la transaction. ` +
            "Retirez-le, ou ajoutez « -- no-transaction » en tête de fichier.",
        ),
        true,
      );
    }
    try {
      await client.query("BEGIN");
      if (useRole) await client.query(`SET LOCAL ROLE ${quoteIdent(role as string)}`);
      await client.query(file.sql);
      if (useRole) await client.query("RESET ROLE");
      await record();
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connexion perdue : l'erreur d'origine prime */
      }
      throw wrapError(file, error, true);
    }
    return;
  }

  // Fichier hors transaction (CREATE INDEX CONCURRENTLY, VACUUM, ALTER TYPE … ADD VALUE…) :
  // une instruction à la fois, en autocommit.
  try {
    if (useRole) await client.query(`SET ROLE ${quoteIdent(role as string)}`);
    for (const statement of splitStatements(file.sql)) {
      await client.query(statement.sql);
    }
  } catch (error) {
    throw wrapError(file, error, false);
  } finally {
    if (useRole) {
      try {
        await client.query("RESET ROLE");
      } catch {
        /* ignoré */
      }
    }
  }
  try {
    await record();
  } catch (error) {
    throw wrapError(file, error, false);
  }
}

function wrapError(file: MigrationFile, error: unknown, transactional: boolean): MigrationExecutionError {
  if (error instanceof MigrationExecutionError) return error;
  const position = Number((error as { position?: unknown } | null)?.position);
  return new MigrationExecutionError(
    file.version,
    file.filename,
    Number.isFinite(position) && position > 0 ? lineAt(file.sql, position) : undefined,
    error,
    transactional,
  );
}
