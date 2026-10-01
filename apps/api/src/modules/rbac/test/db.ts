/**
 * Aides d'intégration : base jetable + baseline v2 + migrations du module rbac.
 * Les tests s'ignorent sans `TEST_DATABASE_URL` (cf. vitest.config.mts pour le lancement).
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { TenantDb, SystemDb, migrate } from "@ecoledigitale/database";
import { newId, noopLogger } from "@ecoledigitale/kernel";

const here = fileURLToPath(new URL(".", import.meta.url));
export const BASELINE_DIR = resolve(here, "../../../../../../packages/database/migrations");
export const RBAC_MIGRATIONS_DIR = resolve(here, "../migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

if (!hasDb) {
  console.warn(
    "[rbac] TEST_DATABASE_URL absente : les tests d'intégration sont IGNORÉS. " +
      "Voir src/modules/rbac/README.md (Postgres jetable dans Docker).",
  );
}

export const describeIntegration: typeof describe = describe.skipIf(!hasDb) as unknown as typeof describe;

const suffix = (): string => randomBytes(4).toString("hex");

function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface RbacTestDb {
  name: string;
  /** Connexion administrateur (superuser) sur la base de test. */
  admin: Client;
  /** Pool de l'application : rôle LOGIN membre de `app_user` (soumis à la RLS). */
  appPool: Pool;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  /** Crée un tenant (ligne dans kernel.tenants) et renvoie son id. */
  createTenant(slug?: string): Promise<string>;
  drop(): Promise<void>;
}

export async function createRbacTestDb(): Promise<RbacTestDb> {
  const name = `ed_it_${suffix()}_rbac_test`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await migrate({ client: admin, dirs: [BASELINE_DIR, RBAC_MIGRATIONS_DIR], role: "migrator", logger: noopLogger });

  const role = `it_app_${suffix()}`;
  const password = randomBytes(16).toString("hex");
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' IN ROLE app_user`);
  const appPool = new Pool({ connectionString: urlFor(name, role, password), max: 4 });
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
