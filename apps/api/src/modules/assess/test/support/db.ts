/**
 * Aides d'intégration : base jetable + baseline v2 + migrations du module assess. Les tests s'ignorent proprement sans
 * `TEST_DATABASE_URL` (voir vitest.config.ts pour le lancement sur un Postgres éphémère).
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
export const ASSESS_MIGRATIONS_DIR = resolve(here, "../../migrations");
/** Migrations du module audit (journal chaîné) : pour prouver que l'audit réel accepte les entrées du module. */
export const AUDIT_MIGRATIONS_DIR = resolve(here, "../../../audit/migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

if (!hasDb) {
  console.warn(
    "[assess] TEST_DATABASE_URL absente : les tests d'intégration sont IGNORÉS. " +
      "Lancez : ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/assess/vitest.config.ts",
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

export interface AssessTestDb {
  name: string;
  /** Connexion administrateur (SUPERUSER) : lectures de vérification et tentatives d'écriture hors application. */
  admin: Client;
  /** Pool applicatif : rôle LOGIN membre de `app_user` (soumis à la RLS et aux droits). */
  appPool: Pool;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  createTenant(slug?: string): Promise<string>;
  drop(): Promise<void>;
}

export async function createAssessTestDb(options: { poolSize?: number; withAudit?: boolean; extraDirs?: string[] } = {}): Promise<AssessTestDb> {
  const name = `ed_it_${suffix()}_assess_test`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await migrate({
    client: admin,
    dirs: [BASELINE_DIR, ...(options.withAudit ? [AUDIT_MIGRATIONS_DIR] : []), ASSESS_MIGRATIONS_DIR, ...(options.extraDirs ?? [])],
    role: "migrator",
    logger: noopLogger,
  });

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

export function ctxFor(tenantId: string, userId: string = newId(), roles: string[] = ["assess"], mfa = false): RequestContext {
  return createRequestContext({ tenantId, userId, roles, mfa });
}

export async function adminRows<R = Record<string, any>>(db: AssessTestDb, sql: string, params: unknown[] = []): Promise<R[]> {
  const res = await db.admin.query(sql, params);
  return res.rows as R[];
}

export async function adminOne<R = Record<string, any>>(db: AssessTestDb, sql: string, params: unknown[] = []): Promise<R> {
  const rows = await adminRows<R>(db, sql, params);
  if (rows.length === 0) throw new Error(`Aucune ligne pour : ${sql}`);
  return rows[0] as R;
}
