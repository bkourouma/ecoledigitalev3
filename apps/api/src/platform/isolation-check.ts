/**
 * Test d'isolation GLOBAL (plan §3.4, ADR-002) : base éphémère -> baseline + migrations de
 * tous les modules -> `checkTenantIsolation` sur `kernel` et sur chaque schéma de module,
 * avec la liste blanche centralisée (`modules/isolation-allowlist*.ts`).
 *
 * Sans module (état initial), le test porte sur `kernel` seul et passe trivialement.
 *
 * Contrôles ajoutés par-dessus `assertTenantIsolation` :
 *  - aucun schéma hors `kernel` + schémas de modules (un module = un schéma du même nom) ;
 *  - aucune table applicative dans `public` (hors tables de suivi des migrations) ;
 *  - aucune entrée de liste blanche périmée (qui ne correspond à aucune table).
 *
 * L'instance visée par `adminUrl` doit être JETABLE (création/suppression de base et de rôle).
 */
import { randomBytes } from "node:crypto";
import { Client, Pool } from "pg";
import { checkTenantIsolation, type TenantIsolationReport, type Violation } from "@ecoledigitale/database";
import { noopLogger, type Logger } from "@ecoledigitale/kernel";
import { discoverModules, type FileImporter } from "../modules/registry-discovery";
import { loadIsolationAllowlist, type LoadedAllowlist } from "./isolation-allowlist-loader";
import { createLoginRole } from "./v2-login-role";
import { runV2Migrations } from "./v2-migrations";

export interface GlobalIsolationOptions {
  /** Connexion d'un rôle pouvant CREATE DATABASE / CREATE ROLE sur une instance jetable (TEST_DATABASE_URL). */
  adminUrl: string;
  modulesDir?: string;
  importer?: FileImporter;
  logger?: Logger;
}

export interface GlobalIsolationResult {
  database: string;
  modules: string[];
  schemas: string[];
  allowlist: LoadedAllowlist;
  report: TenantIsolationReport;
  /** Violations de toute nature (vide = succès). */
  violations: Violation[];
}

export class GlobalIsolationError extends Error {
  readonly result: GlobalIsolationResult;
  constructor(result: GlobalIsolationResult) {
    super(
      `Isolation multi-tenant violée (${result.violations.length}) :\n` +
        result.violations.map((v) => `  - ${v.table} : ${v.problem}`).join("\n"),
    );
    this.name = "GlobalIsolationError";
    this.result = result;
  }
}

function urlForDatabase(adminUrl: string, database: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Exécute le contrôle et RENVOIE le résultat (jamais de levée sur violation : voir `assertGlobalIsolation`). */
export async function runGlobalIsolationCheck(options: GlobalIsolationOptions): Promise<GlobalIsolationResult> {
  const logger = options.logger ?? noopLogger;
  const discoverOptions = {
    ...(options.modulesDir ? { modulesDir: options.modulesDir } : {}),
    ...(options.importer ? { importer: options.importer } : {}),
  };

  const modules = await discoverModules(discoverOptions);
  const keys = modules.map((m) => m.key);
  const allowlist = await loadIsolationAllowlist({
    ...(options.modulesDir ? { modulesDir: options.modulesDir } : {}),
    ...(options.importer ? { importer: options.importer } : {}),
    knownModules: keys,
  });

  const suffix = randomBytes(4).toString("hex");
  const database = `ed_iso_${suffix}_test`;
  const loginRole = `ed_iso_${suffix}`;

  const maintenance = new Client({ connectionString: options.adminUrl });
  await maintenance.connect();
  let pool: Pool | undefined;
  try {
    await maintenance.query(`CREATE DATABASE "${database}"`);
    const dbAdminUrl = urlForDatabase(options.adminUrl, database);

    await runV2Migrations({ url: dbAdminUrl, logger, ...discoverOptions });

    const login = await createLoginRole({ adminUrl: dbAdminUrl, role: loginRole });
    pool = new Pool({ connectionString: login.applicationUrl, max: 4 });

    const schemas = ["kernel", ...keys];
    const report = await checkTenantIsolation({
      pool,
      schemas,
      allowlist: allowlist.tables,
      fixtures: allowlist.fixtures,
    });
    const violations: Violation[] = [...report.violations];

    for (const stale of report.staleAllowlist) {
      violations.push({ table: stale, problem: "entrée de liste blanche sans table correspondante (liste périmée : supprimez-la)" });
    }

    const admin = new Client({ connectionString: dbAdminUrl });
    await admin.connect();
    try {
      // Un module peut posséder un schéma d'archive `<clé>_archive` (partitions détachées, ex. audit_archive).
      // Il contient des données de tous les tenants sans RLS : `app_user` ne doit y avoir AUCUN droit d'usage.
      const archiveSchemas = schemas.map((s) => `${s}_archive`);
      const allowedSchemas = new Set(["public", "information_schema", ...schemas, ...archiveSchemas]);
      for (const archive of archiveSchemas) {
        const { rows } = await admin.query(
          `SELECT n.nspname FROM pg_namespace n
            WHERE n.nspname = $1 AND has_schema_privilege('app_user', n.oid, 'USAGE')`,
          [archive],
        );
        for (const row of rows as Array<{ nspname: string }>) {
          violations.push({
            table: `${row.nspname}.*`,
            problem: `le schéma d'archive "${row.nspname}" est accessible à app_user (sans RLS, il contient des données de tous les tenants)`,
          });
        }
      }
      const extraSchemas = (
        await admin.query(
          `SELECT nspname FROM pg_namespace
            WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> ALL($1::text[]) ORDER BY nspname`,
          [[...allowedSchemas]],
        )
      ).rows as Array<{ nspname: string }>;
      for (const row of extraSchemas) {
        violations.push({
          table: `${row.nspname}.*`,
          problem: `schéma "${row.nspname}" ne correspond à aucun module : un module possède UN schéma du même nom que sa clé`,
        });
      }

      const publicTables = (
        await admin.query(
          `SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND tablename NOT LIKE 'schema\\_migrations%' ORDER BY tablename`,
        )
      ).rows as Array<{ tablename: string }>;
      for (const row of publicTables) {
        violations.push({
          table: `public.${row.tablename}`,
          problem: "table créée dans le schéma public : toute table appartient au schéma de son module",
        });
      }
    } finally {
      await admin.end().catch(() => undefined);
    }

    return { database, modules: keys, schemas, allowlist, report, violations };
  } finally {
    if (pool) await pool.end().catch(() => undefined);
    await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => undefined);
    await maintenance.query(`DROP ROLE IF EXISTS "${loginRole}"`).catch(() => undefined);
    await maintenance.end().catch(() => undefined);
  }
}

/** Comme `runGlobalIsolationCheck`, mais lève `GlobalIsolationError` s'il y a au moins une violation. */
export async function assertGlobalIsolation(options: GlobalIsolationOptions): Promise<GlobalIsolationResult> {
  const result = await runGlobalIsolationCheck(options);
  if (result.violations.length > 0) throw new GlobalIsolationError(result);
  return result;
}
