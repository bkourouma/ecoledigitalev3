import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantIsolationError, assertTenantIsolation, checkTenantIsolation } from "../src";
import { applyBaseline, createTestDb, describeIntegration, type TestDb } from "./helpers";

describeIntegration("assertTenantIsolation", () => {
  let db: TestDb;
  let appPool: ReturnType<TestDb["pool"]>;

  beforeAll(async () => {
    db = await createTestDb();
    await applyBaseline(db);
    appPool = db.pool((await db.createLogin("it_app", "app_user")).url, 2);

    await db.admin.query(`
      SET ROLE migrator;

      ---------------------------------------------------------------- schéma sain
      CREATE SCHEMA good AUTHORIZATION migrator;
      GRANT USAGE ON SCHEMA good TO app_user;
      ALTER DEFAULT PRIVILEGES IN SCHEMA good GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

      CREATE TABLE good.classes (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
        label varchar(12) NOT NULL,
        capacity int NOT NULL,
        open boolean NOT NULL DEFAULT true
      );
      SELECT kernel.enable_tenant_rls('good.classes');

      -- FK vers une autre table de tenant : le parent est fabriqué automatiquement.
      CREATE TABLE good.students (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
        class_id uuid NOT NULL REFERENCES good.classes(id),
        born date NOT NULL,
        meta jsonb NOT NULL,
        level text NOT NULL CHECK (level IN ('A','B'))   -- CHECK : valeur 'isoN' refusée -> structure seule
      );
      SELECT kernel.enable_tenant_rls('good.students');

      CREATE TYPE good.mood AS ENUM ('calm', 'angry');
      CREATE TABLE good.moods (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
        mood good.mood NOT NULL,
        tags text[] NOT NULL DEFAULT '{}'
      );
      SELECT kernel.enable_tenant_rls('good.moods');

      -- Type non fabricable : contrôle structurel seulement, et le rapport le dit.
      CREATE TABLE good.documents (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants(id),
        search tsvector NOT NULL
      );
      SELECT kernel.enable_tenant_rls('good.documents');

      -- Table globale légitime : doit figurer dans la liste blanche.
      CREATE TABLE good.countries (code text PRIMARY KEY, name text NOT NULL);

      ---------------------------------------------------------------- schéma fautif
      CREATE SCHEMA bad AUTHORIZATION migrator;
      GRANT USAGE ON SCHEMA bad TO app_user;
      ALTER DEFAULT PRIVILEGES IN SCHEMA bad GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

      -- 1. aucune RLS
      CREATE TABLE bad.no_rls (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      -- 2. ENABLE sans FORCE
      CREATE TABLE bad.no_force (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      CREATE INDEX ON bad.no_force (tenant_id);
      ALTER TABLE bad.no_force ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON bad.no_force
        USING (tenant_id = kernel.current_tenant_id()) WITH CHECK (tenant_id = kernel.current_tenant_id());
      -- 3. pas de colonne tenant_id
      CREATE TABLE bad.no_tenant_col (id uuid PRIMARY KEY, label text);
      -- 4. tenant_id nullable
      CREATE TABLE bad.nullable_tenant (id uuid PRIMARY KEY, tenant_id uuid);
      -- 5. échappatoire « super-admin » dans la policy
      CREATE TABLE bad.backdoor (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      CREATE INDEX ON bad.backdoor (tenant_id);
      ALTER TABLE bad.backdoor ENABLE ROW LEVEL SECURITY;
      ALTER TABLE bad.backdoor FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON bad.backdoor
        USING (tenant_id = kernel.current_tenant_id() OR current_setting('app.super_admin', true) = 'true')
        WITH CHECK (tenant_id = kernel.current_tenant_id());
      -- 6. policy étrangère en plus
      CREATE TABLE bad.extra_policy (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      CREATE INDEX ON bad.extra_policy (tenant_id);
      ALTER TABLE bad.extra_policy ENABLE ROW LEVEL SECURITY;
      ALTER TABLE bad.extra_policy FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON bad.extra_policy
        USING (tenant_id = kernel.current_tenant_id()) WITH CHECK (tenant_id = kernel.current_tenant_id());
      CREATE POLICY open_door ON bad.extra_policy USING (true);
      -- 7. fuite que le contrôle STRUCTUREL laisse passer : seul le contrôle comportemental la voit
      CREATE TABLE bad.leaky (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      CREATE INDEX ON bad.leaky (tenant_id);
      ALTER TABLE bad.leaky ENABLE ROW LEVEL SECURITY;
      ALTER TABLE bad.leaky FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON bad.leaky
        USING (kernel.current_tenant_id() IS NOT NULL AND tenant_id IS NOT NULL)
        WITH CHECK (tenant_id = kernel.current_tenant_id());
      -- 8. vue matérialisée
      CREATE MATERIALIZED VIEW bad.snapshot AS SELECT 1 AS x;
      -- 9. pas d'index sur tenant_id
      CREATE TABLE bad.no_index (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
      ALTER TABLE bad.no_index ENABLE ROW LEVEL SECURITY;
      ALTER TABLE bad.no_index FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON bad.no_index
        USING (tenant_id = kernel.current_tenant_id()) WITH CHECK (tenant_id = kernel.current_tenant_id());

      RESET ROLE;
    `);
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("la baseline kernel (outbox comprise) passe, kernel.tenants étant en liste blanche", async () => {
    const report = await assertTenantIsolation({
      pool: appPool,
      schemas: ["kernel"],
      allowlist: ["kernel.tenants"],
      // Le CHECK sur `type` exige `domaine.evenement` : valeur que le générateur ne peut pas deviner.
      fixtures: { "kernel.domain_events": { type: "isolation.check", occurred_at: () => new Date().toISOString() } },
    });
    expect(report.role).toMatch(/^it_app_/);
    expect(report.behavioural).toContain("kernel.domain_events");
    expect(report.allowlisted).toEqual(["kernel.tenants"]);
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
  });

  it("sans fixtures, une table sous CHECK est honnêtement rapportée « structure seule » avec la raison", async () => {
    const report = await assertTenantIsolation({ pool: appPool, schemas: ["kernel"], allowlist: ["kernel.tenants"] });
    expect(report.behavioural).not.toContain("kernel.domain_events");
    const entry = report.structuralOnly.find((s) => s.table === "kernel.domain_events");
    expect(entry?.reason).toMatch(/check|CHECK/);
  });

  it("sans liste blanche, la table globale kernel.tenants est refusée", async () => {
    const err = await assertTenantIsolation({ pool: appPool, schemas: ["kernel"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantIsolationError);
    const v = (err as TenantIsolationError).report.violations;
    expect(v.map((x) => x.table)).toContain("kernel.tenants");
    expect(v.find((x) => x.table === "kernel.tenants")?.problem).toMatch(/tenant_id absente/);
    expect((err as Error).message).toMatch(/kernel\.tenants/);
  });

  it("schéma sain : tables fabricables testées pour de vrai (FK, enum, varchar, tableaux), les autres déclarées « structure seule »", async () => {
    const report = await assertTenantIsolation({
      pool: appPool,
      schemas: ["good"],
      allowlist: ["good.countries"],
    });
    expect(report.violations).toEqual([]);
    expect(report.behavioural.sort()).toEqual(["good.classes", "good.moods"]);

    const structural = Object.fromEntries(report.structuralOnly.map((s) => [s.table, s.reason]));
    expect(Object.keys(structural).sort()).toEqual(["good.documents", "good.students"]);
    expect(structural["good.documents"]).toMatch(/non fabricable/);
    expect(structural["good.students"]).toMatch(/CHECK|check|interrompu|impossible|violates/i);
  });

  it("détecte chacune des neuf fautes, avec une raison précise", async () => {
    const report = await checkTenantIsolation({ pool: appPool, schemas: ["bad"] });
    const problems = (t: string) => report.violations.filter((v) => v.table === `bad.${t}`).map((v) => v.problem).join(" | ");

    expect(problems("no_rls")).toMatch(/non activée/);
    expect(problems("no_rls")).toMatch(/FORCE/);
    expect(problems("no_rls")).toMatch(/aucune policy/);
    expect(problems("no_force")).toMatch(/FORCE ROW LEVEL SECURITY absent/);
    expect(problems("no_tenant_col")).toMatch(/tenant_id absente/);
    expect(problems("nullable_tenant")).toMatch(/NOT NULL/);
    expect(problems("backdoor")).toMatch(/USING de tenant_isolation inattendu/);
    expect(problems("extra_policy")).toMatch(/policy étrangère "open_door"/);
    expect(problems("leaky")).toMatch(/FUITE : le tenant B lit/);
    expect(problems("no_index")).toMatch(/index/);
    expect(report.violations.find((v) => v.table === "bad.snapshot")?.problem).toMatch(/vue matérialisée/);

    // Chaque table fautive est bien dans le rapport.
    const tables = new Set(report.violations.map((v) => v.table));
    for (const t of ["no_rls", "no_force", "no_tenant_col", "nullable_tenant", "backdoor", "extra_policy", "leaky", "snapshot", "no_index"]) {
      expect(tables.has(`bad.${t}`), t).toBe(true);
    }
  });

  it("la fuite comportementale (leaky) est invisible au contrôle structurel : preuve de l'utilité du test réel", async () => {
    const report = await checkTenantIsolation({ pool: appPool, schemas: ["bad"] });
    const leaky = report.violations.filter((v) => v.table === "bad.leaky");
    expect(leaky.length).toBeGreaterThan(0);
    // Aucun grief structurel : uniquement des fuites MESURÉES (lecture, puis écriture).
    expect(leaky.map((v) => v.problem).filter((p) => !/^(FUITE|ÉCRITURE|les lignes de A ont disparu)/.test(p))).toEqual([]);
    expect(leaky.some((v) => /^FUITE : le tenant B lit/.test(v.problem))).toBe(true);
  });

  it("signale une entrée de liste blanche périmée", async () => {
    const report = await checkTenantIsolation({
      pool: appPool,
      schemas: ["good"],
      allowlist: ["good.countries", "good.table_supprimee"],
    });
    expect(report.staleAllowlist).toEqual(["good.table_supprimee"]);
  });

  it("ne laisse aucune donnée derrière lui", async () => {
    await assertTenantIsolation({ pool: appPool, schemas: ["good"], allowlist: ["good.countries"] });
    for (const t of ["good.classes", "good.moods", "kernel.tenants", "kernel.domain_events"]) {
      const n = (await db.admin.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
      expect(n, t).toBe(0);
    }
  });

  it("rend la connexion au pool même en cas d'échec (pool de 1)", async () => {
    const single = db.pool((await db.createLogin("it_app1", "app_user")).url, 1);
    await expect(assertTenantIsolation({ pool: single, schemas: ["bad"] })).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(assertTenantIsolation({ pool: single, schemas: ["good"], allowlist: ["good.countries"] })).resolves.toBeDefined();
  });
});
