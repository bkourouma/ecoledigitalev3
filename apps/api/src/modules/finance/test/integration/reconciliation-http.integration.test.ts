/**
 * Routes du rapprochement : `GET /payments/pending`, `GET|POST /resolutions…`, repli manuel des remboursements.
 * Matrice de permissions (lecture / résolution sensible), quatre yeux de bout en bout par HTTP, validation stricte des
 * corps, forme des réponses (contrats Zod), isolation entre tenants. Fastify + Postgres réel, fournisseur factice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ForbiddenError, UnauthorizedError, createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import {
  financePendingPaymentsDtoSchema,
  financeRefundDtoSchema,
  financeResolutionDtoSchema,
} from "@ecoledigitale/contracts/src/v2/finance";
import manifest from "../../manifest";
import { createFinanceDeps } from "../../application/deps";
import { initiateOnlinePayment, verifyPendingPayment } from "../../application/online-payments";
import { requestRefund } from "../../application/refunds";
import { financePlugin } from "../../http/plugin";
import { createProviderRegistry, StaticProviderConfigSource } from "../../infrastructure/providers/registry";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { fakeDefinition, type FakeRealProvider } from "../support/fake-provider";
import { xof } from "../support/harness";
import { learnerId, nextKey, seedCatalog, simpleInvoice } from "../support/scenario";

const ALL = manifest.permissions.map((p) => p.key);
const READ = ["finance.payment.read"];
const RECONCILE = ["finance.payment.read", "finance.payment.reconcile"];

describeIntegration("API HTTP du rapprochement (permissions, quatre yeux, contrats)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let app: FastifyInstance;
  let tenantA: string;
  let tenantB: string;
  let fakes: FakeRealProvider[];
  const alice = newId();
  const bob = newId();

  beforeAll(async () => {
    db = await createFinanceTestDb();
    tenantA = await db.createTenant();
    tenantB = await db.createTenant();
    fakes = [];
    const source = new StaticProviderConfigSource();
    for (const t of [tenantA, tenantB]) source.set(t, "fakepay", { apiKey: "k", webhookSecret: "s" });
    const providers = createProviderRegistry({ environment: "test", configSource: source }).register(fakeDefinition("fakepay", fakes));
    world = makeWorld(db, { providers });
    await seedCatalog(world.deps, ctxFor(tenantA));
    app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      const tenant = req.headers["x-test-tenant"];
      const user = req.headers["x-test-user"];
      if (typeof tenant === "string") {
        (req as unknown as { ctx: unknown }).ctx = createRequestContext({ tenantId: tenant, userId: typeof user === "string" && user !== "" ? user : newId(), roles: [] });
      }
    });
    await app.register(financePlugin, {
      deps: createFinanceDeps({ db: db.tenantDb, clock: world.clock, providers: world.providers, enrollments: world.enrollments, config: { environment: "test" } }),
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

  async function call(method: "GET" | "POST", url: string, o: { tenant?: string | "none"; user?: string; perms?: string[]; body?: unknown; query?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { "x-test-perms": (o.perms ?? ALL).join(",") };
    if (o.tenant !== "none") headers["x-test-tenant"] = o.tenant ?? tenantA;
    headers["x-test-user"] = o.user ?? alice;
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

  /** Paiement en ligne EN ATTENTE chez le faux fournisseur (sans API de remboursement). */
  async function pendingPayment(tenantId: string) {
    const ctx = ctxFor(tenantId);
    const learner = learnerId();
    const inv = await simpleInvoice(world.deps, ctx, learner, 100_000);
    const key = nextKey("http-rec");
    unwrap(await initiateOnlinePayment(world.deps, ctx, { idempotencyKey: key, learnerId: learner, amount: xof(30_000), provider: "fakepay", invoiceId: inv.invoice.id }));
    const [row] = await adminRows<{ id: string }>(db, "SELECT id FROM finance.payments WHERE idempotency_key = $1", [key]);
    return { id: row!.id, ctx, invoiceId: inv.invoice.id };
  }

  describe("GET /payments/pending", () => {
    it("401 sans contexte ; 403 sans `finance.payment.read` ; 200 avec — forme conforme au contrat", async () => {
      expect((await call("GET", "/payments/pending", { tenant: "none" })).status).toBe(401);
      expect((await call("GET", "/payments/pending", { perms: ["finance.invoice.read"] })).status).toBe(403);
      const p = await pendingPayment(tenantA);
      const ok = await call("GET", "/payments/pending", { perms: READ });
      expect(ok.status).toBe(200);
      const parsed = financePendingPaymentsDtoSchema.parse(ok.json);
      expect(parsed.items.some((i) => i.payment.id === p.id)).toBe(true);
      expect(parsed.total).toBeGreaterThanOrEqual(1);
      expect(parsed.items.find((i) => i.payment.id === p.id)).toMatchObject({ reconciliation: null, openResolutionId: null });
    });

    it("filtres validés (flagged, provider, olderThanMinutes) ; paramètre invalide => 400", async () => {
      expect((await call("GET", "/payments/pending", { perms: READ, query: { flagged: "true" } })).status).toBe(200);
      expect((await call("GET", "/payments/pending", { perms: READ, query: { provider: "fakepay", olderThanMinutes: "30" } })).status).toBe(200);
      expect((await call("GET", "/payments/pending", { perms: READ, query: { flagged: "peut-etre" } })).status).toBe(400);
      expect((await call("GET", "/payments/pending", { perms: READ, query: { provider: "Pas Valide!" } })).status).toBe(400);
    });

    it("RLS : un tenant ne voit pas les paiements en attente d'un autre", async () => {
      const b = await pendingPayment(tenantB);
      const fromA = await call("GET", "/payments/pending", { perms: READ, tenant: tenantA });
      expect(fromA.json.items.some((i: { payment: { id: string } }) => i.payment.id === b.id)).toBe(false);
      const fromB = await call("GET", "/payments/pending", { perms: READ, tenant: tenantB });
      expect(fromB.json.items.some((i: { payment: { id: string } }) => i.payment.id === b.id)).toBe(true);
    });
  });

  describe("résolution manuelle : matrice de permissions et quatre yeux", () => {
    it("lecture seule : peut LISTER, ne peut ni demander ni approuver ni refuser (403)", async () => {
      const p = await pendingPayment(tenantA);
      const body = { paymentId: p.id, outcome: "SUCCEEDED", reason: "Relevé opérateur du jour : encaissé", evidenceRef: "REL-0901-1" };
      expect((await call("GET", "/resolutions", { perms: READ })).status).toBe(200);
      for (const perms of [READ, ["finance.payment.create"], ["finance.payment.refund"], ["finance.provider.manage"]]) {
        expect((await call("POST", "/resolutions", { perms, body })).status, perms.join()).toBe(403);
        expect((await call("POST", `/resolutions/${newId()}/approve`, { perms, body: {} })).status, perms.join()).toBe(403);
        expect((await call("POST", `/resolutions/${newId()}/reject`, { perms, body: {} })).status, perms.join()).toBe(403);
      }
      expect((await call("POST", "/resolutions", { tenant: "none", body })).status).toBe(401);
    });

    it("corps strict : sujet unique, motif, preuve, champs inconnus refusés (400)", async () => {
      const p = await pendingPayment(tenantA);
      const good = { paymentId: p.id, outcome: "SUCCEEDED", reason: "Relevé opérateur du jour : encaissé", evidenceRef: "REL-0901-2" };
      for (const bad of [
        { ...good, paymentId: undefined },
        { ...good, refundId: newId() },
        { ...good, outcome: "PENDING" },
        { ...good, reason: "court" },
        { ...good, evidenceRef: "x" },
        { ...good, status: "APPROVED" },
        { ...good, paymentId: "pas-un-uuid" },
      ]) {
        expect((await call("POST", "/resolutions", { perms: RECONCILE, body: bad })).status, JSON.stringify(bad)).toBe(400);
      }
    });

    it("de bout en bout : demande (alice) -> auto-approbation 409 -> approbation (bob) -> paiement CONFIRMÉ ; rejeu 409 ; liste filtrée", async () => {
      const p = await pendingPayment(tenantA);
      const created = await call("POST", "/resolutions", { perms: RECONCILE, user: alice, body: { paymentId: p.id, outcome: "SUCCEEDED", reason: "Relevé opérateur du jour : encaissé", evidenceRef: "REL-0901-3" } });
      expect(created.status).toBe(201);
      const res = financeResolutionDtoSchema.parse(created.json);
      expect(res).toMatchObject({ status: "REQUESTED", paymentId: p.id, refundId: null, requestedBy: alice, decidedBy: null });

      // Une seule demande ouverte par sujet.
      const dup = await call("POST", "/resolutions", { perms: RECONCILE, user: bob, body: { paymentId: p.id, outcome: "FAILED", reason: "Demande concurrente sur le même sujet", evidenceRef: "REL-X" } });
      expect(dup.status).toBe(409);
      expect(dup.json.code).toBe("finance.resolution_already_open");

      const listed = await call("GET", "/payments/pending", { perms: READ });
      expect(listed.json.items.find((i: { payment: { id: string } }) => i.payment.id === p.id).openResolutionId).toBe(res.id);

      const self = await call("POST", `/resolutions/${res.id}/approve`, { perms: RECONCILE, user: alice, body: {} });
      expect(self.status).toBe(409);
      expect(self.json.code).toBe("finance.resolution_self_approval");
      expect((await adminRows<{ status: string }>(db, "SELECT status FROM finance.payments WHERE id = $1", [p.id]))[0]!.status).toBe("PENDING");

      const other = await call("POST", `/resolutions/${res.id}/approve`, { perms: RECONCILE, user: bob, tenant: tenantB, body: {} });
      expect(other.status).toBe(404); // autre tenant : introuvable
      const approved = await call("POST", `/resolutions/${res.id}/approve`, { perms: RECONCILE, user: bob, body: { note: "Vérifié" } });
      expect(approved.status).toBe(200);
      expect(financeResolutionDtoSchema.parse(approved.json)).toMatchObject({ status: "APPROVED", decidedBy: bob, decisionNote: "Vérifié" });
      expect((await adminRows<{ status: string }>(db, "SELECT status FROM finance.payments WHERE id = $1", [p.id]))[0]!.status).toBe("CONFIRMED");
      expect((await call("POST", `/resolutions/${res.id}/approve`, { perms: RECONCILE, user: bob, body: {} })).status).toBe(409);
      expect((await call("POST", `/resolutions/${res.id}/reject`, { perms: RECONCILE, user: bob, body: {} })).status).toBe(409);

      const approvedList = await call("GET", "/resolutions", { perms: READ, query: { status: "APPROVED", paymentId: p.id } });
      expect(approvedList.status).toBe(200);
      expect(approvedList.json.items.map((r: { id: string }) => r.id)).toEqual([res.id]);
      // L'écran n'affiche plus le paiement : il n'est plus en attente.
      const after = await call("GET", "/payments/pending", { perms: READ });
      expect(after.json.items.some((i: { payment: { id: string } }) => i.payment.id === p.id)).toBe(false);
    });

    it("refus : la demande est close sans effet ; une nouvelle demande est possible", async () => {
      const p = await pendingPayment(tenantA);
      const created = await call("POST", "/resolutions", { perms: RECONCILE, user: alice, body: { paymentId: p.id, outcome: "FAILED", reason: "Le client conteste le débit initial", evidenceRef: "APPEL-77" } });
      const rejected = await call("POST", `/resolutions/${created.json.id}/reject`, { perms: RECONCILE, user: bob, body: { note: "Preuve insuffisante" } });
      expect(rejected.status).toBe(200);
      expect(rejected.json).toMatchObject({ status: "REJECTED", decidedBy: bob });
      expect((await adminRows<{ status: string }>(db, "SELECT status FROM finance.payments WHERE id = $1", [p.id]))[0]!.status).toBe("PENDING");
      const again = await call("POST", "/resolutions", { perms: RECONCILE, user: alice, body: { paymentId: p.id, outcome: "FAILED", reason: "Relevé : aucune transaction trouvée", evidenceRef: "REL-APRES" } });
      expect(again.status).toBe(201);
    });
  });

  describe("remboursement : repli manuel par HTTP", () => {
    async function confirmedFakePayment() {
      const p = await pendingPayment(tenantA);
      fakes.forEach((f) => {
        f.verifyStatus = "SUCCEEDED";
        f.verifyAmount = xof(30_000);
      });
      unwrap(await verifyPendingPayment(world.deps, p.ctx, { paymentId: p.id }));
      fakes.forEach((f) => {
        f.verifyStatus = "PENDING";
        f.verifyAmount = null;
      });
      return p;
    }

    it("fournisseur sans API : approbation => APPROUVÉ ; exécution sans preuve 409 ; avec preuve 200 (MANUAL) ; corps strict", async () => {
      const p = await confirmedFakePayment();
      const refund = unwrap(await requestRefund(world.deps, ctxFor(tenantA, alice), { paymentId: p.id, amount: xof(30_000), reason: "Paiement en double de la famille" }));
      const approved = await call("POST", `/refunds/${refund.id}/approve`, { user: bob, body: {} });
      expect(approved.status).toBe(200);
      expect(financeRefundDtoSchema.parse(approved.json).status).toBe("APPROVED");

      const noProof = await call("POST", `/refunds/${refund.id}/complete`, { user: bob, body: {} });
      expect(noProof.status).toBe(409);
      expect(noProof.json.code).toBe("finance.refund_manual_required");

      expect((await call("POST", `/refunds/${refund.id}/complete`, { user: bob, body: { manual: { reference: "x" } } })).status).toBe(400);
      expect((await call("POST", `/refunds/${refund.id}/complete`, { user: bob, body: { manual: { reference: "BO-FAKE-1", extra: 1 } } })).status).toBe(400);
      expect((await call("POST", `/refunds/${refund.id}/complete`, { user: bob, perms: READ, body: { manual: { reference: "BO-FAKE-1" } } })).status).toBe(403);

      const done = await call("POST", `/refunds/${refund.id}/complete`, { user: bob, body: { manual: { reference: "BO-FAKE-1", note: "Remboursé depuis le portail marchand" } } });
      expect(done.status).toBe(200);
      expect(financeRefundDtoSchema.parse(done.json)).toMatchObject({ status: "COMPLETED", executionMode: "MANUAL", manualReference: "BO-FAKE-1", provider: null });
    });

    it("`manual` accepté dès l'approbation ; statuts REFUND_PENDING / REFUND_FAILED présents dans le contrat", async () => {
      const p = await confirmedFakePayment();
      const refund = unwrap(await requestRefund(world.deps, ctxFor(tenantA, alice), { paymentId: p.id, amount: xof(10_000), reason: "Remise accordée à la famille" }));
      const done = await call("POST", `/refunds/${refund.id}/approve`, { user: bob, body: { manual: { reference: "BO-FAKE-2" } } });
      expect(done.status).toBe(200);
      expect(done.json).toMatchObject({ status: "COMPLETED", executionMode: "MANUAL" });
      expect(financeRefundDtoSchema.shape.status.options).toEqual(expect.arrayContaining(["REFUND_PENDING", "REFUND_FAILED", "COMPLETED"]));
    });
  });
});
