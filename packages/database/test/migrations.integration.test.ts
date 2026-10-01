import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { noopLogger } from "@ecoledigitale/kernel";
import {
  MigrationChecksumError,
  MigrationExecutionError,
  MigrationFileError,
  MigrationLockTimeoutError,
  MigrationMissingError,
  MigrationOrderError,
  UnsafeDatabaseError,
  migrate,
} from "../src";
import { main } from "../src/cli";
import { BASELINE_DIR, createTestDb, describeIntegration, type TestDb } from "./helpers";

const tmpDirs: string[] = [];
function workDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ed-mig-it-"));
  tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

const run = (db: TestDb, dirs: string[], extra: Partial<Parameters<typeof migrate>[0]> = {}) =>
  migrate({ client: db.admin, dirs, logger: noopLogger, ...extra });

const versions = async (db: TestDb): Promise<string[]> =>
  (await db.admin.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => r.version);

const tableExists = async (db: TestDb, name: string): Promise<boolean> =>
  (await db.admin.query("SELECT to_regclass($1) IS NOT NULL AS ok", [name])).rows[0].ok;

describeIntegration("runner de migrations sur Postgres réel", () => {
  const dbs: TestDb[] = [];
  const fresh = async (suffix = "test"): Promise<TestDb> => {
    const db = await createTestDb(suffix);
    dbs.push(db);
    return db;
  };
  afterAll(async () => {
    for (const db of dbs) await db.drop();
  });

  it("applique la baseline v2 sous le rôle migrator, puis est idempotent", async () => {
    const db = await fresh();
    const first = await run(db, [BASELINE_DIR], { role: "migrator" });
    expect(first.applied).toEqual(["0001_roles.sql", "0002_kernel.sql", "0003_outbox.sql"]);
    expect(first.database).toBe(db.name);
    expect(await versions(db)).toEqual(["0001", "0002", "0003"]);

    const rows = (await db.admin.query("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version")).rows;
    expect(rows[0]).toMatchObject({ version: "0001", name: "roles" });
    expect(rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].applied_at).toBeInstanceOf(Date);

    const second = await run(db, [BASELINE_DIR], { role: "migrator" });
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toHaveLength(3);

    // Les objets des fichiers 0002+ appartiennent à migrator (SET LOCAL ROLE effectif).
    const owner = (await db.admin.query("SELECT tableowner FROM pg_tables WHERE schemaname='kernel' AND tablename='tenants'")).rows[0].tableowner;
    expect(owner).toBe("migrator");
    // …et le bookkeeping reste au rôle de connexion, jamais à migrator.
    const bookOwner = (await db.admin.query("SELECT tableowner FROM pg_tables WHERE tablename='schema_migrations'")).rows[0].tableowner;
    expect(bookOwner).not.toBe("migrator");
  });

  it("refuse un fichier déjà appliqué dont le contenu a changé, SANS rien appliquer d'autre", async () => {
    const db = await fresh();
    const dir = workDir({
      "0001_a.sql": "CREATE TABLE t_a (id int);",
      "0002_b.sql": "CREATE TABLE t_b (id int);",
    });
    await run(db, [dir]);

    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE t_a (id int, extra text);");
    writeFileSync(join(dir, "0003_c.sql"), "CREATE TABLE t_c (id int);");
    const err = await run(db, [dir]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationChecksumError);
    expect((err as MigrationChecksumError).mismatches.map((m) => m.version)).toEqual(["0001"]);
    expect((err as Error).message).toMatch(/immuable/);
    expect(await tableExists(db, "t_c")).toBe(false);
    expect(await versions(db)).toEqual(["0001", "0002"]);
  });

  it("n'est pas sensible aux fins de ligne CRLF ni au BOM", async () => {
    const db = await fresh();
    const dir = workDir({ "0001_a.sql": "CREATE TABLE t_eol (id int);\n" });
    await run(db, [dir]);
    writeFileSync(join(dir, "0001_a.sql"), "﻿CREATE TABLE t_eol (id int);\r\n");
    await expect(run(db, [dir])).resolves.toMatchObject({ applied: [] });
  });

  it("refuse si une migration appliquée n'est plus dans les dossiers", async () => {
    const db = await fresh();
    const dir = workDir({ "0001_a.sql": "SELECT 1;", "0002_b.sql": "SELECT 2;" });
    await run(db, [dir]);
    rmSync(join(dir, "0002_b.sql"));
    const err = await run(db, [dir]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationMissingError);
    expect((err as MigrationMissingError).versions).toEqual(["0002_b"]);
  });

  it("refuse une migration insérée avant l'historique, sauf allowOutOfOrder", async () => {
    const db = await fresh();
    const dir = workDir({ "0001_a.sql": "SELECT 1;", "0003_c.sql": "SELECT 3;" });
    await run(db, [dir]);
    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE t_late (id int);");
    const err = await run(db, [dir]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationOrderError);
    expect(await tableExists(db, "t_late")).toBe(false);

    const ok = await run(db, [dir], { allowOutOfOrder: true });
    expect(ok.applied).toEqual(["0002_b.sql"]);
    expect(await tableExists(db, "t_late")).toBe(true);
  });

  it("une migration qui échoue est annulée EN ENTIER et n'est pas enregistrée ; les suivantes ne tournent pas", async () => {
    const db = await fresh();
    const dir = workDir({
      "0001_ok.sql": "CREATE TABLE t_ok (id int);",
      "0002_ko.sql": "CREATE TABLE t_half (id int);\nINSERT INTO t_half VALUES (1);\nSELECT * FROM table_inexistante;\n",
      "0003_after.sql": "CREATE TABLE t_after (id int);",
    });
    const err = await run(db, [dir]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationExecutionError);
    const e = err as MigrationExecutionError;
    expect(e.filename).toBe("0002_ko.sql");
    expect(e.line).toBe(3);
    expect(e.message).toMatch(/table_inexistante/);
    expect(e.message).toMatch(/transaction annulée/);

    expect(await tableExists(db, "t_ok")).toBe(true);
    expect(await tableExists(db, "t_half")).toBe(false);
    expect(await tableExists(db, "t_after")).toBe(false);
    expect(await versions(db)).toEqual(["0001"]);

    // Après correction, la reprise est possible.
    writeFileSync(join(dir, "0002_ko.sql"), "CREATE TABLE t_half (id int);");
    await expect(run(db, [dir])).resolves.toMatchObject({ applied: ["0002_ko.sql", "0003_after.sql"] });
  });

  it("refuse un BEGIN/COMMIT explicite dans un fichier transactionnel (atomicité préservée)", async () => {
    const db = await fresh();
    const dir = workDir({ "0001_tx.sql": "BEGIN;\nCREATE TABLE t_tx (id int);\nCOMMIT;" });
    const err = await run(db, [dir]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationExecutionError);
    expect((err as Error).message).toMatch(/contrôle de transaction explicite/);
    expect(await tableExists(db, "t_tx")).toBe(false);
  });

  it("-- no-transaction : CREATE INDEX CONCURRENTLY fonctionne ; le même fichier en transaction échoue", async () => {
    const db = await fresh();
    const base = workDir({ "0001_t.sql": "CREATE TABLE t_idx (id int, v int);" });
    await run(db, [base]);

    const concurrent = "CREATE INDEX CONCURRENTLY t_idx_v ON t_idx (v);\nCREATE INDEX CONCURRENTLY t_idx_id ON t_idx (id);\n";
    writeFileSync(join(base, "0002_idx.sql"), `-- no-transaction\n${concurrent}`);
    await expect(run(db, [base])).resolves.toMatchObject({ applied: ["0002_idx.sql"] });
    const idx = (await db.admin.query("SELECT indexname FROM pg_indexes WHERE tablename='t_idx' ORDER BY 1")).rows.map((r) => r.indexname);
    expect(idx).toEqual(["t_idx_id", "t_idx_v"]);

    writeFileSync(join(base, "0003_idx2.sql"), "CREATE INDEX CONCURRENTLY t_idx_x ON t_idx (v, id);\n");
    const err = await run(db, [base]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationExecutionError);
    expect((err as Error).message).toMatch(/CONCURRENTLY|transaction block/);
    expect(await versions(db)).toEqual(["0001", "0002"]);
  });

  it("-- no-transaction : un échec signale les effets partiels possibles et n'enregistre rien", async () => {
    const db = await fresh();
    const dir = workDir({
      "0001_partial.sql": "-- no-transaction\nCREATE TABLE t_partial (id int);\nSELECT * FROM n_existe_pas;\n",
    });
    const err = await run(db, [dir]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MigrationExecutionError);
    expect((err as Error).message).toMatch(/effets partiels/);
    expect(await tableExists(db, "t_partial")).toBe(true); // c'est le contrat d'un fichier sans transaction
    expect(await versions(db)).toEqual([]);
  });

  it("dry-run : liste l'attendu sans créer ni table de suivi ni objets", async () => {
    const db = await fresh();
    const dir = workDir({ "0001_a.sql": "CREATE TABLE t_dry (id int);" });
    const res = await run(db, [dir], { dryRun: true });
    expect(res.pending).toEqual(["0001_a.sql"]);
    expect(res.applied).toEqual([]);
    expect(await tableExists(db, "schema_migrations")).toBe(false);
    expect(await tableExists(db, "t_dry")).toBe(false);

    await run(db, [dir]);
    writeFileSync(join(dir, "0002_b.sql"), "SELECT 1;");
    const again = await run(db, [dir], { dryRun: true });
    expect(again.pending).toEqual(["0002_b.sql"]);
    expect(again.alreadyApplied).toEqual(["0001_a.sql"]);
  });

  it("verrou advisory : deux runners simultanés s'enchaînent, chaque migration n'est appliquée qu'UNE fois", async () => {
    const db = await fresh();
    const dir = workDir({
      "0001_slow.sql": "SELECT pg_sleep(1.2);\nCREATE TABLE t_lock (id int);",
      "0002_next.sql": "INSERT INTO t_lock VALUES (1);",
    });
    const second = new Client({ connectionString: db.adminUrl });
    await second.connect();
    try {
      const [r1, r2] = await Promise.all([
        migrate({ client: db.admin, dirs: [dir], logger: noopLogger }),
        (async () => {
          await new Promise((r) => setTimeout(r, 200)); // démarre pendant que le premier tient le verrou
          return migrate({ client: second, dirs: [dir], logger: noopLogger });
        })(),
      ]);
      const appliedTotal = [...r1.applied, ...r2.applied].sort();
      expect(appliedTotal).toEqual(["0001_slow.sql", "0002_next.sql"]);
      expect(r1.applied.length === 2 || r2.applied.length === 2).toBe(true);
      expect((await db.admin.query("SELECT count(*)::int AS n FROM t_lock")).rows[0].n).toBe(1);
    } finally {
      await second.end();
    }
  });

  it("verrou advisory : un runner en attente abandonne proprement après lockTimeoutMs", async () => {
    const db = await fresh();
    const dir = workDir({ "0001_slow.sql": "SELECT pg_sleep(1.5);\nCREATE TABLE t_lock2 (id int);" });
    const second = new Client({ connectionString: db.adminUrl });
    await second.connect();
    try {
      const first = migrate({ client: db.admin, dirs: [dir], logger: noopLogger });
      await new Promise((r) => setTimeout(r, 300));
      const err = await migrate({ client: second, dirs: [dir], lockTimeoutMs: 300, logger: noopLogger }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MigrationLockTimeoutError);
      await first;
      expect(await versions(db)).toEqual(["0001"]);
    } finally {
      await second.end();
    }
  });

  it("le verrou est libéré même après un échec (le runner suivant passe)", async () => {
    const db = await fresh();
    const dir = workDir({ "0001_ko.sql": "SELECT * FROM nope;" });
    await run(db, [dir]).catch(() => undefined);
    writeFileSync(join(dir, "0001_ko.sql"), "SELECT 1;");
    const second = new Client({ connectionString: db.adminUrl });
    await second.connect();
    try {
      await expect(migrate({ client: second, dirs: [dir], lockTimeoutMs: 500, logger: noopLogger })).resolves.toMatchObject({
        applied: ["0001_ko.sql"],
      });
    } finally {
      await second.end();
    }
  });

  describe("garde-fou sur le nom de base", () => {
    it("refuse une base `*_prod` sans yes, et n'y écrit rien", async () => {
      const db = await fresh("prod");
      const dir = workDir({ "0001_a.sql": "CREATE TABLE t_guard (id int);" });
      const err = await run(db, [dir]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnsafeDatabaseError);
      expect((err as UnsafeDatabaseError).database).toBe(db.name);
      expect(await tableExists(db, "schema_migrations")).toBe(false);
      expect(await tableExists(db, "t_guard")).toBe(false);
    });

    it("l'accepte avec yes explicite", async () => {
      const db = await fresh("prod");
      const dir = workDir({ "0001_a.sql": "CREATE TABLE t_guard (id int);" });
      await expect(run(db, [dir], { yes: true })).resolves.toMatchObject({ applied: ["0001_a.sql"] });
    });

    it.each(["dev", "local", "test"])("accepte une base *_%s sans confirmation", async (suffix) => {
      const db = await fresh(suffix);
      await expect(run(db, [workDir({ "0001_a.sql": "SELECT 1;" })])).resolves.toMatchObject({ applied: ["0001_a.sql"] });
    });
  });

  it("plusieurs dossiers : numéros globaux, doublon refusé avant toute écriture", async () => {
    const db = await fresh();
    const a = workDir({ "0001_a.sql": "CREATE TABLE t_m1 (id int);" });
    const b = workDir({ "0002_b.sql": "CREATE TABLE t_m2 (id int);" });
    await expect(run(db, [a, b])).resolves.toMatchObject({ applied: ["0001_a.sql", "0002_b.sql"] });

    const dup = workDir({ "0002_autre.sql": "SELECT 1;" });
    await expect(run(db, [a, b, dup])).rejects.toBeInstanceOf(MigrationFileError);
    expect(await versions(db)).toEqual(["0001", "0002"]);
  });

  it("rôle absent : le bootstrap passe ; ensuite SET LOCAL ROLE s'applique, sauf pour un fichier -- no-role", async () => {
    const db = await fresh();
    const dir = workDir({
      "0001_boot.sql":
        "-- no-role\nDO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='it_runner_role') THEN CREATE ROLE it_runner_role NOLOGIN; END IF; END $$;\n" +
        "CREATE SCHEMA it_s AUTHORIZATION it_runner_role;\nCREATE TABLE public.t_boot_owner (id int);",
      "0002_use.sql": "CREATE TABLE it_s.t_owned (id int);",
    });
    try {
      await run(db, [dir], { role: "it_runner_role" });
      const owners = Object.fromEntries(
        (
          await db.admin.query("SELECT tablename, tableowner FROM pg_tables WHERE tablename IN ('t_owned','t_boot_owner')")
        ).rows.map((r) => [r.tablename, r.tableowner]),
      );
      expect(owners.t_owned).toBe("it_runner_role"); // 0002 : SET LOCAL ROLE appliqué
      expect(owners.t_boot_owner).not.toBe("it_runner_role"); // 0001 : -- no-role, rôle de connexion
    } finally {
      await db.admin.query("DROP SCHEMA IF EXISTS it_s CASCADE").catch(() => undefined);
      await db.admin.query("DROP OWNED BY it_runner_role").catch(() => undefined);
      await db.admin.query("DROP ROLE IF EXISTS it_runner_role").catch(() => undefined);
    }
  });

  it("un rôle d'exécution existant ne s'applique pas au fichier de bootstrap de la baseline (2e base du même cluster)", async () => {
    // `migrator` existe déjà dans le cluster (créé par les tests précédents) : 0001 doit quand même passer.
    const db = await fresh();
    await expect(run(db, [BASELINE_DIR], { role: "migrator" })).resolves.toMatchObject({
      applied: ["0001_roles.sql", "0002_kernel.sql", "0003_outbox.sql"],
    });
  });

  describe("CLI", () => {
    const capture = async (fn: () => Promise<number>) => {
      const logs: string[] = [];
      const errs: string[] = [];
      const [oLog, oErr, oInfo, oWarn] = [console.log, console.error, console.info, console.warn];
      console.log = (m: unknown) => void logs.push(String(m));
      console.error = (m: unknown) => void errs.push(String(m));
      console.info = () => undefined;
      console.warn = () => undefined;
      try {
        return { code: await fn(), logs, errs };
      } finally {
        [console.log, console.error, console.info, console.warn] = [oLog, oErr, oInfo, oWarn];
      }
    };

    it("applique avec --dir / --url (séparateur -- toléré), n'affiche pas le mot de passe, est idempotent", async () => {
      const db = await fresh();
      const url = db.adminUrl;
      const res = await capture(() => main(["--", "--dir", BASELINE_DIR, "--url", url]));
      expect(res.code).toBe(0);
      expect(res.logs.join("\n")).toMatch(/3 migration\(s\) appliquée\(s\)/);
      expect(res.logs.join("\n")).not.toContain(new URL(url).password);
      expect(await versions(db)).toEqual(["0001", "0002", "0003"]);

      const again = await capture(() => main(["--dir", BASELINE_DIR, "--url", url]));
      expect(again.code).toBe(0);
      expect(again.logs.join("\n")).toMatch(/0 migration\(s\) appliquée\(s\), 3 déjà/);
    });

    it("lit DATABASE_URL, refuse une base *_prod sans --yes (code 1) puis l'accepte avec --yes", async () => {
      const db = await fresh("prod");
      const env = { DATABASE_URL: db.adminUrl } as NodeJS.ProcessEnv;
      const refused = await capture(() => main(["--dir", BASELINE_DIR], env));
      expect(refused.code).toBe(1);
      expect(refused.errs.join("\n")).toMatch(/MIGRATION_UNSAFE_DATABASE/);
      expect(await tableExists(db, "schema_migrations")).toBe(false);

      const accepted = await capture(() => main(["--dir", BASELINE_DIR, "--yes"], env));
      expect(accepted.code).toBe(0);
      expect(await versions(db)).toEqual(["0001", "0002", "0003"]);
    });

    it("--dry-run ne modifie rien ; une erreur de checksum donne le code 1", async () => {
      const db = await fresh();
      const dir = workDir();
      for (const f of ["0001_roles.sql", "0002_kernel.sql", "0003_outbox.sql"]) copyFileSync(join(BASELINE_DIR, f), join(dir, f));
      const dry = await capture(() => main(["--dir", dir, "--url", db.adminUrl, "--dry-run"]));
      expect(dry.code).toBe(0);
      expect(dry.logs.join("\n")).toMatch(/3 migration\(s\) en attente/);
      expect(await tableExists(db, "schema_migrations")).toBe(false);

      await capture(() => main(["--dir", dir, "--url", db.adminUrl]));
      writeFileSync(join(dir, "0003_outbox.sql"), `${readFileSync(join(dir, "0003_outbox.sql"), "utf8")}\n-- modifié après coup\n`);
      const bad = await capture(() => main(["--dir", dir, "--url", db.adminUrl]));
      expect(bad.code).toBe(1);
      expect(bad.errs.join("\n")).toMatch(/MIGRATION_CHECKSUM_MISMATCH/);
    });
  });

  it("la baseline est idempotente au niveau SQL (rôles, kernel, outbox) : rejouée à la main, elle ne casse rien", async () => {
    const db = await fresh();
    await run(db, [BASELINE_DIR], { role: "migrator" });
    for (const f of ["0001_roles.sql", "0002_kernel.sql"]) {
      await expect(db.admin.query(readFileSync(join(BASELINE_DIR, f), "utf8"))).resolves.toBeDefined();
    }
  });
});
