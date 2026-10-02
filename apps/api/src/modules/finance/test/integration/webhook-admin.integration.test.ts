/**
 * Événements webhook en échec : liste, détail et rejeu sûr (idempotent, audité, sans secret ni charge brute),
 * par les cas d'usage ET par HTTP (permissions, contrats, isolation entre tenants A/B).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import { financeReplayWebhookEventResultDtoSchema, financeWebhookEventDtoSchema, financeWebhookEventsDtoSchema } from "@ecoledigitale/contracts/src/v2/finance";
import manifest from "../../manifest";
import { createFinanceDeps } from "../../application/deps";
import { handleProviderWebhook, initiateOnlinePayment } from "../../application/online-payments";
import { getPaymentView } from "../../application/payments";
import { listWebhookEventsPage, replayFailedWebhookEvent, safeWebhookError } from "../../application/webhook-admin";
import { financePlugin } from "../../http/plugin";
import { SANDBOX_PROVIDER_NAME, SandboxProvider } from "../../infrastructure/providers/sandbox-provider";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, nextKey, seedCatalog, simpleInvoice, xof } from "../support/scenario";

const ALL = manifest.permissions.map((p) => p.key);

describeIntegration("webhooks en échec : lecture et rejeu sûr (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantA: string;
  let tenantB: string;
  let app: FastifyInstance;
  const alice = newId();

  beforeAll(async () => {
    db = await createFinanceTestDb(16);
    world = makeWorld(db);
    tenantA = await db.createTenant();
    tenantB = await db.createTenant();
    await seedCatalog(world.deps, ctxFor(tenantA));
    await seedCatalog(world.deps, ctxFor(tenantB));
    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      if (typeof tenant === "string") {
        (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: alice, roles: [] });
      }
    });
    await app.register(financePlugin, {
      deps: world.deps,
      requirePermission: (permission) => async (req) => {
        if (!(req as unknown as { ctx?: unknown }).ctx) throw new UnauthorizedError();
        if (!String(req.headers["x-test-perms"] ?? "").split(",").includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  async function sandboxOf(tenantId: string): Promise<SandboxProvider> {
    const r = await world.providers.resolve(tenantId, SANDBOX_PROVIDER_NAME);
    if (!r.ok) throw r.error;
    return r.value as SandboxProvider;
  }

  /** Paiement sandbox EN ATTENTE + webhook de succès au montant divergent => événement `FAILED`. */
  async function failedWebhook(tenantId: string, eventId: string = nextKey("evt")) {
    const ctx = ctxFor(tenantId);
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const view = unwrap(await initiateOnlinePayment(world.deps, ctx, { idempotencyKey: nextKey("wh"), learnerId: learner, amount: xof(25_001), provider: "sandbox" }));
    const sandbox = await sandboxOf(tenantId);
    const ref = view.payment.providerRef!;
    sandbox.settle(ref, "success");
    const wh = sandbox.buildWebhook(ref, { amount: xof(1_000), eventId });
    const r = unwrap(await handleProviderWebhook(world.deps, { tenantId, provider: "sandbox", rawBody: wh.rawBody, headers: wh.headers }));
    expect(r.status).toBe("FAILED");
    const [row] = await adminRows<{ id: string }>(db, "SELECT id FROM finance.webhook_events WHERE tenant_id = $1 AND event_id = $2", [tenantId, eventId]);
    return { ctx, paymentId: view.payment.id, ref, eventRowId: row!.id, sandbox, eventId };
  }

  async function call(method: "GET" | "POST", url: string, o: { tenant?: string | "none"; perms?: string[]; body?: unknown; query?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { "x-test-perms": (o.perms ?? ALL).join(",") };
    if (o.tenant !== "none") headers["x-test-tenant"] = o.tenant ?? tenantA;
    const payload = o.body === undefined ? undefined : JSON.stringify(o.body);
    if (payload !== undefined) headers["content-type"] = "application/json";
    const res = await app.inject({ method, url: `/api/v1/finance${url}`, headers, payload, query: o.query });
    let json: any;
    try {
      json = res.json();
    } catch {
      json = undefined;
    }
    return { status: res.statusCode, json };
  }

  it("liste les événements FAILED du tenant (par défaut), sans charge brute ni secret", async () => {
    const f = await failedWebhook(tenantA);
    const page = unwrap(await listWebhookEventsPage(world.deps, f.ctx, {}));
    const found = page.items.find((i) => i.id === f.eventRowId);
    expect(found).toMatchObject({ status: "FAILED", paymentId: f.paymentId, error: "finance.provider_amount_mismatch", provider: "sandbox" });
    expect(Object.keys(found!)).not.toContain("payload");
  });

  it("rejeu : interroge le fournisseur, applique l'issue avec les contrôles du webhook, audite, puis est idempotent", async () => {
    const f = await failedWebhook(tenantA);
    const r = unwrap(await replayFailedWebhookEvent(world.deps, f.ctx, { id: f.eventRowId, note: "relance après vérification" }));
    expect(r).toMatchObject({ replayed: false, resolved: true, paymentStatus: "CONFIRMED" });
    expect(r.event.status).toBe("PROCESSED");
    expect(unwrap(await getPaymentView(world.deps, f.ctx, f.paymentId)).payment.status).toBe("CONFIRMED");
    expect(world.audit.actions().some((a) => a === "finance.webhook.replayed")).toBe(true);

    // second rejeu : plus FAILED => aucun effet, un seul encaissement
    const again = unwrap(await replayFailedWebhookEvent(world.deps, f.ctx, { id: f.eventRowId }));
    expect(again).toMatchObject({ replayed: true, resolved: false });
    expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [f.paymentId])).toHaveLength(1);
    expect(await adminRows(db, "SELECT 1 FROM finance.payment_allocations WHERE payment_id = $1", [f.paymentId])).toHaveLength(1);
  });

  it("rejeux CONCURRENTS : un seul retraitement, un seul reçu", async () => {
    const f = await failedWebhook(tenantA);
    const results = await Promise.all(Array.from({ length: 6 }, () => replayFailedWebhookEvent(world.deps, f.ctx, { id: f.eventRowId })));
    const values = results.map((x) => unwrap(x));
    expect(values.filter((v) => !v.replayed && v.resolved)).toHaveLength(1);
    expect(await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [f.paymentId])).toHaveLength(1);
  });

  it("fournisseur toujours en attente : l'événement reste FAILED, tentative comptée, audit d'échec, rien encaissé", async () => {
    const f = await failedWebhook(tenantA);
    // le fournisseur repasse en attente (le sandbox ne sait pas "dé-régler" : on simule via un nouveau paiement non réglé)
    const ctx = f.ctx;
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const pending = unwrap(await initiateOnlinePayment(world.deps, ctx, { idempotencyKey: nextKey("wh-p"), learnerId: learner, amount: xof(25_001), provider: "sandbox" }));
    await adminRows(db, "UPDATE finance.webhook_events SET payment_id = $2 WHERE id = $1", [f.eventRowId, pending.payment.id]);
    const r = unwrap(await replayFailedWebhookEvent(world.deps, ctx, { id: f.eventRowId }));
    expect(r).toMatchObject({ replayed: false, resolved: false });
    expect(r.event).toMatchObject({ status: "FAILED", error: "provider_still_pending", attempts: 2 });
    expect(unwrap(await getPaymentView(world.deps, ctx, pending.payment.id)).payment.status).toBe("PENDING");
    expect(world.audit.actions().some((a) => a === "finance.webhook.replay_failed")).toBe(true);
  });

  it("paiement déjà réglé entre-temps : l'événement devient IGNORED (payment_already_settled)", async () => {
    const f = await failedWebhook(tenantA);
    const good = f.sandbox.buildWebhook(f.ref, { eventId: nextKey("evt-good") });
    unwrap(await handleProviderWebhook(world.deps, { tenantId: tenantA, provider: "sandbox", rawBody: good.rawBody, headers: good.headers }));
    const r = unwrap(await replayFailedWebhookEvent(world.deps, f.ctx, { id: f.eventRowId }));
    expect(r.resolved).toBe(true);
    expect(r.event).toMatchObject({ status: "IGNORED", error: "payment_already_settled" });
  });

  it("événement inconnu : 404 ; événement sans paiement : conflit finance.webhook_not_replayable", async () => {
    const f = await failedWebhook(tenantA);
    const missing = await replayFailedWebhookEvent(world.deps, f.ctx, { id: newId() });
    expect(missing.ok).toBe(false);
    await adminRows(db, "UPDATE finance.webhook_events SET payment_id = NULL WHERE id = $1", [f.eventRowId]);
    const nopay = await replayFailedWebhookEvent(world.deps, f.ctx, { id: f.eventRowId });
    expect(nopay.ok).toBe(false);
    if (!nopay.ok) expect(nopay.error.code).toBe("finance.webhook_not_replayable");
  });

  it("safeWebhookError masque tout ce qui n'est pas un code court", () => {
    expect(safeWebhookError("finance.provider_amount_mismatch")).toBe("finance.provider_amount_mismatch");
    expect(safeWebhookError("Clé secrète sk_live_123 invalide pour +225 01 02 03")).toBe("unknown");
    expect(safeWebhookError(null)).toBeNull();
  });

  describe("HTTP", () => {
    it("401 sans contexte ; 403 sans permission ; la lecture ne donne pas le rejeu", async () => {
      expect((await call("GET", "/webhook-events", { tenant: "none" })).status).toBe(401);
      expect((await call("GET", "/webhook-events", { perms: ["finance.payment.read"] })).status).toBe(403);
      const f = await failedWebhook(tenantA);
      expect((await call("POST", `/webhook-events/${f.eventRowId}/replay`, { perms: ["finance.webhook.read"], body: {} })).status).toBe(403);
    });

    it("liste conforme au contrat, sans payload ; filtres validés", async () => {
      const f = await failedWebhook(tenantA);
      const res = await call("GET", "/webhook-events", { perms: ["finance.webhook.read"] });
      expect(res.status).toBe(200);
      const parsed = financeWebhookEventsDtoSchema.parse(res.json);
      expect(parsed.items.some((i) => i.id === f.eventRowId)).toBe(true);
      expect(JSON.stringify(res.json)).not.toMatch(/payload|signature|secret/i);
      expect((await call("GET", "/webhook-events", { perms: ["finance.webhook.read"], query: { status: "BIDON" } })).status).toBe(400);
      expect((await call("GET", "/webhook-events", { perms: ["finance.webhook.read"], query: { provider: "sandbox", status: "PROCESSED" } })).status).toBe(200);
      const one = await call("GET", `/webhook-events/${f.eventRowId}`, { perms: ["finance.webhook.read"] });
      expect(financeWebhookEventDtoSchema.parse(one.json).id).toBe(f.eventRowId);
    });

    it("rejeu par HTTP : conforme au contrat, corps strict, idempotent", async () => {
      const f = await failedWebhook(tenantA);
      expect((await call("POST", `/webhook-events/${f.eventRowId}/replay`, { perms: ["finance.webhook.replay"], body: { inconnu: 1 } })).status).toBe(400);
      const res = await call("POST", `/webhook-events/${f.eventRowId}/replay`, { perms: ["finance.webhook.replay"], body: { note: "ok" } });
      expect(res.status).toBe(200);
      expect(financeReplayWebhookEventResultDtoSchema.parse(res.json)).toMatchObject({ replayed: false, resolved: true, paymentStatus: "CONFIRMED" });
      const second = await call("POST", `/webhook-events/${f.eventRowId}/replay`, { perms: ["finance.webhook.replay"] });
      expect(financeReplayWebhookEventResultDtoSchema.parse(second.json)).toMatchObject({ replayed: true, resolved: false });
    });

    it("RLS A/B : B ne voit ni ne rejoue l'événement de A", async () => {
      const f = await failedWebhook(tenantA);
      const listB = await call("GET", "/webhook-events", { tenant: tenantB, perms: ["finance.webhook.read"] });
      expect(listB.json.items.some((i: { id: string }) => i.id === f.eventRowId)).toBe(false);
      expect((await call("GET", `/webhook-events/${f.eventRowId}`, { tenant: tenantB, perms: ["finance.webhook.read"] })).status).toBe(404);
      expect((await call("POST", `/webhook-events/${f.eventRowId}/replay`, { tenant: tenantB, perms: ["finance.webhook.replay"] })).status).toBe(404);
      const [row] = await adminRows<{ status: string }>(db, "SELECT status FROM finance.webhook_events WHERE id = $1", [f.eventRowId]);
      expect(row!.status).toBe("FAILED");
    });
  });
});

describe("manifeste : permissions des webhooks en échec", () => {
  it("lecture simple, rejeu sensible", () => {
    const byKey = new Map(manifest.permissions.map((p) => [p.key, p]));
    expect(byKey.get("finance.webhook.read")?.sensitive).toBeFalsy();
    expect(byKey.get("finance.webhook.replay")?.sensitive).toBe(true);
  });
});
