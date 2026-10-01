import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureTenantSync,
  disambiguateSlug,
  legacyRowToKernelTenant,
  normalizeKernelSlug,
  syncAllTenantsToKernel,
  syncTenantToKernel,
  upsertKernelTenant,
} from "../src/platform/tenant-sync";

const ID = "0192f0a4-7b1e-7c3a-8d2e-3f4a5b6c7d8e";
const KERNEL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

afterEach(() => configureTenantSync(null));

describe("normalisation des slugs legacy vers kernel.tenants", () => {
  it("laisse intact un slug déjà conforme", () => {
    expect(normalizeKernelSlug("imhotepacademy", ID)).toBe("imhotepacademy");
    expect(normalizeKernelSlug("ecole-digitale-2", ID)).toBe("ecole-digitale-2");
  });

  it("normalise majuscules, accents, espaces et caractères interdits", () => {
    expect(normalizeKernelSlug("École Saint_Jean!", ID)).toBe("ecole-saint-jean");
    expect(normalizeKernelSlug("--ASPCI--", ID)).toBe("aspci");
  });

  it("retombe sur un slug dérivé de l'UUID quand rien d'exploitable ne reste", () => {
    for (const bad of ["", "a", "!!!", "---", "é"]) {
      const slug = normalizeKernelSlug(bad, ID);
      expect(slug).toBe("t-0192f0a4");
      expect(slug).toMatch(KERNEL_SLUG_RE);
    }
  });

  it("tronque à 50 caractères sans terminer par un tiret", () => {
    const slug = normalizeKernelSlug(`${"a".repeat(48)}-bbbb`, ID);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug).toMatch(KERNEL_SLUG_RE);
  });

  it("produit toujours un slug valide (échantillon varié)", () => {
    for (const input of ["x".repeat(200), "a b c", "ÀÉÎÕÜ", "tenant.name", "-", "_underscore_", "UPPER"]) {
      expect(normalizeKernelSlug(input, ID)).toMatch(KERNEL_SLUG_RE);
    }
  });

  it("disambiguateSlug suffixe par l'UUID et reste valide même pour une base longue", () => {
    const slug = disambiguateSlug("a".repeat(50), ID);
    expect(slug).toMatch(KERNEL_SLUG_RE);
    expect(slug.endsWith("-0192f0a4")).toBe(true);
  });

  it("convertit une ligne legacy (is_active -> status)", () => {
    expect(legacyRowToKernelTenant({ id: ID.toUpperCase(), slug: "Demo", name: " Démo ", is_active: true })).toEqual({
      id: ID,
      slug: "demo",
      name: "Démo",
      status: "active",
    });
    expect(legacyRowToKernelTenant({ id: ID, slug: "demo", name: "x", is_active: false }).status).toBe("suspended");
    expect(legacyRowToKernelTenant({ id: ID, slug: "demo", name: "x", is_active: null }).status).toBe("active");
    expect(legacyRowToKernelTenant({ id: ID, slug: "demo", name: "  ", is_active: true }).name).toBe("demo");
  });
});

// ---------------------------------------------------------------------------

function fakeSystemDb() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const state = { failSlugOnce: false };
  const tx: any = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (state.failSlugOnce) {
        state.failSlugOnce = false;
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      return { rows: [], rowCount: 1 };
    }),
    transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  };
  const systemDb = { run: vi.fn(async (_reason: string, fn: (t: unknown) => unknown) => fn(tx)) };
  return { systemDb: systemDb as never, queries, state, tx };
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("upsertKernelTenant", () => {
  it("réessaie avec un slug suffixé quand le slug est déjà pris par un autre tenant", async () => {
    const { tx, state, queries } = fakeSystemDb();
    state.failSlugOnce = true;
    const result = await upsertKernelTenant(tx, { id: ID, slug: "demo", name: "Démo", status: "active" });
    expect(result).toEqual({ slug: "demo-0192f0a4", disambiguated: true });
    expect(queries).toHaveLength(2);
    expect(queries[1]?.params[1]).toBe("demo-0192f0a4");
  });

  it("propage les erreurs qui ne sont pas des collisions de slug", async () => {
    const { tx } = fakeSystemDb();
    tx.query.mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "42501" }));
    await expect(upsertKernelTenant(tx, { id: ID, slug: "demo", name: "x", status: "active" })).rejects.toThrow(/permission denied/);
  });

  it("ne désarchive jamais un tenant archivé côté v2 (SQL)", async () => {
    const { tx, queries } = fakeSystemDb();
    await upsertKernelTenant(tx, { id: ID, slug: "demo", name: "x", status: "active" });
    expect(queries[0]?.sql).toMatch(/status = 'archived' THEN 'archived'/);
    expect(queries[0]?.sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
  });
});

describe("syncTenantToKernel", () => {
  it("est sans effet tant que la plateforme v2 n'est pas configurée", async () => {
    const source = { query: vi.fn() };
    expect(await syncTenantToKernel(ID, { source })).toBe("skipped");
    expect(source.query).not.toHaveBeenCalled();
  });

  it("lit la ligne via la source fournie (transaction legacy en cours) et l'écrit dans kernel.tenants", async () => {
    const { systemDb, queries } = fakeSystemDb();
    configureTenantSync({ systemDb, logger: logger() });
    const source = { query: vi.fn(async () => ({ rows: [{ id: ID, slug: "Demo", name: "Démo", is_active: false }] })) };

    expect(await syncTenantToKernel(ID, { source })).toBe("synced");
    expect(source.query).toHaveBeenCalledWith(expect.stringContaining("public.tenants"), [ID]);
    expect(queries[0]?.params).toEqual([ID, "demo", "Démo", "suspended"]);
  });

  it("ne lève jamais : une panne v2 n'empêche pas le provisioning legacy", async () => {
    const log = logger();
    const systemDb = { run: vi.fn().mockRejectedValue(new Error("connexion refusée")) } as never;
    configureTenantSync({ systemDb, logger: log });
    const source = { query: vi.fn(async () => ({ rows: [{ id: ID, slug: "demo", name: "x", is_active: true }] })) };

    expect(await syncTenantToKernel(ID, { source })).toBe("failed");
    expect(log.error).toHaveBeenCalled();
    await expect(syncTenantToKernel(ID, { source, strict: true })).rejects.toThrow(/connexion refusée/);
  });

  it("ignore (sans erreur) un tenant absent de public.tenants", async () => {
    const { systemDb } = fakeSystemDb();
    const log = logger();
    configureTenantSync({ systemDb, logger: log });
    expect(await syncTenantToKernel(ID, { source: { query: async () => ({ rows: [] }) } })).toBe("skipped");
    expect(log.warn).toHaveBeenCalled();
  });

  it("utilise le pool legacy configuré quand aucune source n'est donnée, et le libère", async () => {
    const { systemDb } = fakeSystemDb();
    const release = vi.fn();
    const client = { query: vi.fn(async () => ({ rows: [{ id: ID, slug: "demo", name: "x", is_active: true }] })), release };
    configureTenantSync({ systemDb, logger: logger(), legacyPool: { connect: async () => client } });
    expect(await syncTenantToKernel(ID)).toBe("synced");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("syncAllTenantsToKernel", () => {
  it("synchronise tous les tenants dans UNE transaction système et signale les slugs désambiguïsés", async () => {
    const { systemDb, queries, state } = fakeSystemDb();
    const log = logger();
    configureTenantSync({ systemDb, logger: log });
    const rows = [
      { id: ID, slug: "a", name: "A", is_active: true },
      { id: "0192f0a4-7b1e-7c3a-8d2e-bbbbbbbbbbbb", slug: "b", name: "B", is_active: true },
    ];
    state.failSlugOnce = true; // la première insertion entre en collision
    const report = await syncAllTenantsToKernel({ query: async () => ({ rows }) });
    expect(report).toEqual({ total: 2, disambiguated: 1 });
    expect((systemDb as any).run).toHaveBeenCalledTimes(1);
    expect(queries.length).toBe(3);
  });

  it("ne fait rien quand la plateforme n'est pas configurée", async () => {
    expect(await syncAllTenantsToKernel({ query: vi.fn() as never })).toEqual({ total: 0, disambiguated: 0 });
  });
});
