/**
 * RATTRAPAGE des tenants legacy au démarrage de la plateforme v2 : complet, IDEMPOTENT (prouvé), sûr en
 * concurrence (deux instances de l'API qui démarrent ensemble), appliqué aussi à la création d'un tenant legacy.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noopLogger } from "@ecoledigitale/kernel";
import { buildPlatformDeps } from "../../src/modules/platform";
import { catchUpLegacyTenants, catchUpTenant, readCatchUpPolicy, type CatchUpPolicy } from "../../src/platform/legacy-catchup";
import { syncTenantToKernel } from "../../src/platform/tenant-sync";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, startPhase1Platform, type Phase1Env } from "./support/harness";
import { provisionByConsole } from "./support/scenario";

const L1 = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const L2 = "0192f0a4-7b1e-7c3a-8d2e-0000000000b2";
const L3 = "0192f0a4-7b1e-7c3a-8d2e-0000000000b3";

describe("politique de rattrapage (hypothèse de produit documentée)", () => {
  it("défauts : plan PROFESSIONAL, pack HIGHER, pays CI", () => {
    expect(readCatchUpPolicy({})).toEqual({ planKey: "PROFESSIONAL", pack: "HIGHER", countryCode: "CI" });
  });
  it("surchargeable par V2_LEGACY_TENANT_DEFAULT_PLAN / _PACK / _COUNTRY", () => {
    expect(readCatchUpPolicy({ V2_LEGACY_TENANT_DEFAULT_PLAN: "enterprise", V2_LEGACY_TENANT_DEFAULT_PACK: "secondary", V2_LEGACY_TENANT_DEFAULT_COUNTRY: "ci" })).toEqual({
      planKey: "ENTERPRISE",
      pack: "SECONDARY",
      countryCode: "CI",
    });
  });
  it("une valeur invalide REFUSE le démarrage (jamais de repli silencieux)", () => {
    expect(() => readCatchUpPolicy({ V2_LEGACY_TENANT_DEFAULT_PACK: "COLLEGE" })).toThrow(/V2_LEGACY_TENANT_DEFAULT_PACK/);
    expect(() => readCatchUpPolicy({ V2_LEGACY_TENANT_DEFAULT_PLAN: "pro fessionnel" })).toThrow(/V2_LEGACY_TENANT_DEFAULT_PLAN/);
    expect(() => readCatchUpPolicy({ V2_LEGACY_TENANT_DEFAULT_COUNTRY: "CIV" })).toThrow(/V2_LEGACY_TENANT_DEFAULT_COUNTRY/);
  });
});

describeIntegration.skipIf(!REDIS_URL)("rattrapage des tenants legacy (Postgres + Redis réels)", () => {
  let p: Phase1Env;
  const policy: CatchUpPolicy = { planKey: "PROFESSIONAL", pack: "HIGHER", countryCode: "CI" };

  const snapshot = async () => {
    const q = async (sql: string) => (await p.db.admin.query(sql)).rows[0].n as number;
    return {
      profiles: await q("SELECT count(*)::int AS n FROM tenancy.tenant_profiles"),
      institutions: await q("SELECT count(*)::int AS n FROM tenancy.institutions"),
      campuses: await q("SELECT count(*)::int AS n FROM tenancy.campuses"),
      onboarding: await q("SELECT count(*)::int AS n FROM tenancy.onboarding_steps"),
      roles: await q("SELECT count(*)::int AS n FROM rbac.roles"),
      subscriptions: await q("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions"),
    };
  };
  const deps = () => buildPlatformDeps(p.app, p.app.v2Runtime);

  beforeAll(async () => {
    p = await startPhase1Platform({
      startWorker: false,
      legacyTenants: [
        { id: L1, slug: "ecole-un", name: "École Un", is_active: true },
        { id: L2, slug: "ecole-deux", name: "École Deux (suspendue)", is_active: false },
        { id: L3, slug: "École Ñandú", name: "École Trois", is_active: true },
      ],
    });
  }, 240_000);
  afterAll(async () => {
    await p?.stop();
  });

  it("au démarrage : profil, UN établissement + campus par défaut, onboarding, 10 rôles système et abonnement pour chaque tenant", async () => {
    expect(p.status.catchUp).toBeDefined();
    expect(p.status.catchUp).toMatchObject({
      examined: 3,
      changed: 3,
      alreadyComplete: 0,
      failed: [],
      // Rôles : `syncRbac` (étape précédente du démarrage) a déjà instancié ceux des 2 tenants ACTIFS ; le rattrapage
      // complète le tenant suspendu (que `syncRbac` ne parcourt pas). Les 30 rôles sont vérifiés tenant par tenant.
      created: { profiles: 3, institutions: 3, campuses: 3, onboarding: 3, roles: 10, subscriptions: 3 },
    });

    for (const [id, name, status] of [[L1, "École Un", "active"], [L2, "École Deux (suspendue)", "suspended"], [L3, "École Trois", "active"]] as const) {
      const t = await p.db.admin.query("SELECT status FROM kernel.tenants WHERE id = $1", [id]);
      expect(t.rows[0].status).toBe(status);
      const profile = await p.db.admin.query("SELECT legal_name, country_code FROM tenancy.tenant_profiles WHERE tenant_id = $1", [id]);
      expect(profile.rows[0]).toEqual({ legal_name: name, country_code: "CI" });
      const inst = await p.db.admin.query("SELECT pack, country_code FROM tenancy.institutions WHERE tenant_id = $1", [id]);
      expect(inst.rows).toEqual([{ pack: "HIGHER", country_code: "CI" }]);
      const campus = await p.db.admin.query("SELECT is_default FROM tenancy.campuses WHERE tenant_id = $1", [id]);
      expect(campus.rows).toEqual([{ is_default: true }]);
      const steps = await p.db.admin.query("SELECT step_key, status FROM tenancy.onboarding_steps WHERE tenant_id = $1", [id]);
      expect(steps.rows).toHaveLength(11);
      expect(steps.rows.filter((s) => s.status === "COMPLETED").map((s) => s.step_key).sort()).toEqual(["ACCOUNT", "COUNTRY", "INSTITUTION", "INSTITUTION_TYPE", "PACK"]);
      const roles = await p.db.admin.query("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1 AND is_system", [id]);
      expect(roles.rows[0].n).toBe(10);
      const sub = await p.db.admin.query("SELECT plan_key, packs, status, ends_at FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [id]);
      expect(sub.rows).toEqual([{ plan_key: "PROFESSIONAL", packs: ["HIGHER"], status: "ACTIVE", ends_at: null }]);
    }
  });

  it("le tenant rattrapé a des droits effectifs (plan PROFESSIONAL + pack HIGHER) ; le suspendu n'a que CORE", async () => {
    const reader = p.app.v2Runtime.entitlements.reader;
    expect((await reader.getEntitlements(L1)).features).toContain("finance.online-payment");
    const suspended = await reader.getEntitlements(L2);
    expect(suspended.reason).toBe("TENANT_SUSPENDED");
    expect(suspended.features).not.toContain("finance.online-payment");
  });

  it("IDEMPOTENT : un second passage ne crée RIEN et ne change aucun compteur", async () => {
    const before = await snapshot();
    const again = await catchUpLegacyTenants(deps(), policy, noopLogger);
    expect(again).toMatchObject({
      examined: 3,
      changed: 0,
      alreadyComplete: 3,
      failed: [],
      created: { profiles: 0, institutions: 0, campuses: 0, onboarding: 0, roles: 0, subscriptions: 0 },
    });
    const third = await catchUpLegacyTenants(deps(), policy, noopLogger);
    expect(third.changed).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it("ne touche pas aux tenants provisionnés par la console (déjà complets) ni à un abonnement annulé", async () => {
    const T = await provisionByConsole(p, { name: "Console Co", slug: "consoleco", packs: ["PRIMARY"], ownerEmail: "o@consoleco.test" });
    const before = await snapshot();
    const report = await catchUpLegacyTenants(deps(), policy, noopLogger);
    expect(report.changed).toBe(0);
    expect(report.alreadyComplete).toBe(4);
    // Un abonnement annulé par l'opérateur n'est PAS recréé par le rattrapage.
    const cancel = await p.http("PUT", `/api/v1/platform/tenants/${T.tenantId}/subscription`, {
      token: p.operatorToken,
      body: { planKey: "STARTER", packs: ["PRIMARY"], status: "CANCELED" },
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const subsBefore = (await p.db.admin.query("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [T.tenantId])).rows[0].n;
    await catchUpTenant(deps(), T.tenantId, policy);
    expect((await p.db.admin.query("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [T.tenantId])).rows[0].n).toBe(subsBefore);
    expect(await snapshot()).toEqual({ ...before });
  });

  it("sûr en CONCURRENCE : deux instances qui rattrapent le même tenant neuf n'y créent aucun doublon ni erreur", async () => {
    const id = randomUUID();
    await p.db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, 'concurrent', 'École Concurrente')", [id]);
    const [a, b] = await Promise.all([catchUpTenant(deps(), id, policy), catchUpTenant(deps(), id, policy)]);
    expect(a.failed, JSON.stringify(a.failed)).toEqual([]);
    expect(b.failed, JSON.stringify(b.failed)).toEqual([]);
    const count = async (table: string) => (await p.db.admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [id])).rows[0].n;
    expect(await count("tenancy.tenant_profiles")).toBe(1);
    expect(await count("tenancy.institutions")).toBe(1);
    expect(await count("tenancy.campuses")).toBe(1);
    expect(await count("tenancy.onboarding_steps")).toBe(11);
    expect(await count("entitlements.tenant_subscriptions")).toBe(1);
    expect((await p.db.admin.query("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1 AND is_system", [id])).rows[0].n).toBe(10);
  });

  it("à la création d'un tenant legacy (tenant-sync) : le rattrapage s'applique sans attendre le prochain démarrage", async () => {
    const id = randomUUID();
    p.legacy.tenants.push({ id, slug: "nouveau-legacy", name: "Nouveau Legacy", is_active: true });
    expect(await syncTenantToKernel(id)).toBe("synced");
    const roles = await p.db.admin.query("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1 AND is_system", [id]);
    expect(roles.rows[0].n).toBe(10);
    const sub = await p.db.admin.query("SELECT plan_key FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [id]);
    expect(sub.rows).toEqual([{ plan_key: "PROFESSIONAL" }]);
  });
});
