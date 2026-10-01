/**
 * Isolation multi-tenant du schéma iam : test générique d'ADR-002 + preuves
 * propres aux tables globales (annuaire en lecture seule, colonnes immuables).
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { checkTenantIsolation } from "@ecoledigitale/database";
import { IAM_ISOLATION_ALLOWLIST, IAM_ISOLATION_ALLOWLIST_TABLES } from "../../isolation-allowlist.iam";
import { createHarness, describeIntegration, meta, type Harness } from "./helpers";

describeIntegration("iam — isolation multi-tenant (Postgres réel)", () => {
  let h: Harness;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    h = await createHarness();
    tenantA = await h.createTenant("ecole-a", "École A");
    tenantB = await h.createTenant("ecole-b", "École B");
  });
  afterAll(async () => h.stop());

  it("test générique : toute table iam hors liste blanche a tenant_id NOT NULL + RLS forcée + isolation A/B", async () => {
    const report = await checkTenantIsolation({
      pool: h.pool,
      schemas: ["iam", "kernel"],
      allowlist: [...IAM_ISOLATION_ALLOWLIST_TABLES, "kernel.tenants"],
      // Valeurs pour les colonnes sous CHECK que le générateur ne peut pas deviner.
      fixtures: {
        "iam.identities": { email: (n: number) => `iso-${n}@exemple.ci` },
        "iam.memberships": { base_role: "teacher", roles: ["teacher"] },
        "iam.sessions": { active_role: "teacher" },
        "iam.login_challenges": { purpose: "login", active_role: "teacher", max_attempts: 5 },
        "kernel.domain_events": { type: "iam.test.isolation" },
      },
    });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    for (const t of ["iam.memberships", "iam.sessions", "iam.refresh_tokens", "iam.login_challenges"]) {
      expect([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]).toContain(t);
    }
    // eslint-disable-next-line no-console
    console.log("[iam] isolation comportementale :", report.behavioural.join(", ") || "(aucune)", "| structure seule :", report.structuralOnly.map((s) => `${s.table} (${s.reason})`).join("; ") || "(aucune)");
  });

  it("chaque entrée de la liste blanche est justifiée (texte non vide) et correspond à une table existante", async () => {
    for (const e of IAM_ISOLATION_ALLOWLIST) expect(e.justification.length).toBeGreaterThan(60);
    const rows = await h.admin.query(`SELECT schemaname || '.' || tablename AS t FROM pg_tables WHERE schemaname = 'iam'`);
    const existing = rows.rows.map((r: { t: string }) => r.t);
    for (const t of IAM_ISOLATION_ALLOWLIST_TABLES) expect(existing).toContain(t);
    // et aucune table du schéma n'échappe à la fois à la RLS et à la liste blanche
    const noRls = await h.admin.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'iam' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
    for (const r of noRls.rows) expect(IAM_ISOLATION_ALLOWLIST_TABLES).toContain(`iam.${r.relname}`);
  });

  it("l'annuaire iam.identity_tenants est alimenté par trigger et en LECTURE SEULE pour l'application", async () => {
    const a = await h.member(tenantA, "parent@exemple.ci", ["parent"]);
    await h.member(tenantB, "parent@exemple.ci", ["parent"]);
    const dir = await h.pool.query(`SELECT tenant_id FROM iam.identity_tenants WHERE identity_id = $1 ORDER BY tenant_id`, [a.identityId]);
    expect(dir.rows.map((r) => r.tenant_id).sort()).toEqual([tenantA, tenantB].sort());

    await expect(h.pool.query(`INSERT INTO iam.identity_tenants (identity_id, tenant_id) VALUES ($1, $2)`, [a.identityId, tenantA])).rejects.toThrow(/permission denied/);
    await expect(h.pool.query(`DELETE FROM iam.identity_tenants WHERE identity_id = $1`, [a.identityId])).rejects.toThrow(/permission denied/);
    await expect(h.pool.query(`UPDATE iam.identity_tenants SET tenant_id = $2 WHERE identity_id = $1`, [a.identityId, tenantA])).rejects.toThrow(/permission denied/);
  });

  it("colonnes immuables : identity_id / tenant_id d'un accès ne se modifient pas ; pas de DELETE d'identité", async () => {
    const m = await h.member(tenantA, "immuable@exemple.ci", ["teacher"]);
    await expect(
      h.tenantDb.run(h.ctx(tenantA), (tx) => tx.query(`UPDATE iam.memberships SET tenant_id = $2 WHERE id = $1`, [m.membershipId, tenantB])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      h.tenantDb.run(h.ctx(tenantA), (tx) => tx.query(`UPDATE iam.memberships SET identity_id = gen_random_uuid() WHERE id = $1`, [m.membershipId])),
    ).rejects.toThrow(/permission denied/);
    await expect(h.pool.query(`DELETE FROM iam.identities WHERE id = $1`, [m.identityId])).rejects.toThrow(/permission denied/);
  });

  it("sous le tenant A, les accès, sessions et refresh tokens du tenant B sont invisibles et intouchables", async () => {
    await h.member(tenantA, "a-user@exemple.ci", ["teacher"]);
    await h.member(tenantB, "b-user@exemple.ci", ["teacher"]);
    const login = await h.iam.login({ email: "b-user@exemple.ci", password: "Correct-Horse-Battery-9", tenantSlug: "ecole-b", meta: meta() });
    expect(login.ok && login.value.status).toBe("authenticated");

    const ctxA = h.ctx(tenantA);
    await h.tenantDb.run(ctxA, async (tx) => {
      expect((await tx.many(`SELECT id FROM iam.memberships WHERE tenant_id = $1`, [tenantB])).length).toBe(0);
      expect((await tx.many(`SELECT id FROM iam.sessions`)).length).toBe(0);
      expect((await tx.many(`SELECT id FROM iam.refresh_tokens`)).length).toBe(0);
      expect((await tx.query(`UPDATE iam.sessions SET revoked_at = now()`)).rowCount).toBe(0);
    });
    // Pas de DELETE accordé sur memberships : refus net, quel que soit le tenant.
    await expect(h.tenantDb.run(ctxA, (tx) => tx.query(`DELETE FROM iam.memberships`))).rejects.toThrow(/permission denied/);
    // Insertion « au nom » du tenant B depuis le contexte A : refusée par la RLS (WITH CHECK).
    await expect(
      h.tenantDb.run(ctxA, (tx) =>
        tx.query(
          `INSERT INTO iam.memberships (id, tenant_id, identity_id, base_role, roles, created_at, updated_at)
           SELECT gen_random_uuid(), $1, id, 'teacher', ARRAY['teacher'], now(), now() FROM iam.identities LIMIT 1`,
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("sans contexte tenant, les tables de tenant d'iam sont vides (échec fermé)", async () => {
    const rows = await h.systemDb.run("test-iam-sans-tenant", async (tx) => ({
      memberships: (await tx.many(`SELECT id FROM iam.memberships`)).length,
      sessions: (await tx.many(`SELECT id FROM iam.sessions`)).length,
      challenges: (await tx.many(`SELECT id FROM iam.login_challenges`)).length,
    }));
    expect(rows).toEqual({ memberships: 0, sessions: 0, challenges: 0 });
  });
});
