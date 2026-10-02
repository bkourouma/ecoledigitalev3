import { describe, expect, it } from "vitest";
import { createProviderRegistry, StaticProviderConfigSource, EnvProviderConfigSource, type AppEnvironment } from "../../infrastructure/providers/registry";
import { endpointsFromEnv, registerPaymentProviders } from "../../infrastructure/providers/definitions";
import { CompositeConfigSource } from "../../infrastructure/provider-config-source";
import { MAX_FIELD_LENGTH, catalogEntry, requiredSettingsOf, validateFieldValue } from "../../infrastructure/providers/catalog";
import { SECRETS, TEST_TENANT, testRuntime } from "../support/adapters";

const WAVE = { mode: "production", api_key: SECRETS.waveApiKey, webhook_secret: SECRETS.waveWebhookSecret, enabled: "true" };

function registryFor(environment: AppEnvironment, settings: Record<string, Record<string, string | undefined>> = {}) {
  const source = new StaticProviderConfigSource();
  for (const [name, s] of Object.entries(settings)) source.set(TEST_TENANT, name, s);
  const registry = createProviderRegistry({ environment, configSource: source });
  registerPaymentProviders(registry, testRuntime({}));
  return registry;
}

describe("registre : adaptateurs réels, mode explicite, jamais de simulation silencieuse", () => {
  it("non configuré : refus dans TOUS les environnements, seuls les NOMS des paramètres manquants sont exposés", async () => {
    for (const env of ["development", "test", "staging", "production"] as const) {
      const r = await registryFor(env).resolve(TEST_TENANT, "wave");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("finance.provider_not_configured");
        expect(r.error.details).toMatchObject({ provider: "wave", missing: ["mode", "api_key", "webhook_secret"] });
      }
    }
  });

  it("incomplet : liste uniquement les noms manquants, jamais une valeur", async () => {
    const r = await registryFor("production", { wave: { mode: "production", api_key: SECRETS.waveApiKey } }).resolve(TEST_TENANT, "wave");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.details).toMatchObject({ missing: ["webhook_secret"] });
      expect(JSON.stringify(r.error)).not.toContain(SECRETS.waveApiKey);
    }
  });

  it("le mode est EXPLICITE : absent => non configuré ; valeur inconnue => configuration invalide", async () => {
    const { mode: _m, ...noMode } = WAVE;
    const absent = await registryFor("production", { wave: noMode }).resolve(TEST_TENANT, "wave");
    expect(!absent.ok && absent.error.details).toMatchObject({ missing: ["mode"] });
    const bad = await registryFor("production", { wave: { ...WAVE, mode: "demo" } }).resolve(TEST_TENANT, "wave");
    expect(!bad.ok && bad.error.code).toBe("finance.provider_config_invalid");
  });

  it("mode sandbox d'un fournisseur : refusé en production, permis en staging, développement et test", async () => {
    const prod = await registryFor("production", { wave: { ...WAVE, mode: "sandbox" } }).resolve(TEST_TENANT, "wave");
    expect(!prod.ok && prod.error.code).toBe("finance.provider_sandbox_forbidden");
    for (const env of ["staging", "development", "test"] as const) {
      const r = await registryFor(env, { wave: { ...WAVE, mode: "sandbox" } }).resolve(TEST_TENANT, "wave");
      expect(r.ok).toBe(true);
    }
    // `allowSandbox` ne contourne PAS la règle des adaptateurs réels (il ne vaut que pour la sandbox interne).
    const bypass = await registryFor("production", { wave: { ...WAVE, mode: "sandbox", allowSandbox: "true" } }).resolve(TEST_TENANT, "wave");
    expect(bypass.ok).toBe(false);
  });

  it("production complète => adaptateur réel, jamais simulé", async () => {
    const r = await registryFor("production", { wave: WAVE }).resolve(TEST_TENANT, "wave");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.getProviderName()).toBe("wave");
      expect(r.value.simulated).toBe(false);
    }
  });

  it("fournisseur désactivé => refus explicite ; resolveWith(ignoreDisabled) pour le test de connexion", async () => {
    const registry = registryFor("production", { wave: { ...WAVE, enabled: "false" } });
    const r = await registry.resolve(TEST_TENANT, "wave");
    expect(!r.ok && r.error.code).toBe("finance.provider_disabled");
    expect((await registry.resolveWith(TEST_TENANT, "wave", { ...WAVE, enabled: "false" }, { ignoreDisabled: true })).ok).toBe(true);
  });

  it("repli de développement vers la sandbox : seulement s'il est demandé, jamais pour un adaptateur configuré, jamais en production", async () => {
    const dev = createProviderRegistry({ environment: "development", devSandboxFallback: true });
    registerPaymentProviders(dev, testRuntime({}));
    const r = await dev.resolve(TEST_TENANT, "orange_money");
    expect(r.ok && r.value.getProviderName()).toBe("sandbox");
    const prod = createProviderRegistry({ environment: "production", devSandboxFallback: true });
    registerPaymentProviders(prod, testRuntime({}));
    const p = await prod.resolve(TEST_TENANT, "orange_money");
    expect(!p.ok && p.error.code).toBe("finance.provider_not_configured");
  });

  it("l'instance est mise en cache par configuration ; une configuration modifiée produit une nouvelle instance", async () => {
    const source = new StaticProviderConfigSource().set(TEST_TENANT, "wave", WAVE);
    const registry = createProviderRegistry({ environment: "production", configSource: source });
    registerPaymentProviders(registry, testRuntime({}));
    const a = await registry.resolve(TEST_TENANT, "wave");
    const b = await registry.resolve(TEST_TENANT, "wave");
    source.set(TEST_TENANT, "wave", { ...WAVE, api_key: "AUTRE-CLE" });
    const c = await registry.resolve(TEST_TENANT, "wave");
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.value).toBe(b.value);
      expect(c.value).not.toBe(a.value);
    }
  });
});

describe("sources de configuration", () => {
  const env = new EnvProviderConfigSource({ FINANCE_PROVIDER_WAVE_API_KEY: "k", FINANCE_PROVIDER_WAVE_MODE: "production", FINANCE_PROVIDER_SANDBOX_ALLOWSANDBOX: "true" });
  const tenant = new StaticProviderConfigSource().set(TEST_TENANT, "cinetpay", { mode: "production", enabled: "true" });

  it("sans repli : un tenant sans configuration propre ne lit JAMAIS l'environnement (l'argent ne va pas au compte de la plateforme)", async () => {
    const c = new CompositeConfigSource(tenant, env, { allowEnvFallback: false, alwaysEnv: ["sandbox"] });
    expect(await c.get(TEST_TENANT, "wave")).toBeNull();
    expect(await c.get(TEST_TENANT, "cinetpay")).toMatchObject({ enabled: "true" });
    expect((await c.get(TEST_TENANT, "sandbox"))?.allowsandbox).toBe("true");
  });

  it("repli autorisé : l'environnement ne sert que quand le tenant n'a PAS de ligne ; une ligne désactivée n'est jamais contournée", async () => {
    const disabled = new StaticProviderConfigSource().set(TEST_TENANT, "wave", { enabled: "false", mode: "production" });
    const c = new CompositeConfigSource(disabled, env, { allowEnvFallback: true });
    expect(await c.get(TEST_TENANT, "wave")).toEqual({ enabled: "false", mode: "production" });
    const none = new CompositeConfigSource(new StaticProviderConfigSource(), env, { allowEnvFallback: true });
    expect(await none.get(TEST_TENANT, "wave")).toMatchObject({ api_key: "k", mode: "production" });
  });
});

describe("points d'accès et catalogue", () => {
  it("endpointsFromEnv : points d'accès de la plateforme uniquement", () => {
    expect(endpointsFromEnv({ FINANCE_PROVIDER_WAVE_BASE_URL: "https://w.test", FINANCE_PROVIDER_MTN_MOMO_SANDBOX_BASE_URL: "https://s.test", FINANCE_PROVIDER_CINETPAY_API_KEY: "x" })).toEqual({
      wave: { production: "https://w.test" },
      mtn_momo: { sandbox: "https://s.test" },
    });
  });

  it("requiredSettingsOf : le mode puis les champs obligatoires du catalogue", () => {
    expect(requiredSettingsOf(catalogEntry("wave")!)).toEqual(["mode", "api_key", "webhook_secret"]);
    expect(requiredSettingsOf(catalogEntry("cinetpay")!)).toEqual(["mode", "site_id", "api_key", "secret_key"]);
    expect(requiredSettingsOf(catalogEntry("mtn_momo")!)).toContain("subscription_key");
  });

  it("validateFieldValue : texte borné, sans caractère de contrôle, options et motifs respectés", () => {
    const site = catalogEntry("cinetpay")!.fields.find((f) => f.key === "site_id")!;
    const channels = catalogEntry("cinetpay")!.fields.find((f) => f.key === "channels")!;
    const secret = catalogEntry("wave")!.fields.find((f) => f.key === "api_key")!;
    expect(validateFieldValue(site, "105899")).toBeNull();
    expect(validateFieldValue(site, "abc")).not.toBeNull();
    expect(validateFieldValue(channels, "ALL")).toBeNull();
    expect(validateFieldValue(channels, "TOUT")).not.toBeNull();
    expect(validateFieldValue(secret, "x".repeat(MAX_FIELD_LENGTH))).toBeNull();
    expect(validateFieldValue(secret, "x".repeat(MAX_FIELD_LENGTH + 1))).not.toBeNull();
    expect(validateFieldValue(secret, "")).not.toBeNull();
    expect(validateFieldValue(secret, "   ")).not.toBeNull();
    expect(validateFieldValue(secret, "a\nb")).not.toBeNull();
    expect(validateFieldValue(secret, 42)).not.toBeNull();
  });
});
