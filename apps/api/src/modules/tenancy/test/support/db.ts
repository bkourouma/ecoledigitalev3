/**
 * Aides de tests d'intégration : base jetable, migrations (baseline + modules),
 * rôle applicatif NON propriétaire. S'ignore proprement sans TEST_DATABASE_URL.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { noopLogger } from "@ecoledigitale/kernel";
import { TenantDb, migrate } from "@ecoledigitale/database";

// `__dirname` est fourni par vite-node (et par CommonJS) : compatible avec le tsconfig de l'API.
const repo = resolve(__dirname, "../../../../../../../");

export const BASELINE_DIR = resolve(repo, "packages/database/migrations");
export const TENANCY_MIGRATIONS = resolve(repo, "apps/api/src/modules/tenancy/migrations");
export const ENTITLEMENTS_MIGRATIONS = resolve(repo, "apps/api/src/modules/entitlements/migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

if (!hasDb) {
  console.warn(
    "[tenancy] TEST_DATABASE_URL absente : les tests d'intégration sont IGNORÉS. " +
      "Lancez : node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/tenancy/vitest.config.ts",
  );
}

export const describeIntegration: typeof describe = describe.skipIf(!hasDb) as unknown as typeof describe;

const rand = (n = 4): string => randomBytes(n).toString("hex");

function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface TestDb {
  name: string;
  admin: Client;
  /** Pool connecté avec un rôle membre de `app_user` (ni propriétaire, ni superuser, ni BYPASSRLS). */
  appPool: Pool;
  tenantDb: TenantDb;
  drop(): Promise<void>;
}

/** Crée une base `ed_it_<aléa>_test`, applique baseline + `dirs`, ouvre un pool applicatif. */
export async function createTestDb(dirs: readonly string[]): Promise<TestDb> {
  const name = `ed_it_${rand()}_test`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await migrate({ client: admin, dirs: [BASELINE_DIR, ...dirs], role: "migrator", logger: noopLogger });

  const role = `it_app_${rand()}`;
  const password = rand(16);
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' IN ROLE app_user`);
  const appPool = new Pool({ connectionString: urlFor(name, role, password), max: 6 });

  return {
    name,
    admin,
    appPool,
    tenantDb: new TenantDb(appPool),
    async drop() {
      await appPool.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      try {
        await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await maintenance.query(`DROP ROLE IF EXISTS "${role}"`);
      } finally {
        await maintenance.end().catch(() => undefined);
      }
    },
  };
}
