import { describe, expect, it } from "vitest";
import { Money, newId } from "@ecoledigitale/kernel";
import {
  EnvProviderConfigSource,
  ProviderRegistry,
  StaticProviderConfigSource,
  createProviderRegistry,
  isDevLikeEnvironment,
  sandboxDefinition,
} from "../../infrastructure/providers/registry";
import {
  DEFAULT_SANDBOX_SECRET,
  SANDBOX_SIGNATURE_HEADER,
  SandboxProvider,
  resolveSandboxOutcome,
} from "../../infrastructure/providers/sandbox-provider";
import { fakeDefinition } from "../support/fake-provider";
import { xof } from "../support/factories";

const tenant = newId();

describe("règle de sécurité des fournisseurs : jamais de repli silencieux en simulation", () => {
  it("environnements de développement uniquement : development et test", () => {
    expect(isDevLikeEnvironment("development")).toBe(true);
    expect(isDevLikeEnvironment("test")).toBe(true);
    expect(isDevLikeEnvironment("staging")).toBe(false);
    expect(isDevLikeEnvironment("production")).toBe(false);
  });

  it("hors développement, un fournisseur non configuré est REFUSÉ (seuls les NOMS manquants sont exposés)", async () => {
    for (const environment of ["staging", "production"] as const) {
      const registry = createProviderRegistry({ environment }).register(fakeDefinition("wave"));
      const r = await registry.resolve(tenant, "wave");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("finance.provider_not_configured");
        expect(r.error.details).toEqual({ provider: "wave", missing: ["apiKey", "webhookSecret"] });
      }
    }
  });

  it("hors développement, la sandbox est refusée sauf autorisation explicite du tenant", async () => {
    const config = new StaticProviderConfigSource();
    const registry = createProviderRegistry({ environment: "production", configSource: config });
    const refused = await registry.resolve(tenant, "sandbox");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("finance.provider_sandbox_forbidden");

    config.set(tenant, "sandbox", { allowSandbox: "true" });
    const allowed = await registry.resolve(tenant, "sandbox");
    expect(allowed.ok).toBe(true);
    // autorisation par tenant : un autre tenant reste refusé
    const other = await registry.resolve(newId(), "sandbox");
    expect(other.ok).toBe(false);
  });

  it("en développement, la sandbox est disponible mais le repli n'existe que s'il est demandé", async () => {
    const dev = createProviderRegistry({ environment: "development" }).register(fakeDefinition("wave"));
    expect((await dev.resolve(tenant, "sandbox")).ok).toBe(true);
    const noFallback = await dev.resolve(tenant, "wave");
    expect(noFallback.ok).toBe(false); // pas de repli implicite, même en développement

    const warnings: unknown[] = [];
    const withFallback = createProviderRegistry({
      environment: "development",
      devSandboxFallback: true,
      logger: { debug: () => undefined, info: () => undefined, error: () => undefined, warn: (o) => void warnings.push(o) },
    }).register(fakeDefinition("wave"));
    const r = await withFallback.resolve(tenant, "wave");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.simulated).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it("le repli de développement est IGNORÉ en production même s'il est demandé", async () => {
    const registry = createProviderRegistry({ environment: "production", devSandboxFallback: true }).register(fakeDefinition("wave"));
    const r = await registry.resolve(tenant, "wave");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.provider_not_configured");
  });

  it("fournisseur inconnu ; configuré ⇒ instance réelle (non simulée) mise en cache par configuration", async () => {
    const config = new StaticProviderConfigSource().set(tenant, "wave", { apiKey: "k", webhookSecret: "s" });
    const created: unknown[] = [];
    const registry = createProviderRegistry({ environment: "production", configSource: config }).register(fakeDefinition("wave", created as never[]));
    const unknown = await registry.resolve(tenant, "mtn_momo");
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("finance.provider_unknown");

    const a = await registry.resolve(tenant, "wave");
    const b = await registry.resolve(tenant, "wave");
    expect(a.ok && b.ok && a.value === b.value).toBe(true);
    expect(created).toHaveLength(1);
    if (a.ok) expect(a.value.simulated).toBe(false);

    config.set(tenant, "wave", { apiKey: "k2", webhookSecret: "s" });
    const c = await registry.resolve(tenant, "wave");
    expect(c.ok && a.ok && c.value !== a.value).toBe(true);
  });

  it("un paramètre vide compte comme manquant", async () => {
    const config = new StaticProviderConfigSource().set(tenant, "wave", { apiKey: "  ", webhookSecret: "s" });
    const registry = createProviderRegistry({ environment: "production", configSource: config }).register(fakeDefinition("wave"));
    const r = await registry.resolve(tenant, "wave");
    expect(!r.ok && r.error.details).toMatchObject({ missing: ["apiKey"] });
  });

  it("enregistrement : noms valides et uniques", () => {
    const registry = new ProviderRegistry({ environment: "test" }).register(sandboxDefinition);
    expect(() => registry.register(sandboxDefinition)).toThrow(/déjà enregistré/);
    expect(() => registry.register({ ...sandboxDefinition, name: "Bad Name" })).toThrow(/invalide/);
    expect(registry.names()).toEqual(["sandbox"]);
    expect(registry.has("sandbox")).toBe(true);
  });

  it("source d'environnement : FINANCE_PROVIDER_<NOM>_<CLÉ>", async () => {
    const src = new EnvProviderConfigSource({
      FINANCE_PROVIDER_ORANGE_MONEY_APIKEY: "abc",
      FINANCE_PROVIDER_ORANGE_MONEY_WEBHOOKSECRET: "def",
      FINANCE_PROVIDER_WAVE_APIKEY: "zzz",
      UNRELATED: "x",
    });
    expect(await src.get(tenant, "orange_money")).toEqual({ apikey: "abc", webhooksecret: "def" });
    expect(await src.get(tenant, "mtn")).toBeNull();
  });
});

describe("SandboxProvider : déterministe", () => {
  it("issue d'après le drapeau, sinon d'après le montant", () => {
    expect(resolveSandboxOutcome(xof(25_000))).toBe("success");
    expect(resolveSandboxOutcome(xof(25_013))).toBe("failure");
    expect(resolveSandboxOutcome(xof(25_001))).toBe("pending");
    expect(resolveSandboxOutcome(xof(1))).toBe("pending");
    expect(resolveSandboxOutcome(xof(13))).toBe("failure");
    expect(resolveSandboxOutcome(xof(25_001), "success")).toBe("success"); // le drapeau prime
    expect(resolveSandboxOutcome(xof(25_000), "failure")).toBe("failure");
    expect(resolveSandboxOutcome(xof(25_000), "bizarre")).toBe("success");
  });

  it("initiate est idempotent et cohérent avec verify", async () => {
    const p = new SandboxProvider();
    const id = newId();
    const first = await p.initiate({ tenantId: tenant, paymentId: id, amount: xof(25_001) });
    const second = await p.initiate({ tenantId: tenant, paymentId: id, amount: xof(25_001) });
    expect(first).toEqual(second);
    expect(first.ok && first.value.status).toBe("PENDING");
    const ref = first.ok ? first.value.providerRef! : "";
    const v1 = await p.verify({ paymentId: id, providerRef: ref });
    expect(v1.ok && v1.value.status).toBe("PENDING");
    const settled = p.settle(ref, "success");
    expect(settled.ok && settled.value.status).toBe("SUCCEEDED");
    const v2 = await p.verify({ paymentId: id, providerRef: ref });
    expect(v2.ok && v2.value.status).toBe("SUCCEEDED");
    expect(v2.ok && v2.value.amount?.amount).toBe(25_001);
    expect(p.settle(ref, "failure").ok).toBe(false); // déjà réglée
    expect((await p.verify({ paymentId: newId(), providerRef: "sbx_inconnu" })).ok).toBe(false);
  });

  it("succès et échec immédiats", async () => {
    const p = new SandboxProvider();
    const ok = await p.initiate({ tenantId: tenant, paymentId: newId(), amount: xof(10_000) });
    expect(ok.ok && ok.value.status).toBe("SUCCEEDED");
    const ko = await p.initiate({ tenantId: tenant, paymentId: newId(), amount: xof(10_013) });
    expect(ko.ok && ko.value.status).toBe("FAILED");
    const flagged = await p.initiate({ tenantId: tenant, paymentId: newId(), amount: xof(10_000), metadata: { sandbox: "pending" } });
    expect(flagged.ok && flagged.value.status).toBe("PENDING");
    expect((await p.initiate({ tenantId: tenant, paymentId: newId(), amount: xof(0) })).ok).toBe(false);
  });

  it("signature HMAC-SHA256 du corps brut : valide, altérée, absente, mal formée", async () => {
    const p = new SandboxProvider({ secret: "s3cr3t" });
    const init = await p.initiate({ tenantId: tenant, paymentId: newId(), amount: xof(25_001) });
    const ref = init.ok ? init.value.providerRef! : "";
    p.settle(ref, "success");
    const wh = p.buildWebhook(ref);
    expect(p.verifySignature(wh.rawBody, wh.headers)).toBe(true);
    expect(p.verifySignature(wh.rawBody + " ", wh.headers)).toBe(false); // un octet de plus
    expect(p.verifySignature(wh.rawBody, {})).toBe(false);
    expect(p.verifySignature(wh.rawBody, { [SANDBOX_SIGNATURE_HEADER]: "zz" })).toBe(false);
    expect(p.verifySignature(wh.rawBody, { [SANDBOX_SIGNATURE_HEADER]: "0".repeat(64) })).toBe(false);
    // un autre secret ne valide pas
    expect(new SandboxProvider({ secret: "autre" }).verifySignature(wh.rawBody, wh.headers)).toBe(false);
    // le secret par défaut est celui documenté
    expect(new SandboxProvider().sign("x")).toBe(new SandboxProvider({ secret: DEFAULT_SANDBOX_SECRET }).sign("x"));
  });

  it("analyse du webhook : statut, montant, identifiants ; rejets explicites", async () => {
    const p = new SandboxProvider();
    const id = newId();
    const init = await p.initiate({ tenantId: tenant, paymentId: id, amount: xof(25_001) });
    const ref = init.ok ? init.value.providerRef! : "";
    p.settle(ref, "failure");
    const wh = p.buildWebhook(ref);
    const parsed = await p.handleWebhook(wh.rawBody, wh.headers);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({ eventId: wh.eventId, status: "FAILED", paymentId: id, providerRef: ref });
      expect(parsed.value.amount?.amount).toBe(25_001);
    }
    expect((await p.handleWebhook("pas du json", {})).ok).toBe(false);
    expect((await p.handleWebhook(JSON.stringify({ id: "e", type: "inconnu" }), {})).ok).toBe(false);
    expect((await p.handleWebhook(JSON.stringify({ type: "payment.succeeded" }), {})).ok).toBe(false);
    expect((await p.handleWebhook(JSON.stringify({ id: "e", type: "payment.succeeded", amount: "abc" }), {})).ok).toBe(false);
  });

  it("buildWebhook sur une transaction inconnue lève (garde de test)", () => {
    expect(() => new SandboxProvider().buildWebhook("sbx_nope")).toThrow();
  });

  it("montants : Money entier uniquement dans le webhook", async () => {
    const p = new SandboxProvider();
    const r = await p.handleWebhook(JSON.stringify({ id: "e1", type: "payment.succeeded", amount: 12.5 }), {});
    expect(r.ok).toBe(false);
    expect(Money.of(5).amount).toBe(5);
  });
});
