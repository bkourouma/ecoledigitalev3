/**
 * Deux instances de l'API qui démarrent EN MÊME TEMPS sur la même base (déploiement à N réplicas, redémarrage
 * simultané) : synchronisation des tenants, du catalogue de permissions, des rôles système, des features et
 * rattrapage legacy doivent se sérialiser sans erreur ni doublon.
 */
import { expect, it } from "vitest";
import { configureTenantSync } from "../../src/platform/tenant-sync";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, bootInstance, flushQueuePrefix, prepareInfra } from "./support/harness";

const TENANTS = [
  { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000d1", slug: "un", name: "Un", is_active: true },
  { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000d2", slug: "deux", name: "Deux", is_active: true },
  { id: "0192f0a4-7b1e-7c3a-8d2e-0000000000d3", slug: "trois", name: "Trois", is_active: false },
];

describeIntegration.skipIf(!REDIS_URL)("démarrage simultané de deux instances de l'API", () => {
  it("aucune erreur, aucun doublon : mêmes invariants qu'avec une seule instance", async () => {
    const infra = await prepareInfra({ legacyTenants: TENANTS });
    try {
      const [one, two] = await Promise.all([bootInstance(infra), bootInstance(infra)]);
      expect(one.status.enabled && two.status.enabled).toBe(true);
      const failed = [...(one.status.catchUp?.failed ?? []), ...(two.status.catchUp?.failed ?? [])];
      expect(failed, JSON.stringify(failed)).toEqual([]);

      const n = async (sql: string, ...params: unknown[]) => (await infra.db.admin.query(sql, params)).rows[0].n as number;
      expect(await n("SELECT count(*)::int AS n FROM kernel.tenants")).toBe(3);
      for (const t of TENANTS) {
        expect(await n("SELECT count(*)::int AS n FROM tenancy.tenant_profiles WHERE tenant_id = $1", t.id)).toBe(1);
        expect(await n("SELECT count(*)::int AS n FROM tenancy.institutions WHERE tenant_id = $1", t.id)).toBe(1);
        expect(await n("SELECT count(*)::int AS n FROM tenancy.campuses WHERE tenant_id = $1", t.id)).toBe(1);
        expect(await n("SELECT count(*)::int AS n FROM tenancy.onboarding_steps WHERE tenant_id = $1", t.id)).toBe(11);
        expect(await n("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1 AND is_system", t.id)).toBe(10);
        expect(await n("SELECT count(*)::int AS n FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", t.id)).toBe(1);
      }
      // Catalogues : une ligne par permission / feature déclarée, partagées par les deux instances.
      const manifests = one.app.v2.manifests;
      expect(await n("SELECT count(*)::int AS n FROM rbac.permissions WHERE retired_at IS NULL")).toBe(manifests.reduce((s, m) => s + m.permissions.length, 0));
      expect(await n("SELECT count(*)::int AS n FROM entitlements.features WHERE retired_at IS NULL")).toBe(manifests.reduce((s, m) => s + m.features.length, 0));
      await Promise.all([one.app.close(), two.app.close()]);
    } finally {
      configureTenantSync(null);
      await flushQueuePrefix(infra.queuePrefix);
      await infra.db.drop();
      infra.restoreEnv();
    }
  }, 240_000);
});
