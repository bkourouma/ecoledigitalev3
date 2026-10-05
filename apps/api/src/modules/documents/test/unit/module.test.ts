/**
 * Tests unitaires (sans base de données) : manifeste, fichiers conventionnels, migrations, et chargement du plugin PAR LE REGISTRE
 * (signature (app, runtime), préfixe /api/v1/documents, gardes de permission, garde de contexte, validation avant tout accès aux
 * données, 429 du limiteur).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import { registerDocumentsPorts } from "../../http/plugin";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctxOf = (userId: string): RequestContext => createRequestContext({ tenantId: TENANT, userId });

describe("module documents : manifeste", () => {
  it("déclare un manifeste valide dont les permissions, menus et features sont préfixés par la clé", () => {
    expect(manifest.key).toBe("documents");
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
    for (const permission of manifest.permissions) expect(permission.key.startsWith("documents.")).toBe(true);
    for (const menu of manifest.menus) expect(manifest.permissions.map((p) => p.key)).toContain(menu.permission);
    for (const feature of manifest.features) expect(feature.key.startsWith("documents.")).toBe(true);
    for (const menu of manifest.menus.filter((m) => m.feature)) expect(manifest.features.map((f) => f.key)).toContain(menu.feature);
  });

  it("déclare les niveaux de lecture, les conventions `child` / `self` / `own` et marque confidentiel, gestion et quarantaine sensibles", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["documents.read", "documents.read.restricted", "documents.read.confidential", "documents.child.read", "documents.child.upload", "documents.self.read", "documents.self.upload", "documents.own.read", "documents.own.upload"]));
    expect(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort()).toEqual(["documents.manage", "documents.quarantine.manage", "documents.read.confidential"]);
  });

  it("publie des événements <module>.<entité>.<verbe> dont l'alerte d'expiration, et ne consomme rien", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^documents\.[a-z_]+\.[a-z_]+$/);
    expect(manifest.events.publishes).toEqual(expect.arrayContaining(["documents.document.expiring", "documents.document.expired", "documents.document.version_added", "documents.upload.quarantined"]));
    expect(manifest.events.consumes).toEqual([]);
  });

  it("ses fichiers conventionnels existent et les migrations respectent la plage 2500-2599", () => {
    const dir = resolve(__dirname, "../..");
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md"]) expect(existsSync(resolve(dir, file)), file).toBe(true);
    const migrations = readdirSync(resolve(dir, "migrations")).sort();
    expect(migrations.length).toBeGreaterThan(0);
    for (const file of migrations) {
      const n = Number(file.slice(0, 4));
      expect(n, file).toBeGreaterThanOrEqual(2500);
      expect(n, file).toBeLessThanOrEqual(2599);
    }
  });

  it("les migrations ne référencent aucun autre schéma que kernel et documents (aucune FK inter-modules) et n'accordent jamais DELETE", () => {
    const dir = resolve(__dirname, "../../migrations");
    const sql = readdirSync(dir).map((f) => readFileSync(resolve(dir, f), "utf8")).join("\n").replace(/--.*$/gm, "");
    const refs = [...sql.matchAll(/REFERENCES\s+([a-z_]+)\./gi)].map((m) => m[1]!.toLowerCase());
    for (const schema of refs) expect(["kernel", "documents"]).toContain(schema);
    expect(sql).not.toMatch(/\b(people|academic|rbac|iam|tenancy|attendance|messaging)\./i);
    for (const grant of sql.matchAll(/GRANT\s+([^;]*?)\s+ON\s+documents\.[a-z_]+\s+TO\s+app_user/gi)) expect(grant[1], grant[0]).not.toMatch(/DELETE/i);
  });

  it("les défauts du code (paramètres) sont ceux de la table", async () => {
    const { DEFAULT_SETTINGS } = await import("../../infrastructure/settings-repository");
    const sql = readFileSync(resolve(__dirname, "../../migrations/2500_documents_reference.sql"), "utf8");
    // Q-03 : le défaut de rétention a été changé par une migration ultérieure (2503), jamais en réécrivant 2500.
    const later = readFileSync(resolve(__dirname, "../../migrations/2503_documents_retention_never.sql"), "utf8");
    expect(later).toContain(`ALTER COLUMN archive_retention_days SET DEFAULT ${DEFAULT_SETTINGS.archiveRetentionDays}`);
    expect(DEFAULT_SETTINGS.archiveRetentionDays).toBe(0);
    expect(sql).toContain(`max_bytes                 integer NOT NULL DEFAULT ${DEFAULT_SETTINGS.maxBytes}`);
    expect(sql).toContain(`ARRAY[${DEFAULT_SETTINGS.defaultAlertDays.join(", ")}]`);
    expect(sql).toContain(`quarantine_retention_days integer NOT NULL DEFAULT ${DEFAULT_SETTINGS.quarantineRetentionDays}`);
    expect(sql).toContain(`max_versions              integer NOT NULL DEFAULT ${DEFAULT_SETTINGS.maxVersions}`);
  });
});

describe("module documents : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });

  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

  async function boot(grants: string[], options: { limiter?: boolean } = {}) {
    let dbCalls = 0;
    const guarded: string[] = [];
    const runtime = {
      tenantDb: { run: async () => { dbCalls += 1; throw new Error("aucun accès aux données attendu"); } },
      clock: systemClock,
      logger: quiet,
      env: {},
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      entitlements: { isFeatureEnabled: async () => false },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grants.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      rateLimiter: options.limiter ? { hit: async () => ({ allowed: false, count: 99, retryAfterMs: 4200 }) } : { hit: async () => ({ allowed: true, count: 1, retryAfterMs: 0 }) },
    } as unknown as ModuleRuntime;

    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      const user = request.headers["x-user"];
      if (typeof user === "string") (request as unknown as { ctx: RequestContext }).ctx = ctxOf(user);
    });
    const dir = resolve(__dirname, "../..");
    const discovered: DiscoveredModule = {
      key: "documents",
      dir,
      manifestPath: resolve(dir, "manifest.ts"),
      manifest,
      pluginPath: resolve(dir, "http", "plugin.ts"),
      migrationsDir: resolve(dir, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    registerDocumentsPorts(app, inMemoryPorts());
    return { app, guarded, loaded, dbCalls: () => dbCalls };
  }

  it("monte les routes sous /api/v1/documents et pose le registre de ports sur la racine", async () => {
    const { app: instance, loaded } = await boot(["documents.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/documents"]);
    expect(instance.hasDecorator("documentsPorts")).toBe(true);
    expect((await instance.inject({ method: "GET", url: "/documents", headers: { "x-user": USER } })).statusCode).toBe(404); // jamais sans le préfixe
  });

  it("refuse sans contexte (401) et sans permission (403), avec des permissions du manifeste, sans toucher aux données", async () => {
    const { app: instance, guarded, dbCalls } = await boot(["documents.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/documents/documents" })).statusCode).toBe(401);
    for (const [method, url] of [
      ["POST", "/api/v1/documents/categories"],
      ["PUT", "/api/v1/documents/settings"],
      ["GET", "/api/v1/documents/quarantine"],
      ["GET", "/api/v1/documents/usage"],
      ["POST", "/api/v1/documents/documents"],
      ["POST", "/api/v1/documents/documents/0192f0a4-7b1e-7c3a-8d2e-0000000000c1/restore"],
      ["POST", "/api/v1/documents/documents/0192f0a4-7b1e-7c3a-8d2e-0000000000c1/shares"],
    ] as const) {
      const res = await instance.inject({ method, url, headers: { "x-user": USER }, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    const known = new Set(manifest.permissions.map((p) => p.key));
    for (const p of guarded) expect(known.has(p), p).toBe(true);
    expect(dbCalls()).toBe(0);
  });

  it("valide l'entrée (400) avant tout accès aux données ; dépôt non multipart refusé", async () => {
    const { app: instance, dbCalls } = await boot(["documents.read", "documents.upload", "documents.share", "documents.category.manage"]);
    const badId = await instance.inject({ method: "GET", url: "/api/v1/documents/documents/pas-un-uuid", headers: { "x-user": USER } });
    expect(badId.statusCode).toBe(400);
    expect(badId.json()).toMatchObject({ kind: "validation", code: "documents.invalid_input" });
    expect((await instance.inject({ method: "GET", url: "/api/v1/documents/documents?limit=9999", headers: { "x-user": USER } })).statusCode).toBe(400);
    const json = await instance.inject({ method: "POST", url: "/api/v1/documents/documents", headers: { "x-user": USER }, payload: { title: "x" } });
    expect(json.statusCode).toBe(400);
    expect(json.json().code).toBe("documents.invalid_input");
    expect((await instance.inject({ method: "POST", url: "/api/v1/documents/categories", headers: { "x-user": USER }, payload: { code: "x" } })).statusCode).toBe(400);
    expect((await instance.inject({ method: "POST", url: "/api/v1/documents/documents/0192f0a4-7b1e-7c3a-8d2e-0000000000c1/shares", headers: { "x-user": USER }, payload: { userId: "x" } })).statusCode).toBe(400);
    expect(dbCalls()).toBe(0);
  });

  it("limiteur de débit : 429 + Retry-After avant tout accès aux données", async () => {
    const { app: instance, dbCalls } = await boot(["documents.read"], { limiter: true });
    const res = await instance.inject({ method: "GET", url: "/api/v1/documents/documents", headers: { "x-user": USER } });
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json().code).toBe("documents.rate_limited");
    expect(dbCalls()).toBe(0);
  });
});
