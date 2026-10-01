import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext, newId, unwrap } from "@ecoledigitale/kernel";
import { getInvoiceById } from "../../application/invoices";
import { handleProviderWebhook, initiateOnlinePayment, verifyPendingPayment } from "../../application/online-payments";
import { getPaymentView } from "../../application/payments";
import { SANDBOX_PROVIDER_NAME, SandboxProvider } from "../../infrastructure/providers/sandbox-provider";
import { StaticProviderConfigSource, createProviderRegistry } from "../../infrastructure/providers/registry";
import { adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { FakeRealProvider, fakeDefinition } from "../support/fake-provider";
import { learnerId, nextKey, seedCatalog, simpleInvoice, xof } from "../support/scenario";

/** Le fournisseur sandbox instancié par le registre pour (tenant, "sandbox"). */
async function sandboxOf(world: TestWorld, tenantId: string): Promise<SandboxProvider> {
  const r = await world.providers.resolve(tenantId, SANDBOX_PROVIDER_NAME);
  if (!r.ok) throw r.error;
  return r.value as SandboxProvider;
}

describeIntegration("paiement en ligne : sandbox, webhooks idempotents, registre (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createFinanceTestDb(16);
    world = makeWorld(db);
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    await seedCatalog(world.deps, ctx);
  });
  afterAll(async () => {
    await db.drop();
  });

  const initiate = (learner: string, amount: number, extra: Record<string, unknown> = {}) =>
    initiateOnlinePayment(world.deps, ctx, { idempotencyKey: nextKey("online"), learnerId: learner, amount: xof(amount), provider: "sandbox", ...extra });

  it("succès immédiat : paiement confirmé, imputé à la facture visée, reçu, marqué simulé", async () => {
    const learner = learnerId();
    const target = await simpleInvoice(world.deps, ctx, learner, 100_000, "2025-12-01");
    const other = await simpleInvoice(world.deps, ctx, learner, 100_000, "2025-10-01"); // plus ancienne, mais non visée
    const r = unwrap(await initiate(learner, 25_000, { invoiceId: target.invoice.id }));
    expect(r.payment.status).toBe("CONFIRMED");
    expect(r.payment.simulated).toBe(true);
    expect(r.payment.method).toBe("ONLINE");
    expect(r.payment.provider).toBe("sandbox");
    expect(r.payment.providerRef).toMatch(/^sbx_/);
    expect(r.receipt?.number).toMatch(/^REC-2025-/);
    expect(r.allocations.map((a) => a.invoiceId)).toEqual([target.invoice.id]);
    expect(unwrap(await getInvoiceById(world.deps, ctx, target.invoice.id)).invoice.paid.amount).toBe(25_000);
    expect(unwrap(await getInvoiceById(world.deps, ctx, other.invoice.id)).invoice.paid.amount).toBe(0);

    const types = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE payload->>'paymentId' = $1 ORDER BY id", [r.payment.id]);
    expect(types.map((t) => t.type)).toEqual(expect.arrayContaining(["finance.payment.initiated", "finance.payment.completed"]));
  });

  it("échec : paiement FAILED, événement finance.payment.failed, aucune imputation ni reçu", async () => {
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const r = unwrap(await initiate(learner, 25_013));
    expect(r.payment.status).toBe("FAILED");
    expect(r.payment.failureReason).toBe("sandbox_declined");
    expect(r.receipt).toBeNull();
    expect(r.allocations).toHaveLength(0);
    const ev = await adminRows(db, "SELECT 1 FROM kernel.domain_events WHERE type = 'finance.payment.failed' AND payload->>'paymentId' = $1", [r.payment.id]);
    expect(ev).toHaveLength(1);
  });

  it("initiation idempotente : même clé ⇒ même paiement, une seule transaction fournisseur ; demande différente ⇒ conflit", async () => {
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const key = nextKey("online-idem");
    const a = unwrap(await initiateOnlinePayment(world.deps, ctx, { idempotencyKey: key, learnerId: learner, amount: xof(25_001), provider: "sandbox" }));
    const b = unwrap(await initiateOnlinePayment(world.deps, ctx, { idempotencyKey: key, learnerId: learner, amount: xof(25_001), provider: "sandbox" }));
    expect(b.payment.id).toBe(a.payment.id);
    expect(b.replayed).toBe(true);
    expect(b.payment.status).toBe("PENDING");
    const conflict = await initiateOnlinePayment(world.deps, ctx, { idempotencyKey: key, learnerId: learner, amount: xof(25_002), provider: "sandbox" });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("finance.idempotency_key_reused");
    const rows = await adminRows(db, "SELECT 1 FROM finance.payments WHERE idempotency_key = $1", [key]);
    expect(rows).toHaveLength(1);
  });

  describe("webhooks", () => {
    async function pendingPayment(amount = 25_001) {
      const learner = learnerId();
      const inv = await simpleInvoice(world.deps, ctx, learner, 100_000);
      const view = unwrap(await initiate(learner, amount));
      expect(view.payment.status).toBe("PENDING");
      const sandbox = await sandboxOf(world, tenantId);
      return { learner, inv, view, sandbox, ref: view.payment.providerRef! };
    }
    const send = (wh: { rawBody: string; headers: Record<string, string> }, provider = "sandbox") =>
      handleProviderWebhook(world.deps, { tenantId, provider, rawBody: wh.rawBody, headers: wh.headers });

    it("succès : confirme, impute, émet le reçu ; le rejeu du MÊME événement ne retraite rien", async () => {
      const { inv, view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      const wh = sandbox.buildWebhook(ref);
      const first = unwrap(await send(wh));
      expect(first).toMatchObject({ status: "PROCESSED", replayed: false, paymentId: view.payment.id, paymentStatus: "CONFIRMED" });

      const confirmed = unwrap(await getPaymentView(world.deps, ctx, view.payment.id));
      expect(confirmed.payment.status).toBe("CONFIRMED");
      expect(confirmed.receipt).not.toBeNull();
      expect(confirmed.payment.allocated.amount).toBe(25_001);
      expect(unwrap(await getInvoiceById(world.deps, ctx, inv.invoice.id)).invoice.paid.amount).toBe(25_001);

      // rejeu (rien ne bouge)
      const replay = unwrap(await send(wh));
      expect(replay).toMatchObject({ status: "PROCESSED", replayed: true });
      const rows = await adminRows(db, "SELECT 1 FROM finance.webhook_events WHERE event_id = $1", [wh.eventId]);
      expect(rows).toHaveLength(1);
      const receipts = await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [view.payment.id]);
      expect(receipts).toHaveLength(1);
      expect(unwrap(await getInvoiceById(world.deps, ctx, inv.invoice.id)).invoice.paid.amount).toBe(25_001);
    });

    it("un second événement (autre identifiant) pour un paiement déjà confirmé est IGNORÉ", async () => {
      const { view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      unwrap(await send(sandbox.buildWebhook(ref)));
      const dup = unwrap(await send(sandbox.buildWebhook(ref, { eventId: "evt_autre_identifiant" })));
      expect(dup).toMatchObject({ status: "IGNORED", replayed: false });
      const confirmed = unwrap(await getPaymentView(world.deps, ctx, view.payment.id));
      expect(confirmed.allocations).toHaveLength(1);
    });

    it("livraisons CONCURRENTES du même événement : traité une seule fois", async () => {
      const { inv, view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      const wh = sandbox.buildWebhook(ref);
      const results = await Promise.all(Array.from({ length: 10 }, () => send(wh)));
      const values = results.map((r) => unwrap(r));
      expect(values.filter((v) => !v.replayed)).toHaveLength(1);
      expect(values.every((v) => v.status === "PROCESSED")).toBe(true);
      expect(unwrap(await getInvoiceById(world.deps, ctx, inv.invoice.id)).invoice.paid.amount).toBe(25_001);
      const allocs = await adminRows(db, "SELECT 1 FROM finance.payment_allocations WHERE payment_id = $1", [view.payment.id]);
      expect(allocs).toHaveLength(1);
      const receipts = await adminRows(db, "SELECT 1 FROM finance.receipts WHERE payment_id = $1", [view.payment.id]);
      expect(receipts).toHaveLength(1);
    });

    it("signature invalide ou corps altéré ⇒ 401 et RIEN n'est stocké ni modifié", async () => {
      const { view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      const wh = sandbox.buildWebhook(ref);
      const tampered = await send({ rawBody: wh.rawBody.replace("25001", "99999"), headers: wh.headers });
      expect(tampered.ok).toBe(false);
      if (!tampered.ok) {
        expect(tampered.error.code).toBe("finance.webhook_signature_invalid");
        expect(tampered.error.httpStatus).toBe(401);
      }
      const noSig = await send({ rawBody: wh.rawBody, headers: {} });
      expect(noSig.ok).toBe(false);
      const stored = await adminRows(db, "SELECT 1 FROM finance.webhook_events WHERE event_id = $1", [wh.eventId]);
      expect(stored).toHaveLength(0);
      expect(unwrap(await getPaymentView(world.deps, ctx, view.payment.id)).payment.status).toBe("PENDING");
    });

    it("montant divergent : événement enregistré FAILED, le paiement reste EN ATTENTE (rapprochement manuel)", async () => {
      const { view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      const wh = sandbox.buildWebhook(ref, { amount: xof(1_000) });
      const r = unwrap(await send(wh));
      expect(r.status).toBe("FAILED");
      expect(unwrap(await getPaymentView(world.deps, ctx, view.payment.id)).payment.status).toBe("PENDING");
      const [row] = await adminRows<{ status: string; error: string }>(db, "SELECT status, error FROM finance.webhook_events WHERE event_id = $1", [wh.eventId]);
      expect(row).toMatchObject({ status: "FAILED", error: "finance.provider_amount_mismatch" });
    });

    it("succès sans montant : refusé (jamais d'encaissement non vérifiable)", async () => {
      const { view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      const r = unwrap(await send(sandbox.buildWebhook(ref, { omitAmount: true })));
      expect(r.status).toBe("FAILED");
      expect(unwrap(await getPaymentView(world.deps, ctx, view.payment.id)).payment.status).toBe("PENDING");
    });

    it("échec annoncé par le fournisseur : paiement FAILED ; un succès tardif est signalé sans rien encaisser", async () => {
      const { view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "failure");
      const failed = unwrap(await send(sandbox.buildWebhook(ref)));
      expect(failed.status).toBe("PROCESSED");
      expect(unwrap(await getPaymentView(world.deps, ctx, view.payment.id)).payment.status).toBe("FAILED");

      const late = unwrap(await send(sandbox.buildWebhook(ref, { status: "SUCCEEDED", eventId: "evt_tardif", amount: xof(25_001) })));
      expect(late.status).toBe("FAILED"); // à rapprocher à la main
      const after = unwrap(await getPaymentView(world.deps, ctx, view.payment.id));
      expect(after.payment.status).toBe("FAILED");
      expect(after.receipt).toBeNull();
      const [row] = await adminRows<{ error: string }>(db, "SELECT error FROM finance.webhook_events WHERE event_id = 'evt_tardif'");
      expect(row!.error).toBe("finance.provider_failed");
    });

    it("paiement inconnu : événement enregistré IGNORED (pas de nouvelle tentative inutile du fournisseur)", async () => {
      const sandbox = await sandboxOf(world, tenantId);
      const init = await sandbox.initiate({ tenantId, paymentId: newId(), amount: xof(25_001) });
      const ref = init.ok ? init.value.providerRef! : "";
      sandbox.settle(ref, "success");
      const r = unwrap(await send(sandbox.buildWebhook(ref)));
      expect(r).toMatchObject({ status: "IGNORED", paymentId: null });
    });

    it("l'événement relie aussi le paiement par la référence du fournisseur seule", async () => {
      const { view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      const wh = sandbox.buildWebhook(ref);
      const body = JSON.parse(wh.rawBody);
      delete body.reference;
      const raw = JSON.stringify(body);
      const r = unwrap(await send({ rawBody: raw, headers: { ...wh.headers, "x-sandbox-signature": sandbox.sign(raw) } }));
      expect(r.status).toBe("PROCESSED");
      expect(unwrap(await getPaymentView(world.deps, ctx, view.payment.id)).payment.status).toBe("CONFIRMED");
    });

    it("fournisseur non configuré / inconnu : refus explicite", async () => {
      const r = await handleProviderWebhook(world.deps, { tenantId, provider: "inconnu", rawBody: "{}", headers: {} });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("finance.provider_unknown");
    });

    it("un webhook ne traverse pas les tenants : l'identifiant d'un autre tenant ne trouve rien", async () => {
      const { view, sandbox, ref } = await pendingPayment();
      sandbox.settle(ref, "success");
      const otherTenant = await db.createTenant();
      const otherSandbox = await sandboxOf(world, otherTenant);
      const init = await otherSandbox.initiate({ tenantId: otherTenant, paymentId: view.payment.id, amount: xof(25_001) });
      expect(init.ok).toBe(true);
      otherSandbox.settle(`sbx_${view.payment.id}`, "success");
      const wh = otherSandbox.buildWebhook(`sbx_${view.payment.id}`);
      const r = unwrap(await handleProviderWebhook(world.deps, { tenantId: otherTenant, provider: "sandbox", rawBody: wh.rawBody, headers: wh.headers }));
      expect(r.status).toBe("IGNORED"); // le paiement appartient à un autre tenant : invisible (RLS)
      expect(unwrap(await getPaymentView(world.deps, ctx, view.payment.id)).payment.status).toBe("PENDING");
    });
  });

  it("vérification active (poll) d'un paiement en attente", async () => {
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const view = unwrap(await initiate(learner, 25_001));
    const sandbox = await sandboxOf(world, tenantId);
    const still = unwrap(await verifyPendingPayment(world.deps, ctx, { paymentId: view.payment.id }));
    expect(still.payment.status).toBe("PENDING");
    sandbox.settle(view.payment.providerRef!, "success");
    const done = unwrap(await verifyPendingPayment(world.deps, ctx, { paymentId: view.payment.id }));
    expect(done.payment.status).toBe("CONFIRMED");
    expect(done.receipt).not.toBeNull();
    // idempotent : une seconde vérification ne change rien
    const again = unwrap(await verifyPendingPayment(world.deps, ctx, { paymentId: view.payment.id }));
    expect(again.payment.status).toBe("CONFIRMED");
    expect(again.allocations).toHaveLength(1);
  });

  describe("registre en environnement de production", () => {
    it("la sandbox est refusée ; un fournisseur non configuré aussi ; configuré, il fonctionne comme un vrai adaptateur", async () => {
      const prodTenant = await db.createTenant();
      const prodCtx = ctxFor(prodTenant);
      const config = new StaticProviderConfigSource();
      const instances: FakeRealProvider[] = [];
      const providers = createProviderRegistry({ environment: "production", configSource: config }).register(fakeDefinition("wave", instances));
      const prod = makeWorld(db, { config: { environment: "production" }, providers });
      await seedCatalog(prod.deps, prodCtx);
      const learner = learnerId();
      const inv = await simpleInvoice(prod.deps, prodCtx, learner, 100_000);

      const sandbox = await initiateOnlinePayment(prod.deps, prodCtx, { idempotencyKey: nextKey(), learnerId: learner, amount: xof(25_000), provider: "sandbox" });
      expect(sandbox.ok).toBe(false);
      if (!sandbox.ok) expect(sandbox.error.code).toBe("finance.provider_sandbox_forbidden");
      const unconfigured = await initiateOnlinePayment(prod.deps, prodCtx, { idempotencyKey: nextKey(), learnerId: learner, amount: xof(25_000), provider: "wave" });
      expect(unconfigured.ok).toBe(false);
      if (!unconfigured.ok) expect(unconfigured.error.code).toBe("finance.provider_not_configured");
      const none = await adminRows(db, "SELECT 1 FROM finance.payments WHERE tenant_id = $1", [prodTenant]);
      expect(none).toHaveLength(0); // aucun paiement créé quand le fournisseur est refusé

      config.set(prodTenant, "wave", { apiKey: "key", webhookSecret: "whsec" });
      const view = unwrap(await initiateOnlinePayment(prod.deps, prodCtx, { idempotencyKey: nextKey(), learnerId: learner, amount: xof(25_000), provider: "wave", invoiceId: inv.invoice.id, payer: { phoneNumber: "+2250700000000" } }));
      expect(view.payment.status).toBe("PENDING");
      expect(view.payment.simulated).toBe(false);
      expect(view.instructions?.ussdCode).toBe("*144#");
      const fake = instances[0]!;
      expect(fake.initiations).toHaveLength(1);
      expect(fake.initiations[0]).toMatchObject({ tenantId: prodTenant, paymentId: view.payment.id });

      // webhook signé du fournisseur réel
      const raw = JSON.stringify({ event: "ev-1", kind: "pay.ok", order: view.payment.id, ref: view.payment.providerRef, amount: 25_000, ok: true });
      const headers = { "x-fake-signature": fake.sign(raw) };
      const done = unwrap(await handleProviderWebhook(prod.deps, { tenantId: prodTenant, provider: "wave", rawBody: raw, headers }));
      expect(done.status).toBe("PROCESSED");
      expect(unwrap(await getPaymentView(prod.deps, prodCtx, view.payment.id)).payment.status).toBe("CONFIRMED");
      // mauvais secret ⇒ refus
      const bad = await handleProviderWebhook(prod.deps, { tenantId: prodTenant, provider: "wave", rawBody: raw.replace("ev-1", "ev-2"), headers });
      expect(bad.ok).toBe(false);
    });

    it("un paiement simulé ne peut JAMAIS être confirmé en production (même via un webhook valide)", async () => {
      const t = await db.createTenant();
      const c = ctxFor(t);
      const config = new StaticProviderConfigSource();
      const providers = createProviderRegistry({ environment: "production", configSource: config });
      const prod = makeWorld(db, { config: { environment: "production" }, providers });
      config.set(t, "sandbox", { allowSandbox: "true" }); // tenant de démonstration explicitement autorisé
      await seedCatalog(prod.deps, c);
      const learner = learnerId();
      await simpleInvoice(prod.deps, c, learner, 100_000);
      const view = unwrap(await initiateOnlinePayment(prod.deps, c, { idempotencyKey: nextKey(), learnerId: learner, amount: xof(25_001), provider: "sandbox" }));
      expect(view.payment.simulated).toBe(true);
      expect(view.payment.status).toBe("PENDING");
      const sb = (await prod.providers.resolve(t, "sandbox")) as { ok: true; value: SandboxProvider };
      sb.value.settle(view.payment.providerRef!, "success");
      const wh = sb.value.buildWebhook(view.payment.providerRef!);
      const r = unwrap(await handleProviderWebhook(prod.deps, { tenantId: t, provider: "sandbox", rawBody: wh.rawBody, headers: wh.headers }));
      expect(r.status).toBe("FAILED");
      expect(unwrap(await getPaymentView(prod.deps, c, view.payment.id)).payment.status).toBe("PENDING");
      const [row] = await adminRows<{ error: string }>(db, "SELECT error FROM finance.webhook_events WHERE tenant_id = $1", [t]);
      expect(row!.error).toBe("finance.simulated_payment_in_production");
    });
  });

  it("échec technique du fournisseur : le paiement reste PENDING et se rejoue avec la même clé", async () => {
    const t = await db.createTenant();
    const c = ctxFor(t);
    const config = new StaticProviderConfigSource().set(t, "wave", { apiKey: "key", webhookSecret: "whsec" });
    const instances: FakeRealProvider[] = [];
    const providers = createProviderRegistry({ environment: "production", configSource: config }).register(fakeDefinition("wave", instances));
    const prod = makeWorld(db, { config: { environment: "production" }, providers });
    await seedCatalog(prod.deps, c);
    const learner = learnerId();
    await simpleInvoice(prod.deps, c, learner, 100_000);
    // première résolution pour obtenir l'instance, puis panne
    await prod.providers.resolve(t, "wave");
    instances[0]!.failNextInitiate = true;
    const key = nextKey("retry");
    const first = await initiateOnlinePayment(prod.deps, c, { idempotencyKey: key, learnerId: learner, amount: xof(25_000), provider: "wave" });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.code).toBe("finance.provider_failed");
    const pending = await adminRows<{ status: string; provider_ref: string | null }>(db, "SELECT status, provider_ref FROM finance.payments WHERE idempotency_key = $1", [key]);
    expect(pending).toEqual([{ status: "PENDING", provider_ref: null }]);

    const retry = unwrap(await initiateOnlinePayment(prod.deps, c, { idempotencyKey: key, learnerId: learner, amount: xof(25_000), provider: "wave" }));
    expect(retry.payment.providerRef).toMatch(/^wave-/);
    expect(instances[0]!.initiations).toHaveLength(1);
    const all = await adminRows(db, "SELECT 1 FROM finance.payments WHERE idempotency_key = $1", [key]);
    expect(all).toHaveLength(1);
  });

  it("le contexte système d'un webhook n'est pas un utilisateur : reçu émis sans émetteur", async () => {
    const sys = createSystemContext(tenantId);
    expect(sys.userId).toBeNull();
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const view = unwrap(await initiate(learner, 25_001));
    const sandbox = await sandboxOf(world, tenantId);
    sandbox.settle(view.payment.providerRef!, "success");
    const wh = sandbox.buildWebhook(view.payment.providerRef!);
    unwrap(await handleProviderWebhook(world.deps, { tenantId, provider: "sandbox", rawBody: wh.rawBody, headers: wh.headers }));
    const [row] = await adminRows<{ issued_by: string | null }>(db, "SELECT issued_by FROM finance.receipts WHERE payment_id = $1", [view.payment.id]);
    expect(row!.issued_by).toBeNull();
  });
});
