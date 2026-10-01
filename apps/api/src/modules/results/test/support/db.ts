/**
 * Aides d'intégration : base jetable + baseline v2 + migrations des modules rules, assess et results (le calcul passe par
 * les VRAIES règles du catalogue national). Les tests s'ignorent proprement sans `TEST_DATABASE_URL`.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { SystemDb, TenantDb, migrate } from "@ecoledigitale/database";
import { createRequestContext, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";

const here = fileURLToPath(new URL(".", import.meta.url));
export const BASELINE_DIR = resolve(here, "../../../../../../../packages/database/migrations");
export const RULES_MIGRATIONS_DIR = resolve(here, "../../../rules/migrations");
export const ASSESS_MIGRATIONS_DIR = resolve(here, "../../../assess/migrations");
export const RESULTS_MIGRATIONS_DIR = resolve(here, "../../migrations");
export const AUDIT_MIGRATIONS_DIR = resolve(here, "../../../audit/migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

if (!hasDb) {
  console.warn(
    "[results] TEST_DATABASE_URL absente : les tests d'intégration sont IGNORÉS. " +
      "Lancez : ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/results/vitest.config.ts",
  );
}

export const describeIntegration: typeof describe = describe.skipIf(!hasDb) as unknown as typeof describe;

const suffix = (): string => randomBytes(4).toString("hex");

export function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface ResultsTestDb {
  name: string;
  admin: Client;
  appPool: Pool;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  createTenant(slug?: string): Promise<string>;
  drop(): Promise<void>;
}

export async function createResultsTestDb(options: { poolSize?: number } = {}): Promise<ResultsTestDb> {
  const name = `ed_it_${suffix()}_results_test`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await migrate({ client: admin, dirs: [BASELINE_DIR, RULES_MIGRATIONS_DIR, ASSESS_MIGRATIONS_DIR, RESULTS_MIGRATIONS_DIR], role: "migrator", logger: noopLogger });

  const role = `it_app_${suffix()}`;
  const password = randomBytes(16).toString("hex");
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' IN ROLE app_user`);
  const appPool = new Pool({ connectionString: urlFor(name, role, password), max: options.poolSize ?? 12 });
  appPool.on("error", () => undefined);
  admin.on("error", () => undefined);
  const tenantDb = new TenantDb(appPool);
  const systemDb = new SystemDb(tenantDb, { logger: noopLogger });

  return {
    name,
    admin,
    appPool,
    tenantDb,
    systemDb,
    async createTenant(slug) {
      const id = newId();
      const s = slug ?? `t-${id.slice(-10)}`;
      await admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [id, s, `Tenant ${s}`]);
      return id;
    },
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

export function ctxFor(tenantId: string, userId: string = newId(), roles: string[] = ["results"], mfa = true): RequestContext {
  return createRequestContext({ tenantId, userId, roles, mfa });
}

export async function adminRows<R = Record<string, any>>(db: ResultsTestDb, sql: string, params: unknown[] = []): Promise<R[]> {
  const res = await db.admin.query(sql, params);
  return res.rows as R[];
}

export async function adminOne<R = Record<string, any>>(db: ResultsTestDb, sql: string, params: unknown[] = []): Promise<R> {
  const rows = await adminRows<R>(db, sql, params);
  if (rows.length === 0) throw new Error(`Aucune ligne pour : ${sql}`);
  return rows[0] as R;
}
