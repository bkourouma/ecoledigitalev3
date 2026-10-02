/**
 * Module chargé PAR LE REGISTRE avec la signature `(app, runtime)` : routes sous `/api/v1/councils` sans double préfixe, 401 sans contexte,
 * 403 sans permission (du manifeste), échec fermé tant qu'aucun port n'est branché, ports résolus à la requête (enregistrement tardif,
 * ordre de chargement indifférent). Sans base : doublures de TenantDb.
 */
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import type { QueryResult, TenantDb, Tx } from "@ecoledigitale/database";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import { registerCouncilsPorts } from "../../http/plugin";
import { inMemoryPorts, unavailablePorts } from "../../infrastructure/in-memory-ports";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const CLASSROOM = "0192f0a4-7b1e-7c3a-8d2e-0000000000c1";
const TYPE = "0192f0a4-7b1e-7c3a-8d2e-0000000000f1";
const PERIOD = "0192f0a4-7b1e-7c3a-8d2e-0000000000d1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

const typeRow = { id: TYPE, code: "DEMO", label: "Conseil de démonstration", scope: "PERIOD", minResultsStatus: "GRADING_LOCKED", minParticipants: null, requiredRoleCodes: [], signerFunctions: ["PRESIDENT"], signerRoleCodes: [], requiresDecisionPerStudent: false, sortOrder: 0, active: true };

/** Base factice : aucune ligne, sauf un type de conseil actif (pour atteindre les ports). */
function fakeDb(): TenantDb {
  const tx: Tx = {
    async query<R = Record<string, unknown>>(): Promise<QueryResult<R>> {
      return { rows: [], rowCount: 0 };
    },
    async queryOne(sql: string) {
      return /FROM councils\.council_types/.test(sql) ? (typeRow as never) : null;
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

describe("module councils : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });

  async function boot(grant: string[] = []) {
    const guarded: string[] = [];
    const runtime = {
      tenantDb: fakeDb(),
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
    const discovered: DiscoveredModule = { key: "councils", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, guarded, loaded };
  }

  it("monte les routes sous /api/v1/councils (sans double préfixe), jamais mises en cache", async () => {
    const { app: instance, loaded } = await boot(["council.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/councils"]);
    const res = await instance.inject({ method: "GET", url: "/api/v1/councils/reference", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ roles: [], councilTypes: [], decisionTypes: [], settings: [] }); // aucune valeur livrée par le code
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await instance.inject({ method: "GET", url: "/reference", headers: { "x-tenant": TENANT } })).statusCode).toBe(404);
  });

  it("401 sans contexte, 403 sans permission ; chaque garde nomme une permission du manifeste", async () => {
    const { app: instance, guarded } = await boot(["council.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/councils/councils" })).statusCode).toBe(401);
    const denied = await instance.inject({ method: "POST", url: "/api/v1/councils/councils", headers: { "x-tenant": TENANT }, payload: { classroomId: CLASSROOM, academicPeriodId: PERIOD, councilTypeId: TYPE } });
    expect(denied.statusCode).toBe(403);
    expect(guarded).toContain("council.manage");
    const known = new Set(manifest.permissions.map((p) => p.key));
    for (const permission of guarded) expect(known.has(permission), permission).toBe(true);
  });

  it("échec FERMÉ sans port branché (409 `councils.port_unavailable`), puis ports résolus à la requête une fois enregistrés", async () => {
    const { app: instance } = await boot(["council.manage"]);
    const body = { classroomId: CLASSROOM, academicPeriodId: PERIOD, councilTypeId: TYPE };
    const closed = await instance.inject({ method: "POST", url: "/api/v1/councils/councils", headers: { "x-tenant": TENANT }, payload: body });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ code: "councils.port_unavailable" });
    // Enregistrement tardif par la plateforme : le port est lu à chaque requête (la classe est inconnue : 404, plus 409).
    registerCouncilsPorts(instance, inMemoryPorts());
    const open = await instance.inject({ method: "POST", url: "/api/v1/councils/councils", headers: { "x-tenant": TENANT }, payload: body });
    expect(open.statusCode).toBe(404);
    expect(open.json()).toMatchObject({ code: "councils.classroom_not_found" });
  });

  it("un acteur système est refusé avant tout accès aux données", async () => {
    const { app: instance } = await boot(["council.manage"]);
    const system = createRequestContext({ tenantId: TENANT, actor: "system" });
    instance.addHook("onRequest", async (request) => {
      if (request.headers["x-system"]) (request as unknown as { ctx: RequestContext }).ctx = system;
    });
    const res = await instance.inject({ method: "POST", url: "/api/v1/councils/councils", headers: { "x-tenant": TENANT, "x-system": "1" }, payload: { classroomId: CLASSROOM, academicPeriodId: PERIOD, councilTypeId: TYPE } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "councils.human_decision_required" });
  });

  it("chaque port non branché échoue FERMÉ avec `councils.port_unavailable` (jamais une valeur inventée)", async () => {
    const ports = unavailablePorts() as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
    for (const [name, port] of Object.entries(ports)) {
      if (name === "templates") continue; // modèle livré avec le module (aucun port externe)
      for (const [fn, impl] of Object.entries(port)) {
        let thrown: unknown;
        try {
          await impl();
        } catch (e) {
          thrown = e;
        }
        expect(thrown, `${name}.${fn}`).toMatchObject({ code: "councils.port_unavailable" });
      }
    }
  });
});
