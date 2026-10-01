import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus, ManualClock, createDomainEvent, type DomainEvent } from "@ecoledigitale/kernel";
import {
  PermissionSetCache,
  RBAC_ASSIGNMENT_CHANGED,
  RBAC_ROLE_CHANGED,
  emptyPermissionSet,
  subscribeCacheInvalidation,
} from "../index";
import { diffPermissions, missingPermissions, slugifyRoleKey, uniqueRoleKey } from "../domain/role-rules";
import { ROLE_KEY_RE } from "../domain/system-roles";
import { NOW, T1, T2, U1, U2, authFor, ctxFor } from "./fixtures";

describe("clés de rôles", () => {
  it("slugifyRoleKey : accents retirés, snake_case, longueur bornée", () => {
    expect(slugifyRoleKey("Directeur des études")).toBe("directeur_des_etudes");
    expect(slugifyRoleKey("  Comptable  (Junior) ")).toBe("comptable_junior");
    expect(slugifyRoleKey("Élève-référent")).toBe("eleve_referent");
    expect(slugifyRoleKey("2024 Bureau")).toBe("role_2024_bureau");
    expect(slugifyRoleKey("A")).toBe("a_role");
    expect(slugifyRoleKey("!!!")).toBe("role");
    expect(slugifyRoleKey("x".repeat(200)).length).toBeLessThanOrEqual(62);
    for (const label of ["Directeur des études", "A", "!!!", "x".repeat(200), "Ça va ?", "日本語"]) {
      expect(ROLE_KEY_RE.test(slugifyRoleKey(label)), label).toBe(true);
    }
  });

  it("uniqueRoleKey : suffixe _2, _3… sans dépasser 63 caractères", () => {
    expect(uniqueRoleKey("comptable", new Set())).toBe("comptable");
    expect(uniqueRoleKey("comptable", new Set(["comptable"]))).toBe("comptable_2");
    expect(uniqueRoleKey("comptable", new Set(["comptable", "comptable_2"]))).toBe("comptable_3");
    const long = "a".repeat(62);
    const k = uniqueRoleKey(long, new Set([long]));
    expect(k.length).toBeLessThanOrEqual(63);
    expect(k.endsWith("_2")).toBe(true);
    expect(ROLE_KEY_RE.test(k)).toBe(true);
  });
});

describe("anti-escalade et différences", () => {
  it("missingPermissions : ce que l'acteur ne détient pas lui-même", () => {
    const actor = authFor([{ permissions: ["grade.read", "grade.enter"] }]);
    expect(missingPermissions(actor, ["grade.read", "grade.publish", "finance.invoice.read"], "any")).toEqual([
      "finance.invoice.read",
      "grade.publish",
    ]);
    expect(missingPermissions(actor, [], "any")).toEqual([]);
  });

  it("une permission sensible détenue mais sans MFA compte comme manquante", () => {
    const actor = authFor([{ permissions: ["grade.publish"] }], { sensitive: ["grade.publish"], mfa: false });
    expect(missingPermissions(actor, ["grade.publish"], "any")).toEqual(["grade.publish"]);
    const withMfa = authFor([{ permissions: ["grade.publish"] }], { sensitive: ["grade.publish"], mfa: true });
    expect(missingPermissions(withMfa, ["grade.publish"], "any")).toEqual([]);
  });

  it("diffPermissions", () => {
    expect(diffPermissions(["a.b", "c.d"], ["c.d", "e.f"])).toEqual({ added: ["e.f"], removed: ["a.b"] });
    expect(diffPermissions([], [])).toEqual({ added: [], removed: [] });
  });
});

describe("PermissionSetCache", () => {
  const set = (userId = U1) => emptyPermissionSet(T1, userId, NOW);

  it("sert depuis le cache jusqu'à l'expiration du TTL", () => {
    const clock = new ManualClock("2026-10-01T12:00:00Z");
    const cache = new PermissionSetCache({ ttlMs: 1000, clock });
    cache.set(T1, U1, set());
    expect(cache.get(T1, U1)).toBeDefined();
    clock.advance(999);
    expect(cache.get(T1, U1)).toBeDefined();
    clock.advance(1);
    expect(cache.get(T1, U1)).toBeUndefined();
    expect(cache.entryCount).toBe(0);
  });

  it("isole les tenants et les utilisateurs, insensible à la casse des UUID", () => {
    const cache = new PermissionSetCache();
    cache.set(T1, U1, set());
    expect(cache.get(T2, U1)).toBeUndefined();
    expect(cache.get(T1, U2)).toBeUndefined();
    expect(cache.get(T1.toUpperCase(), U1.toUpperCase())).toBeDefined();
  });

  it("invalidateUser n'enlève que cet utilisateur ; invalidateTenant enlève tout le tenant seulement", () => {
    const cache = new PermissionSetCache();
    cache.set(T1, U1, set(U1));
    cache.set(T1, U2, set(U2));
    cache.set(T2, U1, emptyPermissionSet(T2, U1, NOW));
    cache.invalidateUser(T1, U1);
    expect(cache.get(T1, U1)).toBeUndefined();
    expect(cache.get(T1, U2)).toBeDefined();
    cache.invalidateTenant(T1);
    expect(cache.get(T1, U2)).toBeUndefined();
    expect(cache.get(T2, U1)).toBeDefined();
    expect(cache.entryCount).toBe(1);
    cache.clear();
    expect(cache.entryCount).toBe(0);
  });

  it("getOrLoad : un seul chargement pour des appels concurrents (single-flight)", async () => {
    const cache = new PermissionSetCache();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return set();
    };
    const [a, b, c] = await Promise.all([cache.getOrLoad(T1, U1, loader), cache.getOrLoad(T1, U1, loader), cache.getOrLoad(T1, U1, loader)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    await cache.getOrLoad(T1, U1, loader);
    expect(calls).toBe(1); // servi par le cache
  });

  it("une invalidation PENDANT le chargement empêche de mémoriser un résultat périmé", async () => {
    const cache = new PermissionSetCache();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stale = set();
    const first = cache.getOrLoad(T1, U1, async () => {
      await gate;
      return stale;
    });
    cache.invalidateUser(T1, U1); // un droit vient de changer
    release();
    expect(await first).toBe(stale); // l'appelant en cours reçoit son résultat…
    expect(cache.get(T1, U1)).toBeUndefined(); // …mais il n'est PAS mémorisé

    const fresh = set();
    expect(await cache.getOrLoad(T1, U1, async () => fresh)).toBe(fresh);
  });

  it("une invalidation de tenant pendant un chargement a le même effet", async () => {
    const cache = new PermissionSetCache();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = cache.getOrLoad(T1, U1, async () => {
      await gate;
      return set();
    });
    cache.invalidateTenant(T1);
    release();
    await p;
    expect(cache.get(T1, U1)).toBeUndefined();
  });

  it("un chargement en échec n'est pas mémorisé et peut être rejoué", async () => {
    const cache = new PermissionSetCache();
    await expect(cache.getOrLoad(T1, U1, async () => Promise.reject(new Error("db down")))).rejects.toThrow("db down");
    const ok = set();
    expect(await cache.getOrLoad(T1, U1, async () => ok)).toBe(ok);
  });

  it("ttl 0 désactive le cache ; borne le nombre d'entrées", async () => {
    const off = new PermissionSetCache({ ttlMs: 0 });
    off.set(T1, U1, set());
    expect(off.get(T1, U1)).toBeUndefined();

    const small = new PermissionSetCache({ maxEntries: 2 });
    small.set(T1, U1, set(U1));
    small.set(T1, U2, set(U2));
    small.set(T2, U1, emptyPermissionSet(T2, U1, NOW));
    expect(small.entryCount).toBe(2);
    expect(small.get(T2, U1)).toBeDefined();
  });

  it("refuse un TTL négatif", () => {
    expect(() => new PermissionSetCache({ ttlMs: -1 })).toThrow(RangeError);
  });

  it("subscribeCacheInvalidation : rbac.assignment.changed invalide l'utilisateur, rbac.role.changed le tenant", async () => {
    const bus = new InMemoryEventBus();
    const cache = new PermissionSetCache();
    const off = subscribeCacheInvalidation(bus, cache);
    const ctx = ctxFor();
    cache.set(T1, U1, set(U1));
    cache.set(T1, U2, set(U2));

    await bus.publish(
      createDomainEvent({ type: RBAC_ASSIGNMENT_CHANGED, ctx, payload: { v: 1, change: "revoked", userId: U1 } }) as DomainEvent,
    );
    expect(cache.get(T1, U1)).toBeUndefined();
    expect(cache.get(T1, U2)).toBeDefined();

    await bus.publish(createDomainEvent({ type: RBAC_ROLE_CHANGED, ctx, payload: { v: 1, change: "updated" } }) as DomainEvent);
    expect(cache.get(T1, U2)).toBeUndefined();

    // payload sans userId : par prudence, tout le tenant
    cache.set(T1, U1, set(U1));
    await bus.publish(createDomainEvent({ type: RBAC_ASSIGNMENT_CHANGED, ctx, payload: { v: 1 } }) as DomainEvent);
    expect(cache.get(T1, U1)).toBeUndefined();

    off();
    expect(bus.size).toBe(0);
    cache.set(T1, U1, set(U1));
    await bus.publish(createDomainEvent({ type: RBAC_ROLE_CHANGED, ctx, payload: { v: 1 } }) as DomainEvent);
    expect(cache.get(T1, U1)).toBeDefined();
  });

  it("n'invalide pas un autre tenant", async () => {
    const bus = new InMemoryEventBus();
    const cache = new PermissionSetCache();
    subscribeCacheInvalidation(bus, cache);
    cache.set(T2, U1, emptyPermissionSet(T2, U1, NOW));
    await bus.publish(createDomainEvent({ type: RBAC_ROLE_CHANGED, ctx: ctxFor({ tenantId: T1 }), payload: { v: 1 } }) as DomainEvent);
    expect(cache.get(T2, U1)).toBeDefined();
  });

  it("vi : getOrLoad ne rappelle pas le loader tant que le cache est chaud", async () => {
    const cache = new PermissionSetCache();
    const loader = vi.fn(async () => set());
    await cache.getOrLoad(T1, U1, loader);
    await cache.getOrLoad(T1, U1, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
