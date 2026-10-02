/**
 * Aides d'intégration : base jetable, migrations (baseline + module), rôle applicatif NON propriétaire.
 * Les tests qui l'utilisent s'ignorent sans TEST_DATABASE_URL. Postgres éphémère dans Docker :
 *
 *   ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --root apps/api src/modules/zz_gate_13b6ce/test
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { noopLogger } from "@ecoledigitale/kernel";
import { TenantDb, migrate } from "@ecoledigitale/database";

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("Racine du dépôt introuvable (pnpm-workspace.yaml).");
}

export const BASELINE_DIR = resolve(repoRoot(), "packages/database/migrations");
export const MODULE_MIGRATIONS = resolve(__dirname, "../../migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const describeIntegration: typeof describe = describe.skipIf(!TEST_DATABASE_URL) as unknown as typeof describe;

const rand = (n = 4): string => randomBytes(n).toString("hex");

function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = "/" + database;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface ModuleTestDb {
  /** Connexion propriétaire/administrateur (préparer ou lire les données hors RLS). */
  admin: Client;
  /** Pool d'un rôle membre de app_user (ni propriétaire, ni superuser, ni BYPASSRLS) : la RLS s'applique. */
  appPool: Pool;
  tenantDb: TenantDb;
  createTenant(slug: string): Promise<string>;
  drop(): Promise<void>;
}

export async function createModuleTestDb(): Promise<ModuleTestDb> {
  const name = "ed_it_" + rand() + "_test";
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query('CREATE DATABASE "' + name + '"');

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await migrate({ client: admin, dirs: [BASELINE_DIR, MODULE_MIGRATIONS], role: "migrator", logger: noopLogger });

  const role = "it_app_" + rand();
  const password = rand(16);
  await admin.query('CREATE ROLE "' + role + '" LOGIN PASSWORD \'' + password + "' IN ROLE app_user");
  const appPool = new Pool({ connectionString: urlFor(name, role, password), max: 4 });

  return {
    admin,
    appPool,
    tenantDb: new TenantDb(appPool),
    async createTenant(slug) {
      const id = (await admin.query("SELECT gen_random_uuid() AS id")).rows[0].id as string;
      await admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, slug, slug]);
      return id;
    },
    async drop() {
      await appPool.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      try {
        await maintenance.query('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
        await maintenance.query('DROP ROLE IF EXISTS "' + role + '"');
      } finally {
        await maintenance.end().catch(() => undefined);
      }
    },
  };
}
