/**
 * Aides d'intégration : base jetable + baseline v2 + migrations du worker + migrations du module people. Les tests
 * s'ignorent proprement sans `TEST_DATABASE_URL` (voir vitest.config.ts pour le lancement sur un Postgres éphémère).
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { SystemDb, TenantDb, migrate } from "@ecoledigitale/database";
import { ManualClock, createRequestContext, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import { createPeopleDeps, type PeopleDeps, type PeopleDepsInput } from "../../application/deps";
import { RecordingAudit } from "../../application/ports";

const here = fileURLToPath(new URL(".", import.meta.url));
export const BASELINE_DIR = resolve(here, "../../../../../../../packages/database/migrations");
export const WORKER_MIGRATIONS_DIR = resolve(here, "../../../../../../worker/migrations");
export const PEOPLE_MIGRATIONS_DIR = resolve(here, "../../migrations");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

if (!hasDb) {
  console.warn(
    "[people] TEST_DATABASE_URL absente : les tests d'intégration sont IGNORÉS. " +
      "Lancez : ED_PG_IMAGE=postgres:17-alpine node packages/database/scripts/with-postgres.mjs --config apps/api/src/modules/people/vitest.config.ts",
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

export interface PeopleTestDb {
  name: string;
  /** Connexion administrateur (superuser) : vérifications indépendantes de la RLS et tentatives d'écriture hors application. */
  admin: Client;
  /** Pool applicatif : rôle LOGIN membre de `app_user` (soumis à la RLS). */
  appPool: Pool;
  tenantDb: TenantDb;
  systemDb: SystemDb;
  createTenant(slug?: string): Promise<string>;
  drop(): Promise<void>;
}

export async function createPeopleTestDb(poolSize = 12): Promise<PeopleTestDb> {
  const name = `ed_it_${suffix()}_people_test`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await migrate({ client: admin, dirs: [BASELINE_DIR, WORKER_MIGRATIONS_DIR, PEOPLE_MIGRATIONS_DIR], role: "migrator", logger: noopLogger });

  const role = `it_app_${suffix()}`;
  const password = randomBytes(16).toString("hex");
  await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' IN ROLE app_user`);
  const appPool = new Pool({ connectionString: urlFor(name, role, password), max: poolSize });
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

export interface TestWorld {
  deps: PeopleDeps;
  clock: ManualClock;
  audit: RecordingAudit;
}

/** Dépendances de test : horloge figée (1er sept. 2025), audit enregistré. */
export function makeWorld(db: PeopleTestDb, overrides: Partial<PeopleDepsInput> = {}): TestWorld {
  const clock = new ManualClock("2025-09-01T08:00:00.000Z");
  const audit = new RecordingAudit();
  const deps = createPeopleDeps({ db: db.tenantDb, clock, audit, ...overrides });
  return { deps, clock, audit };
}

export function ctxFor(tenantId: string, userId: string = newId(), roles: string[] = ["secretariat"]): RequestContext {
  return createRequestContext({ tenantId, userId, roles });
}

/** Lit toute une requête en tant que superuser (vérifications indépendantes de la RLS). */
export async function adminRows<R = Record<string, any>>(db: PeopleTestDb, sql: string, params: unknown[] = []): Promise<R[]> {
  const res = await db.admin.query(sql, params);
  return res.rows as R[];
}

export async function adminOne<R = Record<string, any>>(db: PeopleTestDb, sql: string, params: unknown[] = []): Promise<R> {
  const rows = await adminRows<R>(db, sql, params);
  if (rows.length === 0) throw new Error(`Aucune ligne pour : ${sql}`);
  return rows[0] as R;
}
