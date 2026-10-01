import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";
import { Client, Pool } from "pg";
import { noopLogger } from "@ecoledigitale/kernel";
import { migrate } from "../src";

const here = dirname(fileURLToPath(import.meta.url));

export const BASELINE_DIR = resolve(here, "../migrations");
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

if (!hasDb) {
  console.warn(
    "[database] TEST_DATABASE_URL absente : les tests d'intégration sont IGNORÉS. " +
      "Lancez-les avec `pnpm --filter @ecoledigitale/database test:integration` (Postgres jetable dans Docker) " +
      "ou définissez TEST_DATABASE_URL vers une instance jetable dont le rôle peut CREATE DATABASE / CREATE ROLE.",
  );
}

/** `describe` réservé aux tests qui ont besoin d'un vrai Postgres. */
export const describeIntegration: typeof describe = describe.skipIf(!hasDb) as unknown as typeof describe;

export const randomSecret = (): string => randomBytes(16).toString("hex");
export const randomSuffix = (): string => randomBytes(4).toString("hex");

export function urlFor(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface TestDb {
  name: string;
  /** Connexion administrateur (celle de TEST_DATABASE_URL) sur la base de test. */
  admin: Client;
  adminUrl: string;
  /** Crée un rôle LOGIN (mot de passe aléatoire, éphémère) membre de `memberOf`. */
  createLogin(prefix: string, memberOf: string): Promise<{ role: string; url: string }>;
  pool(url: string, max?: number): Pool;
  drop(): Promise<void>;
}

/** Crée une base `ed_it_<aléa>_<suffix>` vide, avec nettoyage complet à la fin. */
export async function createTestDb(suffix = "test"): Promise<TestDb> {
  const name = `ed_it_${randomSuffix()}_${suffix}`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);

  const adminUrl = urlFor(name);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();

  const roles: string[] = [];
  const pools: Pool[] = [];

  return {
    name,
    admin,
    adminUrl,
    async createLogin(prefix, memberOf) {
      const role = `${prefix}_${randomSuffix()}`;
      const password = randomSecret();
      if (!/^[a-z0-9_]+$/.test(role) || !/^[0-9a-f]+$/.test(password)) throw new Error("identifiant de test invalide");
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' IN ROLE "${memberOf}"`);
      roles.push(role);
      return { role, url: urlFor(name, role, password) };
    },
    pool(url, max = 4) {
      const p = new Pool({ connectionString: url, max });
      pools.push(p);
      return p;
    },
    async drop() {
      await Promise.all(pools.map((p) => p.end().catch(() => undefined)));
      await admin.end().catch(() => undefined);
      try {
        await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        for (const role of roles) await maintenance.query(`DROP ROLE IF EXISTS "${role}"`);
      } finally {
        await maintenance.end().catch(() => undefined);
      }
    },
  };
}

/** Applique la baseline v2 sur `db` sous le rôle `migrator`. */
export async function applyBaseline(db: TestDb): Promise<void> {
  await migrate({ client: db.admin, dirs: [BASELINE_DIR], role: "migrator", logger: noopLogger });
}
