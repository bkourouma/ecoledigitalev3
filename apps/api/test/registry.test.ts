import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@ecoledigitale/kernel";
import {
  ModuleRegistryError,
  discoverModules,
  getLoadedManifests,
  getLoadedModules,
  registerModules,
  resetRegistryForTests,
} from "../src/modules/registry";
import { makeFakeModules, makeTmpDir, type FakeModules } from "./helpers/fixtures";

let fake: FakeModules | undefined;
afterEach(() => {
  fake?.cleanup();
  fake = undefined;
  resetRegistryForTests();
});

const perm = (key: string) => ({ key, label: key });

describe("découverte des modules", () => {
  it("découvre les dossiers modules/*/manifest sans fichier central et ignore les dossiers _ et .", async () => {
    fake = makeFakeModules({
      beta: { manifest: {} },
      alpha: { manifest: {} },
      _template: { manifest: null },
    });
    mkdirSync(join(fake.dir, ".cache"));
    const found = await discoverModules({ modulesDir: fake.dir, importer: fake.importer });
    expect(found.map((m) => m.key)).toEqual(["alpha", "beta"]);
  });

  it("ordonne par dépendances (topologique), pas par ordre alphabétique", async () => {
    fake = makeFakeModules({
      alpha: { manifest: { dependsOn: ["zeta"] } },
      mid: { manifest: { dependsOn: ["alpha"] } },
      zeta: { manifest: {} },
    });
    const found = await discoverModules({ modulesDir: fake.dir, importer: fake.importer });
    expect(found.map((m) => m.key)).toEqual(["zeta", "alpha", "mid"]);
  });

  it("repère http/plugin et migrations/ de chaque module", async () => {
    fake = makeFakeModules({
      with_all: { plugin: true, migrations: { "0001_init.sql": "SELECT 1;" } },
      bare: {},
    });
    const found = await discoverModules({ modulesDir: fake.dir, importer: fake.importer });
    const all = found.find((m) => m.key === "with_all");
    const bare = found.find((m) => m.key === "bare");
    expect(all?.pluginPath).toMatch(/plugin\.ts$/);
    expect(all?.migrationsDir).toMatch(/migrations$/);
    expect(bare?.pluginPath).toBeNull();
    expect(bare?.migrationsDir).toBeNull();
  });

  it("refuse une dépendance inconnue", async () => {
    fake = makeFakeModules({ solo: { manifest: { dependsOn: ["ghost"] } } });
    await expect(discoverModules({ modulesDir: fake.dir, importer: fake.importer })).rejects.toThrow(/inconnue "ghost"/);
  });

  it("refuse un cycle de dépendances", async () => {
    fake = makeFakeModules({ a: { manifest: { dependsOn: ["b"] } }, b: { manifest: { dependsOn: ["a"] } } });
    await expect(discoverModules({ modulesDir: fake.dir, importer: fake.importer })).rejects.toThrow(/Cycle/);
  });

  it("refuse une permission déclarée par deux modules", async () => {
    fake = makeFakeModules({
      a: { manifest: { permissions: [perm("shared.thing.read")] } },
      b: { manifest: { permissions: [perm("shared.thing.read")] } },
    });
    await expect(discoverModules({ modulesDir: fake.dir, importer: fake.importer })).rejects.toThrow(/Permission "shared.thing.read"/);
  });

  it("refuse une clé différente du nom du dossier (= schéma Postgres)", async () => {
    fake = makeFakeModules({ folder: { manifest: { key: "other" } } });
    await expect(discoverModules({ modulesDir: fake.dir, importer: fake.importer })).rejects.toThrow(/clé doit être égale au nom du dossier/);
  });

  it("refuse un manifeste invalide (pack inconnu) avec le chemin du fichier", async () => {
    fake = makeFakeModules({ broken: { manifest: { packs: ["NOPE"] } } });
    const error = await discoverModules({ modulesDir: fake.dir, importer: fake.importer }).catch((e) => e);
    expect(error).toBeInstanceOf(ModuleRegistryError);
    expect(error.message).toMatch(/Manifeste invalide .*manifest\.ts.*pack inconnu/);
  });

  it("refuse un dossier de module sans manifest.ts", async () => {
    fake = makeFakeModules({ orphan: { manifest: null } });
    await expect(discoverModules({ modulesDir: fake.dir, importer: fake.importer })).rejects.toThrow(/n'a pas de manifest\.ts/);
  });

  it("remonte l'échec de chargement d'un manifeste", async () => {
    fake = makeFakeModules({ ok: {} });
    await expect(
      discoverModules({ modulesDir: fake.dir, importer: async () => Promise.reject(new Error("boom")) }),
    ).rejects.toThrow(/Impossible de charger .*boom/);
  });

  it("charge un vrai fichier manifest.js par l'importer par défaut (interop CJS)", async () => {
    const tmp = makeTmpDir();
    try {
      mkdirSync(join(tmp.dir, "real_mod"));
      writeFileSync(
        join(tmp.dir, "real_mod", "manifest.js"),
        'module.exports = { default: { key: "real_mod", title: "Réel", packs: ["CORE"] } };\n',
      );
      const found = await discoverModules({ modulesDir: tmp.dir });
      expect(found.map((m) => m.key)).toEqual(["real_mod"]);
      expect(found[0]?.manifest.title).toBe("Réel");
    } finally {
      tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  // Stubs de ce que fournit le plugin v2-context (testé ailleurs).
  app.decorate("v2", { tenantDb: {}, systemDb: {}, manifests: [], logger: console, pool: {} } as never);
  app.decorateRequest("ctx", null as never);
  app.addHook("preHandler", async (request) => {
    if (request.headers["x-test-auth"]) request.ctx = { tenantId: "t", requestId: "r" } as never;
  });
  return app;
}

describe("chargement des plugins", () => {
  let app: FastifyInstance;
  beforeEach(() => {
    app = buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("charge les plugins dans l'ordre topologique sous /api/v1/<key>", async () => {
    const loadOrder: string[] = [];
    const plugin = (key: string) => async (instance: FastifyInstance) => {
      loadOrder.push(key);
      instance.get("/ping", async () => ({ module: key }));
    };
    fake = makeFakeModules({
      alpha: { manifest: { dependsOn: ["zeta"] }, plugin: plugin("alpha") },
      zeta: { plugin: plugin("zeta") },
      no_http: {},
    });
    const loaded = await registerModules(app, { enabled: true, modulesDir: fake.dir, importer: fake.importer });

    expect(loadOrder).toEqual(["zeta", "alpha"]);
    expect(loaded.map((m) => m.key)).toEqual(["zeta", "alpha", "no_http"]);
    expect(loaded.find((m) => m.key === "no_http")?.hasPlugin).toBe(false);
    expect(loaded.find((m) => m.key === "alpha")?.prefix).toBe("/api/v1/alpha");

    const res = await app.inject({ method: "GET", url: "/api/v1/alpha/ping", headers: { "x-test-auth": "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ module: "alpha" });
    expect((await app.inject({ method: "GET", url: "/ping", headers: { "x-test-auth": "1" } })).statusCode).toBe(404);
  });

  it("expose getLoadedManifests() dans l'ordre topologique", async () => {
    expect(getLoadedManifests()).toEqual([]);
    fake = makeFakeModules({ alpha: { manifest: { dependsOn: ["zeta"] } }, zeta: {} });
    await registerModules(app, { enabled: true, modulesDir: fake.dir, importer: fake.importer });
    expect(getLoadedManifests().map((m) => m.key)).toEqual(["zeta", "alpha"]);
    expect(getLoadedModules()).toHaveLength(2);
  });

  it("ne charge RIEN et avertit quand les modules v2 sont désactivés (V2_DATABASE_URL absent)", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const plugin = vi.fn();
    fake = makeFakeModules({ alpha: { plugin } });
    const loaded = await registerModules(app, { enabled: false, modulesDir: fake.dir, importer: fake.importer, logger });
    expect(loaded).toEqual([]);
    expect(getLoadedManifests()).toEqual([]);
    expect(plugin).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[1])).toMatch(/V2_DATABASE_URL/);
  });

  it("par défaut, l'activation dépend de V2_DATABASE_URL", async () => {
    const saved = process.env.V2_DATABASE_URL;
    delete process.env.V2_DATABASE_URL;
    try {
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      expect(await registerModules(app, { logger })).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.V2_DATABASE_URL = saved;
    }
  });

  it("exige app.v2 (plugin v2-context) quand il est activé", async () => {
    const bare = Fastify({ logger: false });
    fake = makeFakeModules({ alpha: {} });
    await expect(registerModules(bare, { enabled: true, modulesDir: fake.dir, importer: fake.importer })).rejects.toThrow(/v2-context/);
    await bare.close();
  });

  it("refuse un plugin qui n'exporte pas une fonction", async () => {
    fake = makeFakeModules({ alpha: { plugin: true } });
    const importer = async (path: string) => (path.endsWith("plugin.ts") ? { default: 42 } : fake!.importer(path));
    await expect(registerModules(app, { enabled: true, modulesDir: fake.dir, importer })).rejects.toThrow(/plugin Fastify/);
  });

  it("traduit les erreurs du kernel en réponses JSON stables, sans fuite des erreurs inconnues", async () => {
    fake = makeFakeModules({
      errs: {
        plugin: async (instance: FastifyInstance) => {
          instance.get("/missing", async () => {
            throw NotFoundError.of("Élève", "42");
          });
          instance.get("/crash", async () => {
            throw new Error("SELECT secret FROM pg_authid");
          });
        },
      },
    });
    await registerModules(app, { enabled: true, modulesDir: fake.dir, importer: fake.importer });

    const missing = await app.inject({ method: "GET", url: "/api/v1/errs/missing", headers: { "x-test-auth": "1" } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "NOT_FOUND", kind: "not_found", status: 404 });

    const crash = await app.inject({ method: "GET", url: "/api/v1/errs/crash", headers: { "x-test-auth": "1" } });
    expect(crash.statusCode).toBe(500);
    expect(crash.json().code).toBe("INTERNAL");
    expect(crash.body).not.toContain("pg_authid");
  });

  it("répond 401 sans contexte, sauf route déclarée publique", async () => {
    fake = makeFakeModules({
      guarded: {
        plugin: async (instance: FastifyInstance) => {
          instance.get("/private", async () => ({ ok: true }));
          instance.get("/open", { config: { public: true } }, async () => ({ ok: true }));
        },
      },
    });
    await registerModules(app, { enabled: true, modulesDir: fake.dir, importer: fake.importer });

    const denied = await app.inject({ method: "GET", url: "/api/v1/guarded/private" });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().code).toBe("UNAUTHORIZED");
    expect((await app.inject({ method: "GET", url: "/api/v1/guarded/private", headers: { "x-test-auth": "1" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/v1/guarded/open" })).statusCode).toBe(200);
  });

  it("n'affecte pas le gestionnaire d'erreurs ni les gardes des routes hors modules", async () => {
    app.get("/legacy", async () => {
      throw new Error("legacy boom");
    });
    fake = makeFakeModules({ alpha: { plugin: true } });
    await registerModules(app, { enabled: true, modulesDir: fake.dir, importer: fake.importer });
    const res = await app.inject({ method: "GET", url: "/legacy" });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toBe("legacy boom"); // comportement Fastify par défaut, inchangé
  });
});
