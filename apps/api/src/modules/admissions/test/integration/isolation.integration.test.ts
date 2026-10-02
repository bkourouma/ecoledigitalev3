/**
 * Isolation (Postgres réel ; s'ignore sans TEST_DATABASE_URL) : `assertTenantIsolation` sur le schéma admissions (RLS forcée,
 * seule exception `public_form_index`), puis contrôle de CETTE exception : lecture ouverte (résolution du lien avant tout
 * contexte), écriture limitée au tenant propriétaire, aucune donnée personnelle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import allowlist from "../../../isolation-allowlist.admissions";
import { describeIntegration } from "../support/db";
import { createWorld, openPublicForm, type World } from "../support/world";

describeIntegration("admissions : isolation par tenant", () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld();
  });
  afterAll(async () => {
    await w?.close();
  });

  it("assertTenantIsolation : toutes les tables du schéma sont isolées, sauf public_form_index (justifiée)", async () => {
    expect(allowlist.map((e) => e.table)).toEqual(["admissions.public_form_index"]);
    expect(allowlist[0]!.reason.length).toBeGreaterThanOrEqual(20);
    const report = await assertTenantIsolation({ pool: w.db.appPool, schemas: ["admissions"], allowlist: allowlist.map((e) => e.table) });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
  });

  it("public_form_index : lecture ouverte, mais un tenant n'écrit, ne modifie ni ne supprime que SES lignes ; le slug est opaque (>= 96 bits)", async () => {
    const slugA = await openPublicForm(w.A);
    const slugB = await openPublicForm(w.B);
    expect(slugA).toMatch(/^[a-z0-9]{16,40}$/);
    expect(slugA.length * Math.log2(36)).toBeGreaterThan(96);
    // Le lien de A est lisible sans contexte de tenant (résolution du formulaire public)…
    const seen = await w.A.deps.systemDb!.run("test-lecture-ouverte", (tx) => tx.many("SELECT slug, tenant_id FROM admissions.public_form_index ORDER BY slug"), { readOnly: true });
    expect(seen.map((r) => r.slug)).toEqual(expect.arrayContaining([slugA, slugB]));
    // …mais B ne peut ni insérer au nom de A, ni modifier, ni supprimer le lien de A.
    await expect(w.B.deps.db.run(w.B.ctx(), (tx) => tx.query("INSERT INTO admissions.public_form_index (slug, tenant_id, institution_id) VALUES ($1, $2, $3)", ["z".repeat(26), w.A.id, w.A.institutionId]))).rejects.toThrow(/row-level security|sécurité/i);
    const updated = await w.B.deps.db.run(w.B.ctx(), (tx) => tx.query("UPDATE admissions.public_form_index SET enabled = false WHERE slug = $1", [slugA]));
    expect(updated.rowCount).toBe(0);
    const deleted = await w.B.deps.db.run(w.B.ctx(), (tx) => tx.query("DELETE FROM admissions.public_form_index WHERE slug = $1", [slugA]));
    expect(deleted.rowCount).toBe(0);
    const still = await w.db.admin.query("SELECT enabled FROM admissions.public_form_index WHERE slug = $1", [slugA]);
    expect(still.rows[0].enabled).toBe(true);
    // Aucune donnée personnelle : la table ne porte que slug, tenant, établissement, état.
    const cols = await w.db.admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'admissions' AND table_name = 'public_form_index' ORDER BY column_name");
    expect(cols.rows.map((r) => r.column_name)).toEqual(["created_at", "enabled", "institution_id", "slug", "tenant_id", "updated_at"]);
  });
});
