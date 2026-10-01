/**
 * Arbre des périmètres (tenancy -> rbac) et sélecteurs de périmètre des routes : purs, sans base.
 */
import { describe, expect, it, vi } from "vitest";
import { ManualClock } from "@ecoledigitale/kernel";
import { buildScopeTree, createTenancyScopeTreeProvider } from "../application/scope-tree";
import { scopeFromIdParam } from "../http/common";

const INSTITUTION = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const CAMPUS_1 = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const CAMPUS_2 = "0192f0a4-7b1e-7c3a-8d2e-0000000000b2";
const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000c1";

describe("buildScopeTree", () => {
  const tree = buildScopeTree([{ id: CAMPUS_1, institutionId: INSTITUTION }, { id: CAMPUS_2.toUpperCase(), institutionId: INSTITUTION }], [INSTITUTION]);
  it("relie chaque campus à son établissement (insensible à la casse)", () => {
    expect(tree.institutionOfCampus(CAMPUS_1)).toBe(INSTITUTION);
    expect(tree.institutionOfCampus(CAMPUS_2)).toBe(INSTITUTION);
    expect(tree.institutionOfCampus("0192f0a4-7b1e-7c3a-8d2e-0000000000ff")).toBeUndefined();
  });
  it("sait quels périmètres existent : tenant toujours, établissement et campus seulement s'ils sont connus", () => {
    expect(tree.knows({ type: "tenant" })).toBe(true);
    expect(tree.knows({ type: "institution", id: INSTITUTION })).toBe(true);
    expect(tree.knows({ type: "campus", id: CAMPUS_1 })).toBe(true);
    expect(tree.knows({ type: "campus", id: "0192f0a4-7b1e-7c3a-8d2e-0000000000ff" })).toBe(false);
    expect(tree.knows({ type: "institution", id: "0192f0a4-7b1e-7c3a-8d2e-0000000000ff" })).toBe(false);
    expect(tree.knows({ type: "campus" })).toBe(false);
  });
});

describe("createTenancyScopeTreeProvider : instantané court, invalidable", () => {
  function fakeDb() {
    const calls = { n: 0 };
    const db = {
      run: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
        calls.n += 1;
        return fn({
          many: async (sql: string) => (sql.includes("campuses") ? [{ id: CAMPUS_1, institution_id: INSTITUTION }] : [{ id: INSTITUTION }]),
        });
      },
    };
    return { db: db as never, calls };
  }

  it("lit la base une fois par TTL, relit après expiration ou invalidation", async () => {
    const clock = new ManualClock(new Date("2026-10-01T10:00:00Z"));
    const { db, calls } = fakeDb();
    const provider = createTenancyScopeTreeProvider(db, { ttlMs: 5_000, clock });
    expect((await provider.forTenant(TENANT)).institutionOfCampus(CAMPUS_1)).toBe(INSTITUTION);
    await provider.forTenant(TENANT);
    await provider.forTenant(TENANT.toUpperCase());
    expect(calls.n).toBe(1);

    provider.invalidate(TENANT);
    await provider.forTenant(TENANT);
    expect(calls.n).toBe(2);

    clock.advance(5_001);
    await provider.forTenant(TENANT);
    expect(calls.n).toBe(3);
  });

  it("des appels concurrents partagent une seule lecture ; un instantané invalidé pendant la lecture n'est pas mémorisé", async () => {
    const { db, calls } = fakeDb();
    const provider = createTenancyScopeTreeProvider(db, { ttlMs: 60_000 });
    await Promise.all([provider.forTenant(TENANT), provider.forTenant(TENANT), provider.forTenant(TENANT)]);
    expect(calls.n).toBe(1);

    const slow = createTenancyScopeTreeProvider(
      { run: async (_c: unknown, fn: (tx: unknown) => Promise<unknown>) => (await new Promise((r) => setTimeout(r, 20)), fn({ many: async () => [] })) } as never,
      { ttlMs: 60_000 },
    );
    const pending = slow.forTenant(TENANT);
    slow.invalidate(TENANT); // la structure a changé pendant la lecture
    await pending;
    const spy = vi.fn();
    const second = createTenancyScopeTreeProvider({ run: async (_c: unknown, fn: (tx: unknown) => Promise<unknown>) => (spy(), fn({ many: async () => [] })) } as never);
    await second.forTenant(TENANT);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("scopeFromIdParam : périmètre d'une ressource désignée par :id", () => {
  const request = (id: unknown) => ({ params: { id } }) as never;
  it("campus / établissement : l'identifiant de l'URL, en minuscules", () => {
    expect(scopeFromIdParam("campus")(request(CAMPUS_1.toUpperCase()))).toEqual({ type: "campus", id: CAMPUS_1 });
    expect(scopeFromIdParam("institution")(request(INSTITUTION))).toEqual({ type: "institution", id: INSTITUTION });
  });
  it("identifiant absent ou invalide : périmètre TENANT (le plus strict), jamais une exception dans la garde", () => {
    for (const id of [undefined, "", "pas-un-uuid", 42, "../../etc/passwd"]) {
      expect(scopeFromIdParam("campus")(request(id)), String(id)).toEqual({ type: "tenant" });
    }
    expect(scopeFromIdParam("campus")({ params: undefined } as never)).toEqual({ type: "tenant" });
  });
});
