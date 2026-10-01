/**
 * Le port `AuditRecorder` de tenancy est compatible avec le VRAI `AuditService` du module `audit` :
 * les opérations sensibles s'inscrivent dans la même transaction que la donnée.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ManualClock, createRequestContext, newId } from "@ecoledigitale/kernel";
import { createAuditService } from "../../audit";
import { createInstitution, provisionTenant, updateTenantProfile, type TenancyDeps } from "../index";
import { AUDIT_MIGRATIONS, TENANCY_MIGRATIONS, createTestDb, describeIntegration, type TestDb } from "./support/db";

describeIntegration("tenancy — branchement du module audit", () => {
  let db: TestDb;
  let deps: TenancyDeps;

  beforeAll(async () => {
    db = await createTestDb([AUDIT_MIGRATIONS, TENANCY_MIGRATIONS]);
    const clock = new ManualClock("2026-10-01T08:00:00.000Z");
    deps = { db: db.tenantDb, clock, audit: createAuditService({ clock }) };
  });

  afterAll(async () => {
    await db?.drop();
  });

  it("provisioning, création d'établissement et mise à jour du profil sont audités, dans la même transaction", async () => {
    const r = await provisionTenant(deps, {
      name: "Org Audit",
      slug: "org-audit",
      countryCode: "CI",
      packs: ["PRIMARY"],
      adminContact: { name: "Awa Koné", email: "a@audit.ci" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const ctx = createRequestContext({ tenantId: r.value.tenantId, userId: newId() });
    expect((await createInstitution(deps, ctx, { name: "Lycée Audit", pack: "SECONDARY" })).ok).toBe(true);
    expect((await updateTenantProfile(deps, ctx, { tradeName: "Audit & Co" })).ok).toBe(true);

    const rows = (
      await db.admin.query("SELECT action, entity FROM audit.audit_log WHERE tenant_id = $1 ORDER BY seq", [r.value.tenantId])
    ).rows;
    expect(rows).toEqual([
      { action: "tenancy.tenant.provision", entity: "tenant" },
      { action: "tenancy.institution.create", entity: "institution" },
      { action: "tenancy.profile.update", entity: "tenant_profile" },
    ]);
  });

  it("un échec annule aussi l'audit (rien n'est inscrit pour une opération refusée)", async () => {
    const before = Number((await db.admin.query("SELECT count(*)::int AS n FROM audit.audit_log")).rows[0].n);
    const dup = await provisionTenant(deps, {
      name: "Doublon",
      slug: "org-audit",
      countryCode: "CI",
      packs: ["PRIMARY"],
      adminContact: { name: "Awa Koné", email: "a@audit.ci" },
    });
    expect(dup.ok).toBe(false);
    expect(Number((await db.admin.query("SELECT count(*)::int AS n FROM audit.audit_log")).rows[0].n)).toBe(before);
  });
});
