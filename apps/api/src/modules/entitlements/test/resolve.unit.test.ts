/** `computeEntitlements` : fonction PURE, testée sur toutes les combinaisons plan / pack / surcharge / expiration / suspension. */
import { describe, expect, it } from "vitest";
import {
  computeEntitlements,
  hasFeature,
  isSubscriptionActive,
  type CatalogFeature,
  type EntitlementsInput,
  type OverrideSnapshot,
  type SubscriptionSnapshot,
  type TenantLifecycleStatus,
} from "../domain/resolve";
import type { SubscriptionStatus } from "@ecoledigitale/contracts/src/v2/entitlements";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const at = (iso: string): Date => new Date(iso);
const PAST = at("2026-09-01T00:00:00.000Z");
const FUTURE = at("2026-12-01T00:00:00.000Z");
const FARTHER = at("2027-06-01T00:00:00.000Z");

const CATALOG: CatalogFeature[] = [
  { key: "core.dashboard", packs: ["CORE"], retired: false },
  { key: "core.profile", packs: ["CORE"], retired: false },
  { key: "primary.report-card", packs: ["PRIMARY"], retired: false },
  { key: "secondary.timetable", packs: ["SECONDARY"], retired: false },
  { key: "higher.ue-ecue", packs: ["HIGHER"], retired: false },
  { key: "virtual.live-class", packs: ["VIRTUAL"], retired: false },
  { key: "shared.library", packs: ["PRIMARY", "SECONDARY"], retired: false },
  { key: "finance.online-payment", packs: [], retired: false }, // plan seulement
  { key: "analytics.advanced", packs: [], retired: false }, // plan seulement
  { key: "legacy.old-core", packs: ["CORE"], retired: true }, // retirée : jamais accordée
  { key: "legacy.old-pack", packs: ["PRIMARY"], retired: true },
];
const CORE = ["core.dashboard", "core.profile"];

function sub(patch: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    planKey: "PROFESSIONAL",
    packs: [],
    status: "ACTIVE",
    startsAt: PAST,
    endsAt: null,
    learnerTierMax: 500,
    ...patch,
  };
}

function input(patch: Partial<EntitlementsInput> = {}): EntitlementsInput {
  return {
    tenantId: "t1",
    tenantStatus: "active",
    catalog: CATALOG,
    subscription: sub(),
    planFeatureKeys: [],
    overrides: [],
    ...patch,
  };
}

const run = (patch: Partial<EntitlementsInput> = {}, now = NOW) => computeEntitlements(input(patch), now);
const grant = (featureKey: string, expiresAt: Date | null = null): OverrideSnapshot => ({ featureKey, effect: "GRANT", expiresAt });
const deny = (featureKey: string, expiresAt: Date | null = null): OverrideSnapshot => ({ featureKey, effect: "DENY", expiresAt });

describe("computeEntitlements — socle", () => {
  it("abonnement actif sans plan ni pack : uniquement CORE", () => {
    const r = run();
    expect(r.reason).toBe("OK");
    expect(r.features).toEqual(CORE);
    expect(r.sources).toEqual({ "core.dashboard": "CORE", "core.profile": "CORE" });
  });

  it("le plan accorde ses features (source PLAN)", () => {
    const r = run({ planFeatureKeys: ["finance.online-payment", "analytics.advanced"] });
    expect(r.features).toEqual([...CORE, "analytics.advanced", "finance.online-payment"].sort());
    expect(r.sources["finance.online-payment"]).toBe("PLAN");
  });

  it("un pack souscrit accorde les features qui l'incluent (source PACK)", () => {
    const r = run({ subscription: sub({ packs: ["PRIMARY"] }) });
    expect(r.features).toEqual([...CORE, "primary.report-card", "shared.library"].sort());
    expect(r.sources["primary.report-card"]).toBe("PACK");
    expect(r.packs).toEqual(["PRIMARY"]);
  });

  it("plusieurs packs : union ; une feature partagée n'est comptée qu'une fois", () => {
    const r = run({ subscription: sub({ packs: ["PRIMARY", "SECONDARY"] }) });
    expect(r.features).toEqual([...CORE, "primary.report-card", "secondary.timetable", "shared.library"].sort());
    expect(new Set(r.features).size).toBe(r.features.length);
  });

  it("plan ET pack : union, la source la plus prioritaire (PLAN) est conservée", () => {
    const r = run({ subscription: sub({ packs: ["PRIMARY"] }), planFeatureKeys: ["primary.report-card", "finance.online-payment"] });
    expect(r.sources["primary.report-card"]).toBe("PLAN");
    expect(r.sources["shared.library"]).toBe("PACK");
    expect(r.features).toEqual([...CORE, "finance.online-payment", "primary.report-card", "shared.library"].sort());
  });

  it("les pack non souscrits n'accordent rien", () => {
    const r = run({ subscription: sub({ packs: ["HIGHER"] }) });
    expect(r.features).not.toContain("primary.report-card");
    expect(r.features).toContain("higher.ue-ecue");
    expect(r.features).not.toContain("virtual.live-class");
  });

  it("une feature RETIRÉE n'est jamais accordée : ni CORE, ni plan, ni pack, ni surcharge", () => {
    const r = run({
      subscription: sub({ packs: ["PRIMARY"] }),
      planFeatureKeys: ["legacy.old-core", "legacy.old-pack"],
      overrides: [grant("legacy.old-core"), grant("legacy.old-pack")],
    });
    expect(r.features.some((f) => f.startsWith("legacy."))).toBe(false);
  });

  it("clé de plan inconnue du catalogue : ignorée", () => {
    const r = run({ planFeatureKeys: ["ghost.feature"] });
    expect(r.features).toEqual(CORE);
  });

  it("expose le plafond de la tranche d'apprenants, le plan et le statut", () => {
    const r = run({ subscription: sub({ learnerTierMax: 200, status: "TRIALING" }) });
    expect(r.limits.learnerTierMax).toBe(200);
    expect(r.planKey).toBe("PROFESSIONAL");
    expect(r.subscriptionStatus).toBe("TRIALING");
  });

  it("sortie triée, sans doublon, sources ⇔ features", () => {
    const r = run({ subscription: sub({ packs: ["VIRTUAL", "HIGHER", "PRIMARY"] }), planFeatureKeys: ["analytics.advanced"] });
    expect(r.features).toEqual([...r.features].sort());
    expect(Object.keys(r.sources).sort()).toEqual(r.features);
  });

  it("n'altère pas ses entrées", () => {
    const i = input({ subscription: sub({ packs: ["PRIMARY"] }), overrides: [deny("shared.library")], planFeatureKeys: ["analytics.advanced"] });
    const copy = JSON.stringify(i);
    computeEntitlements(i, NOW);
    expect(JSON.stringify(i)).toBe(copy);
  });
});

describe("computeEntitlements — surcharges", () => {
  it("GRANT ajoute une feature hors plan/pack (source OVERRIDE)", () => {
    const r = run({ overrides: [grant("higher.ue-ecue")] });
    expect(r.features).toEqual([...CORE, "higher.ue-ecue"].sort());
    expect(r.sources["higher.ue-ecue"]).toBe("OVERRIDE");
  });

  it("GRANT sur une feature déjà accordée ne change pas sa source", () => {
    const r = run({ subscription: sub({ packs: ["PRIMARY"] }), overrides: [grant("primary.report-card")] });
    expect(r.sources["primary.report-card"]).toBe("PACK");
  });

  it("DENY retire une feature du plan", () => {
    const r = run({ planFeatureKeys: ["finance.online-payment"], overrides: [deny("finance.online-payment")] });
    expect(r.features).toEqual(CORE);
  });

  it("DENY retire une feature d'un pack", () => {
    const r = run({ subscription: sub({ packs: ["PRIMARY"] }), overrides: [deny("shared.library")] });
    expect(r.features).toEqual([...CORE, "primary.report-card"].sort());
  });

  it("DENY ne retire JAMAIS une feature CORE", () => {
    const r = run({ overrides: [deny("core.dashboard"), deny("core.profile")] });
    expect(r.features).toEqual(CORE);
    expect(r.sources["core.dashboard"]).toBe("CORE");
  });

  it("surcharge sur une feature inconnue : sans effet", () => {
    const r = run({ overrides: [grant("ghost.feature"), deny("ghost.other")] });
    expect(r.features).toEqual(CORE);
    expect(r.validUntil).toBeNull(); // une surcharge ignorée ne borne pas non plus le cache
  });

  it("surcharge GRANT expirée : sans effet ; non expirée : effet", () => {
    expect(run({ overrides: [grant("higher.ue-ecue", PAST)] }).features).toEqual(CORE);
    expect(run({ overrides: [grant("higher.ue-ecue", FUTURE)] }).features).toContain("higher.ue-ecue");
  });

  it("surcharge DENY expirée : la feature est de nouveau accordée", () => {
    const base = { planFeatureKeys: ["finance.online-payment"] };
    expect(run({ ...base, overrides: [deny("finance.online-payment", PAST)] }).features).toContain("finance.online-payment");
    expect(run({ ...base, overrides: [deny("finance.online-payment", FUTURE)] }).features).not.toContain("finance.online-payment");
  });

  it("expiration EXACTEMENT à l'instant courant : expirée (borne exclusive)", () => {
    expect(run({ overrides: [grant("higher.ue-ecue", NOW)] }).features).toEqual(CORE);
  });

  it("une même feature : l'expiration fait basculer le résultat avec le temps", () => {
    const o = [grant("higher.ue-ecue", FUTURE)];
    expect(run({ overrides: o }, at("2026-11-30T23:59:59.999Z")).features).toContain("higher.ue-ecue");
    expect(run({ overrides: o }, at("2026-12-01T00:00:00.000Z")).features).toEqual(CORE);
  });

  it("GRANT et DENY sur des features différentes se cumulent", () => {
    const r = run({
      subscription: sub({ packs: ["SECONDARY"] }),
      overrides: [grant("virtual.live-class"), deny("secondary.timetable")],
    });
    expect(r.features).toEqual([...CORE, "shared.library", "virtual.live-class"].sort());
  });
});

describe("computeEntitlements — suspension et abonnement inactif : CORE seulement", () => {
  const rich: Partial<EntitlementsInput> = {
    planFeatureKeys: ["finance.online-payment"],
    overrides: [grant("higher.ue-ecue"), deny("shared.library")],
  };

  it.each<[TenantLifecycleStatus, string]>([
    ["suspended", "TENANT_SUSPENDED"],
    ["archived", "TENANT_ARCHIVED"],
  ])("tenant %s : CORE seulement même avec abonnement actif, plan, packs et GRANT (%s)", (tenantStatus, reason) => {
    const r = run({ ...rich, tenantStatus, subscription: sub({ packs: ["PRIMARY", "HIGHER"] }) });
    expect(r.reason).toBe(reason);
    expect(r.features).toEqual(CORE);
    expect(r.limits.learnerTierMax).toBeNull();
  });

  it("aucun abonnement : CORE seulement, y compris avec un GRANT", () => {
    const r = run({ ...rich, subscription: null });
    expect(r.reason).toBe("NO_SUBSCRIPTION");
    expect(r.features).toEqual(CORE);
    expect(r.planKey).toBeNull();
  });

  it.each<SubscriptionStatus>(["CANCELED", "EXPIRED", "PAST_DUE"])("abonnement %s : CORE seulement", (status) => {
    const r = run({ ...rich, subscription: sub({ status, packs: ["PRIMARY"] }) });
    expect(r.reason).toBe("SUBSCRIPTION_INACTIVE");
    expect(r.features).toEqual(CORE);
    expect(r.subscriptionStatus).toBe(status);
  });

  it("abonnement échu (ends_at passé) bien que statut ACTIVE : CORE seulement", () => {
    const r = run({ ...rich, subscription: sub({ endsAt: PAST, packs: ["PRIMARY"] }) });
    expect(r.reason).toBe("SUBSCRIPTION_INACTIVE");
    expect(r.features).toEqual(CORE);
  });

  it("fin d'abonnement EXACTEMENT maintenant : échu (borne exclusive)", () => {
    expect(isSubscriptionActive(sub({ endsAt: NOW }), NOW)).toBe(false);
    expect(isSubscriptionActive(sub({ endsAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(true);
  });

  it("abonnement pas encore commencé : CORE seulement, et validUntil = son début", () => {
    const r = run({ ...rich, subscription: sub({ startsAt: FUTURE, packs: ["PRIMARY"] }) });
    expect(r.reason).toBe("SUBSCRIPTION_INACTIVE");
    expect(r.features).toEqual(CORE);
    expect(r.validUntil).toEqual(FUTURE);
  });

  it("début d'abonnement EXACTEMENT maintenant : actif (borne inclusive)", () => {
    expect(isSubscriptionActive(sub({ startsAt: NOW }), NOW)).toBe(true);
  });

  it("l'essai (TRIALING) accorde les droits comme un abonnement actif", () => {
    const r = run({ subscription: sub({ status: "TRIALING", packs: ["PRIMARY"] }) });
    expect(r.reason).toBe("OK");
    expect(r.features).toContain("primary.report-card");
  });

  it("suspension : le statut du tenant prime sur un abonnement actif ET un GRANT", () => {
    const active = run({ ...rich });
    const suspended = run({ ...rich, tenantStatus: "suspended" });
    expect(active.features.length).toBeGreaterThan(CORE.length);
    expect(suspended.features).toEqual(CORE);
  });
});

describe("computeEntitlements — validUntil (borne de cache)", () => {
  it("aucune échéance : null", () => {
    expect(run().validUntil).toBeNull();
  });

  it("fin d'abonnement future", () => {
    expect(run({ subscription: sub({ endsAt: FUTURE }) }).validUntil).toEqual(FUTURE);
  });

  it("expiration d'une surcharge future", () => {
    expect(run({ overrides: [grant("higher.ue-ecue", FUTURE)] }).validUntil).toEqual(FUTURE);
  });

  it("la plus proche échéance l'emporte", () => {
    const r = run({
      subscription: sub({ endsAt: FARTHER }),
      overrides: [grant("higher.ue-ecue", FUTURE), deny("shared.library", FARTHER)],
    });
    expect(r.validUntil).toEqual(FUTURE);
  });

  it("une surcharge déjà expirée ne borne rien", () => {
    expect(run({ overrides: [grant("higher.ue-ecue", PAST)] }).validUntil).toBeNull();
  });

  it("horodate le calcul", () => {
    expect(run().computedAt).toEqual(NOW);
  });
});

describe("hasFeature", () => {
  it("lit la liste accordée", () => {
    const r = run({ subscription: sub({ packs: ["PRIMARY"] }) });
    expect(hasFeature(r, "primary.report-card")).toBe(true);
    expect(hasFeature(r, "higher.ue-ecue")).toBe(false);
    expect(hasFeature(r, "core.dashboard")).toBe(true);
  });
});

describe("computeEntitlements — énumération exhaustive des combinaisons", () => {
  const tenantStatuses: TenantLifecycleStatus[] = ["active", "suspended", "archived"];
  const subStates: Array<[string, SubscriptionSnapshot | null]> = [
    ["aucun", null],
    ["actif", sub()],
    ["essai", sub({ status: "TRIALING" })],
    ["impayé", sub({ status: "PAST_DUE" })],
    ["résilié", sub({ status: "CANCELED" })],
    ["expiré (statut)", sub({ status: "EXPIRED" })],
    ["échu (date)", sub({ endsAt: PAST })],
    ["à venir", sub({ startsAt: FUTURE })],
  ];
  const packSubsets = (): string[][] => {
    const all = ["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"];
    return Array.from({ length: 1 << all.length }, (_, mask) => all.filter((_p, i) => mask & (1 << i)));
  };
  const planSets: string[][] = [[], ["finance.online-payment"], ["finance.online-payment", "analytics.advanced", "primary.report-card"]];
  const overrideSets: Array<[string, OverrideSnapshot[]]> = [
    ["aucune", []],
    ["grant", [grant("higher.ue-ecue")]],
    ["grant expiré", [grant("higher.ue-ecue", PAST)]],
    ["deny", [deny("finance.online-payment"), deny("shared.library")]],
    ["deny expiré", [deny("finance.online-payment", PAST)]],
    ["deny core", [deny("core.dashboard")]],
    ["mixte", [grant("virtual.live-class", FUTURE), deny("primary.report-card"), grant("analytics.advanced", PAST)]],
  ];

  it("invariants vérifiés sur toutes les combinaisons statut × abonnement × packs × plan × surcharges", () => {
    let combos = 0;
    for (const tenantStatus of tenantStatuses) {
      for (const [stateName, s] of subStates) {
        for (const packs of packSubsets()) {
          for (const planFeatureKeys of planSets) {
            for (const [overrideName, overrides] of overrideSets) {
              combos += 1;
              const subscription = s ? { ...s, packs } : null;
              const label = `${tenantStatus}/${stateName}/[${packs}]/plan${planFeatureKeys.length}/${overrideName}`;
              const r = computeEntitlements(input({ tenantStatus, subscription, planFeatureKeys, overrides }), NOW);

              // (a) CORE toujours accordée, (b) jamais de feature retirée.
              for (const k of CORE) expect(r.features, label).toContain(k);
              expect(r.features.some((f) => f.startsWith("legacy.")), label).toBe(false);

              // (c) Hors tenant actif + abonnement actif : CORE exactement.
              const entitled = tenantStatus === "active" && isSubscriptionActive(subscription, NOW);
              if (!entitled) {
                expect(r.features, label).toEqual(CORE);
                expect(r.reason, label).not.toBe("OK");
              } else {
                expect(r.reason, label).toBe("OK");
                // (d) Tout ce qui est accordé hors CORE a une source plan/pack/surcharge justifiée.
                for (const f of r.features) {
                  const src = r.sources[f];
                  if (src === "CORE") expect(CORE, label).toContain(f);
                  if (src === "PLAN") expect(planFeatureKeys, label).toContain(f);
                  if (src === "PACK") {
                    const feat = CATALOG.find((c) => c.key === f);
                    expect(feat?.packs.some((p) => packs.includes(p)), label).toBe(true);
                  }
                  if (src === "OVERRIDE") expect(overrides.some((o) => o.featureKey === f && o.effect === "GRANT"), label).toBe(true);
                }
                // (e) Un DENY non expiré retire toute feature non CORE.
                for (const o of overrides) {
                  const live = o.expiresAt === null || o.expiresAt.getTime() > NOW.getTime();
                  if (o.effect === "DENY" && live && !CORE.includes(o.featureKey)) {
                    expect(r.features, label).not.toContain(o.featureKey);
                  }
                }
              }

              // (f) Forme : trié, sans doublon, sources ⇔ features.
              expect(r.features, label).toEqual([...new Set(r.features)].sort());
              expect(Object.keys(r.sources).sort(), label).toEqual(r.features);
            }
          }
        }
      }
    }
    expect(combos).toBe(3 * 8 * 16 * 3 * 7);
  });
});
