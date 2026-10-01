import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, PERMISSION_KEY_RE, createRequestContext, newId, noopLogger, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { reportcardsEventPayloadSchemas } from "@ecoledigitale/contracts/src/v2/reportcards";
import * as contractsIndex from "@ecoledigitale/contracts/src/v2";
import { SYSTEM_ROLE_TEMPLATES, buildPermissionCatalog, rbacManifest, resolveSystemRoles } from "../../../rbac";
import { loadIsolationAllowlist, validateEntries } from "../../../../platform/isolation-allowlist-loader";
import { listPublicRoutes, resetPublicRoutesForTests, trackPublicRoutes } from "../../../../platform/public-routes";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import * as publicApi from "../../index";
import manifest from "../../manifest";
import jobs from "../../jobs";
import subscribers, { RENDER_ATTEMPTS, buildSubscribers } from "../../subscribers";
import allowlist, { fixtures, reportcardsIsolationAllowlistTables, reportcardsTenantTables } from "../../../isolation-allowlist.reportcards";
import { PERMISSIONS } from "../../http/guards";
import { ConsumedEvents } from "../../domain/events";
import { FakePdfRenderer, InMemoryResults } from "../../infrastructure/in-memory-ports";

const MODULE_DIR = resolve(__dirname, "../..");

describe("manifeste du module reportcards", () => {
  it("clé, dépendances, packs ; s'insère dans l'ordre topologique sans cycle", () => {
    expect(manifest).toMatchObject({ key: "reportcards", dependsOn: ["rbac"] });
    expect(manifest.packs).toEqual(["PRIMARY", "SECONDARY", "HIGHER", "VIRTUAL"]);
    const order = resolveModuleOrder([rbacManifest, manifest]).map((m) => m.key);
    expect(order.indexOf("rbac")).toBeLessThan(order.indexOf("reportcards"));
  });

  it("permissions : format valide, uniques, TOUTES utilisées par la couche HTTP ; sensibles = émission, publication, révocation, identité, signataires", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(PERMISSION_KEY_RE);
    expect(Object.values(PERMISSIONS).sort()).toEqual([...keys].sort());
    expect(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort()).toEqual([
      "reportcard.branding.manage",
      "reportcard.generate",
      "reportcard.publish",
      "reportcard.revoke",
      "reportcard.signatory.manage",
    ]);
  });

  it("événements publiés = schémas du contrat, noms `<module>.<entité>.<verbe-passé>` ; événements consommés = ceux des abonnés", () => {
    expect([...manifest.events.publishes].sort()).toEqual(Object.keys(reportcardsEventPayloadSchemas).sort());
    for (const type of manifest.events.publishes) expect(type).toMatch(/^reportcards\.[a-z_]+\.[a-z_]+$/);
    // Un module consomme aussi ses propres événements de rendu (abonnés du worker) : manifeste = abonnés, ni plus ni moins.
    expect([...manifest.events.consumes].sort()).toEqual(
      [ConsumedEvents.TENANT_PROVISIONED, "reportcards.snapshot.created", "reportcards.report_card.render_requested", "reportcards.batch.completed"].sort(),
    );
    const patterns = subscribers.map((s) => String(s.pattern));
    for (const consumed of manifest.events.consumes) expect(patterns).toContain(consumed);
    for (const pattern of patterns) expect(manifest.events.consumes).toContain(pattern);
  });

  it("menus : permission et feature déclarées ; features rattachées aux packs", () => {
    expect(manifest.features.map((f) => f.key).sort()).toEqual(["reportcard.block-unpaid", "reportcard.public-verification", "reportcard.transcript"]);
    for (const m of manifest.menus) {
      expect(manifest.permissions.some((p) => p.key === m.permission)).toBe(true);
      if (m.feature) expect(manifest.features.some((f) => f.key === m.feature)).toBe(true);
    }
  });

  it("contrats Zod : tous préfixés `reportcard…` et sans collision avec les exports des autres modules (l'index v2 est régénéré par le lead)", async () => {
    const own = await import("@ecoledigitale/contracts/src/v2/reportcards");
    const names = Object.keys(own);
    expect(names.length).toBeGreaterThan(60);
    expect(names.filter((n) => !/^(reportcards?|REPORTCARD)/i.test(n))).toEqual([]);
    // L'index v2 contient désormais aussi ce module : on ne compare qu'aux exports des AUTRES modules.
    const ownNames = new Set(names);
    const contractsDir = resolve(__dirname, "../../../../../../../packages/contracts/src/v2");
    const otherNames = new Set<string>();
    for (const file of readdirSync(contractsDir).filter((x) => x.endsWith(".ts") && x !== "index.ts" && x !== "reportcards.ts")) {
      const mod = await import(`@ecoledigitale/contracts/src/v2/${file.slice(0, -3)}`);
      for (const n of Object.keys(mod)) otherNames.add(n);
    }
    expect(names.filter((n) => otherNames.has(n))).toEqual([]);
    expect(Object.keys(contractsIndex).filter((n) => !ownNames.has(n) && n.startsWith("reportcards"))).toEqual([]);
  });

  it("fichiers conventionnels présents ; migrations dans la plage 1300-1399, numérotées, sans trou", () => {
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md"]) expect(existsSync(resolve(MODULE_DIR, file)), file).toBe(true);
    const migrations = readdirSync(resolve(MODULE_DIR, "migrations")).sort();
    expect(migrations.length).toBeGreaterThanOrEqual(4);
    migrations.forEach((f, i) => expect(f).toMatch(new RegExp(`^${1300 + i}_reportcards_[a-z_]+\\.sql$`)));
  });
});

describe("alignement avec les rôles système du module rbac", () => {
  const catalog = buildPermissionCatalog([manifest]);
  const roles = new Map(resolveSystemRoles(catalog).map((r) => [r.template.key, new Set(r.permissions)]));
  const can = (role: string, perm: string): boolean => roles.get(role)?.has(perm) === true;

  it("direction : tout ; parent : ses enfants seulement ; élève : lui-même seulement", () => {
    for (const p of manifest.permissions.map((x) => x.key)) {
      expect(can("directeur_etudes", p), p).toBe(true);
      expect(can("owner", p), p).toBe(true);
    }
    expect(can("parent", "reportcard.child.read")).toBe(true);
    expect(can("parent", "reportcard.read")).toBe(false);
    expect(can("parent", "reportcard.generate")).toBe(false);
    expect(can("eleve", "reportcard.self.read")).toBe(true);
    expect(can("eleve", "reportcard.read")).toBe(false);
    expect(can("eleve", "reportcard.child.read")).toBe(false);
    expect(can("responsable_pedagogique", "reportcard.read")).toBe(true);
    expect(can("responsable_pedagogique", "reportcard.generate")).toBe(false);
    expect(SYSTEM_ROLE_TEMPLATES.length).toBeGreaterThan(5);
  });
});

describe("abonnés et jobs du worker", () => {
  it("abonnés : noms stables et uniques, motifs exacts, 3 tentatives de rendu, concurrence bornée", () => {
    const names = subscribers.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(["reportcards.combine-batch", "reportcards.render-requested", "reportcards.render-snapshot", "reportcards.seed-templates"]);
    const render = subscribers.find((s) => s.name === "reportcards.render-snapshot")!;
    expect(render.pattern).toBe("reportcards.snapshot.created");
    expect(render.retry?.attempts).toBe(RENDER_ATTEMPTS);
    expect(RENDER_ATTEMPTS).toBe(3);
    expect(render.concurrency).toBeLessThanOrEqual(2);
    expect(subscribers.find((s) => s.name === "reportcards.render-requested")!.pattern).toBe("reportcards.report_card.render_requested");
    expect(subscribers.find((s) => s.name === "reportcards.combine-batch")!.pattern).toBe("reportcards.batch.completed");
    for (const s of subscribers) expect([...manifest.events.publishes, ConsumedEvents.TENANT_PROVISIONED]).toContain(String(s.pattern));
  });

  it("jobs : intégrité nocturne, filet de rendu, purge du journal ; par tenant ; cron valides", () => {
    expect(jobs.map((j) => j.name).sort()).toEqual(["reportcards.integrity-check", "reportcards.purge-verification-log", "reportcards.sweep-renders"]);
    for (const j of jobs) {
      expect(j.cron.trim().split(/\s+/).length).toBeGreaterThanOrEqual(5);
      expect(j.perTenant).toBe(true);
    }
  });

  it("le gestionnaire de rendu appelle le moteur injecté et ignore un payload sans identifiant", async () => {
    let called = 0;
    const subs = buildSubscribers((() => {
      called += 1;
      throw new Error("pas de dépendances en test unitaire");
    }) as never);
    const handler = subs.find((s) => s.name === "reportcards.render-snapshot")!.handler;
    const logs: unknown[] = [];
    const ctx = { logger: { warn: (...a: unknown[]) => logs.push(a), info: () => undefined, error: () => undefined }, attempt: 1, db: { ctx: createRequestContext({ tenantId: newId(), userId: newId() }) } } as never;
    await handler({ id: newId(), type: "reportcards.snapshot.created", payload: { v: 1 } } as never, ctx);
    expect(called).toBe(0);
    expect(logs).toHaveLength(1);
  });
});

describe("liste blanche d'isolation", () => {
  it("quatre tables globales justifiées (>= 20 caractères) ; le chargeur de la plateforme les accepte", async () => {
    expect(reportcardsIsolationAllowlistTables).toEqual(["reportcards.platform_templates", "reportcards.signing_keys", "reportcards.verification_index", "reportcards.file_hash_index"]);
    for (const e of allowlist) expect(e.reason.length).toBeGreaterThanOrEqual(20);
    expect(validateEntries(allowlist, "isolation-allowlist.reportcards.ts", "reportcards")).toHaveLength(4);
    const knownModules = readdirSync(resolve(MODULE_DIR, "..")).filter((d) => existsSync(resolve(MODULE_DIR, "..", d, "manifest.ts")));
    const loaded = await loadIsolationAllowlist({ knownModules });
    expect(loaded.tables).toEqual(expect.arrayContaining(reportcardsIsolationAllowlistTables as string[]));
    expect(Object.keys(fixtures).every((t) => t.startsWith("reportcards."))).toBe(true);
    expect(reportcardsTenantTables).toHaveLength(10);
  });
});

describe("API publique (index.ts)", () => {
  it("expose les ports, adaptateurs, cas d'usage et le port générique de scellement / rendu", () => {
    for (const name of [
      "reportcardsManifest", "registerReportcardsPorts", "reportcardsPlugin", "createReportcardsDeps", "InMemoryResults", "InMemoryStorage", "S3Storage", "StaticKeyProvider",
      "PuppeteerPdfRenderer", "createBatch", "reissueReportCard", "publishReportCard", "revokeReportCard", "getDownloadUrl", "verifyByCode", "verifyByFile", "renderReportCard",
      "sealDocument", "renderDocumentPdf", "registerVerificationFor", "canonicalJson", "snapshotHash", "encodeQr", "ensureBuiltinTemplates", "checkIntegrity",
    ]) {
      expect((publicApi as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it("sealDocument / renderDocumentPdf : natures inconnues refusées (AC8.2), signature et code produits pour les natures connues", async () => {
    const keys = new publicApi.StaticKeyProvider(publicApi.generateSigningKeyPair().privateKey, "seal-test-01");
    const deps = publicApi.createReportcardsDeps({ db: {} as never, keys });
    const bad = publicApi.sealDocument(deps, { kind: "LETTRE_LIBRE", snapshot: {}, issuedAt: new Date() });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("reportcards.unknown_document_kind");
    const sealed = publicApi.sealDocument(deps, { kind: "DIPLOMA", snapshot: { titre: "Diplôme", niveau: 3 }, issuedAt: new Date("2026-01-01T00:00:00Z") });
    expect(sealed.ok).toBe(true);
    if (sealed.ok) {
      expect(sealed.value.verificationCode).toMatch(/^[A-Z2-7]{26}$/);
      expect(publicApi.verifyDocumentSignature(keys.publicKey, { snapshotHash: sealed.value.snapshotHash, verificationCode: sealed.value.verificationCode, issuedAt: sealed.value.issuedAt }, sealed.value.signature)).toBe(true);
    }
    const floats = publicApi.sealDocument(deps, { kind: "PAYSLIP", snapshot: { net: 1.5 }, issuedAt: new Date() });
    expect(floats.ok).toBe(false);
    const noKey = publicApi.sealDocument(publicApi.createReportcardsDeps({ db: {} as never }), { kind: "DIPLOMA", snapshot: {}, issuedAt: new Date() });
    expect(noKey.ok).toBe(false);
    const rendered = await publicApi.renderDocumentPdf(publicApi.createReportcardsDeps({ db: {} as never }), createRequestContext({ tenantId: newId(), userId: newId() }), { kind: "NOPE", templateKey: "x", context: {}, title: "t", issuedAt: new Date() });
    expect(rendered.ok).toBe(false);
  });
});

describe("chargé par le registre de la plateforme", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    resetPublicRoutesForTests();
    await app?.close();
    app = undefined;
  });

  const tenant = newId();
  const ctx: RequestContext = createRequestContext({ tenantId: tenant, userId: newId() });
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grant: string[] = []) {
    const guarded: string[] = [];
    const fakeTx = { many: async () => [], query: async () => ({ rows: [], rowCount: 0 }), queryOne: async () => null };
    const runtime = {
      tenantDb: { run: async () => { throw new Error("pas de base"); } },
      systemDb: { run: async (_reason: string, fn: (tx: unknown) => unknown) => fn(fakeTx), runForTenant: async () => null },
      clock: systemClock,
      logger: noopLogger,
      env: {},
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      entitlements: { requireFeature: () => async () => undefined, isFeatureEnabled: async () => true, reader: { hasFeature: async () => true, getEntitlements: async () => ({ features: [] }) } },
      rateLimiter: { hit: async () => ({ allowed: true, count: 1, retryAfterMs: 0 }) },
      superAdminAuthorizer: { authorize: async () => { throw new ForbiddenError("opérateur requis"); } },
    } as unknown as ModuleRuntime;

    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });
    trackPublicRoutes(app);
    const discovered: DiscoveredModule = {
      key: "reportcards",
      dir: MODULE_DIR,
      manifestPath: resolve(MODULE_DIR, "manifest.ts"),
      manifest,
      pluginPath: resolve(MODULE_DIR, "http", "plugin.ts"),
      migrationsDir: resolve(MODULE_DIR, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, guarded, loaded };
  }

  it("routes sous /api/v1/reportcards (signature (app, runtime)), 401 sans contexte, 403 sans permission ; aucun préfixe doublé", async () => {
    const { app: instance, loaded, guarded } = await boot();
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/reportcards"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/reportcards/report-cards" })).statusCode).toBe(401);
    const denied = await instance.inject({ method: "GET", url: "/api/v1/reportcards/report-cards", headers: { "x-tenant": "1" } });
    expect(denied.statusCode).toBe(403);
    expect(guarded).toContain("reportcard.read");
    for (const p of guarded) expect(manifest.permissions.map((x) => x.key)).toContain(p);
    expect((await instance.inject({ method: "GET", url: "/report-cards", headers: { "x-tenant": "1" } })).statusCode).toBe(404);
  });

  it("chaque permission garde au moins une route (aucune permission déclarée inutile) et aucune route protégée n'utilise un rôle codé en dur", async () => {
    const { app: instance, guarded } = await boot(manifest.permissions.map((p) => p.key));
    const probes: Array<[string, string]> = [
      ["GET", "/preflight?classroomId=x"], ["POST", "/batches"], ["GET", "/report-cards"], ["GET", `/report-cards/${newId()}`], ["GET", `/report-cards/${newId()}/explain`],
      ["GET", `/report-cards/${newId()}/pdf`], ["POST", `/report-cards/${newId()}/publish`], ["POST", `/report-cards/${newId()}/revoke`], ["POST", `/report-cards/${newId()}/reissue`],
      ["GET", "/me/report-cards"], ["GET", `/children/${newId()}/report-cards`], ["GET", "/branding"], ["GET", "/signatories"], ["GET", "/templates"], ["POST", "/publish"],
    ];
    for (const [method, url] of probes) await instance.inject({ method: method as "GET", url: `/api/v1/reportcards${url}`, headers: { "x-tenant": "1" }, payload: method === "POST" ? {} : undefined });
    const used = new Set(guarded);
    for (const p of manifest.permissions.map((x) => x.key)) expect(used.has(p), p).toBe(true);
  });

  it("routes publiques déclarées `config.public` (relevées pour le middleware legacy) : vérification, clés, plateforme, .well-known ; joignables sans contexte", async () => {
    const { app: instance } = await boot();
    const publicUrls = listPublicRoutes().map((r) => `${r.method} ${r.url}`);
    expect(publicUrls).toEqual(
      expect.arrayContaining([
        "GET /api/v1/public/verify/:code",
        "POST /api/v1/public/verify/upload",
        "GET /api/v1/public/keys",
        "GET /.well-known/ecoledigitale-keys.json",
        "GET /api/v1/reportcards/public/verify/:code",
        "GET /api/v1/reportcards/platform/keys",
      ]),
    );
    const unknown = await instance.inject({ method: "GET", url: `/api/v1/public/verify/${"A".repeat(26)}` });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().status).toBe("UNKNOWN");
    const keys = await instance.inject({ method: "GET", url: "/.well-known/ecoledigitale-keys.json" });
    expect(keys.statusCode).toBe(200);
    expect(keys.json()).toMatchObject({ keys: [] });
    // Console plateforme : le jeton opérateur est exigé même si la route est « publique » pour la garde de contexte.
    expect((await instance.inject({ method: "GET", url: "/api/v1/reportcards/platform/keys" })).statusCode).toBe(403);
  });

  it("le registre de ports est décoré sur la racine : results, people… s'y enregistrent dans un ordre quelconque", async () => {
    const { app: instance } = await boot();
    expect(instance.hasDecorator("reportcardsPorts")).toBe(true);
    const results = new InMemoryResults();
    publicApi.registerReportcardsPorts(instance, { results, renderer: new FakePdfRenderer() });
    expect(instance.reportcardsPorts.current.results).toBe(results);
  });
});
