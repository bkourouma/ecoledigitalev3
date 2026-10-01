import { describe, expect, it } from "vitest";
import { defineModule } from "@ecoledigitale/kernel";
import { collectFeatures } from "../application/catalog";
import { DEFAULT_USAGE_MODE, monthsBefore, parsePeriod, periodOf } from "../application/usage";
import manifest from "../manifest";
import { ENTITLEMENTS_ISOLATION_ALLOWLIST } from "../../isolation-allowlist.entitlements";

const mod = (key: string, features: Array<{ key: string; label?: string; packs?: string[] }>) =>
  defineModule({
    key,
    title: key,
    packs: ["CORE"],
    features: features.map((f) => ({ key: f.key, label: f.label ?? f.key, packs: (f.packs ?? []) as never })),
  });

describe("collectFeatures (manifestes -> catalogue)", () => {
  it("extrait les features avec leur module d'origine", () => {
    const r = collectFeatures([
      mod("finance", [{ key: "finance.online-payment", label: "Paiement en ligne", packs: ["PRIMARY", "SECONDARY"] }]),
      mod("core", [{ key: "core.dashboard", packs: ["CORE"] }]),
    ]);
    expect(r.ok && r.value).toEqual([
      { key: "finance.online-payment", label: "Paiement en ligne", moduleKey: "finance", packs: ["PRIMARY", "SECONDARY"] },
      { key: "core.dashboard", label: "core.dashboard", moduleKey: "core", packs: ["CORE"] },
    ]);
  });

  it("refuse une feature déclarée par deux modules", () => {
    const r = collectFeatures([mod("a", [{ key: "x.feature" }]), mod("b", [{ key: "x.feature" }])]);
    expect(!r.ok && r.error.issues[0]?.code).toBe("entitlements.feature_duplicate");
  });

  it.each(["Finance.Online", "sans-point", "a.", ".b", "a b.c"])("refuse la clé invalide « %s »", (key) => {
    const r = collectFeatures([mod("m", [{ key }])]);
    expect(!r.ok && r.error.issues[0]?.code).toBe("entitlements.feature_key_invalid");
  });

  it("refuse un pack inconnu", () => {
    const r = collectFeatures([mod("m", [{ key: "m.feature", packs: ["MATERNELLE"] }])]);
    expect(!r.ok && r.error.issues[0]?.code).toBe("entitlements.feature_pack_invalid");
  });

  it("module sans feature : liste vide", () => {
    const r = collectFeatures([mod("m", [])]);
    expect(r.ok && r.value).toEqual([]);
  });
});

describe("périodes d'usage (UTC)", () => {
  it("periodOf : premier jour du mois UTC, y compris aux frontières", () => {
    expect(periodOf(new Date("2026-10-15T12:00:00Z"))).toBe("2026-10-01");
    expect(periodOf(new Date("2026-10-31T23:59:59.999Z"))).toBe("2026-10-01");
    expect(periodOf(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11-01");
    expect(periodOf(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
  });

  it("parsePeriod : AAAA-MM ou AAAA-MM-JJ -> premier du mois ; invalide -> null", () => {
    expect(parsePeriod("2026-03")).toBe("2026-03-01");
    expect(parsePeriod("2026-03-17")).toBe("2026-03-01");
    for (const bad of ["2026-13", "2026-00", "26-03", "2026/03", "abc", "1999-01", ""]) expect(parsePeriod(bad)).toBeNull();
  });

  it("monthsBefore : passe l'année", () => {
    expect(monthsBefore("2026-03-01", 0)).toBe("2026-03-01");
    expect(monthsBefore("2026-03-01", 2)).toBe("2026-01-01");
    expect(monthsBefore("2026-03-01", 3)).toBe("2025-12-01");
    expect(monthsBefore("2026-10-01", 11)).toBe("2025-11-01");
  });

  it("mode d'agrégation par défaut selon la mesure", () => {
    expect(DEFAULT_USAGE_MODE).toEqual({ ACTIVE_LEARNERS: "MAX", STORAGE_BYTES: "SET", SMS_SENT: "INCREMENT" });
  });
});

describe("manifeste et liste blanche", () => {
  it("clé, dépendance à tenancy, permissions dont une sensible, événements", () => {
    expect(manifest.key).toBe("entitlements");
    expect(manifest.dependsOn).toEqual(["tenancy"]);
    expect(manifest.permissions.map((p) => [p.key, Boolean(p.sensitive)])).toEqual([
      ["entitlements.read", false],
      ["entitlements.manage", true],
    ]);
    expect(manifest.events.publishes).toEqual(["entitlements.subscription.changed", "entitlements.override.changed"]);
    expect(manifest.events.consumes).toContain("tenancy.tenant.provisioned");
  });

  it("la liste blanche d'isolation : une clé + une justification substantielle par table globale", () => {
    expect(ENTITLEMENTS_ISOLATION_ALLOWLIST.map((e) => e.key)).toEqual([
      "entitlements.plans",
      "entitlements.packs",
      "entitlements.features",
      "entitlements.plan_features",
    ]);
    for (const e of ENTITLEMENTS_ISOLATION_ALLOWLIST) expect(e.justification.length).toBeGreaterThan(40);
  });
});
