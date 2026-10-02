/**
 * Tests unitaires (sans base de données) : manifeste, domaine, use case avec doublures, et chargement du plugin
 * PAR LE REGISTRE (signature (app, runtime), préfixe /api/v1/documents, gardes de permission, garde de contexte).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  ForbiddenError,
  createRequestContext,
  resolveModuleOrder,
  systemClock,
  type RequestContext,
} from "@ecoledigitale/kernel";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../registry";
import type { ModuleRuntime } from "../../../platform/runtime";
import { createItem } from "../application/items";
import { ITEM_CREATED } from "../domain/events";
import { normalizeLabel } from "../domain/item";
import manifest from "../manifest";
import { makeFakeDb } from "./support/fakes";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });

describe("module documents : manifeste", () => {
  it("déclare un manifeste valide dont les permissions sont préfixées par la clé", () => {
    expect(manifest.key).toBe("documents");
    expect(manifest.permissions.length).toBeGreaterThan(0);
    for (const permission of manifest.permissions) expect(permission.key.startsWith("documents.")).toBe(true);
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
  });

  it("publie des événements <module>.<entité>.<verbe> et ses fichiers conventionnels existent", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^documents\.[a-z_]+\.[a-z_]+$/);
    const dir = resolve(__dirname, "..");
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts"]) {
      expect(existsSync(resolve(dir, file)), file).toBe(true);
    }
  });
});

describe("module documents : domaine", () => {
  it("normalise et valide le libellé d'un élément", () => {
    expect(normalizeLabel("  Mon   élément ")).toEqual({ ok: true, value: "Mon élément" });
    expect(normalizeLabel("   ").ok).toBe(false);
    expect(normalizeLabel("x".repeat(500)).ok).toBe(false);
  });
});

describe("module documents : use case createItem (doublures)", () => {
  it("écrit la ligne, l'événement d'outbox puis l'audit, dans cet ordre", async () => {
    const fake = makeFakeDb();
    const result = await createItem({ tenantDb: fake.db, clock: systemClock, audit: fake.audit }, ctx, { label: " Premier " });
    expect(result.ok).toBe(true);
    expect(fake.order).toEqual(["sql", "outbox", "audit"]);
    expect(fake.auditEntries).toHaveLength(1);
    expect(fake.auditEntries.at(0)).toMatchObject({ action: "documents.item.create", entity: "item", after: { label: "Premier" } });
    const outbox = fake.queries.find((q) => /kernel\.domain_events/.test(q.sql));
    expect(outbox?.params).toContain(ITEM_CREATED);
  });

  it("refuse un libellé invalide sans rien écrire", async () => {
    const fake = makeFakeDb();
    const result = await createItem({ tenantDb: fake.db, clock: systemClock, audit: fake.audit }, ctx, { label: "  " });
    expect(result.ok).toBe(false);
    expect(fake.queries).toEqual([]);
    expect(fake.auditEntries).toEqual([]);
  });

  it("propage l'échec d'audit (la transaction réelle est alors annulée)", async () => {
    const fake = makeFakeDb({ failAudit: true });
    await expect(createItem({ tenantDb: fake.db, clock: systemClock, audit: fake.audit }, ctx, { label: "A" })).rejects.toThrow(
      /audit indisponible/,
    );
  });
});

describe("module documents : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });

  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grant: string[] = []) {
    const fake = makeFakeDb();
    const guarded: string[] = [];
    const runtime = {
      tenantDb: fake.db,
      clock: systemClock,
      auditPort: { record: fake.audit.record, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    } as unknown as ModuleRuntime;

    app = Fastify({ logger: false });
    app.decorate("v2", {} as never); // exigé par le registre (posé en vrai par le plugin v2-context)
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });

    const dir = resolve(__dirname, "..");
    const discovered: DiscoveredModule = {
      key: "documents",
      dir,
      manifestPath: resolve(dir, "manifest.ts"),
      manifest,
      pluginPath: resolve(dir, "http", "plugin.ts"),
      migrationsDir: resolve(dir, "migrations"),
    };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, fake, guarded, loaded };
  }

  it("monte les routes sous /api/v1/documents avec la signature (app, runtime)", async () => {
    const { app: instance, loaded } = await boot(["documents.item.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/documents"]);
    const res = await instance.inject({ method: "GET", url: "/api/v1/documents/items", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    // Pas de double préfixe : la route sans préfixe n'existe pas à la racine.
    expect((await instance.inject({ method: "GET", url: "/items", headers: { "x-tenant": TENANT } })).statusCode).toBe(404);
  });

  it("refuse sans contexte (401) et sans permission (403), avec les permissions du manifeste", async () => {
    const { app: instance, guarded } = await boot(["documents.item.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/documents/items" })).statusCode).toBe(401);
    const denied = await instance.inject({
      method: "POST",
      url: "/api/v1/documents/items",
      headers: { "x-tenant": TENANT },
      payload: { label: "x" },
    });
    expect(denied.statusCode).toBe(403);
    expect(guarded).toContain("documents.item.create");
    for (const permission of guarded) expect(manifest.permissions.map((p) => p.key)).toContain(permission);
  });

  it("crée un élément (201), valide le corps (400) et audite dans la même transaction", async () => {
    const { app: instance, fake } = await boot(["documents.item.create"]);
    const ok = await instance.inject({ method: "POST", url: "/api/v1/documents/items", headers: { "x-tenant": TENANT }, payload: { label: "Alpha" } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ label: "Alpha", tenantId: TENANT });
    expect(fake.order).toEqual(["sql", "outbox", "audit"]);

    const bad = await instance.inject({ method: "POST", url: "/api/v1/documents/items", headers: { "x-tenant": TENANT }, payload: { label: "   " } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ kind: "validation" });
    const missing = await instance.inject({ method: "POST", url: "/api/v1/documents/items", headers: { "x-tenant": TENANT }, payload: {} });
    expect(missing.statusCode).toBe(400);
  });
});
