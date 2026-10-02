/**
 * Tests unitaires (sans base de données) : manifeste, fichiers conventionnels, et chargement du plugin PAR LE REGISTRE
 * (signature (app, runtime), préfixe /api/v1/messaging, gardes de permission, garde de contexte, 429 du limiteur).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import { makeFakeDb } from "../support/fakes";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { registerMessagingPorts } from "../../http/plugin";
import { buildWorld, IDS } from "../support/world";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const ctxOf = (userId: string): RequestContext => createRequestContext({ tenantId: TENANT, userId });

describe("module messaging : manifeste", () => {
  it("déclare un manifeste valide dont les permissions et menus sont préfixés par la clé", () => {
    expect(manifest.key).toBe("messaging");
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
    for (const permission of manifest.permissions) expect(permission.key.startsWith("messaging.")).toBe(true);
    for (const menu of manifest.menus) expect(manifest.permissions.map((p) => p.key)).toContain(menu.permission);
  });

  it("déclare les conventions `child` / `self` et marque la modération sensible", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["messaging.child.read", "messaging.child.send", "messaging.self.read", "messaging.self.send"]));
    const sensitive = manifest.permissions.filter((p) => p.sensitive).map((p) => p.key).sort();
    expect(sensitive).toEqual(["messaging.moderation.manage", "messaging.moderation.read", "messaging.moderation.supervise"]);
  });

  it("publie des événements <module>.<entité>.<verbe> et consomme les événements de présence", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^messaging\.[a-z_]+\.[a-z_]+$/);
    expect(manifest.events.publishes).toEqual(expect.arrayContaining(["messaging.message.sent", "messaging.announcement.published"]));
    expect(manifest.events.consumes).toEqual(["attendance.absence.recorded", "attendance.late.recorded"]);
  });

  it("ses fichiers conventionnels existent et la migration respecte la plage 1700-1799", () => {
    const dir = resolve(__dirname, "../..");
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md"]) expect(existsSync(resolve(dir, file)), file).toBe(true);
    expect(existsSync(resolve(dir, "migrations/1700_messaging_init.sql"))).toBe(true);
  });

  it("la migration ne référence aucun autre schéma que kernel et messaging (aucune FK inter-modules)", () => {
    const sql = readFileSync(resolve(__dirname, "../../migrations/1700_messaging_init.sql"), "utf8").replace(/--.*$/gm, "");
    const refs = [...sql.matchAll(/REFERENCES\s+([a-z_]+)\./gi)].map((m) => m[1]!.toLowerCase());
    for (const schema of refs) expect(["kernel", "messaging"]).toContain(schema);
    expect(sql).not.toMatch(/\b(people|academic|rbac|iam|tenancy|attendance)\./i);
  });
});

describe("module messaging : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });

  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grants: string[], options: { limiter?: boolean } = {}) {
    const fake = makeFakeDb();
    const guarded: string[] = [];
    const runtime = {
      tenantDb: fake.db,
      clock: systemClock,
      logger: quiet,
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
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
      key: "messaging",
      dir,
      manifestPath: resolve(dir, "manifest.ts"),
      manifest,
      pluginPath: resolve(dir, "http", "plugin.ts"),
      migrationsDir: resolve(dir, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    registerMessagingPorts(app, inMemoryPorts(buildWorld()));
    return { app, fake, guarded, loaded };
  }

  it("monte les routes sous /api/v1/messaging et pose le registre de ports sur la racine", async () => {
    const { app: instance, loaded } = await boot(["messaging.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/messaging"]);
    expect(instance.hasDecorator("messagingPorts")).toBe(true);
    const res = await instance.inject({ method: "GET", url: "/api/v1/messaging/me/unread", headers: { "x-user": IDS.teacher6A } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ conversations: 0, announcements: 0, notifications: 0 });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await instance.inject({ method: "GET", url: "/me/unread", headers: { "x-user": IDS.teacher6A } })).statusCode).toBe(404);
  });

  it("refuse sans contexte (401) et sans permission (403), avec des permissions du manifeste", async () => {
    const { app: instance, guarded } = await boot(["messaging.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/messaging/conversations" })).statusCode).toBe(401);
    const noWrite = await instance.inject({
      method: "POST",
      url: "/api/v1/messaging/conversations",
      headers: { "x-user": IDS.teacher6A },
      payload: { kind: "DIRECT", body: "Bonjour", recipients: { userIds: [IDS.parent1] } },
    });
    expect(noWrite.statusCode).toBe(403);
    const noModeration = await instance.inject({ method: "GET", url: "/api/v1/messaging/moderation/reports", headers: { "x-user": IDS.teacher6A } });
    expect(noModeration.statusCode).toBe(403);
    const noSettings = await instance.inject({ method: "PUT", url: "/api/v1/messaging/settings", headers: { "x-user": IDS.teacher6A }, payload: { studentPolicy: "DISABLED" } });
    expect(noSettings.statusCode).toBe(403);
    const known = new Set(manifest.permissions.map((p) => p.key));
    for (const p of guarded) expect(known.has(p), p).toBe(true);
  });

  it("valide le corps (400) avant tout accès aux données", async () => {
    const { app: instance, fake } = await boot(["messaging.read", "messaging.send"]);
    const bad = await instance.inject({ method: "POST", url: "/api/v1/messaging/conversations", headers: { "x-user": IDS.teacher6A }, payload: { kind: "DIRECT", body: "  ", recipients: {} } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ kind: "validation" });
    expect(fake.queries).toEqual([]);
    const badId = await instance.inject({ method: "GET", url: "/api/v1/messaging/conversations/pas-un-uuid", headers: { "x-user": IDS.teacher6A } });
    expect(badId.statusCode).toBe(400);
  });

  it("le limiteur de débit renvoie 429 avec Retry-After, avant tout accès aux données", async () => {
    const { app: instance, fake } = await boot(["messaging.read", "messaging.send"], { limiter: true });
    const res = await instance.inject({
      method: "POST",
      url: "/api/v1/messaging/conversations",
      headers: { "x-user": IDS.teacher6A },
      payload: { kind: "DIRECT", body: "Bonjour", recipients: { userIds: [IDS.parent1] } },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json()).toMatchObject({ code: "messaging.rate_limited" });
    expect(fake.queries).toEqual([]);
  });

  it("un port non branché fait échouer FERMÉ (aucun envoi sans annuaire)", async () => {
    const fake = makeFakeDb();
    const runtime = {
      tenantDb: fake.db,
      clock: systemClock,
      logger: quiet,
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: () => async () => undefined,
    } as unknown as ModuleRuntime;
    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      (request as unknown as { ctx: RequestContext }).ctx = ctxOf(IDS.teacher6A);
    });
    const dir = resolve(__dirname, "../..");
    await registerModules(app, {
      enabled: true,
      discovered: [{ key: "messaging", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") }],
      runtime,
      logger: quiet,
    });
    const res = await app.inject({ method: "POST", url: "/api/v1/messaging/conversations", payload: { kind: "DIRECT", body: "Bonjour", recipients: { userIds: [IDS.parent1] } } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "messaging.port_unavailable" });
  });
});
