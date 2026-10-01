/**
 * Migrations v2 : baseline `packages/database/migrations`, puis `modules/<key>/migrations`
 * dans l'ORDRE TOPOLOGIQUE des manifestes, via le runner de `@ecoledigitale/database`.
 *
 * Les numéros de version du runner sont globaux à un appel. Chaque module numérote donc ses
 * migrations depuis 0001 (conventions) : on appelle le runner UNE FOIS PAR DOSSIER, avec une
 * table de suivi distincte (`schema_migrations` pour la baseline, `schema_migrations_<key>`
 * pour un module, dans `public`, propriété du rôle de connexion et illisible pour app_user).
 * Les garanties du runner s'appliquent à chaque dossier : checksum, verrou advisory,
 * transaction par fichier, garde-fou sur le nom de la base (`_test|_dev|_local` ou `--yes`).
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { migrate, MigrationError, type MigrateResult } from "@ecoledigitale/database";
import { consoleLogger, type Logger } from "@ecoledigitale/kernel";
import { discoverModules, type DiscoveredModule, type FileImporter } from "../modules/registry-discovery";

/** Ré-exporté pour les scripts racine, qui ne résolvent pas les paquets du workspace. */
export { MigrationError };

/** Racine du dépôt (apps/api/src/platform -> ../../../..). */
export const REPO_ROOT = resolve(__dirname, "../../../..");
export const BASELINE_MIGRATIONS_DIR = join(REPO_ROOT, "packages", "database", "migrations");

/**
 * Migrations du worker (`apps/worker/migrations`, plage 0600-0699) : `kernel.processed_events` (idempotence des
 * abonnés), trigger NOTIFY de l'outbox, index de purge. Le worker REFUSE de démarrer sans elles
 * (`assertRequiredTables`) ; elles n'étaient appliquées par aucune commande de la plateforme (seul le raccourci
 * `pnpm --filter @ecoledigitale/worker migrate` les jouait) : défaut d'assemblage corrigé ici.
 */
export const WORKER_MIGRATIONS_DIR = join(REPO_ROOT, "apps", "worker", "migrations");

export interface MigrationStep {
  /** `baseline`, `worker` ou la clé du module. */
  id: string;
  kind: "baseline" | "worker" | "module";
  dir: string;
  /** Table de suivi du runner. */
  table: string;
}

export function trackingTableFor(moduleKey: string): string {
  return `schema_migrations_${moduleKey}`;
}

function hasSqlFiles(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).some((f) => f.toLowerCase().endsWith(".sql"));
}

/**
 * Plan d'exécution : baseline, migrations du worker (si le dossier existe et contient du SQL), puis modules
 * (ordre topologique), modules sans migration omis. `workerDir: null` désactive l'étape (tests de l'outillage
 * sur des modules factices).
 */
export function planMigrationSteps(
  modules: readonly Pick<DiscoveredModule, "key" | "migrationsDir">[],
  baselineDir: string = BASELINE_MIGRATIONS_DIR,
  workerDir: string | null = WORKER_MIGRATIONS_DIR,
): MigrationStep[] {
  const steps: MigrationStep[] = [{ id: "baseline", kind: "baseline", dir: baselineDir, table: "schema_migrations" }];
  if (workerDir && hasSqlFiles(workerDir)) {
    steps.push({ id: "worker", kind: "worker", dir: workerDir, table: "schema_migrations_worker" });
  }
  for (const mod of modules) {
    if (mod.migrationsDir && hasSqlFiles(mod.migrationsDir)) {
      steps.push({ id: mod.key, kind: "module", dir: mod.migrationsDir, table: trackingTableFor(mod.key) });
    }
  }
  return steps;
}

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<url illisible>";
  }
}

export interface RunV2MigrationsOptions {
  /** Connexion du rôle `migrator`/propriétaire (V2_MIGRATOR_URL), JAMAIS celle de l'application. */
  url: string;
  yes?: boolean;
  dryRun?: boolean;
  allowOutOfOrder?: boolean;
  lockTimeoutMs?: number;
  modulesDir?: string;
  baselineDir?: string;
  /** Dossier des migrations du worker ; `null` pour l'omettre (défaut : `apps/worker/migrations`). */
  workerDir?: string | null;
  importer?: FileImporter;
  logger?: Logger;
  /** Rôle d'exécution des fichiers (défaut `migrator`). */
  role?: string;
}

export interface V2MigrationStepResult {
  step: MigrationStep;
  result: MigrateResult;
}

export interface V2MigrationsReport {
  database: string;
  steps: V2MigrationStepResult[];
}

/** Valide les manifestes, établit le plan puis applique chaque dossier dans l'ordre. */
export async function runV2Migrations(options: RunV2MigrationsOptions): Promise<V2MigrationsReport> {
  const logger = options.logger ?? consoleLogger;

  // Les manifestes sont validés AVANT toute connexion : cycle ou doublon ⇒ rien n'est appliqué.
  const modules = await discoverModules({
    ...(options.modulesDir ? { modulesDir: options.modulesDir } : {}),
    ...(options.importer ? { importer: options.importer } : {}),
  });
  const steps = planMigrationSteps(modules, options.baselineDir, options.workerDir);

  const client = new Client({ connectionString: options.url, application_name: "ecoledigitale-v2-migrate" });
  await client.connect();
  try {
    const results: V2MigrationStepResult[] = [];
    let database = "";
    for (const step of steps) {
      const result = await migrate({
        client,
        dirs: [step.dir],
        table: step.table,
        role: options.role ?? "migrator",
        yes: options.yes === true,
        dryRun: options.dryRun === true,
        allowOutOfOrder: options.allowOutOfOrder === true,
        ...(options.lockTimeoutMs !== undefined ? { lockTimeoutMs: options.lockTimeoutMs } : {}),
        logger,
      });
      database = result.database;
      results.push({ step, result });
    }
    return { database, steps: results };
  } finally {
    await client.end().catch(() => undefined);
  }
}
