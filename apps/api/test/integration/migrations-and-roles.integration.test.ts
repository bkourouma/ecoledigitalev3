/**
 * Migrations v2 (ordre, suivi par module, garde-fou de nom de base) et rôles de connexion
 * (création, refus superuser / BYPASSRLS / migrator) sur un vrai Postgres jetable.
 */
import { afterEach, beforeEach, expect, it } from "vitest";
import { Pool } from "pg";
import { MigrationChecksumError, UnsafeDatabaseError } from "@ecoledigitale/database";
import { noopLogger } from "@ecoledigitale/kernel";
import { assertSafeDbRole, UnsafeDatabaseRoleError } from "../../src/platform/v2-context";
import { LoginRoleError, createLoginRole } from "../../src/platform/v2-login-role";
import { runV2Migrations } from "../../src/platform/v2-migrations";
import {
  createEphemeralDb,
  describeIntegration,
  makeFakeModules,
  randomSuffix,
  urlForDatabase,
  type EphemeralDb,
  type FakeModules,
} from "../helpers/fixtures";

describeIntegration("migrations v2", () => {
  let db: EphemeralDb;
  let fake: FakeModules | undefined;

  beforeEach(async () => {
    db = await createEphemeralDb("test");
  });
  afterEach(async () => {
    fake?.cleanup();
    fake = undefined;
    await db.drop();
  });

  const grants = (schema: string) => `CREATE SCHEMA ${schema};\nGRANT USAGE ON SCHEMA ${schema} TO app_user;\n`;

  it("applique la baseline puis chaque module dans l'ordre des dépendances, avec un suivi par module", async () => {
    fake = makeFakeModules({
      // « b » dépend de « a » : sa migration lit a.items, elle échoue si « a » n'a pas été appliqué avant.
      b: {
        manifest: { dependsOn: ["a"] },
        migrations: {
          "0001_init.sql": `${grants("b")}CREATE TABLE b.copy AS SELECT id FROM a.items;\n`,
          "0002_more.sql": "ALTER TABLE b.copy ADD COLUMN note text;\n",
        },
      },
      a: {
        migrations: {
          "0001_init.sql": `${grants("a")}CREATE TABLE a.items (id uuid PRIMARY KEY DEFAULT gen_random_uuid());\n`,
        },
      },
    });

    const report = await runV2Migrations({ url: db.adminUrl, modulesDir: fake.dir, importer: fake.importer, logger: noopLogger, workerDir: null });
    expect(report.database).toBe(db.name);
    expect(report.steps.map((s) => s.step.id)).toEqual(["baseline", "a", "b"]);
    expect(report.steps[0]?.result.applied).toEqual(["0001_roles.sql", "0002_kernel.sql", "0003_outbox.sql"]);
    expect(report.steps[2]?.result.applied).toEqual(["0001_init.sql", "0002_more.sql"]);

    // Même numéro 0001 pour deux modules : tables de suivi distinctes.
    const tracked = await db.admin.query(
      `SELECT 'a' AS m, version FROM schema_migrations_a UNION ALL SELECT 'b', version FROM schema_migrations_b ORDER BY 1, 2`,
    );
    expect(tracked.rows).toEqual([
      { m: "a", version: "0001" },
      { m: "b", version: "0001" },
      { m: "b", version: "0002" },
    ]);

    // Les objets des modules appartiennent à migrator (et non au rôle de connexion).
    const owner = await db.admin.query("SELECT tableowner FROM pg_tables WHERE schemaname = 'a' AND tablename = 'items'");
    expect(owner.rows[0]?.tableowner).toBe("migrator");
  });

  it("est idempotent : un second passage n'applique rien", async () => {
    fake = makeFakeModules({ a: { migrations: { "0001_init.sql": `${grants("a")}CREATE TABLE a.t (id int);\n` } } });
    await runV2Migrations({ url: db.adminUrl, modulesDir: fake.dir, importer: fake.importer, logger: noopLogger, workerDir: null });
    const second = await runV2Migrations({ url: db.adminUrl, modulesDir: fake.dir, importer: fake.importer, logger: noopLogger, workerDir: null });
    for (const { result } of second.steps) expect(result.applied).toEqual([]);
    expect(second.steps[1]?.result.alreadyApplied).toEqual(["0001_init.sql"]);
  });

  it("refuse la modification d'une migration déjà appliquée (checksum)", async () => {
    fake = makeFakeModules({ a: { migrations: { "0001_init.sql": `${grants("a")}CREATE TABLE a.t (id int);\n` } } });
    await runV2Migrations({ url: db.adminUrl, modulesDir: fake.dir, importer: fake.importer, logger: noopLogger, workerDir: null });

    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(fake.dir, "a", "migrations", "0001_init.sql"), `${grants("a")}CREATE TABLE a.t (id bigint);\n`);
    await expect(
      runV2Migrations({ url: db.adminUrl, modulesDir: fake.dir, importer: fake.importer, logger: noopLogger, workerDir: null }),
    ).rejects.toBeInstanceOf(MigrationChecksumError);
  });

  it("--dry-run liste ce qui serait appliqué sans rien écrire", async () => {
    fake = makeFakeModules({ a: { migrations: { "0001_init.sql": `${grants("a")}CREATE TABLE a.t (id int);\n` } } });
    const report = await runV2Migrations({ url: db.adminUrl, modulesDir: fake.dir, importer: fake.importer, dryRun: true, logger: noopLogger, workerDir: null });
    expect(report.steps[0]?.result.pending).toHaveLength(3);
    expect(report.steps[1]?.result.pending).toEqual(["0001_init.sql"]);
    const schemas = await db.admin.query("SELECT 1 FROM pg_namespace WHERE nspname IN ('kernel', 'a')");
    expect(schemas.rows).toHaveLength(0);
  });

  it("n'applique rien si les manifestes sont invalides (cycle) : validation AVANT toute connexion", async () => {
    fake = makeFakeModules({ a: { manifest: { dependsOn: ["b"] } }, b: { manifest: { dependsOn: ["a"] } } });
    await expect(
      runV2Migrations({ url: db.adminUrl, modulesDir: fake.dir, importer: fake.importer, logger: noopLogger, workerDir: null }),
    ).rejects.toThrow(/Cycle/);
    const schemas = await db.admin.query("SELECT 1 FROM pg_namespace WHERE nspname = 'kernel'");
    expect(schemas.rows).toHaveLength(0);
  });
});

describeIntegration("garde-fou du nom de base", () => {
  it("refuse une base dont le nom ne finit pas par _test/_dev/_local, sauf --yes", async () => {
    const db = await createEphemeralDb("prod");
    try {
      await expect(runV2Migrations({ url: db.adminUrl, logger: noopLogger })).rejects.toBeInstanceOf(UnsafeDatabaseError);
      const empty = await db.admin.query("SELECT 1 FROM pg_namespace WHERE nspname = 'kernel'");
      expect(empty.rows).toHaveLength(0);

      const accepted = await runV2Migrations({ url: db.adminUrl, yes: true, logger: noopLogger });
      expect(accepted.steps[0]?.result.applied).toHaveLength(3);
    } finally {
      await db.drop();
    }
  });
});

describeIntegration("rôle de connexion applicatif", () => {
  let db: EphemeralDb;
  const roles: string[] = [];
  const pools: Pool[] = [];

  beforeEach(async () => {
    db = await createEphemeralDb("test", roles);
    await runV2Migrations({ url: db.adminUrl, logger: noopLogger });
  });
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
    await db.drop();
  });

  const poolFor = (url: string): Pool => {
    const pool = new Pool({ connectionString: url, max: 2 });
    pools.push(pool);
    return pool;
  };

  it("crée un rôle LOGIN membre de app_user, sûr, avec un mot de passe aléatoire affiché une fois", async () => {
    const role = `ed_t_${randomSuffix()}`;
    roles.push(role);
    const created = await createLoginRole({ adminUrl: db.adminUrl, role });

    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.applicationUrl).toContain(created.secret);
    expect(created.rotated).toBe(false);

    const attrs = await db.admin.query(
      "SELECT rolsuper, rolbypassrls, rolcanlogin, pg_has_role(oid, 'app_user', 'member') AS member FROM pg_roles WHERE rolname = $1",
      [role],
    );
    expect(attrs.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: true, member: true });

    // L'API démarrerait avec ce rôle.
    await expect(assertSafeDbRole(poolFor(created.applicationUrl))).resolves.toMatchObject({ role });
  });

  it("refuse de recréer un rôle existant sans --rotate, et le fait tourner avec --rotate", async () => {
    const role = `ed_t_${randomSuffix()}`;
    roles.push(role);
    const first = await createLoginRole({ adminUrl: db.adminUrl, role });
    await expect(createLoginRole({ adminUrl: db.adminUrl, role })).rejects.toThrow(/existe déjà/);

    const rotated = await createLoginRole({ adminUrl: db.adminUrl, role, rotate: true });
    expect(rotated.rotated).toBe(true);
    expect(rotated.secret).not.toBe(first.secret);
    await expect(assertSafeDbRole(poolFor(rotated.applicationUrl))).resolves.toBeDefined();
    // L'ancien mot de passe ne fonctionne plus.
    await expect(poolFor(first.applicationUrl).query("SELECT 1")).rejects.toThrow();
  });

  it("refuse la rotation d'un rôle qui n'est pas un rôle applicatif sûr", async () => {
    const role = `ed_t_${randomSuffix()}`;
    roles.push(role);
    await db.admin.query(`CREATE ROLE "${role}" LOGIN BYPASSRLS PASSWORD 'x1x2x3x4x5x6x7x8x9' IN ROLE app_user`);
    await expect(createLoginRole({ adminUrl: db.adminUrl, role, rotate: true })).rejects.toBeInstanceOf(LoginRoleError);
  });

  it("refuse hors base _dev/_test/_local, avant toute création de rôle", async () => {
    const prod = await createEphemeralDb("prod");
    try {
      const role = `ed_t_${randomSuffix()}`;
      roles.push(role);
      await expect(createLoginRole({ adminUrl: prod.adminUrl, role })).rejects.toThrow(/_dev, _test ou _local/);
      const none = await prod.admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      expect(none.rows).toHaveLength(0);
    } finally {
      await prod.drop();
    }
  });

  it("l'API REFUSE un superuser (le rôle d'administration de TEST_DATABASE_URL)", async () => {
    const admin = poolFor(db.adminUrl);
    const isSuper = (await admin.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]?.rolsuper;
    if (!isSuper) return; // instance où l'administrateur n'est pas superuser : cas couvert par les tests unitaires
    await expect(assertSafeDbRole(admin)).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
  });

  it("l'API REFUSE un rôle BYPASSRLS, un rôle hors app_user et un rôle membre de migrator", async () => {
    const make = async (suffix: string, options: string): Promise<Pool> => {
      const role = `ed_t_${suffix}_${randomSuffix()}`;
      roles.push(role);
      const secret = `s${randomSuffix()}${randomSuffix()}${randomSuffix()}`;
      await db.admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${secret}' ${options}`);
      return poolFor(urlForDatabase(db.name, role, secret));
    };

    await expect(assertSafeDbRole(await make("bypass", "BYPASSRLS IN ROLE app_user"))).rejects.toThrow(/BYPASSRLS/);
    await expect(assertSafeDbRole(await make("plain", "NOBYPASSRLS"))).rejects.toThrow(/membre de "app_user"/);
    await expect(assertSafeDbRole(await make("owner", "IN ROLE app_user, migrator"))).rejects.toThrow(/migrator/);
  });
});
