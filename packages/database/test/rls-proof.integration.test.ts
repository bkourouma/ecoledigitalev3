/**
 * PREUVE : le design corrige le défaut constaté (la RLS « existait » mais un
 * super-utilisateur ou le propriétaire de la table la contournait).
 *
 *  1. rôle applicatif (membre de app_user) : le tenant A ne voit rien de B,
 *     ne peut ni lire, ni modifier, ni supprimer, ni insérer pour B ;
 *  2. LE DÉFAUT : un rôle PROPRIÉTAIRE d'une table avec ENABLE ROW LEVEL SECURITY
 *     mais sans FORCE voit TOUTES les lignes malgré la policy ;
 *  3. un super-utilisateur voit tout, même sur une table FORCE : c'est
 *     pourquoi l'API ne doit JAMAIS se connecter ainsi (et pourquoi
 *     assertTenantIsolation refuse un pool superuser) ;
 *  4. avec FORCE (kernel.enable_tenant_rls), le même type de rôle propriétaire
 *     est, lui aussi, soumis à la policy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { createRequestContext } from "@ecoledigitale/kernel";
import { TenantDb, assertTenantIsolation, isRlsViolation } from "../src";
import { applyBaseline, createTestDb, describeIntegration, randomSecret, urlFor, type TestDb } from "./helpers";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describeIntegration("Preuve d'isolation RLS (rôles réels)", () => {
  let db: TestDb;
  let appUrl: string;
  let ownerLogin: { role: string; url: string };
  let migratorLogin: { role: string; url: string };
  let legacyOwnerRole: string;
  let legacyOwnerUrl: string;

  beforeAll(async () => {
    db = await createTestDb();
    await applyBaseline(db);
    const { admin } = db;

    // Rôles de connexion du test (mots de passe aléatoires éphémères).
    const app = await db.createLogin("it_app", "app_user");
    appUrl = app.url;
    migratorLogin = await db.createLogin("it_migrator", "migrator");

    legacyOwnerRole = `it_legacy_${randomSecret().slice(0, 6)}`;
    const legacyPassword = randomSecret();
    await admin.query(`CREATE ROLE "${legacyOwnerRole}" LOGIN PASSWORD '${legacyPassword}'`);
    legacyOwnerUrl = urlFor(db.name, legacyOwnerRole, legacyPassword);
    ownerLogin = { role: legacyOwnerRole, url: legacyOwnerUrl };

    // Tenants A et B (kernel.tenants est global).
    await admin.query(
      `INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, 'tenant-a', 'A'), ($2, 'tenant-b', 'B')`,
      [A, B],
    );

    // Table v2 : créée sous migrator, protégée par enable_tenant_rls (ENABLE + FORCE).
    await admin.query(`
      CREATE SCHEMA demo AUTHORIZATION migrator;
      GRANT USAGE ON SCHEMA demo TO app_user;
      SET ROLE migrator;
      CREATE TABLE demo.items_v2 (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
        label text NOT NULL
      );
      SELECT kernel.enable_tenant_rls('demo.items_v2');
      GRANT SELECT, INSERT, UPDATE, DELETE ON demo.items_v2 TO app_user;

      -- Même table, même policy, mais SANS FORCE : le piège de la base historique.
      CREATE TABLE demo.items_noforce (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
        label text NOT NULL
      );
      ALTER TABLE demo.items_noforce ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON demo.items_noforce
        USING (tenant_id = kernel.current_tenant_id())
        WITH CHECK (tenant_id = kernel.current_tenant_id());
      GRANT SELECT, INSERT, UPDATE, DELETE ON demo.items_noforce TO app_user;
      RESET ROLE;
    `);

    // Table « historique » : propriétaire = rôle applicatif d'avant, policy à l'ancienne, pas de FORCE.
    await admin.query(`
      CREATE TABLE demo.items_legacy (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        label text NOT NULL
      );
      ALTER TABLE demo.items_legacy OWNER TO "${legacyOwnerRole}";
      ALTER TABLE demo.items_legacy ENABLE ROW LEVEL SECURITY;
      CREATE POLICY legacy_tenant_isolation ON demo.items_legacy
        FOR ALL USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
      GRANT USAGE ON SCHEMA demo TO "${legacyOwnerRole}";
    `);

    // Données : 2 lignes par tenant dans chaque table (insertion en superuser = hors RLS).
    for (const table of ["items_v2", "items_noforce", "items_legacy"]) {
      await admin.query(
        `INSERT INTO demo.${table} (tenant_id, label) VALUES ($1,'a1'),($1,'a2'),($2,'b1'),($2,'b2')`,
        [A, B],
      );
    }
  });

  afterAll(async () => {
    await db?.drop();
  });

  // ------------------------------------------------------------------ 0
  it("les rôles de la plateforme sont NOLOGIN, NOBYPASSRLS, sans mot de passe", async () => {
    const roles = (
      await db.admin.query(
        `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, a.rolpassword
           FROM pg_roles r JOIN pg_authid a ON a.oid = r.oid
          WHERE r.rolname IN ('app_user', 'migrator') ORDER BY r.rolname`,
      )
    ).rows;
    expect(roles.map((r) => r.rolname)).toEqual(["app_user", "migrator"]);
    for (const r of roles) {
      expect(r).toMatchObject({
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolpassword: null,
      });
    }
  });

  it("les objets du schéma kernel appartiennent à migrator, pas à l'application", async () => {
    const owners = (
      await db.admin.query(
        `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'kernel'`,
      )
    ).rows.map((r) => r.tableowner);
    expect(owners).toEqual(["migrator"]);
    const fnOwners = (
      await db.admin.query(
        `SELECT DISTINCT pg_get_userbyid(p.proowner) AS o FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'kernel'`,
      )
    ).rows.map((r) => r.o);
    expect(fnOwners).toEqual(["migrator"]);
  });

  // ------------------------------------------------------------------ 1
  describe("avec le rôle applicatif (app_user)", () => {
    it("le tenant A ne voit que ses lignes, B que les siennes", async () => {
      const pool = db.pool(appUrl);
      const tdb = new TenantDb(pool);
      const ctxA = createRequestContext({ tenantId: A, userId: U });
      const ctxB = createRequestContext({ tenantId: B, userId: U });

      const rowsA = await tdb.run(ctxA, (tx) => tx.many("SELECT label, tenant_id FROM demo.items_v2 ORDER BY label"));
      expect(rowsA.map((r) => r.label)).toEqual(["a1", "a2"]);
      expect(new Set(rowsA.map((r) => r.tenant_id))).toEqual(new Set([A]));

      const rowsB = await tdb.run(ctxB, (tx) => tx.many("SELECT label FROM demo.items_v2 ORDER BY label"));
      expect(rowsB.map((r) => r.label)).toEqual(["b1", "b2"]);

      // Même en demandant explicitement les lignes de A en tant que B.
      const crossRead = await tdb.run(ctxB, (tx) => tx.many("SELECT * FROM demo.items_v2 WHERE tenant_id = $1", [A]));
      expect(crossRead).toEqual([]);
    });

    it("B ne peut ni modifier, ni supprimer, ni insérer au nom de A", async () => {
      const tdb = new TenantDb(db.pool(appUrl));
      const ctxB = createRequestContext({ tenantId: B, userId: U });

      await tdb.run(ctxB, async (tx) => {
        expect((await tx.query("UPDATE demo.items_v2 SET label = 'pirate' WHERE tenant_id = $1", [A])).rowCount).toBe(0);
        expect((await tx.query("DELETE FROM demo.items_v2 WHERE tenant_id = $1", [A])).rowCount).toBe(0);
      });

      const forged = await tdb
        .run(ctxB, (tx) => tx.query("INSERT INTO demo.items_v2 (tenant_id, label) VALUES ($1, 'faux')", [A]))
        .catch((e: unknown) => e);
      expect(isRlsViolation(forged)).toBe(true);

      // Rien n'a bougé pour A.
      const ctxA = createRequestContext({ tenantId: A, userId: U });
      const rowsA = await tdb.run(ctxA, (tx) => tx.many("SELECT label FROM demo.items_v2 ORDER BY label"));
      expect(rowsA.map((r) => r.label)).toEqual(["a1", "a2"]);
    });

    it("sans contexte de tenant (ou avec un contexte invalide), aucune ligne n'est visible : échec fermé", async () => {
      const pool = db.pool(appUrl);
      const c = await pool.connect();
      try {
        for (const setup of [
          "SELECT 1",
          "SELECT set_config('app.tenant_id', '', false)",
          "SELECT set_config('app.tenant_id', 'pas-un-uuid', false)",
          "SELECT set_config('app.tenant_id', ''' OR 1=1 --', false)",
        ]) {
          await c.query(setup);
          expect((await c.query("SELECT count(*)::int AS n FROM demo.items_v2")).rows[0].n).toBe(0);
        }
        // Et l'insertion sans tenant est refusée.
        await c.query("SELECT set_config('app.tenant_id', '', false)");
        await expect(c.query("INSERT INTO demo.items_v2 (tenant_id, label) VALUES ($1, 'x')", [A])).rejects.toSatisfy(
          isRlsViolation,
        );
      } finally {
        c.release();
      }
    });

    it("n'a aucun droit de DDL ni de contournement", async () => {
      const c = await db.pool(appUrl).connect();
      try {
        await expect(c.query("CREATE TABLE public.pirate (id int)")).rejects.toThrow(/permission denied/);
        await expect(c.query("CREATE TABLE demo.pirate (id int)")).rejects.toThrow(/permission denied/);
        await expect(c.query("ALTER TABLE demo.items_v2 DISABLE ROW LEVEL SECURITY")).rejects.toThrow(/must be owner/);
        await expect(c.query("SET ROLE migrator")).rejects.toThrow(/permission denied/);
        await expect(c.query("SELECT kernel.enable_tenant_rls('demo.items_v2')")).rejects.toThrow(/permission denied/);
        await expect(c.query("SET row_security = off")).resolves.toBeDefined(); // autorisé, mais…
        await c.query("SELECT set_config('app.tenant_id', $1, false)", [B]);
        // … n'est PAS un contournement : avec row_security=off, la requête échoue au lieu de tout révéler.
        await expect(c.query("SELECT count(*) FROM demo.items_v2")).rejects.toThrow(/row-level security/i);
      } finally {
        c.release();
      }
    });

    it("l'application ne peut pas lire de contexte laissé par une requête précédente (pool de 1 connexion)", async () => {
      const tdb = new TenantDb(db.pool(appUrl, 1));
      await tdb.run(createRequestContext({ tenantId: A, userId: U }), (tx) => tx.query("SELECT 1"));
      const after = await tdb.run(createRequestContext({ tenantId: B, userId: U }), (tx) =>
        tx.many("SELECT label FROM demo.items_v2 ORDER BY label"),
      );
      expect(after.map((r) => r.label)).toEqual(["b1", "b2"]);
    });
  });

  // ------------------------------------------------------------------ 2
  describe("LE DÉFAUT CONSTATÉ : ENABLE sans FORCE, vu par le propriétaire", () => {
    it("le propriétaire d'une table à RLS non forcée voit les lignes de TOUS les tenants", async () => {
      const owner = new Client({ connectionString: ownerLogin.url });
      await owner.connect();
      try {
        await owner.query("SELECT set_config('app.tenant_id', $1, false)", [A]);
        const n = (await owner.query("SELECT count(*)::int AS n FROM demo.items_legacy")).rows[0].n;
        // Les 4 lignes (A et B) alors que la policy demande tenant = A.
        expect(n).toBe(4);
        const foreign = (
          await owner.query("SELECT count(*)::int AS n FROM demo.items_legacy WHERE tenant_id = $1", [B])
        ).rows[0].n;
        expect(foreign).toBe(2);
      } finally {
        await owner.end();
      }
    });

    it("même constat avec la policy v2 : sans FORCE, un rôle membre de migrator contourne la RLS", async () => {
      const m = new Client({ connectionString: migratorLogin.url });
      await m.connect();
      try {
        await m.query("SELECT set_config('app.tenant_id', $1, false)", [A]);
        const noForce = (await m.query("SELECT count(*)::int AS n FROM demo.items_noforce")).rows[0].n;
        expect(noForce).toBe(4);
      } finally {
        await m.end();
      }
    });

    it("le non-propriétaire (app_user) reste, lui, isolé sur la table non forcée", async () => {
      const tdb = new TenantDb(db.pool(appUrl));
      const rows = await tdb.run(createRequestContext({ tenantId: A, userId: U }), (tx) =>
        tx.many("SELECT label FROM demo.items_noforce ORDER BY label"),
      );
      expect(rows.map((r) => r.label)).toEqual(["a1", "a2"]);
    });
  });

  // ------------------------------------------------------------------ 4
  describe("LE CORRECTIF : FORCE ROW LEVEL SECURITY via kernel.enable_tenant_rls", () => {
    it("le MÊME rôle propriétaire (membre de migrator) est soumis à la policy sur la table forcée", async () => {
      const m = new Client({ connectionString: migratorLogin.url });
      await m.connect();
      try {
        await m.query("SELECT set_config('app.tenant_id', $1, false)", [A]);
        const forced = (await m.query("SELECT label FROM demo.items_v2 ORDER BY label")).rows.map((r) => r.label);
        expect(forced).toEqual(["a1", "a2"]); // 2 lignes, pas 4
        const unforced = (await m.query("SELECT count(*)::int AS n FROM demo.items_noforce")).rows[0].n;
        expect(unforced).toBe(4); // la différence, c'est FORCE et rien d'autre
      } finally {
        await m.end();
      }
    });

    it("sans tenant posé, le propriétaire forcé ne voit rien non plus", async () => {
      const m = new Client({ connectionString: migratorLogin.url });
      await m.connect();
      try {
        expect((await m.query("SELECT count(*)::int AS n FROM demo.items_v2")).rows[0].n).toBe(0);
      } finally {
        await m.end();
      }
    });
  });

  // ------------------------------------------------------------------ 3
  describe("La limite qu'aucune policy ne comble : le super-utilisateur", () => {
    it("un superuser voit tout, même avec FORCE — il ne doit jamais servir à l'API", async () => {
      await db.admin.query("SELECT set_config('app.tenant_id', $1, false)", [A]);
      const rolsuper = (await db.admin.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")).rows[0]
        .rolsuper;
      expect(rolsuper).toBe(true);
      const n = (await db.admin.query("SELECT count(*)::int AS n FROM demo.items_v2")).rows[0].n;
      expect(n).toBe(4);
      await db.admin.query("RESET app.tenant_id");
    });

    it("assertTenantIsolation refuse un pool superuser (le test n'aurait aucune valeur)", async () => {
      const pool = db.pool(db.adminUrl);
      await expect(assertTenantIsolation({ pool, schemas: ["demo"], allowlist: [] })).rejects.toThrow(/SUPERUSER/);
    });

    it("assertTenantIsolation refuse aussi un rôle BYPASSRLS", async () => {
      const role = `it_bypass_${randomSecret().slice(0, 6)}`;
      const password = randomSecret();
      await db.admin.query(`CREATE ROLE "${role}" LOGIN BYPASSRLS PASSWORD '${password}'`);
      try {
        const pool = db.pool(urlFor(db.name, role, password), 1);
        await expect(assertTenantIsolation({ pool, schemas: ["demo"] })).rejects.toThrow(/BYPASSRLS/);
      } finally {
        await db.admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
      }
    });
  });

  // ------------------------------------------------------------------ audit
  it("assertTenantIsolation signale la table historique ET la table sans FORCE du schéma demo", async () => {
    const pool = db.pool(appUrl);
    const err = await assertTenantIsolation({ pool, schemas: ["demo"], allowlist: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const report = (err as { report: { violations: Array<{ table: string; problem: string }> } }).report;
    const byTable = (t: string) => report.violations.filter((v) => v.table === t).map((v) => v.problem);
    expect(byTable("demo.items_legacy").join(" | ")).toMatch(/tenant_isolation|FORCE/);
    expect(byTable("demo.items_noforce").join(" | ")).toMatch(/FORCE/);
    expect(byTable("demo.items_v2")).toEqual([]);
  });
});
