import { describe, expect, it } from "vitest";
import { InMemoryEventBus, ManualClock, createDomainEvent, createSystemContext, newId } from "@ecoledigitale/kernel";
import { CachedEntitlementsReader, type EntitlementsReader } from "../application/reader";
import type { EffectiveEntitlements } from "../domain/resolve";

const T1 = "00000000-0000-7000-8000-000000000001";
const T2 = "00000000-0000-7000-8000-000000000002";

function ent(tenantId: string, features: string[], validUntil: Date | null = null, version = 1): EffectiveEntitlements {
  return {
    tenantId,
    reason: "OK",
    planKey: `PLAN${version}`,
    packs: [],
    subscriptionStatus: "ACTIVE",
    features,
    sources: {},
    limits: { learnerTierMax: null },
    validUntil,
    computedAt: new Date(),
  };
}

/** Lecteur factice : compte les appels, résultat modifiable, latence contrôlable. */
class FakeReader implements EntitlementsReader {
  calls = 0;
  version = 1;
  features: string[] = ["a.b"];
  validUntil: Date | null = null;
  fail = false;
  gate: Promise<void> | null = null;

  async getEntitlements(tenantId: string): Promise<EffectiveEntitlements> {
    this.calls += 1;
    const snapshot = ent(tenantId, [...this.features], this.validUntil, this.version);
    if (this.gate) await this.gate;
    if (this.fail) throw new Error("boom");
    return snapshot;
  }
  async hasFeature(tenantId: string, key: string): Promise<boolean> {
    return (await this.getEntitlements(tenantId)).features.includes(key);
  }
}

function setup(options: { ttlMs?: number; maxEntries?: number } = {}) {
  const inner = new FakeReader();
  const clock = new ManualClock("2026-10-01T00:00:00.000Z");
  const cache = new CachedEntitlementsReader(inner, { ttlMs: 30_000, ...options, clock });
  return { inner, clock, cache };
}

describe("CachedEntitlementsReader", () => {
  it("sert le cache pendant le TTL puis recalcule", async () => {
    const { inner, clock, cache } = setup();
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(1);
    clock.advance(29_999);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(1);
    clock.advance(1);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(2);
  });

  it("cache par tenant (pas de mélange)", async () => {
    const { inner, cache } = setup();
    const a = await cache.getEntitlements(T1);
    const b = await cache.getEntitlements(T2);
    expect(a.tenantId).toBe(T1);
    expect(b.tenantId).toBe(T2);
    expect(inner.calls).toBe(2);
  });

  it("invalidate(tenant) ne touche que ce tenant", async () => {
    const { inner, cache } = setup();
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T2);
    inner.features = ["x.y"];
    cache.invalidate(T1);
    expect((await cache.getEntitlements(T1)).features).toEqual(["x.y"]);
    expect((await cache.getEntitlements(T2)).features).toEqual(["a.b"]); // toujours en cache
  });

  it("invalidateAll vide tout", async () => {
    const { inner, cache } = setup();
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T2);
    cache.invalidateAll();
    expect(cache.size).toBe(0);
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T2);
    expect(inner.calls).toBe(4);
  });

  it("validUntil borne la durée de vie : un droit expiré n'est jamais servi après son échéance", async () => {
    const { inner, clock, cache } = setup({ ttlMs: 600_000 });
    inner.validUntil = new Date(clock.now().getTime() + 5_000);
    await cache.getEntitlements(T1);
    clock.advance(4_999);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(1);
    clock.advance(1);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(2);
  });

  it("une valeur déjà échue (validUntil passé ou présent) n'est pas mise en cache", async () => {
    const { inner, clock, cache } = setup();
    inner.validUntil = clock.now();
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(2);
    expect(cache.size).toBe(0);
  });

  it("appels simultanés : un seul calcul (single-flight)", async () => {
    const { inner, cache } = setup();
    let release!: () => void;
    inner.gate = new Promise<void>((r) => (release = r));
    const calls = [cache.getEntitlements(T1), cache.getEntitlements(T1), cache.getEntitlements(T1)];
    release();
    const results = await Promise.all(calls);
    expect(inner.calls).toBe(1);
    expect(new Set(results).size).toBe(1);
  });

  it("invalidation PENDANT un calcul : la valeur périmée n'est pas remise en cache", async () => {
    const { inner, cache } = setup();
    let release!: () => void;
    inner.gate = new Promise<void>((r) => (release = r));
    const inFlight = cache.getEntitlements(T1); // calcule l'ancienne version
    cache.invalidate(T1); // le changement survient pendant le calcul
    inner.gate = null;
    inner.features = ["new.feature"];
    release();
    const old = await inFlight;
    expect(old.features).toEqual(["a.b"]); // la requête en cours reçoit son résultat cohérent...
    expect(cache.size).toBe(0); // ... mais il n'est pas conservé
    expect((await cache.getEntitlements(T1)).features).toEqual(["new.feature"]);
  });

  it("invalidateAll pendant un calcul : idem", async () => {
    const { inner, cache } = setup();
    let release!: () => void;
    inner.gate = new Promise<void>((r) => (release = r));
    const inFlight = cache.getEntitlements(T1);
    cache.invalidateAll();
    release();
    await inFlight;
    expect(cache.size).toBe(0);
  });

  it("une erreur n'est pas mise en cache et n'empoisonne pas les appels suivants", async () => {
    const { inner, cache } = setup();
    inner.fail = true;
    await expect(cache.getEntitlements(T1)).rejects.toThrow("boom");
    inner.fail = false;
    await expect(cache.getEntitlements(T1)).resolves.toBeDefined();
    expect(inner.calls).toBe(2);
  });

  it("borne la taille : le plus ancien est évincé", async () => {
    const { inner, cache } = setup({ maxEntries: 2 });
    const t3 = "00000000-0000-7000-8000-000000000003";
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T2);
    await cache.getEntitlements(t3);
    expect(cache.size).toBe(2);
    await cache.getEntitlements(T1); // évincé : recalculé
    expect(inner.calls).toBe(4);
  });

  it("ttl 0 : pas de cache", async () => {
    const { inner, cache } = setup({ ttlMs: 0 });
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(2);
  });

  it("hasFeature passe par le cache", async () => {
    const { inner, cache } = setup();
    expect(await cache.hasFeature(T1, "a.b")).toBe(true);
    expect(await cache.hasFeature(T1, "z.z")).toBe(false);
    expect(inner.calls).toBe(1);
  });
});

describe("CachedEntitlementsReader — invalidation par événement", () => {
  it.each([
    "entitlements.subscription.changed",
    "entitlements.override.changed",
    "tenancy.tenant.status_changed",
    "tenancy.tenant.provisioned",
  ])("%s invalide le tenant concerné", async (type) => {
    const { inner, cache } = setup();
    await cache.getEntitlements(T1);
    await cache.getEntitlements(T2);
    expect(cache.handleEvent({ type, tenantId: T1 })).toBe(true);
    inner.features = ["changed.now"];
    expect((await cache.getEntitlements(T1)).features).toEqual(["changed.now"]);
    expect((await cache.getEntitlements(T2)).features).toEqual(["a.b"]);
  });

  it("un événement sans rapport est ignoré", async () => {
    const { inner, cache } = setup();
    await cache.getEntitlements(T1);
    expect(cache.handleEvent({ type: "finance.payment.completed", tenantId: T1 })).toBe(false);
    await cache.getEntitlements(T1);
    expect(inner.calls).toBe(1);
  });

  it("bindToBus : les événements du bus en mémoire invalident le cache, le désabonnement coupe le lien", async () => {
    const { inner, cache } = setup();
    const bus = new InMemoryEventBus();
    const unsubscribe = cache.bindToBus(bus);
    const ctx = createSystemContext(T1);

    await cache.getEntitlements(T1);
    inner.features = ["v2.feature"];
    await bus.publish(createDomainEvent({ type: "entitlements.override.changed", payload: { v: 1 }, ctx }));
    expect((await cache.getEntitlements(T1)).features).toEqual(["v2.feature"]);

    unsubscribe();
    inner.features = ["v3.feature"];
    await bus.publish(createDomainEvent({ type: "entitlements.override.changed", payload: { v: 1 }, ctx }));
    expect((await cache.getEntitlements(T1)).features).toEqual(["v2.feature"]); // plus invalidé
    void newId;
  });
});
