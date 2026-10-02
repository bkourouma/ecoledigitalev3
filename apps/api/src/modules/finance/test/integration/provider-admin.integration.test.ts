/**
 * Configuration des fournisseurs par tenant (spec 015) : coffre des secrets, RLS A/B, audit, règles d'activation,
 * test de connexion, source de configuration du registre, routes HTTP (Postgres réel).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, createSystemContext, newId, unwrap, ManualClock } from "@ecoledigitale/kernel";
import { financeProviderListDtoSchema, financeProviderDtoSchema } from "@ecoledigitale/contracts/src/v2/finance";
import { clearProviderCredentials, listProviders, rotateProviderSecrets, saveProviderConfig, setProviderStatus, testProviderConnection } from "../../application/provider-admin";
import { createFinanceDeps, type FinanceDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/ports/audit";
import { financePlugin } from "../../http/plugin";
import { CompositeConfigSource, TenantProviderConfigSource } from "../../infrastructure/provider-config-source";
import { registerPaymentProviders } from "../../infrastructure/providers/definitions";
import { createProviderRegistry, EnvProviderConfigSource, type AppEnvironment } from "../../infrastructure/providers/registry";
import { AesGcmSecretStore, parseKeyring, unavailableSecretStore } from "../../infrastructure/secrets/aes-gcm-secret-store";
import { adminRows, createFinanceTestDb, describeIntegration, type FinanceTestDb } from "../support/db";
import { WaveMock } from "../support/mock-providers";
import { SECRETS, testRuntime } from "../support/adapters";
import manifest from "../../manifest";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const WAVE_FIELDS = { secrets: { api_key: SECRETS.waveApiKey, webhook_secret: SECRETS.waveWebhookSecret }, settings: {} };

describeIntegration("administration des fournisseurs de paiement (Postgres réel)", () => {
  let db: FinanceTestDb;
  let wave: WaveMock;
  let tenantA: string;
  let tenantB: string;
  let audit: RecordingAudit;
  let clock: ManualClock;
  let source: TenantProviderConfigSource;

  const build = (opts: { environment?: AppEnvironment; secrets?: AesGcmSecretStore | typeof unavailableSecretStore; webhookBaseUrl?: string | null } = {}): FinanceDeps => {
    const secrets = opts.secrets ?? new AesGcmSecretStore(parseKeyring(`k1:${k1}`)!);
    const own = new TenantProviderConfigSource({ db: db.tenantDb, secrets, audit, clock, ttlMs: 60_000 });
    source = own;
    const providers = createProviderRegistry({ environment: opts.environment ?? "test", configSource: new CompositeConfigSource(own, new EnvProviderConfigSource({}), { allowEnvFallback: false }) });
    registerPaymentProviders(providers, testRuntime({ wave: { production: wave.url, sandbox: wave.url } }, { clock }));
    return createFinanceDeps({
      db: db.tenantDb,
      clock,
      audit,
      providers,
      secrets,
      providerConfigChanged: (t, p) => own.invalidate(t, p || undefined),
      config: { environment: opts.environment ?? "test", webhookBaseUrl: opts.webhookBaseUrl === undefined ? "https://api.test.local" : opts.webhookBaseUrl },
    });
  };
  const ctxOf = (tenantId: string, userId: string = newId()) => createRequestContext({ tenantId, userId, roles: [] });
  const rowOf = async (tenantId: string, provider: string) =>
    (await adminRows<{ id: string; enabled: boolean; mode: string; settings: Record<string, string>; secrets: Record<string, string>; last_test_ok: boolean | null; last_test_code: string | null }>(
      db,
      "SELECT id, enabled, mode, settings, secrets, last_test_ok, last_test_code FROM finance.provider_configs WHERE tenant_id = $1 AND provider = $2",
      [tenantId, provider],
    ))[0];

  beforeAll(async () => {
    db = await createFinanceTestDb();
    wave = await new WaveMock(SECRETS.waveApiKey).start();
    tenantA = await db.createTenant();
    tenantB = await db.createTenant();
    audit = new RecordingAudit();
    clock = new ManualClock(new Date());
  });
  afterAll(async () => {
    await wave.stop();
    await db.drop();
  });

  describe("enregistrement et coffre", () => {
    it("les secrets sont SCELLÉS en base (jamais en clair), les réglages non secrets en clair, rien n'est renvoyé", async () => {
      const deps = build();
      const view = unwrap(await saveProviderConfig(deps, ctxOf(tenantA), { provider: "cinetpay", mode: "production", settings: { site_id: "105899", channels: "MOBILE_MONEY" }, secrets: { api_key: SECRETS.cinetApiKey, secret_key: SECRETS.cinetSecretKey } }));
      expect(view).toMatchObject({ provider: "cinetpay", configured: true, complete: true, enabled: false, mode: "production", missing: [] });
      const row = (await rowOf(tenantA, "cinetpay"))!;
      expect(row.settings).toEqual({ site_id: "105899", channels: "MOBILE_MONEY" });
      expect(Object.keys(row.secrets).sort()).toEqual(["api_key", "secret_key"]);
      for (const env of Object.values(row.secrets)) expect(env).toMatch(/^v1\.k1\.[A-Za-z0-9_-]{16}\./);
      const dump = JSON.stringify(await adminRows(db, "SELECT * FROM finance.provider_configs"));
      expect(dump).not.toContain(SECRETS.cinetApiKey);
      expect(dump).not.toContain(SECRETS.cinetSecretKey);
      // La vue indique « enregistré », sans valeur.
      const fields = Object.fromEntries(view.fields.map((f) => [f.key, f]));
      expect(fields.api_key).toMatchObject({ secret: true, isSet: true, value: null });
      expect(fields.site_id).toMatchObject({ secret: false, isSet: true, value: "105899" });
      expect(JSON.stringify(view)).not.toContain(SECRETS.cinetApiKey);
    });

    it("la base REFUSE un secret en clair, même pour un superutilisateur (contrainte secrets_are_sealed)", async () => {
      const id = newId();
      await expect(
        db.admin.query("INSERT INTO finance.provider_configs (id, tenant_id, provider, secrets) VALUES ($1,$2,'wave',$3::jsonb)", [id, tenantA, JSON.stringify({ api_key: "en-clair-interdit" })]),
      ).rejects.toThrow(/secrets_are_sealed|check constraint/i);
      await expect(
        db.admin.query("INSERT INTO finance.provider_configs (id, tenant_id, provider, secrets) VALUES ($1,$2,'wave',$3::jsonb)", [id, tenantA, JSON.stringify({ api_key: 42 })]),
      ).rejects.toThrow();
      await expect(
        db.admin.query("INSERT INTO finance.provider_configs (id, tenant_id, provider, mode) VALUES ($1,$2,'wave','demo')", [id, tenantA]),
      ).rejects.toThrow();
    });

    it("mise à jour partielle : un secret omis est CONSERVÉ ; clearSecrets le retire ; la configuration redevient incomplète et le fournisseur est désactivé d'office", async () => {
      const deps = build();
      const ctx = ctxOf(tenantA);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", mode: "production", ...WAVE_FIELDS }));
      unwrap(await setProviderStatus(deps, ctx, { provider: "wave", enabled: true }));
      const before = (await rowOf(tenantA, "wave"))!;
      unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", settings: { webhook_strategy: "shared_secret" } }));
      const after = (await rowOf(tenantA, "wave"))!;
      expect(after.secrets).toEqual(before.secrets);
      expect(after.enabled).toBe(true);
      expect(after.settings).toEqual({ webhook_strategy: "shared_secret" });

      const cleared = unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", clearSecrets: ["webhook_secret"] }));
      expect(cleared).toMatchObject({ complete: false, enabled: false, missing: ["webhook_secret"] });
      expect(Object.keys((await rowOf(tenantA, "wave"))!.secrets)).toEqual(["api_key"]);
      expect(audit.entries.at(-1)!.entry.metadata).toMatchObject({ secretFieldsCleared: ["webhook_secret"], disabledBecauseIncomplete: true });
    });

    it("validation : champ inconnu, secret dans les réglages, réglage dans les secrets, URL, valeurs vides ou trop longues, mode manquant à la création", async () => {
      const deps = build();
      const ctx = ctxOf(tenantA);
      const bad = async (input: Parameters<typeof saveProviderConfig>[2]) => {
        const r = await saveProviderConfig(deps, ctx, input);
        expect(r.ok).toBe(false);
        return r.ok ? "" : r.error.code;
      };
      expect(await bad({ provider: "wave", mode: "production", settings: { base_url: "https://evil.test" } })).toBe("finance.invalid_input");
      expect(await bad({ provider: "wave", mode: "production", settings: { api_key: "x" } })).toBe("finance.invalid_input");
      expect(await bad({ provider: "wave", mode: "production", secrets: { webhook_strategy: "x" } })).toBe("finance.invalid_input");
      expect(await bad({ provider: "cinetpay", mode: "production", settings: { site_id: "abc" } })).toBe("finance.invalid_input");
      expect(await bad({ provider: "wave", mode: "production", secrets: { api_key: "" } })).toBe("finance.invalid_input");
      expect(await bad({ provider: "wave", mode: "production", secrets: { api_key: "x".repeat(600) } })).toBe("finance.invalid_input");
      expect(await bad({ provider: "orange_money", mode: "production", secrets: { webhook_secret: "choisi-par-l-utilisateur" } })).toBe("finance.invalid_input"); // secret généré
      expect(await bad({ provider: "mtn_momo", secrets: { api_key: "x" } })).toBe("finance.invalid_input"); // mode obligatoire à la création
      expect(await bad({ provider: "inconnu", mode: "production" })).toBe("finance.provider_unknown");
    });

    it("secret généré par la plateforme (Orange) : créé une fois, jamais saisi, régénérable à la demande", async () => {
      const deps = build();
      const ctx = ctxOf(tenantA);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "orange_money", mode: "production", settings: { client_id: "om-client", country: "ci" }, secrets: { client_secret: SECRETS.orangeClientSecret, merchant_key: SECRETS.orangeMerchantKey } }));
      const first = (await rowOf(tenantA, "orange_money"))!.secrets.webhook_secret;
      expect(first).toBeTruthy();
      unwrap(await saveProviderConfig(deps, ctx, { provider: "orange_money", settings: { country: "ci" } }));
      expect((await rowOf(tenantA, "orange_money"))!.secrets.webhook_secret).toBe(first);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "orange_money", regenerateWebhookSecret: true }));
      expect((await rowOf(tenantA, "orange_money"))!.secrets.webhook_secret).not.toBe(first);
    });

    it("coffre INDISPONIBLE (aucune clé maître) : toute saisie refusée, jamais de repli en clair", async () => {
      const deps = build({ secrets: unavailableSecretStore });
      const r = await saveProviderConfig(deps, ctxOf(tenantB), { provider: "wave", mode: "production", ...WAVE_FIELDS });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.secrets_unavailable");
      expect(await rowOf(tenantB, "wave")).toBeUndefined();
      const list = unwrap(await listProviders(deps, ctxOf(tenantB)));
      expect(list.secretsAvailable).toBe(false);
      const rot = await rotateProviderSecrets(deps, ctxOf(tenantB));
      expect(rot.ok).toBe(false);
    });

    it("mode sandbox refusé en environnement de production ; accepté en staging", async () => {
      const prod = build({ environment: "production" });
      const r = await saveProviderConfig(prod, ctxOf(tenantB), { provider: "wave", mode: "sandbox", ...WAVE_FIELDS });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.provider_sandbox_forbidden");
      expect(unwrap(await listProviders(prod, ctxOf(tenantB))).items[0]!.sandboxAllowed).toBe(false);
      const staging = build({ environment: "staging" });
      expect((await saveProviderConfig(staging, ctxOf(tenantB), { provider: "wave", mode: "sandbox", ...WAVE_FIELDS })).ok).toBe(true);
      // Passer en production : l'activation d'un fournisseur resté en sandbox est refusée.
      unwrap(await setProviderStatus(staging, ctxOf(tenantB), { provider: "wave", enabled: true }));
      const act = await setProviderStatus(prod, ctxOf(tenantB), { provider: "wave", enabled: true });
      expect(act.ok).toBe(false); // un fournisseur en sandbox ne s'active pas (même déjà actif) en production
      const off = unwrap(await setProviderStatus(staging, ctxOf(tenantB), { provider: "wave", enabled: false }));
      expect(off.enabled).toBe(false);
      const re = await setProviderStatus(prod, ctxOf(tenantB), { provider: "wave", enabled: true });
      expect(re.ok).toBe(false);
      if (!re.ok) expect(re.error.code).toBe("finance.provider_sandbox_forbidden");
    });
  });

  describe("activation, résolution par le registre, audit", () => {
    it("activation refusée tant que la configuration est incomplète, avec les NOMS des champs manquants", async () => {
      const deps = build();
      const ctx = ctxOf(tenantB);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "tresorpay", mode: "production", settings: { merchant_id: "M-1" }, secrets: { api_key: SECRETS.tresorApiKey } }));
      const r = await setProviderStatus(deps, ctx, { provider: "tresorpay", enabled: true });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("finance.provider_not_configured");
        expect(r.error.details).toMatchObject({ missing: ["secret_key", "webhook_secret"] });
        expect(JSON.stringify(r.error)).not.toContain(SECRETS.tresorApiKey);
      }
      const none = await setProviderStatus(deps, ctx, { provider: "cinetpay", enabled: true });
      expect(none.ok).toBe(false);
    });

    it("le registre lit la configuration du tenant : désactivé => refus ; activé => adaptateur réel ; désactivation immédiate (cache invalidé)", async () => {
      const deps = build();
      const ctx = ctxOf(tenantA);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", mode: "production", ...WAVE_FIELDS }));
      const off = await deps.providers.resolve(tenantA, "wave");
      expect(!off.ok && off.error.code).toBe("finance.provider_disabled");
      unwrap(await setProviderStatus(deps, ctx, { provider: "wave", enabled: true }));
      const on = await deps.providers.resolve(tenantA, "wave");
      expect(on.ok && on.value.getProviderName()).toBe("wave");
      unwrap(await setProviderStatus(deps, ctx, { provider: "wave", enabled: false }));
      const off2 = await deps.providers.resolve(tenantA, "wave");
      expect(!off2.ok && off2.error.code).toBe("finance.provider_disabled");
      // Un autre tenant, sans configuration, n'hérite JAMAIS de celle-ci.
      const other = await deps.providers.resolve(tenantB, "cinetpay");
      expect(!other.ok && other.error.code).toBe("finance.provider_not_configured");
    });

    it("chaque écriture est auditée (sensible, NOMS de champs) et l'ouverture des secrets l'est aussi ; aucune valeur dans l'audit", async () => {
      audit.entries.length = 0;
      const deps = build();
      const ctx = ctxOf(tenantA);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", mode: "production", ...WAVE_FIELDS }));
      unwrap(await setProviderStatus(deps, ctx, { provider: "wave", enabled: true }));
      source.invalidate(tenantA);
      await deps.providers.resolve(tenantA, "wave"); // remplit le cache : ouverture des secrets
      unwrap(await clearProviderCredentials(deps, ctx, { provider: "wave" }));
      expect(audit.actions()).toEqual(expect.arrayContaining(["finance.provider.configured", "finance.provider.status_changed", "finance.provider_secret.accessed", "finance.provider.credentials_cleared"]));
      for (const { entry } of audit.entries) expect(entry.sensitive).toBe(true);
      const dump = JSON.stringify(audit.entries);
      for (const v of [SECRETS.waveApiKey, SECRETS.waveWebhookSecret]) expect(dump).not.toContain(v);
      const access = audit.entries.find((e) => e.entry.action === "finance.provider_secret.accessed")!.entry;
      expect(access.metadata).toMatchObject({ provider: "wave", purpose: "resolve" });
      expect((access.metadata as { fields: string[] }).fields.sort()).toEqual(["api_key", "webhook_secret"]);
      const cleared = (await rowOf(tenantA, "wave"))!;
      expect(cleared.secrets).toEqual({});
      expect(cleared.enabled).toBe(false);
    });

    it("une enveloppe copiée vers un autre tenant (ou illisible) n'est pas utilisable : champ manquant, jamais de clair, erreur journalisée sans secret", async () => {
      const deps = build();
      unwrap(await saveProviderConfig(deps, ctxOf(tenantA), { provider: "wave", mode: "production", ...WAVE_FIELDS }));
      unwrap(await setProviderStatus(deps, ctxOf(tenantA), { provider: "wave", enabled: true }));
      const a = (await rowOf(tenantA, "wave"))!;
      // Un attaquant (accès base) copie les enveloppes du tenant A vers le tenant B.
      await db.admin.query(
        "INSERT INTO finance.provider_configs (id, tenant_id, provider, enabled, mode, secrets) VALUES ($1,$2,'wave',true,'production',$3::jsonb) ON CONFLICT (tenant_id, provider) DO UPDATE SET secrets = EXCLUDED.secrets, enabled = true",
        [newId(), tenantB, JSON.stringify(a.secrets)],
      );
      source.invalidate(tenantB);
      const r = await deps.providers.resolve(tenantB, "wave");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.provider_not_configured");
      await db.admin.query("DELETE FROM finance.provider_configs WHERE tenant_id = $1", [tenantB]);
      source.invalidate(tenantB);
    });
  });

  describe("test de connexion", () => {
    it("clés valides : ok et résultat enregistré ; clé refusée : credentials_rejected ; jamais de paiement créé ; espacé", async () => {
      const deps = build();
      const ctx = ctxOf(tenantA);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", mode: "production", ...WAVE_FIELDS }));
      wave.reset();
      wave.sessions.clear();
      wave.creations = 0;
      const ok = unwrap(await testProviderConnection(deps, ctx, { provider: "wave" }));
      expect(ok).toMatchObject({ ok: true, code: "ok" });
      expect(wave.creations).toBe(0);
      expect(wave.calls("/v1/checkout/sessions", "POST")).toHaveLength(0);
      expect(await adminRows(db, "SELECT 1 FROM finance.payments")).toHaveLength(0);
      expect(await rowOf(tenantA, "wave")).toMatchObject({ last_test_ok: true, last_test_code: "ok" });

      const throttled = await testProviderConnection(deps, ctx, { provider: "wave" });
      expect(throttled.ok).toBe(false);
      if (!throttled.ok) expect(throttled.error.code).toBe("finance.provider_test_throttled");
      clock.advance(5_000);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", secrets: { api_key: "cle-refusee" } }));
      const bad = unwrap(await testProviderConnection(deps, ctx, { provider: "wave" }));
      expect(bad).toMatchObject({ ok: false, code: "credentials_rejected" });
      expect(await rowOf(tenantA, "wave")).toMatchObject({ last_test_ok: false, last_test_code: "credentials_rejected" });
      expect(audit.actions()).toContain("finance.provider.tested");
      expect(JSON.stringify(audit.entries)).not.toContain("cle-refusee");
    });

    it("non configuré : refus ; le fournisseur désactivé PEUT être testé (jamais utilisé pour un paiement)", async () => {
      const deps = build();
      const r = await testProviderConnection(deps, ctxOf(tenantB), { provider: "mtn_momo" });
      expect(r.ok).toBe(false);
      const ctx = ctxOf(tenantA);
      clock.advance(5_000);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "wave", secrets: { api_key: SECRETS.waveApiKey } }));
      unwrap(await setProviderStatus(deps, ctx, { provider: "wave", enabled: false }));
      expect((await rowOf(tenantA, "wave"))!.enabled).toBe(false);
      expect(unwrap(await testProviderConnection(deps, ctx, { provider: "wave" })).ok).toBe(true);
    });
  });

  describe("RLS A/B sur la configuration des fournisseurs", () => {
    it("un tenant ne lit ni n'écrit la configuration d'un autre (SQL applicatif sous RLS et cas d'usage)", async () => {
      const deps = build();
      unwrap(await saveProviderConfig(deps, ctxOf(tenantA), { provider: "cinetpay", mode: "production", settings: { site_id: "111111" }, secrets: { api_key: SECRETS.cinetApiKey, secret_key: SECRETS.cinetSecretKey } }));
      // Vue du tenant B : aucune trace de la configuration de A.
      const listB = unwrap(await listProviders(deps, ctxOf(tenantB)));
      const cinetB = listB.items.find((i) => i.provider === "cinetpay")!;
      expect(cinetB).toMatchObject({ configured: false, enabled: false });
      expect(cinetB.fields.find((f) => f.key === "site_id")).toMatchObject({ isSet: false, value: null });
      // SQL brut sous le contexte de B : zéro ligne ; écriture sur la ligne de A : zéro ligne affectée ; insertion pour A : refusée.
      await db.tenantDb.run(createSystemContext(tenantB), async (tx) => {
        expect(await tx.many("SELECT 1 FROM finance.provider_configs WHERE tenant_id = $1", [tenantA])).toHaveLength(0);
        expect(await tx.many("SELECT 1 FROM finance.provider_configs WHERE provider = 'cinetpay'")).toHaveLength(0);
        const upd = await tx.query("UPDATE finance.provider_configs SET enabled = true WHERE tenant_id = $1", [tenantA]);
        expect(upd.rowCount).toBe(0);
        await expect(
          tx.transaction((t) => t.query("INSERT INTO finance.provider_configs (id, tenant_id, provider) VALUES ($1,$2,'tresorpay')", [newId(), tenantA])),
        ).rejects.toThrow();
      });
      // A garde sa configuration intacte ; la source de configuration ne mélange pas les tenants.
      const listA = unwrap(await listProviders(deps, ctxOf(tenantA)));
      expect(listA.items.find((i) => i.provider === "cinetpay")!.fields.find((f) => f.key === "site_id")!.value).toBe("111111");
      source.invalidate(tenantA);
      unwrap(await setProviderStatus(deps, ctxOf(tenantA), { provider: "cinetpay", enabled: true }));
      expect((await source.get(tenantB, "cinetpay"))).toBeNull();
      expect((await source.get(tenantA, "cinetpay"))?.site_id).toBe("111111");
    });
  });

  describe("rotation des clés de chiffrement", () => {
    it("rechiffre avec la clé active ; les secrets restent utilisables ; ancienne clé retirable ensuite", async () => {
      const oldStore = new AesGcmSecretStore(parseKeyring(`k1:${k1}`)!);
      const deps1 = build({ secrets: oldStore });
      const ctx = ctxOf(tenantA);
      unwrap(await saveProviderConfig(deps1, ctx, { provider: "wave", mode: "production", ...WAVE_FIELDS }));
      unwrap(await setProviderStatus(deps1, ctx, { provider: "wave", enabled: true }));
      expect(Object.values((await rowOf(tenantA, "wave"))!.secrets).every((e) => e.startsWith("v1.k1."))).toBe(true);

      const newStore = new AesGcmSecretStore(parseKeyring(`k2:${k2},k1:${k1}`)!);
      const deps2 = build({ secrets: newStore });
      const r = unwrap(await rotateProviderSecrets(deps2, ctx));
      expect(r.keyId).toBe("k2");
      expect(r.rotated).toBeGreaterThanOrEqual(1);
      for (const [, env] of Object.entries((await rowOf(tenantA, "wave"))!.secrets)) expect(env.startsWith("v1.k2.")).toBe(true);
      expect(unwrap(await rotateProviderSecrets(deps2, ctx)).rotated).toBe(0);
      // Seule la nouvelle clé suffit désormais.
      const deps3 = build({ secrets: new AesGcmSecretStore(parseKeyring(`k2:${k2}`)!) });
      const resolved = await deps3.providers.resolve(tenantA, "wave");
      expect(resolved.ok).toBe(true);
      // Clé retirée avant rechiffrement : refus explicite, aucune donnée détruite.
      const lost = build({ secrets: new AesGcmSecretStore(parseKeyring(`k9:${randomBytes(32).toString("base64")}`)!) });
      const rot = await rotateProviderSecrets(lost, ctx);
      expect(rot.ok).toBe(false);
      if (!rot.ok) expect(rot.error.code).toBe("finance.secrets_unavailable");
    });
  });

  describe("URL de webhook", () => {
    it("construite depuis FINANCE_WEBHOOK_BASE_URL ; MTN : porte le jeton du tenant ; null sans base", async () => {
      const deps = build();
      const ctx = ctxOf(tenantA);
      unwrap(await saveProviderConfig(deps, ctx, { provider: "mtn_momo", mode: "production", settings: { target_environment: "mtnivorycoast" }, secrets: { api_user: "u", api_key: SECRETS.mtnApiKey, subscription_key: SECRETS.mtnSubscriptionKey } }));
      const list = unwrap(await listProviders(deps, ctx));
      const wave = list.items.find((i) => i.provider === "wave")!;
      expect(wave.webhookUrl).toBe(`https://api.test.local/api/v1/finance/webhooks/wave/${tenantA}`);
      const mtn = list.items.find((i) => i.provider === "mtn_momo")!;
      expect(mtn.webhookUrl).toMatch(new RegExp(`^https://api\\.test\\.local/api/v1/finance/webhooks/mtn_momo/${tenantA}\\?t=[0-9a-f]{64}$`));
      const none = unwrap(await listProviders(build({ webhookBaseUrl: null }), ctx));
      expect(none.items.every((i) => i.webhookUrl === null)).toBe(true);
    });
  });

  describe("routes HTTP /providers (permission sensible, aucun secret renvoyé)", () => {
    let app: FastifyInstance;
    let deps: FinanceDeps;
    beforeAll(async () => {
      deps = build();
      app = Fastify({ logger: false });
      app.addHook("onRequest", async (req) => {
        const tenant = req.headers["x-test-tenant"];
        if (typeof tenant === "string") (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: newId(), roles: [] });
      });
      await app.register(financePlugin, {
        deps,
        requirePermission: (permission) => async (req) => {
          if (!(req as unknown as { ctx?: unknown }).ctx) throw new UnauthorizedError();
          if (!String(req.headers["x-test-perms"] ?? "").split(",").includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
        },
      });
      await app.ready();
    });
    afterAll(async () => {
      await app.close();
    });
    const call = (method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE", url: string, tenant: string, perms: string[], body?: unknown) =>
      app.inject({ method, url: `/api/v1/finance${url}`, headers: { "x-test-tenant": tenant, "x-test-perms": perms.join(",") }, ...(body !== undefined ? { payload: body as object } : {}) });
    const MANAGE = ["finance.provider.manage"];

    it("la permission finance.provider.manage est déclarée SENSIBLE (MFA) et exigée par toutes les routes", async () => {
      const perm = manifest.permissions.find((p) => p.key === "finance.provider.manage")!;
      expect(perm.sensitive).toBe(true);
      const t = await db.createTenant();
      for (const [method, url, body] of [
        ["GET", "/providers"],
        ["PUT", "/providers/wave", { mode: "production" }],
        ["PATCH", "/providers/wave/status", { enabled: true }],
        ["POST", "/providers/wave/test"],
        ["DELETE", "/providers/wave/credentials"],
        ["POST", "/providers/rotate-secrets"],
      ] as const) {
        const denied = await call(method, url, t, ["finance.payment.create", "finance.payment.refund", "finance.fee.manage"], body);
        expect(denied.statusCode, `${method} ${url}`).toBe(403);
      }
      const anon = await app.inject({ method: "GET", url: "/api/v1/finance/providers" });
      expect(anon.statusCode).toBe(401);
    });

    it("parcours complet : enregistrer, lister, activer, tester, effacer — aucune réponse ne contient un secret", async () => {
      const t = await db.createTenant();
      const responses: string[] = [];
      const put = await call("PUT", "/providers/wave", t, MANAGE, { mode: "production", secrets: WAVE_FIELDS.secrets });
      responses.push(put.body);
      expect(put.statusCode).toBe(200);
      expect(financeProviderDtoSchema.safeParse(put.json()).success).toBe(true);
      const list = await call("GET", "/providers", t, MANAGE);
      responses.push(list.body);
      expect(list.statusCode).toBe(200);
      const parsed = financeProviderListDtoSchema.parse(list.json());
      expect(parsed.items.map((i) => i.provider)).toEqual(["orange_money", "mtn_momo", "wave", "cinetpay", "tresorpay"]);
      expect(parsed.items.find((i) => i.provider === "wave")).toMatchObject({ configured: true, complete: true });
      const on = await call("PATCH", "/providers/wave/status", t, MANAGE, { enabled: true });
      responses.push(on.body);
      expect(on.json()).toMatchObject({ enabled: true });
      const test = await call("POST", "/providers/wave/test", t, MANAGE);
      responses.push(test.body);
      expect(test.json()).toMatchObject({ ok: true, code: "ok" });
      const rot = await call("POST", "/providers/rotate-secrets", t, MANAGE);
      expect(rot.statusCode).toBe(200);
      const del = await call("DELETE", "/providers/wave/credentials", t, MANAGE);
      responses.push(del.body);
      expect(del.json()).toMatchObject({ enabled: false, complete: false });
      for (const body of responses) for (const secret of Object.values(SECRETS)) expect(body).not.toContain(secret);
      expect(JSON.stringify(responses)).not.toMatch(/v1\.k1\./); // pas même une enveloppe chiffrée
    });

    it("entrées refusées : champ inconnu, URL de point d'accès, fournisseur inconnu, secret vide, corps non strict", async () => {
      const t = await db.createTenant();
      for (const body of [{ mode: "production", baseUrl: "https://evil.test" }, { mode: "demo" }, { mode: "production", settings: { base_url: "https://evil.test" } }, { mode: "production", secrets: { api_key: "" } }]) {
        const r = await call("PUT", "/providers/wave", t, MANAGE, body);
        expect(r.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await call("PUT", "/providers/inconnu", t, MANAGE, { mode: "production" })).statusCode).toBe(400);
      expect((await call("PATCH", "/providers/wave/status", t, MANAGE, { enabled: "oui" })).statusCode).toBe(400);
      const noSecretLeak = await call("PUT", "/providers/wave", t, MANAGE, { mode: "production", secrets: { api_key: "SECRET-QUI-NE-DOIT-PAS-REVENIR", nope: "x" } });
      expect(noSecretLeak.statusCode).toBe(400);
      expect(noSecretLeak.body).not.toContain("SECRET-QUI-NE-DOIT-PAS-REVENIR");
    });

    it("un tenant ne voit jamais la configuration d'un autre par les routes", async () => {
      const a = await db.createTenant();
      const b = await db.createTenant();
      await call("PUT", "/providers/cinetpay", a, MANAGE, { mode: "production", settings: { site_id: "424242" }, secrets: { api_key: SECRETS.cinetApiKey, secret_key: SECRETS.cinetSecretKey } });
      const listB = await call("GET", "/providers", b, MANAGE);
      expect(listB.body).not.toContain("424242");
      expect(financeProviderListDtoSchema.parse(listB.json()).items.find((i) => i.provider === "cinetpay")).toMatchObject({ configured: false });
    });

    it("le webhook accepte POST et PUT et répond au GET de contrôle sans effet ; formulaire CinetPay lu en corps brut", async () => {
      const get = await app.inject({ method: "GET", url: `/api/v1/finance/webhooks/cinetpay/${tenantA}` });
      expect(get.statusCode).toBe(200);
      const form = await app.inject({ method: "POST", url: `/api/v1/finance/webhooks/cinetpay/${tenantA}`, headers: { "content-type": "application/x-www-form-urlencoded", "x-token": "0".repeat(64) }, payload: "cpm_site_id=1&cpm_trans_id=abc" });
      expect([401, 409, 404]).toContain(form.statusCode); // refusé : non configuré / signature invalide, jamais 415
      const put = await app.inject({ method: "PUT", url: `/api/v1/finance/webhooks/mtn_momo/${tenantA}?t=${"0".repeat(64)}`, headers: { "content-type": "application/json" }, payload: "{}" });
      expect(put.statusCode).not.toBe(404);
      expect(put.statusCode).not.toBe(415);
    });
  });
});
