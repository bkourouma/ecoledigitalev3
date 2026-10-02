/**
 * Tests unitaires (sans base de données) : manifeste, fichiers conventionnels, et chargement du plugin PAR LE REGISTRE
 * (signature (app, runtime), préfixe /api/v1/notifications, gardes de permission, garde de contexte, routes publiques signées).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../../registry";
import type { ModuleRuntime } from "../../../../platform/runtime";
import manifest from "../../manifest";
import { messagingManifest } from "../../../messaging";
import subscribers, { subscriberNameOf } from "../../subscribers";
import jobs from "../../jobs";
import { signBody, signUnsubscribeToken } from "../../domain/tokens";
import { EVENT_TRIGGERS } from "../../domain/triggers";
import { registerNotificationsPorts } from "../../http/plugin";
import { inMemoryPorts } from "../../infrastructure/in-memory-ports";
import { makeFakeDb } from "../support/fakes";
import { buildWorld, IDS } from "../support/world";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const ctxOf = (userId: string): RequestContext => createRequestContext({ tenantId: TENANT, userId });

describe("module notifications : manifeste", () => {
  it("déclare un manifeste valide dont les permissions et menus sont préfixés par la clé", () => {
    expect(manifest.key).toBe("notifications");
    expect(manifest.dependsOn).toEqual(["messaging"]);
    expect(() => resolveModuleOrder([messagingManifest, manifest])).not.toThrow();
    for (const permission of manifest.permissions) expect(permission.key.startsWith("notifications.")).toBe(true);
    for (const menu of manifest.menus) expect(manifest.permissions.map((p) => p.key)).toContain(menu.permission);
  });

  it("déclare les conventions de portée (own / child / self) et marque l'urgence comme sensible", () => {
    const keys = manifest.permissions.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["notifications.own.manage", "notifications.child.manage", "notifications.self.manage"]));
    expect(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key)).toEqual(["notifications.send.urgent"]);
  });

  it("publie des événements <module>.<entité>.<verbe> sans contenu et consomme les événements des modules sources", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^notifications\.[a-z_]+\.[a-z_]+$/);
    expect(manifest.events.consumes).toEqual(
      expect.arrayContaining(["finance.invoice.issued", "finance.invoice.overdue", "finance.invoice.paid", "attendance.absence.recorded", "attendance.late.recorded", "reportcards.report_card.published", "scheduling.occurrence.cancelled", "messaging.announcement.published"]),
    );
  });

  it("un abonné par événement déclencheur (noms stables et uniques), plus l'arrêt des relances ; les jobs attendus sont déclarés", () => {
    const names = subscribers.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of EVENT_TRIGGERS) expect(names).toContain(subscriberNameOf(t));
    expect(names).toContain("notifications.stop-dunning-on-invoice-paid");
    for (const s of subscribers) expect(s.name).toMatch(/^[a-z][a-z0-9_.-]{0,62}$/);
    expect(jobs.map((j) => j.name).sort()).toEqual(["notifications.dispatch", "notifications.evaluate-alerts", "notifications.housekeeping", "notifications.run-dunning"]);
    // Tout motif d'abonné correspond à un événement consommé déclaré par le manifeste.
    for (const s of subscribers) expect(manifest.events.consumes).toContain(String(s.pattern));
  });

  it("ses fichiers conventionnels existent et la migration respecte la plage 1800-1899", () => {
    const dir = resolve(__dirname, "../..");
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "README.md"]) expect(existsSync(resolve(dir, file)), file).toBe(true);
    expect(existsSync(resolve(dir, "migrations/1800_notifications_init.sql"))).toBe(true);
  });

  it("la migration ne référence aucun autre schéma que kernel et notifications (aucune FK inter-modules)", () => {
    const sql = readFileSync(resolve(__dirname, "../../migrations/1800_notifications_init.sql"), "utf8").replace(/--.*$/gm, "");
    const refs = [...sql.matchAll(/REFERENCES\s+([a-z_]+)\./gi)].map((m) => m[1]!.toLowerCase());
    for (const schema of refs) expect(["kernel", "notifications"]).toContain(schema);
    expect(sql).not.toMatch(/\b(people|academic|rbac|iam|tenancy|attendance|finance|messaging)\./i);
  });
});

describe("module notifications : chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    resetRegistryForTests();
    await app?.close();
    app = undefined;
  });

  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function boot(grants: string[], options: { limiter?: boolean; env?: Record<string, string> } = {}) {
    const fake = makeFakeDb();
    const guarded: string[] = [];
    const runtime = {
      tenantDb: fake.db,
      clock: systemClock,
      logger: quiet,
      env: options.env ?? {},
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
    const discovered: DiscoveredModule = { key: "notifications", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    registerNotificationsPorts(app, { ...inMemoryPorts().ports, directory: buildWorld() });
    return { app, fake, guarded, loaded };
  }

  it("monte les routes sous /api/v1/notifications, pose le registre de ports et expose le catalogue", async () => {
    const { app: instance, loaded } = await boot(["notifications.read"]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/notifications"]);
    expect(instance.hasDecorator("notificationsPorts")).toBe(true);
    const res = await instance.inject({ method: "GET", url: "/api/v1/notifications/catalog", headers: { "x-user": IDS.admin } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const codes = res.json().items.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["absence", "late", "payment_received", "invoice_issued", "payment_reminder", "report_card_published", "convocation", "announcement", "urgent_notice"]));
    const triggers = (await instance.inject({ method: "GET", url: "/api/v1/notifications/triggers", headers: { "x-user": IDS.admin } })).json();
    expect(triggers.items.map((t: { eventType: string }) => t.eventType)).toEqual(expect.arrayContaining(["finance.invoice.issued", "dunning", "OVERDUE_DAYS"]));
    expect((await instance.inject({ method: "GET", url: "/catalog", headers: { "x-user": IDS.admin } })).statusCode).toBe(404);
  });

  it("refuse sans contexte (401) et sans permission (403), avec des permissions du manifeste", async () => {
    const { app: instance, guarded } = await boot(["notifications.read"]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/notifications/deliveries" })).statusCode).toBe(401);
    for (const [method, url, payload] of [
      ["POST", "/api/v1/notifications/templates/absence", { channel: "SMS", body: "x" }],
      ["PUT", "/api/v1/notifications/rules/attendance.absence", {}],
      ["PUT", "/api/v1/notifications/settings", { senderName: "x" }],
      ["POST", "/api/v1/notifications/send", {}],
      ["POST", "/api/v1/notifications/consent", {}],
      ["GET", "/api/v1/notifications/me/preferences", undefined],
      ["POST", "/api/v1/notifications/channels/test", { channels: ["EMAIL"] }],
    ] as const) {
      const res = await instance.inject({ method, url, headers: { "x-user": IDS.teacher }, ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    const known = new Set(manifest.permissions.map((p) => p.key));
    for (const p of guarded) expect(known.has(p), p).toBe(true);
  });

  it("valide les entrées (400) avant tout accès aux données", async () => {
    const { app: instance, fake } = await boot(["notifications.read", "notifications.send", "notifications.templates.manage", "notifications.own.manage"]);
    const bad = await instance.inject({ method: "POST", url: "/api/v1/notifications/send", headers: { "x-user": IDS.admin }, payload: { templateCode: "convocation", audience: { kind: "USERS", userIds: [] }, channels: ["EMAIL"] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ kind: "validation" });
    const badTemplate = await instance.inject({ method: "POST", url: "/api/v1/notifications/templates/inconnu", headers: { "x-user": IDS.admin }, payload: { channel: "SMS", body: "x" } });
    expect(badTemplate.statusCode).toBe(400);
    const badQuery = await instance.inject({ method: "GET", url: "/api/v1/notifications/deliveries?status=NIMPORTEQUOI", headers: { "x-user": IDS.admin } });
    expect(badQuery.statusCode).toBe(400);
    const badPush = await instance.inject({ method: "POST", url: "/api/v1/notifications/me/push/subscriptions", headers: { "x-user": IDS.admin }, payload: { endpoint: "http://non-https.example/x", keys: { p256dh: "a".repeat(60), auth: "b".repeat(20) } } });
    expect(badPush.statusCode).toBe(400);
    expect(fake.queries).toEqual([]);
  });

  it("routes publiques : désinscription (jeton signé) et accusés (corps signé) ; jeton ou signature invalides refusés, limitation de débit", async () => {
    const env = { NOTIFICATIONS_UNSUBSCRIBE_SECRET: "secret-u", NOTIFICATIONS_WEBHOOK_SECRET: "secret-w" };
    const { app: instance, fake } = await boot([], { env });
    // Sans contexte utilisateur : les routes publiques répondent (authentification propre à la route).
    const forged = await instance.inject({ method: "GET", url: "/api/v1/notifications/public/unsubscribe?t=" + "x".repeat(40) });
    expect(forged.statusCode).toBe(403);
    expect(forged.json()).toMatchObject({ code: "notifications.token_invalid" });
    const token = signUnsubscribeToken({ tenantId: TENANT, subjectKey: `user:${IDS.guardianFinancial}`, channel: "SMS" }, "autre-secret");
    expect((await instance.inject({ method: "POST", url: `/api/v1/notifications/public/unsubscribe?t=${encodeURIComponent(token)}` })).statusCode).toBe(403);
    const body = JSON.stringify({ providerId: "p1", status: "DELIVERED" });
    const noSig = await instance.inject({ method: "POST", url: `/api/v1/notifications/webhooks/${TENANT}/delivery-status`, headers: { "content-type": "application/json" }, payload: body });
    expect(noSig.statusCode).toBe(403);
    expect(noSig.json()).toMatchObject({ code: "notifications.signature_invalid" });
    const badSig = await instance.inject({ method: "POST", url: `/api/v1/notifications/webhooks/${TENANT}/delivery-status`, headers: { "content-type": "application/json", "x-notifications-signature": signBody(body, "mauvais") }, payload: body });
    expect(badSig.statusCode).toBe(403);
    expect(fake.queries).toEqual([]); // aucune lecture avant la vérification de la signature
  });

  it("route publique : le limiteur de débit renvoie 429 avec Retry-After", async () => {
    const { app: instance } = await boot([], { limiter: true, env: { NOTIFICATIONS_UNSUBSCRIBE_SECRET: "s" } });
    const res = await instance.inject({ method: "GET", url: "/api/v1/notifications/public/unsubscribe?t=" + "x".repeat(40) });
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("5");
  });

  it("sans secret de désinscription configuré, le lien est refusé (échec fermé)", async () => {
    const { app: instance } = await boot([], { env: {} });
    const res = await instance.inject({ method: "GET", url: "/api/v1/notifications/public/unsubscribe?t=" + "x".repeat(40) });
    expect(res.statusCode).toBe(403);
  });

  it("un port non branché fait échouer FERMÉ (aucune remise sans annuaire)", async () => {
    const fake = makeFakeDb();
    const runtime = {
      tenantDb: fake.db,
      clock: systemClock,
      logger: quiet,
      env: {},
      auditPort: { record: async () => undefined, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: () => async () => undefined,
    } as unknown as ModuleRuntime;
    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      (request as unknown as { ctx: RequestContext }).ctx = ctxOf(IDS.admin);
    });
    const dir = resolve(__dirname, "../..");
    await registerModules(app, {
      enabled: true,
      discovered: [{ key: "notifications", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") }],
      runtime,
      logger: quiet,
    });
    const res = await app.inject({ method: "POST", url: "/api/v1/notifications/send", payload: { templateCode: "announcement", audience: { kind: "ROLES", roleKeys: ["econome"] }, variables: { title: "Titre" }, channels: ["EMAIL"] } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "notifications.port_unavailable" });
  });
});
