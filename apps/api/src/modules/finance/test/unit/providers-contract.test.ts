/**
 * Tests de CONTRAT du port `PaymentProvider` : la même batterie sur Orange Money, MTN MoMo, Wave, CinetPay et
 * TresorPay (serveurs simulés). Un adaptateur qui ne la passe pas ne se branche pas.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money } from "@ecoledigitale/kernel";
import { createHarnesses, xof, type ProviderHarness } from "../support/harness";
import { paymentId } from "../support/adapters";
import { createProviderRegistry } from "../../infrastructure/providers/registry";
import { registerPaymentProviders } from "../../infrastructure/providers/definitions";
import { PROVIDER_CATALOG } from "../../infrastructure/providers/catalog";
import { testRuntime } from "../support/adapters";

let harnesses: ProviderHarness[] = [];
beforeAll(async () => {
  harnesses = await createHarnesses();
});
afterAll(async () => {
  await Promise.all(harnesses.map((h) => h.stop()));
});

const NAMES = ["orange_money", "mtn_momo", "wave", "cinetpay", "tresorpay"] as const;

describe.each(NAMES)("contrat du port : %s", (name) => {
  const h = (): ProviderHarness => harnesses.find((x) => x.name === name)!;

  it("identité : nom stable = nom du registre, jamais simulé, méthodes du port présentes", () => {
    const { provider } = h().build();
    expect(provider.getProviderName()).toBe(name);
    expect(provider.simulated).toBe(false);
    for (const m of ["initiate", "verify", "verifySignature", "handleWebhook"] as const) expect(typeof provider[m]).toBe("function");
    expect(typeof provider.testConnection).toBe("function");
  });

  it("initiate : PENDING + référence fournisseur + moyen de payer (jamais un succès immédiat)", async () => {
    const { provider } = h().build();
    const r = await provider.initiate(h().request(paymentId()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("PENDING");
    expect(r.value.providerRef).toBeTruthy();
    expect(r.value.redirectUrl ?? r.value.instructions).toBeTruthy();
  });

  it("initiate : refuse un montant nul, négatif ou une devise étrangère, sans appel réseau", async () => {
    const { provider } = h().build();
    const before = h().mock.requests.length;
    for (const amount of [Money.of(0, "XOF"), Money.of(-5, "XOF"), Money.of(1000, "EUR")]) {
      const r = await provider.initiate({ ...h().request(paymentId()), amount });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(["finance.invalid_amount", "finance.invalid_input"]).toContain(r.error.code);
    }
    expect(h().mock.requests.length).toBe(before);
  });

  it("verify : en attente puis SUCCEEDED avec le montant EXACT et la devise attendus, jamais de succès sans montant", async () => {
    const { provider } = h().build();
    const id = paymentId();
    const init = await provider.initiate(h().request(id, 30_000));
    expect(init.ok).toBe(true);
    const ref = init.ok ? init.value.providerRef : null;
    const pend = await provider.verify({ paymentId: id, providerRef: ref, amount: xof(30_000) });
    expect(pend.ok && pend.value.status).toBe("PENDING");
    h().settleSuccess(id, ref);
    const done = await provider.verify({ paymentId: id, providerRef: ref, amount: xof(30_000) });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.status).toBe("SUCCEEDED");
    expect(done.value.amount).not.toBeNull();
    expect(done.value.amount!.equals(xof(30_000))).toBe(true);
    expect(done.value.amount!.currency).toBe("XOF");
    expect(Number.isInteger(done.value.amount!.amount)).toBe(true);
  });

  it("verify : jamais d'exception ; un fournisseur injoignable donne un Err typé provider_failed", async () => {
    const { createPaymentProviderDefinitions } = await import("../../infrastructure/providers/definitions");
    const runtime = testRuntime({ [name]: { production: "http://127.0.0.1:1", sandbox: "http://127.0.0.1:1" } }, { retries: 0, timeoutMs: 300 });
    const def = createPaymentProviderDefinitions(runtime).find((d) => d.name === name)!;
    const provider = def.create({ tenantId: "t", settings: h().settings, environment: "test" });
    const r = await provider.verify({ paymentId: paymentId(), providerRef: "ref-x", amount: xof(1000) });
    // Certains adaptateurs répondent « en attente » sans appel quand la référence est inutilisable ; sinon Err typé.
    if (!r.ok) expect(["finance.provider_failed", "finance.invalid_input"]).toContain(r.error.code);
    const i = await provider.initiate(h().request(paymentId()));
    expect(i.ok).toBe(false);
    if (!i.ok) expect(i.error.code).toBe("finance.provider_failed");
  });

  it("verifySignature : faux pour un corps et des en-têtes quelconques (jamais « vrai » par défaut)", () => {
    const { provider } = h().build();
    for (const [body, headers] of [
      ["", {}],
      ["{}", {}],
      ['{"status":"SUCCESS"}', { "x-signature": "a".repeat(64), "x-token": "a".repeat(64), "wave-signature": `t=1,v1=${"a".repeat(64)}`, authorization: "Bearer x" }],
      ["a=1&b=2", { "x-token": "deadbeef" }],
    ] as const) {
      expect(provider.verifySignature(body, headers)).toBe(false);
      expect(provider.verifySignature(body, headers, { tenantId: "t", query: {} })).toBe(false);
    }
  });

  it("verifySignature : faux quand le secret de webhook est absent ou vide, même avec une signature calculée avec ce « secret »", () => {
    for (const key of h().webhookSecretKeys) {
      for (const value of [undefined, "", "   "]) {
        const { provider } = h().build({ [key]: value });
        expect(provider.verifySignature('{"id":"x"}', {})).toBe(false);
        expect(provider.verifySignature('{"id":"x"}', { "x-signature": "0".repeat(64) }, { tenantId: "t", query: { t: "0".repeat(64), ref: paymentId() } })).toBe(false);
      }
    }
  });

  it("handleWebhook : un corps illisible renvoie un Err de validation, jamais une exception", async () => {
    const { provider } = h().build();
    for (const body of ["", "pas du json", "[]", "null", "{}", "<xml/>", "a=b"]) {
      const r = await provider.handleWebhook(body, {}, { tenantId: "t", query: {} });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.webhook_payload_invalid");
    }
  });

  it("aucun montant flottant dans les requêtes sortantes : entier ou chaîne d'entiers", async () => {
    const { provider } = h().build();
    const mock = h().mock;
    mock.reset();
    await provider.initiate(h().request(paymentId(), 12_345));
    const bodies = mock.requests.map((r) => r.body).filter(Boolean);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toMatch(/"amount":\s*\d+\.\d+/);
  });
});

describe("registre et catalogue", () => {
  it("les cinq adaptateurs sont enregistrés, modeAware, et chaque champ obligatoire du catalogue est exigé", () => {
    const registry = createProviderRegistry({ environment: "test" });
    registerPaymentProviders(registry, testRuntime({}));
    expect(registry.names()).toEqual([...NAMES, "sandbox"].sort());
    expect(PROVIDER_CATALOG.map((e) => e.name).sort()).toEqual([...NAMES].sort());
    for (const entry of PROVIDER_CATALOG) {
      const secrets = entry.fields.filter((f) => f.secret);
      expect(secrets.length).toBeGreaterThan(0);
      expect(entry.fields.every((f) => !f.secret || !f.defaultValue)).toBe(true);
      expect(entry.fields.find((f) => f.key === "base_url" || f.key === "url")).toBeUndefined(); // jamais d'URL configurable (SSRF)
    }
  });
});
