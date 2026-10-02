/**
 * Le module est chargé PAR LE REGISTRE (signature `(app, runtime)`, préfixe `/api/v1/admissions`), sans base : 401 sans contexte,
 * 403 sans permission, routes publiques déclarées `config.public` sous `/api/v1/public/admissions`, abonnés et jobs découverts.
 */
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, noopLogger, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import { listPublicRoutes, resetPublicRoutesForTests, trackPublicRoutes } from "../../../../platform/public-routes";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import subscribers from "../../subscribers";
import jobs from "../../jobs";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });

describe("module admissions : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    resetPublicRoutesForTests();
    await app?.close();
    app = undefined;
  });

  async function boot(grant: string[] = []) {
    const guarded: string[] = [];
    const runtime = {
      tenantDb: { run: async () => { throw new Error("pas de base dans ce test"); } },
      systemDb: { run: async () => null },
      clock: systemClock,
      logger: noopLogger,
      env: {},
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      entitlements: { requireFeature: () => async () => undefined, isFeatureEnabled: async () => true, reader: { hasFeature: async () => true } },
      rateLimiter: { hit: async () => ({ allowed: true, count: 1, retryAfterMs: 0 }) },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    } as unknown as ModuleRuntime;
    app = Fastify({ logger: false });
    trackPublicRoutes(app);
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });
    const dir = resolve(__dirname, "../..");
    const discovered: DiscoveredModule = { key: "admissions", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: { info: () => undefined, warn: () => undefined, error: () => undefined } });
    return { app, guarded, loaded };
  }

  it("monte les routes du personnel sous /api/v1/admissions, refuse sans contexte (401) et sans permission (403)", async () => {
    const { app: instance, loaded, guarded } = await boot(["admission.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/admissions"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/admissions/applications" })).statusCode).toBe(401);
    const denied = await instance.inject({ method: "POST", url: "/api/v1/admissions/applications", headers: { "x-tenant": TENANT }, payload: {} });
    expect(denied.statusCode).toBe(403);
    expect(guarded).toContain("admission.create");
    for (const permission of guarded) expect(manifest.permissions.map((p) => p.key)).toContain(permission);
    expect((await instance.inject({ method: "GET", url: "/applications", headers: { "x-tenant": TENANT } })).statusCode).toBe(404); // pas de double préfixe
  });

  it("déclare les routes PUBLIQUES (config.public) sous /api/v1/public/admissions : aucune route du personnel n'est publique", async () => {
    await boot();
    const publicUrls = listPublicRoutes().filter((r) => r.url.includes("admissions")).map((r) => `${r.method} ${r.url}`);
    expect(publicUrls).toEqual(
      expect.arrayContaining([
        "GET /api/v1/public/admissions/forms/:slug",
        "POST /api/v1/public/admissions/forms/:slug/applications",
        "POST /api/v1/public/admissions/track",
        "POST /api/v1/public/admissions/track/documents",
        "POST /api/v1/public/admissions/offers/view",
        "POST /api/v1/public/admissions/offers/respond",
      ]),
    );
    expect(publicUrls.every((u) => u.includes("/api/v1/public/admissions/"))).toBe(true);
    // Le code de suivi ne circule JAMAIS dans l'URL : aucune route GET de suivi.
    expect(publicUrls.some((u) => /GET .*track/.test(u))).toBe(false);
  });

  it("une route publique répond 404 neutre quand le lien est inconnu (sans base : résolution système vide)", async () => {
    const { app: instance } = await boot();
    const res = await instance.inject({ method: "GET", url: `/api/v1/public/admissions/forms/${"c".repeat(26)}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "admissions.public_form_closed" });
    expect(res.headers["x-robots-tag"]).toContain("noindex");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("les abonnés écoutent des événements déclarés consommés ; les jobs sont idempotents et nommés admissions.*", () => {
    const consumed = new Set(manifest.events.consumes);
    for (const s of subscribers as unknown as Array<{ name: string; pattern: string }>) {
      expect(s.name.startsWith("admissions.")).toBe(true);
      expect(consumed.has(s.pattern)).toBe(true);
    }
    expect((jobs as unknown as Array<{ name: string }>).map((j) => j.name).sort()).toEqual(["admissions.anonymize-expired", "admissions.expire-offers", "admissions.payment-deadline", "admissions.purge-public-form"]);
  });
});
