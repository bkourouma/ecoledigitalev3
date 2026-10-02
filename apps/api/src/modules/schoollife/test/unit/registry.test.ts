/**
 * Module chargé PAR LE REGISTRE avec la signature `(app, runtime)` : routes sous `/api/v1/schoollife` sans double préfixe,
 * 401 sans contexte, 403 sans permission (du manifeste), échec fermé tant qu'aucun port n'est branché, ports résolus à la
 * requête (enregistrement tardif, ordre de chargement indifférent). Sans base : doublures de TenantDb.
 */
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import type { QueryResult, TenantDb, Tx } from "@ecoledigitale/database";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import { registerSchoolLifePorts } from "../../http/plugin";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ENROLLMENT = "0192f0a4-7b1e-7c3a-8d2e-0000000000e1";
const TYPE = "0192f0a4-7b1e-7c3a-8d2e-0000000000f1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

function emptyDb(): TenantDb {
  const tx: Tx = {
    async query<R = Record<string, unknown>>(): Promise<QueryResult<R>> {
      return { rows: [], rowCount: 0 };
    },
    async queryOne() {
      return null;
    },
    async many() {
      return [];
    },
    async transaction(fn) {
      return await fn(tx);
    },
  };
  return { run: async (_ctx: unknown, fn: (t: Tx) => Promise<unknown>) => await fn(tx) } as unknown as TenantDb;
}

describe("module schoollife : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });

  async function boot(grant: string[] = []) {
    const guarded: string[] = [];
    const runtime = {
      tenantDb: emptyDb(),
      clock: systemClock,
      logger: quiet,
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      entitlements: { requireFeature: () => async () => undefined, isFeatureEnabled: async () => true },
    } as unknown as ModuleRuntime;
    app = Fastify({ logger: false });
    app.decorate("v2", {} as never); // exigé par le registre (posé en vrai par le plugin v2-context)
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });
    const dir = resolve(__dirname, "../..");
    const discovered: DiscoveredModule = {
      key: "schoollife",
      dir,
      manifestPath: resolve(dir, "manifest.ts"),
      manifest,
      pluginPath: resolve(dir, "http", "plugin.ts"),
      migrationsDir: resolve(dir, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, guarded, loaded };
  }

  it("monte les routes sous /api/v1/schoollife (sans double préfixe), jamais mises en cache", async () => {
    const { app: instance, loaded } = await boot(["schoollife.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/schoollife"]);
    const res = await instance.inject({ method: "GET", url: "/api/v1/schoollife/reference", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ settings: [], severityLevels: [], eventTypes: [] }); // aucune valeur livrée
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await instance.inject({ method: "GET", url: "/reference", headers: { "x-tenant": TENANT } })).statusCode).toBe(404);
  });

  it("401 sans contexte, 403 sans permission ; chaque garde nomme une permission du manifeste", async () => {
    const { app: instance, guarded } = await boot(["schoollife.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/schoollife/incidents" })).statusCode).toBe(401);
    const denied = await instance.inject({ method: "POST", url: "/api/v1/schoollife/measures", headers: { "x-tenant": TENANT }, payload: { enrollmentId: ENROLLMENT, typeId: TYPE, reason: "Motif valable" } });
    expect(denied.statusCode).toBe(403);
    expect(guarded).toContain("schoollife.measure.propose");
    const known = new Set(manifest.permissions.map((p) => p.key));
    for (const permission of guarded) expect(known.has(permission), permission).toBe(true);
  });

  it("échec FERMÉ sans port branché (409 `schoollife.port_unavailable`), puis ports résolus à la requête une fois enregistrés", async () => {
    const { app: instance } = await boot(["schoollife.read", "schoollife.read.all", "schoollife.measure.propose"]);
    const body = { enrollmentId: ENROLLMENT, typeId: TYPE, reason: "Motif valable" };
    const closed = await instance.inject({ method: "POST", url: "/api/v1/schoollife/measures", headers: { "x-tenant": TENANT }, payload: body });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ code: "schoollife.port_unavailable" });
    // Enregistrement tardif par la plateforme : le port est lu à chaque requête (l'inscription est inconnue : 404, plus 409).
    registerSchoolLifePorts(instance, inMemoryPorts());
    const open = await instance.inject({ method: "POST", url: "/api/v1/schoollife/measures", headers: { "x-tenant": TENANT }, payload: body });
    expect(open.statusCode).toBe(404);
    expect(open.json()).toMatchObject({ code: expect.stringMatching(/not_found|enrollment_not_found/) });
  });

  it("un acteur système est refusé avant tout accès aux données", async () => {
    const { app: instance } = await boot(["schoollife.note.write"]);
    const system = createRequestContext({ tenantId: TENANT, actor: "system" });
    instance.addHook("onRequest", async (request) => {
      if (request.headers["x-system"]) (request as unknown as { ctx: RequestContext }).ctx = system;
    });
    const res = await instance.inject({ method: "POST", url: "/api/v1/schoollife/notes", headers: { "x-tenant": TENANT, "x-system": "1" }, payload: { enrollmentId: ENROLLMENT, typeId: TYPE, body: "Bravo", occurredOn: "2026-11-02" } });
    expect([403]).toContain(res.statusCode);
    expect(res.json()).toMatchObject({ code: "schoollife.human_actor_required" });
  });
});
